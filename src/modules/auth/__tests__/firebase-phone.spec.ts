import { UnauthorizedException } from '@nestjs/common';
import { AuthController } from '../auth.controller';
import { AuthService } from '../auth.service';
import { OtpService } from '../otp.service';

describe('Firebase phone proof', () => {
  const originalKey = process.env.FIREBASE_API_KEY;
  const originalFetch = global.fetch;
  const login = jest.fn().mockResolvedValue({ user: { id: 'verified-user' } });
  const otpVerify = jest.fn().mockResolvedValue('+591 71234567');
  const controller = new AuthController(
    { loginWithVerifiedPhone: login } as unknown as AuthService,
    { verify: otpVerify } as unknown as OtpService,
  );
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.FIREBASE_API_KEY = 'test-project-key';
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.FIREBASE_API_KEY;
    else process.env.FIREBASE_API_KEY = originalKey;
  });

  const verify = () => controller.verifyOtp({ phone: '71234567', idToken: 'firebase-proof' });

  it('rejects unverified tokens without creating a marketplace user', async () => {
    fetchMock.mockResolvedValue({ ok: false });
    await expect(verify()).rejects.toThrow(UnauthorizedException);
    expect(login).not.toHaveBeenCalled();
    expect(otpVerify).not.toHaveBeenCalled();
  });

  it('rejects a token proving a different phone', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ users: [{ phoneNumber: '+59177777777' }] }) });
    await expect(verify()).rejects.toThrow(UnauthorizedException);
    expect(login).not.toHaveBeenCalled();
  });

  it('checks the project with Google and accepts the matching phone', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ users: [{ phoneNumber: '+59171234567' }] }) });
    await expect(verify()).resolves.toEqual({ user: { id: 'verified-user' } });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=test-project-key',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ idToken: 'firebase-proof' }) }),
    );
    expect(login).toHaveBeenCalledWith('+591 71234567');
  });

  it('fails closed when Firebase is not configured or unavailable', async () => {
    delete process.env.FIREBASE_API_KEY;
    await expect(verify()).rejects.toThrow(UnauthorizedException);
    expect(fetchMock).not.toHaveBeenCalled();
    process.env.FIREBASE_API_KEY = 'test-project-key';
    fetchMock.mockRejectedValue(new Error('Network unavailable'));
    await expect(verify()).rejects.toThrow(UnauthorizedException);
    expect(login).not.toHaveBeenCalled();
  });

  it('keeps the WhatsApp OTP path working without a Firebase token', async () => {
    await controller.verifyOtp({ phone: '71234567', code: '123456' });
    expect(otpVerify).toHaveBeenCalledWith('71234567', '123456');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(login).toHaveBeenCalledWith('+591 71234567');
  });
});
