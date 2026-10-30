import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminAuthService, AdminTokenPayload } from './admin-auth.service';

/** Routes that stay reachable while the account still has to pick a new password. */
export const ALLOW_PASSWORD_CHANGE = 'allowPasswordChange';
export const AllowWhilePasswordChange = () => SetMetadata(ALLOW_PASSWORD_CHANGE, true);

export interface AdminRequest {
  headers: Record<string, string | string[] | undefined>;
  admin?: AdminTokenPayload;
}

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    const header = String(request.headers.authorization ?? '');
    const payload = await this.auth.verifyToken(header.startsWith('Bearer ') ? header.slice(7) : undefined);
    request.admin = payload;

    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_PASSWORD_CHANGE, [context.getHandler(), context.getClass()]);
    if (payload.mcp && !allowed) {
      throw new ForbiddenException('Primero cambia la contraseña predeterminada');
    }
    return true;
  }
}
