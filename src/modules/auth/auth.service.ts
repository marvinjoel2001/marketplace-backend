import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface SocialLoginDto {
  email: string;
  name: string;
  avatar?: string;
  provider?: string; // TIKTOK, GOOGLE, FACEBOOK
  visitorId?: string;
  interestProfile?: string;
  cart?: string;
}

export interface EnrichProfileDto {
  userId: string;
  phone: string;
  city?: string;
  zone?: string;
  address: string;
  addressReference?: string;
  nitOrCi?: string;
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

    let user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    let isNewUser = false;

    if (!user) {
      isNewUser = true;
      user = await this.prisma.user.create({
        data: {
          email: dto.email.toLowerCase(),
          name: dto.name,
          avatar: dto.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(dto.name)}`,
          provider,
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
        : 'Perfil requiere enriquecimiento de datos para despacho OpenDSP',
    };
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

    // Bolivian phone validation: 8 digits required (e.g. 77012345 or +591 77012345)
    const digitsOnly = dto.phone.replace(/\D/g, '');
    const nationalDigits = digitsOnly.startsWith('591') ? digitsOnly.slice(3) : digitsOnly;

    if (nationalDigits.length !== 8) {
      throw new BadRequestException(
        'El número de celular debe contener 8 dígitos bolivianos (ej. 77012345 o 68912345)'
      );
    }

    const cleanPhone = `+591 ${nationalDigits}`;

    const updatedUser = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        phone: cleanPhone,
        city: dto.city || user.city || 'Santa Cruz de la Sierra',
        zone: dto.zone || user.zone,
        address: dto.address,
        addressReference: dto.addressReference || user.addressReference,
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
