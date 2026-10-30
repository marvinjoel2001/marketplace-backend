import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface SocialLoginDto {
  email: string;
  name: string;
  avatar?: string;
  provider?: string; // TIKTOK, GOOGLE, FACEBOOK, PHONE
  phone?: string;
  visitorId?: string;
  interestProfile?: string;
  cart?: string;
}

export interface EnrichProfileDto {
  userId: string;
  phone?: string;
  name?: string;
  city?: string;
  zone?: string;
  address: string;
  addressReference?: string;
  lat?: number | string;
  lng?: number | string;
  nitOrCi?: string;
}

/** Bolivian mobile numbers: 8 digits, optionally prefixed with 591. Returns null when invalid. */
export function normalizeBoliviaPhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  const national = digits.startsWith('591') ? digits.slice(3) : digits;
  return /^[67]\d{7}$/.test(national) ? `+591 ${national}` : null;
}

export interface SyncInterestsDto {
  userId: string;
  interestProfile: string;
  cart?: string;
}

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async socialLogin(dto: SocialLoginDto) {
    if (!dto.email || !dto.name) {
      throw new BadRequestException('Email y nombre son requeridos para la autenticación');
    }

    const provider = dto.provider || 'TIKTOK';
    // A phone number only identifies someone after a WhatsApp code: see loginWithVerifiedPhone.
    if (provider === 'PHONE') throw new BadRequestException('Confirma tu celular con el código de WhatsApp');
    const phone = dto.phone ? normalizeBoliviaPhone(dto.phone) : null;
    if (dto.phone && !phone) {
      throw new BadRequestException('Escribe un celular boliviano de 8 dígitos, por ejemplo 71234567');
    }

    let user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    this.assertCanSignIn(user);

    let isNewUser = false;

    if (!user) {
      if (phone) {
        const duplicatePhone = await this.prisma.user.findFirst({
          where: { phone },
        });
        if (duplicatePhone) {
          throw new BadRequestException('Ya existe una cuenta con este número de celular');
        }
      }
      isNewUser = true;
      user = await this.prisma.user.create({
        data: {
          email: dto.email.toLowerCase(),
          name: dto.name,
          avatar: dto.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(dto.name)}`,
          provider,
          phone,
          interestProfile: dto.interestProfile || null,
          savedCart: dto.cart || null,
        },
      });
    } else {
      // Merging interestProfile if incoming exists
      let mergedInterest = user.interestProfile;
      if (dto.interestProfile) {
        try {
          const currentProfile = user.interestProfile ? JSON.parse(user.interestProfile) : {};
          const incomingProfile = JSON.parse(dto.interestProfile);

          // Merge weighted category counts
          const mergedCategories = { ...(currentProfile.recentCategories || {}) };
          if (incomingProfile.recentCategories) {
            for (const [cat, count] of Object.entries(incomingProfile.recentCategories)) {
              mergedCategories[cat] = (mergedCategories[cat] || 0) + Number(count);
            }
          }

          // Merge search keywords
          const mergedKeywords = [
            ...(incomingProfile.searchKeywords || []),
            ...(currentProfile.searchKeywords || []),
          ].slice(0, 15);

          mergedInterest = JSON.stringify({
            ...currentProfile,
            ...incomingProfile,
            recentCategories: mergedCategories,
            searchKeywords: mergedKeywords,
            visitorId: currentProfile.visitorId || incomingProfile.visitorId,
          });
        } catch {
          mergedInterest = dto.interestProfile;
        }
      }

      user = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          avatar: dto.avatar || user.avatar,
          interestProfile: mergedInterest,
          savedCart: dto.cart || user.savedCart,
        },
      });
    }

    const isProfileComplete = Boolean(user.phone && user.address);

    return {
      user,
      isNewUser,
      isProfileComplete,
      message: isProfileComplete
        ? 'Sesión iniciada con éxito'
        : 'Falta tu dirección de entrega',
    };
  }

  /** Signs in (or registers) the owner of a phone number that already passed the WhatsApp or SMS code check. */
  async loginWithVerifiedPhone(phone: string) {
    const cleanPhone = normalizeBoliviaPhone(phone) ?? phone;
    const digits = cleanPhone.replace(/\D/g, '').replace(/^591/, '');
    const email = `${digits}@tel.vitrina.bo`;
    let existing = await this.prisma.user.findUnique({ where: { email } });
    if (!existing) {
      existing = await this.prisma.user.findFirst({
        where: {
          OR: [
            { phone: cleanPhone },
            { phone: digits },
            { phone: `+591${digits}` },
          ],
        },
      });
    }
    this.assertCanSignIn(existing);

    const user = existing
      ? await this.prisma.user.update({
          where: { id: existing.id },
          data: { phone: cleanPhone, phoneVerifiedAt: new Date() },
        })
      : await this.prisma.user.create({
          data: {
            email,
            name: `Cliente ${digits.slice(-4)}`,
            avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(digits)}`,
            provider: 'PHONE',
            phone: cleanPhone,
            phoneVerifiedAt: new Date(),
          },
        });
    const isProfileComplete = Boolean(user.phone && user.address);
    return {
      user,
      isNewUser: !existing,
      isProfileComplete,
      message: isProfileComplete ? 'Sesión iniciada con éxito' : 'Falta tu dirección de entrega',
    };
  }

  private assertCanSignIn(user: { status: string } | null) {
    if (user && user.status !== 'ACTIVE') {
      throw new ForbiddenException('Tu cuenta está suspendida. Escríbenos si crees que es un error.');
    }
  }

  async enrichProfile(dto: EnrichProfileDto) {
    if (!dto.userId) {
      throw new BadRequestException('userId es obligatorio');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
    });

    if (!user) {
      throw new NotFoundException(`Usuario con ID ${dto.userId} no encontrado`);
    }

    // The phone may already be known (phone sign-in); otherwise the driver needs one to call.
    const cleanPhone = dto.phone ? normalizeBoliviaPhone(dto.phone) : user.phone;
    if (!cleanPhone) {
      throw new BadRequestException(
        'El número de celular debe contener 8 dígitos bolivianos (ej. 77012345 o 68912345)'
      );
    }
    if (dto.phone && cleanPhone !== user.phone) {
      const duplicate = await this.prisma.user.findFirst({
        where: { phone: cleanPhone, id: { not: user.id } },
      });
      if (duplicate) {
        throw new BadRequestException('Este número de celular ya está registrado en otra cuenta');
      }
    }
    if (!dto.address || !String(dto.address).trim()) {
      throw new BadRequestException('Escribe o marca tu dirección de entrega');
    }
    const lat = dto.lat === undefined || dto.lat === null ? user.lat ?? null : Number(dto.lat);
    const lng = dto.lng === undefined || dto.lng === null ? user.lng ?? null : Number(dto.lng);
    if ((lat !== null && !Number.isFinite(lat)) || (lng !== null && !Number.isFinite(lng))) {
      throw new BadRequestException('La ubicación del mapa no es válida');
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        phone: cleanPhone,
        name: dto.name?.trim() || user.name,
        city: dto.city || user.city || 'Santa Cruz de la Sierra',
        zone: dto.zone || user.zone,
        address: String(dto.address).trim(),
        addressReference: dto.addressReference ?? user.addressReference,
        lat,
        lng,
        nitOrCi: dto.nitOrCi || user.nitOrCi,
      },
    });

    return {
      user: updatedUser,
      isProfileComplete: true,
      message: 'Datos de contacto y entrega enriquecidos exitosamente',
    };
  }

  async syncInterests(dto: SyncInterestsDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
    });

    if (!user) {
      throw new NotFoundException(`Usuario con ID ${dto.userId} no encontrado`);
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        interestProfile: dto.interestProfile,
        ...(dto.cart ? { savedCart: dto.cart } : {}),
      },
    });

    return {
      success: true,
      user: updatedUser,
    };
  }

  async getUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        orders: {
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
      },
    });

    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    return user;
  }
}
