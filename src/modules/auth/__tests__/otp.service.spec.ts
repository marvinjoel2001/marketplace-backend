import { BadRequestException } from '@nestjs/common';
import { OtpService, OTP_MAX_ATTEMPTS } from '../otp.service';

interface Row {
  id: string;
  phone: string;
  codeHash: string;
  expiresAt: Date;
  attempts: number;
  consumedAt: Date | null;
  createdAt: Date;
}

function setup(sendImpl?: () => Promise<{ delivered: boolean; devOnly?: boolean }>) {
  const rows: Row[] = [];
  const newestFirst = (a: Row, b: Row) => b.createdAt.getTime() - a.createdAt.getTime();
  const prisma = {
    otpCode: {
      findMany: jest.fn(async ({ where }: { where: { phone: string; createdAt: { gte: Date } } }) =>
        rows.filter((r) => r.phone === where.phone && r.createdAt >= where.createdAt.gte).sort(newestFirst),
      ),
      findFirst: jest.fn(
        async ({ where }: { where: { phone: string } }) =>
          rows.filter((r) => r.phone === where.phone && !r.consumedAt && r.expiresAt > new Date()).sort(newestFirst)[0] ?? null,
      ),
      create: jest.fn(async ({ data }: { data: Pick<Row, 'phone' | 'codeHash' | 'expiresAt'> }) => {
        const row: Row = { id: `o${rows.length + 1}`, attempts: 0, consumedAt: null, createdAt: new Date(), ...data };
        rows.push(row);
        return row;
      }),
      delete: jest.fn(async ({ where }: { where: { id: string } }) => rows.splice(rows.findIndex((r) => r.id === where.id), 1)),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: { attempts: { increment: number } } }) => {
        rows.find((r) => r.id === where.id)!.attempts += data.attempts.increment;
      }),
      updateMany: jest.fn(async ({ where, data }: { where: { id: string }; data: { consumedAt: Date } }) => {
        const row = rows.find((r) => r.id === where.id && !r.consumedAt);
        if (row) row.consumedAt = data.consumedAt;
        return { count: row ? 1 : 0 };
      }),
    },
  };
  const send = jest.fn(sendImpl ?? (async () => ({ delivered: true })));
  const service = new OtpService(prisma as never, { getSecret: async () => 's3cret' } as never, { send } as never);
  return { service, rows, send };
}

const codeSent = (send: jest.Mock) => /(\d{6})/.exec(send.mock.calls[send.mock.calls.length - 1][1])![1];

describe('OtpService', () => {
  afterEach(() => jest.useRealTimers());

  it('sends a six-digit code over WhatsApp and stores only a hash', async () => {
    const { service, rows, send } = setup();
    expect(await service.request('71234567')).toMatchObject({ sent: true, expiresInSeconds: 300 });
    expect(send).toHaveBeenCalledWith('+591 71234567', expect.stringContaining(codeSent(send)));
    expect(rows[0].codeHash).not.toContain(codeSent(send));
  });

  it('rejects numbers that are not Bolivian mobiles', async () => {
    const { service } = setup();
    await expect(service.request('12345')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('asks to wait before a resend and caps three codes per ten minutes', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] }).setSystemTime(new Date('2026-11-02T14:00:00Z'));
    const { service } = setup();
    await service.request('71234567');
    await expect(service.request('71234567')).rejects.toMatchObject({ status: 429 });
    for (let i = 0; i < 2; i++) {
      jest.setSystemTime(Date.now() + 31_000);
      await service.request('71234567');
    }
    jest.setSystemTime(Date.now() + 31_000);
    await expect(service.request('71234567')).rejects.toMatchObject({ status: 429 });
  });

  it('limits one connection to ten requests an hour', async () => {
    const { service } = setup();
    for (let i = 0; i < 10; i++) await service.request(`7123456${i}`, '9.9.9.9');
    await expect(service.request('71234500', '9.9.9.9')).rejects.toMatchObject({ status: 429 });
  });

  it('forgets a code that could not be delivered', async () => {
    const { service, rows } = setup(async () => {
      throw new Error('gateway down');
    });
    await expect(service.request('71234567')).rejects.toThrow('gateway down');
    expect(rows).toHaveLength(0);
  });

  it('verifies the right code once and returns the normalized phone', async () => {
    const { service, send } = setup();
    await service.request('71234567');
    const code = codeSent(send);
    await expect(service.verify('71234567', code)).resolves.toBe('+591 71234567');
    await expect(service.verify('71234567', code)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('burns the code after too many wrong guesses, even if the right one comes next', async () => {
    const { service, send } = setup();
    await service.request('71234567');
    const right = codeSent(send);
    const wrong = right === '000000' ? '111111' : '000000';
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
      await expect(service.verify('71234567', wrong)).rejects.toBeInstanceOf(BadRequestException);
    }
    await expect(service.verify('71234567', right)).rejects.toThrow(/venció|válido/);
  });

  it('refuses expired codes and codes for another number', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] }).setSystemTime(new Date('2026-11-02T14:00:00Z'));
    const { service, send } = setup();
    await service.request('71234567');
    const code = codeSent(send);
    await expect(service.verify('71234568', code)).rejects.toBeInstanceOf(BadRequestException);
    jest.setSystemTime(Date.now() + 5 * 60 * 1000 + 1000);
    await expect(service.verify('71234567', code)).rejects.toBeInstanceOf(BadRequestException);
  });
});
