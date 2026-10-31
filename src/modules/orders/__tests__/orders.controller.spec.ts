import { createHmac } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { OrdersController } from '../orders.controller';
import { OrdersService } from '../orders.service';
import { PrismaService } from '../../../prisma/prisma.service';

describe('OrdersController', () => {
  let controller: OrdersController;
  const buyer = { id: 'user_1', role: 'CUSTOMER' };

  const mockOrdersService = {
    findByUser: jest.fn().mockResolvedValue([{ id: 'ord_1', orderNumber: 'VT-894120-412', items: [] }]),
    findForViewer: jest.fn().mockImplementation((idOrNumber) => Promise.resolve({ id: 'ord_1', orderNumber: idOrNumber })),
    create: jest.fn().mockImplementation((body) => Promise.resolve({ id: 'ord_new', orderNumber: 'VT-000001-100', ...body })),
    handleDspWebhook: jest.fn().mockResolvedValue({ ok: true }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrdersController],
      providers: [
        { provide: OrdersService, useValue: mockOrdersService },
        { provide: PrismaService, useValue: {} },
      ],
    }).compile();
    controller = module.get<OrdersController>(OrdersController);
  });

  afterEach(() => {
    delete process.env.DSP_WEBHOOK_SECRET;
  });

  it('lists only the signed-in user’s orders', async () => {
    await controller.getMine(buyer);
    expect(mockOrdersService.findByUser).toHaveBeenCalledWith('user_1');
  });

  it('looks an order up for the signed-in viewer', async () => {
    const result = await controller.getOne('VT-894120-412', buyer);
    expect(result.orderNumber).toBe('VT-894120-412');
    expect(mockOrdersService.findForViewer).toHaveBeenCalledWith('VT-894120-412', 'user_1');
  });

  it('creates the order for the session user, whatever userId the body says', async () => {
    await controller.create({ userId: 'someone_else', items: [] }, buyer);
    expect(mockOrdersService.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user_1' }));
  });

  describe('webhook/dsp', () => {
    const payload = { event: 'order.delivered', timestamp: '2026-10-31T12:00:00Z', data: { order_id: 'dsp_1', merchant_reference: 'VT-1' } };

    it('accepts a body signed with DSP_WEBHOOK_SECRET', async () => {
      process.env.DSP_WEBHOOK_SECRET = 'whsec_test';
      const signature = createHmac('sha256', 'whsec_test').update(JSON.stringify(payload)).digest('hex');
      await expect(controller.handleDspWebhook(payload, signature)).resolves.toEqual({ ok: true });
    });

    it('rejects a missing or wrong signature', async () => {
      process.env.DSP_WEBHOOK_SECRET = 'whsec_test';
      await expect(controller.handleDspWebhook(payload, undefined)).rejects.toThrow(UnauthorizedException);
      await expect(controller.handleDspWebhook(payload, 'deadbeef')).rejects.toThrow(UnauthorizedException);
      expect(mockOrdersService.handleDspWebhook).not.toHaveBeenCalled();
    });
  });
});
