import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminAuthService, hashPassword, verifyPassword } from '../admin-auth.service';
import { AdminGuard } from '../admin.guard';

type Account = { id: string; username: string; passwordHash: string; mustChangePassword: boolean };

function setup() {
  const accounts: Account[] = [];
  const prisma = {
    adminAccount: {
      count: jest.fn(async () => accounts.length),
      create: jest.fn(async ({ data }: { data: Omit<Account, 'id'> }) => {
        const row = { id: `a${accounts.length + 1}`, ...data };
        accounts.push(row);
        return row;
      }),
      findUnique: jest.fn(
        async ({ where }: { where: { id?: string; username?: string } }) =>
          accounts.find((a) => a.id === where.id || a.username === where.username) ?? null,
      ),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<Account> }) => {
        const row = accounts.find((a) => a.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
    },
  };
  const settings = { getSecret: jest.fn(async () => 'test-secret') };
  const service = new AdminAuthService(prisma as never, settings as never);
  return { service, accounts };
}

describe('AdminAuthService', () => {
  afterEach(() => jest.useRealTimers());

  it('hashes passwords with a random salt and verifies them', () => {
    const a = hashPassword('clave-segura');
    expect(a).not.toBe(hashPassword('clave-segura'));
    expect(verifyPassword('clave-segura', a)).toBe(true);
    expect(verifyPassword('otra', a)).toBe(false);
    expect(verifyPassword('x', 'sin-formato')).toBe(false);
  });

  it('seeds admin/admin once and forces a password change', async () => {
    const { service, accounts } = setup();
    await service.onModuleInit();
    await service.onModuleInit();
    expect(accounts).toHaveLength(1);

    const session = await service.login('admin', 'admin');
    expect(session.admin).toEqual({ username: 'admin', mustChangePassword: true });
    expect((await service.verifyToken(session.token)).mcp).toBe(true);
  });

  it('rejects wrong credentials and locks after five failures', async () => {
    const { service } = setup();
    await service.onModuleInit();
    for (let i = 0; i < 5; i++) {
      await expect(service.login('admin', 'mala', '1.1.1.1')).rejects.toBeInstanceOf(UnauthorizedException);
    }
    await expect(service.login('admin', 'admin', '1.1.1.1')).rejects.toMatchObject({ status: 429 });
    // Another connection is not locked out.
    await expect(service.login('admin', 'admin', '2.2.2.2')).resolves.toBeDefined();
  });

  it('changes the password, clears the flag and rejects weak or repeated passwords', async () => {
    const { service } = setup();
    await service.onModuleInit();
    const { token } = await service.login('admin', 'admin');
    const { sub } = await service.verifyToken(token);

    await expect(service.changePassword(sub, 'mala', 'nueva-clave-1')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.changePassword(sub, 'admin', 'corta')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.changePassword(sub, 'admin', 'admin')).rejects.toBeInstanceOf(BadRequestException);

    const next = await service.changePassword(sub, 'admin', 'nueva-clave-1', 'Marvin');
    expect(next.admin).toEqual({ username: 'marvin', mustChangePassword: false });
    await expect(service.login('admin', 'admin')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.login('marvin', 'nueva-clave-1')).resolves.toBeDefined();
  });

  it('rejects tampered, malformed and expired tokens', async () => {
    const { service } = setup();
    await service.onModuleInit();
    const { token } = await service.login('admin', 'admin');
    const [body, sig] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), mcp: false }),
    ).toString('base64url');

    await expect(service.verifyToken(`${forged}.${sig}`)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.verifyToken('basura')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.verifyToken(undefined)).rejects.toBeInstanceOf(UnauthorizedException);

    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout'] }).setSystemTime(Date.now() + 13 * 60 * 60 * 1000);
    await expect(service.verifyToken(token)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('AdminGuard', () => {
  const run = async (mcp: boolean, allowed: boolean) => {
    const auth = { verifyToken: jest.fn(async () => ({ sub: 'a1', u: 'admin', mcp, exp: Date.now() + 1000 })) };
    const reflector = { getAllAndOverride: jest.fn(() => allowed) } as unknown as Reflector;
    const guard = new AdminGuard(auth as never, reflector);
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({ headers: { authorization: 'Bearer abc.def' } }) }),
      getHandler: () => null,
      getClass: () => null,
    };
    return guard.canActivate(ctx as never);
  };

  it('lets a normal session through', async () => expect(await run(false, false)).toBe(true));
  it('blocks panel routes while the default password is still set', async () => {
    await expect(run(true, false)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('still allows the change-password route', async () => expect(await run(true, true)).toBe(true));
});
