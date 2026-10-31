import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';

type Headers = Record<string, string | string[] | undefined>;

const logger = new Logger('InternalKeyGuard');
let warned = false;

/**
 * True when the request comes from the Next.js server, which holds AUTH_INTERNAL_KEY. Without the variable local
 * development lets requests through (warning once); production refuses everything until it is set.
 */
export function fromWebServer(headers: Headers): boolean {
  const expected = process.env.AUTH_INTERNAL_KEY;
  if (!expected) {
    if (process.env.NODE_ENV === 'production') {
      if (!warned) logger.error('AUTH_INTERNAL_KEY no está definida: se rechazan los inicios de sesión y las llamadas con sesión.');
      warned = true;
      return false;
    }
    if (!warned) logger.warn('AUTH_INTERNAL_KEY no está definida: en desarrollo se aceptan llamadas de cualquiera. Defínela en producción.');
    warned = true;
    return true;
  }
  const given = Buffer.from(String(headers['x-internal-key'] ?? ''));
  const wanted = Buffer.from(expected);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

/** Endpoints that create or look up identities (social login, WhatsApp codes) must only be called by the Next.js server. */
@Injectable()
export class InternalKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ headers: Headers }>();
    if (!fromWebServer(request.headers)) throw new UnauthorizedException();
    return true;
  }
}
