import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { fromWebServer } from './internal-key.guard';

export interface SessionUser {
  id: string;
  role: string;
}

interface UserRequest {
  headers: Record<string, string | string[] | undefined>;
  user?: SessionUser;
}

/**
 * The customer or seller signed in on the website. Browsers never call these routes directly: the Next.js server
 * checks its signed session cookie and forwards the user id in `x-user-id` together with AUTH_INTERNAL_KEY.
 */
@Injectable()
export class UserGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<UserRequest>();
    const userId = String(request.headers['x-user-id'] ?? '');
    if (!userId || !fromWebServer(request.headers)) throw new UnauthorizedException('Inicia sesión para continuar');
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, status: true } });
    if (!user) throw new UnauthorizedException('Inicia sesión para continuar');
    if (user.status !== 'ACTIVE') throw new ForbiddenException('Tu cuenta está suspendida');
    request.user = { id: user.id, role: user.role };
    return true;
  }
}

export const CurrentUser = createParamDecorator(
  (_: unknown, context: ExecutionContext): SessionUser => context.switchToHttp().getRequest<UserRequest>().user!,
);

/** The store, only when `userId` manages it. */
export async function ownedStore(prisma: PrismaService, idOrSlug: string, userId: string) {
  const store = await prisma.store.findFirst({ where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] } });
  if (!store) throw new NotFoundException('Tienda no encontrada');
  if (store.ownerId !== userId) throw new ForbiddenException('Esta tienda no es tuya');
  return store;
}

/** Products belong to the stores that sell them: only one of those stores' owners may edit or delete the product. */
export async function assertProductOwner(prisma: PrismaService, productId: string, userId: string) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { offers: { select: { store: { select: { ownerId: true } } } } },
  });
  if (!product) throw new NotFoundException('Producto no encontrado');
  if (!product.offers.some((o) => o.store.ownerId === userId)) throw new ForbiddenException('Este producto no es de tu tienda');
}
