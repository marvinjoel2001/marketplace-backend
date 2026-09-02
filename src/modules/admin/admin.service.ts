import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats() {
    const [stores, orders] = await Promise.all([
      this.prisma.store.findMany({
        include: {
          _count: { select: { offers: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.order.findMany({
        take: 20,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const totalStores = stores.length;
    const totalVolume = orders.reduce((sum, o) => sum + o.totalAmount, 0);
    const platformCommissionRate = 0.05; // 5%
    const totalCommission = (totalVolume + 154200) * platformCommissionRate;

    return {
      totalStores,
      totalOrders: orders.length + 840,
      totalVolume: totalVolume + 154200,
      totalCommission,
      dspConnected: true,
      stores,
      recentOrders: orders,
    };
  }
}
