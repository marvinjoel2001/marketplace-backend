import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';

/**
 * Endpoints that create or look up identities (social login, WhatsApp codes) must only be called by the Next.js
 * server, which holds AUTH_INTERNAL_KEY. Without the variable (local development) the guard lets requests through
 * and warns once; production deployments must set it.
 */
@Injectable()
export class InternalKeyGuard implements CanActivate {
  private readonly logger = new Logger(InternalKeyGuard.name);
  private warned = false;

  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.AUTH_INTERNAL_KEY;
    if (!expected) {
      if (!this.warned) {
        this.logger.warn('AUTH_INTERNAL_KEY no está definida: los endpoints de inicio de sesión aceptan llamadas de cualquiera. Defínela en producción.');
        this.warned = true;
      }
      return true;
    }
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>();
    const given = Buffer.from(String(request.headers['x-internal-key'] ?? ''));
    const wanted = Buffer.from(expected);
    if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) throw new UnauthorizedException();
    return true;
  }
}
