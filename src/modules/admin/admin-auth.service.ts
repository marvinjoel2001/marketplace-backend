import { BadRequestException, HttpException, HttpStatus, Injectable, Logger, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

export const DEFAULT_ADMIN_USERNAME = 'admin';
const DEFAULT_ADMIN_PASSWORD = 'admin';
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_FAILURES = 5;
/** The client IP header can be spoofed, so each username also has a cap that no IP can dodge. */
const MAX_FAILURES_PER_USER = 15;
const LOCK_MS = 15 * 60 * 1000;
export const MIN_PASSWORD_LENGTH = 8;

export interface AdminTokenPayload {
  sub: string;
  u: string;
  /** The account still uses the default password: only the change-password flow is allowed. */
  mcp: boolean;
  exp: number;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${scryptSync(password, salt, 64).toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

@Injectable()
export class AdminAuthService implements OnModuleInit {
  private readonly logger = new Logger(AdminAuthService.name);
  private readonly failures = new Map<string, { count: number; lockedUntil: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /** First run: create admin/admin. It cannot be used for anything but choosing a new password. */
  async onModuleInit() {
    if ((await this.prisma.adminAccount.count()) > 0) return;
    await this.prisma.adminAccount.create({
      data: { username: DEFAULT_ADMIN_USERNAME, passwordHash: hashPassword(DEFAULT_ADMIN_PASSWORD), mustChangePassword: true },
    });
    this.logger.warn('Cuenta de administración creada con usuario "admin" y contraseña "admin". Cámbiala al entrar a /admin.');
  }

  async login(username: string, password: string, ip = 'unknown') {
    const name = String(username ?? '').trim().toLowerCase();
    const key = `${name}|${ip}`;
    const userKey = `${name}|*`;
    const state = this.failures.get(key);
    const userState = this.failures.get(userKey);
    if ((state && state.lockedUntil > Date.now()) || (userState && userState.lockedUntil > Date.now())) {
      throw new HttpException('Demasiados intentos. Espera unos minutos e inténtalo de nuevo.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const account = await this.prisma.adminAccount.findUnique({ where: { username: name } });
    // Hash even when the user does not exist so response time does not reveal valid usernames.
    const valid = account ? verifyPassword(String(password ?? ''), account.passwordHash) : verifyPassword('x', hashPassword('y'));
    if (!account || !valid) {
      const count = (state?.count ?? 0) + 1;
      this.failures.set(key, { count, lockedUntil: count >= MAX_FAILURES ? Date.now() + LOCK_MS : 0 });
      const userCount = (userState?.count ?? 0) + 1;
      this.failures.set(userKey, { count: userCount, lockedUntil: userCount >= MAX_FAILURES_PER_USER ? Date.now() + LOCK_MS : 0 });
      throw new UnauthorizedException('Usuario o contraseña incorrectos');
    }

    this.failures.delete(key);
    this.failures.delete(userKey);
    await this.prisma.adminAccount.update({ where: { id: account.id }, data: { lastLoginAt: new Date() } });
    return this.session(account);
  }

  async changePassword(adminId: string, currentPassword: string, newPassword: string, newUsername?: string) {
    const account = await this.prisma.adminAccount.findUnique({ where: { id: adminId } });
    if (!account || !verifyPassword(String(currentPassword ?? ''), account.passwordHash)) {
      throw new UnauthorizedException('La contraseña actual no es correcta');
    }
    if (String(newPassword ?? '').length < MIN_PASSWORD_LENGTH) {
      throw new BadRequestException(`La nueva contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`);
    }
    if (newPassword === DEFAULT_ADMIN_PASSWORD || newPassword === currentPassword) {
      throw new BadRequestException('Elige una contraseña distinta a la actual');
    }

    const username = newUsername?.trim().toLowerCase() || account.username;
    if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
      throw new BadRequestException('El usuario debe tener entre 3 y 32 letras, números, punto o guion');
    }
    if (username !== account.username && (await this.prisma.adminAccount.findUnique({ where: { username } }))) {
      throw new BadRequestException('Ese usuario ya existe');
    }

    const updated = await this.prisma.adminAccount.update({
      where: { id: account.id },
      data: { username, passwordHash: hashPassword(newPassword), mustChangePassword: false },
    });
    return this.session(updated);
  }

  async verifyToken(token: string | undefined): Promise<AdminTokenPayload> {
    const [body, signature] = String(token ?? '').split('.');
    if (!body || !signature) throw new UnauthorizedException('Inicia sesión para continuar');
    const expected = createHmac('sha256', await this.settings.getSecret()).update(body).digest('base64url');
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException('Sesión no válida');

    let payload: AdminTokenPayload;
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
      throw new UnauthorizedException('Sesión no válida');
    }
    if (!payload.exp || payload.exp < Date.now()) throw new UnauthorizedException('Tu sesión venció. Inicia sesión otra vez.');

    // The flag in the token can be stale after a password change in another tab: trust the database.
    const account = await this.prisma.adminAccount.findUnique({ where: { id: payload.sub } });
    if (!account) throw new UnauthorizedException('Sesión no válida');
    return { ...payload, u: account.username, mcp: account.mustChangePassword };
  }

  private async session(account: { id: string; username: string; mustChangePassword: boolean }) {
    const payload: AdminTokenPayload = {
      sub: account.id,
      u: account.username,
      mcp: account.mustChangePassword,
      exp: Date.now() + TOKEN_TTL_MS,
    };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = createHmac('sha256', await this.settings.getSecret()).update(body).digest('base64url');
    return {
      token: `${body}.${signature}`,
      expiresAt: new Date(payload.exp).toISOString(),
      admin: { username: account.username, mustChangePassword: account.mustChangePassword },
    };
  }
}
