import { BadRequestException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { normalizeBoliviaPhone } from './auth.service';
import { WhatsAppService } from './whatsapp.service';

export const OTP_TTL_MS = 5 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
const RESEND_AFTER_MS = 30 * 1000;
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 3;
const MAX_PER_IP_PER_HOUR = 10;

@Injectable()
export class OtpService {
  private readonly ipHits = new Map<string, number[]>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  /** Creates and sends a code. Limits: one per 30 s and three per 10 min per number, ten per hour per IP. */
  async request(rawPhone: string, ip = 'unknown') {
    const phone = normalizeBoliviaPhone(String(rawPhone ?? ''));
    if (!phone) throw new BadRequestException('Escribe tu celular de 8 dígitos, por ejemplo 71234567');
    this.checkIp(ip);

    const now = Date.now();
    const recent = await this.prisma.otpCode.findMany({
      where: { phone, createdAt: { gte: new Date(now - WINDOW_MS) } },
      orderBy: { createdAt: 'desc' },
    });
    if (recent[0] && now - recent[0].createdAt.getTime() < RESEND_AFTER_MS) {
      const wait = Math.ceil((RESEND_AFTER_MS - (now - recent[0].createdAt.getTime())) / 1000);
      throw new HttpException(`Espera ${wait} segundos antes de pedir otro código.`, HttpStatus.TOO_MANY_REQUESTS);
    }
    if (recent.length >= MAX_PER_WINDOW) {
      throw new HttpException('Pediste demasiados códigos. Inténtalo de nuevo en unos minutos.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const row = await this.prisma.otpCode.create({
      data: { phone, codeHash: await this.hash(phone, code), expiresAt: new Date(now + OTP_TTL_MS) },
    });

    try {
      const sent = await this.whatsapp.send(phone, `Tu código de Vitrina Market es ${code}. Vence en 5 minutos. No lo compartas con nadie.`);
      return { sent: true, expiresInSeconds: OTP_TTL_MS / 1000, ...(sent.devOnly ? { devCode: code } : {}) };
    } catch (err) {
      // A code nobody received must not count against the person's limit.
      await this.prisma.otpCode.delete({ where: { id: row.id } }).catch(() => null);
      throw err;
    }
  }

  /** Checks a code and returns the normalized phone it proves. Wrong guesses burn the code after five tries. */
  async verify(rawPhone: string, rawCode: string): Promise<string> {
    const phone = normalizeBoliviaPhone(String(rawPhone ?? ''));
    const code = String(rawCode ?? '').replace(/\D/g, '');
    if (!phone || code.length !== 6) throw new BadRequestException('Escribe el código de 6 dígitos que te llegó por WhatsApp');

    const row = await this.prisma.otpCode.findFirst({
      where: { phone, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!row || row.attempts >= OTP_MAX_ATTEMPTS) {
      throw new BadRequestException('El código venció o ya no es válido. Pide uno nuevo.');
    }

    const expected = Buffer.from(row.codeHash);
    const actual = Buffer.from(await this.hash(phone, code));
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      await this.prisma.otpCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
      const left = OTP_MAX_ATTEMPTS - row.attempts - 1;
      throw new BadRequestException(left > 0 ? `El código no es correcto. Te quedan ${left} intentos.` : 'El código no es correcto. Pide uno nuevo.');
    }

    // updateMany keeps two parallel requests from both consuming the same code.
    const consumed = await this.prisma.otpCode.updateMany({ where: { id: row.id, consumedAt: null }, data: { consumedAt: new Date() } });
    if (consumed.count !== 1) throw new BadRequestException('El código ya fue usado. Pide uno nuevo.');
    return phone;
  }

  private async hash(phone: string, code: string) {
    return createHmac('sha256', await this.settings.getSecret()).update(`${phone}|${code}`).digest('hex');
  }

  private checkIp(ip: string) {
    const now = Date.now();
    const hits = (this.ipHits.get(ip) ?? []).filter((t) => now - t < 60 * 60 * 1000);
    if (hits.length >= MAX_PER_IP_PER_HOUR) {
      throw new HttpException('Demasiados intentos desde tu conexión. Inténtalo más tarde.', HttpStatus.TOO_MANY_REQUESTS);
    }
    hits.push(now);
    this.ipHits.set(ip, hits);
  }
}
