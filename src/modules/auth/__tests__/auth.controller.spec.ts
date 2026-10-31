import { PrismaService } from '../../../prisma/prisma.service';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from '../auth.controller';
import { OtpService } from '../otp.service';
import { AuthService } from '../auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  let service: AuthService;

  const mockAuthService = {
    socialLogin: jest.fn().mockImplementation((dto) =>
      Promise.resolve({
        user: { id: 'usr_1', email: dto.email, name: dto.name, provider: dto.provider || 'TIKTOK' },
        isProfileComplete: false,
        isNewUser: true,
      })
    ),
    enrichProfile: jest.fn().mockImplementation((dto) =>
      Promise.resolve({
        user: { id: dto.userId, phone: dto.phone, address: dto.address },
        isProfileComplete: true,
      })
    ),
    syncInterests: jest.fn().mockImplementation((dto) =>
      Promise.resolve({ success: true, userId: dto.userId })
    ),
    getUser: jest.fn().mockImplementation((id) =>
      Promise.resolve({ id, email: 'test@chiringuito.bo', name: 'Test User' })
    ),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: mockAuthService,
        },
        { provide: OtpService, useValue: { request: jest.fn(), verify: jest.fn() } },
        { provide: PrismaService, useValue: {} },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('socialLogin', () => {
    it('should authenticate user with social credentials', async () => {
      const dto = {
        email: 'marvin@chiringuito.bo',
        name: 'Marvin Rivera',
        provider: 'GOOGLE',
      };

      const result = await controller.socialLogin(dto);
      expect(result.user.email).toBe('marvin@chiringuito.bo');
      expect(result.user.provider).toBe('GOOGLE');
      expect(service.socialLogin).toHaveBeenCalledWith(dto);
    });
  });

  describe('enrichProfile', () => {
    it('should enrich user delivery and phone details', async () => {
      const dto = {
        userId: 'usr_1',
        phone: '77012345',
        address: 'Av. San Martin #450, Equipetrol',
        city: 'Santa Cruz de la Sierra',
      };

      const result = await controller.enrichProfile({ ...dto, userId: 'someone_else' }, { id: 'usr_1', role: 'CUSTOMER' });
      expect(result.isProfileComplete).toBe(true);
      expect(result.user.phone).toBe('77012345');
      // The session decides whose profile changes, not the body.
      expect(service.enrichProfile).toHaveBeenCalledWith(dto);
    });
  });

  describe('getUser', () => {
    it('should retrieve the signed-in user profile', async () => {
      const result = await controller.getUser({ id: 'usr_1', role: 'CUSTOMER' });
      expect(result.id).toBe('usr_1');
      expect(service.getUser).toHaveBeenCalledWith('usr_1');
    });
  });
});
