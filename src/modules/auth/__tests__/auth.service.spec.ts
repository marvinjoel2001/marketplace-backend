import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AuthService } from '../auth.service';
import { PrismaService } from '../../../prisma/prisma.service';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: PrismaService;

  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prisma = module.get<PrismaService>(PrismaService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('socialLogin', () => {
    it('should throw BadRequestException if email is missing', async () => {
      await expect(service.socialLogin({ email: '', name: 'Test' })).rejects.toThrow(
        BadRequestException
      );
    });

    it('should create a new user if not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'usr_new',
        email: 'nuevo@chiringuito.bo',
        name: 'Nuevo Usuario',
        provider: 'TIKTOK',
      });

      const result = await service.socialLogin({
        email: 'nuevo@chiringuito.bo',
        name: 'Nuevo Usuario',
        provider: 'TIKTOK',
      });

      expect(result.isNewUser).toBe(true);
      expect(result.user.email).toBe('nuevo@chiringuito.bo');
      expect(mockPrisma.user.create).toHaveBeenCalled();
    });

    it('should return existing user and update profile', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'usr_existing',
        email: 'existente@chiringuito.bo',
        name: 'Usuario Existente',
        phone: '77012345',
        address: 'Equipetrol',
      });
      mockPrisma.user.update.mockResolvedValue({
        id: 'usr_existing',
        email: 'existente@chiringuito.bo',
        name: 'Usuario Existente',
        phone: '77012345',
        address: 'Equipetrol',
      });

      const result = await service.socialLogin({
        email: 'existente@chiringuito.bo',
        name: 'Usuario Existente',
      });

      expect(result.isNewUser).toBe(false);
      expect(result.isProfileComplete).toBe(true);
    });
  });

  describe('enrichProfile', () => {
    it('should throw BadRequestException if phone or address are missing', async () => {
      await expect(
        service.enrichProfile({ userId: 'usr_1', phone: '', address: '' })
      ).rejects.toThrow(BadRequestException);
    });

    it('should update user address and phone', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'usr_1' });
      mockPrisma.user.update.mockResolvedValue({
        id: 'usr_1',
        phone: '77012345',
        address: 'Av. San Martin #450',
      });

      const result = await service.enrichProfile({
        userId: 'usr_1',
        phone: '77012345',
        address: 'Av. San Martin #450',
      });

      expect(result.isProfileComplete).toBe(true);
      expect(result.user.phone).toBe('77012345');
    });
  });

  describe('getUser', () => {
    it('should throw NotFoundException if user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.getUser('non_existing')).rejects.toThrow(NotFoundException);
    });

    it('should return user without sensitive fields', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'usr_1',
        email: 'user@chiringuito.bo',
        name: 'User One',
      });

      const result = await service.getUser('usr_1');
      expect(result.id).toBe('usr_1');
      expect(result.email).toBe('user@chiringuito.bo');
    });
  });
});
