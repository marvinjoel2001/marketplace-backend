import { ProductsService } from '../products.service';
import { PrismaService } from '../../../prisma/prisma.service';

describe('first product in a new marketplace', () => {
  it('uses the store category when no categories have been initialized', async () => {
    const prisma = {
      store: { findFirst: jest.fn().mockResolvedValue({ id: 'store', category: 'Electrónica' }) },
      category: { findFirst: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({ id: 'category' }) },
      product: { create: jest.fn().mockResolvedValue({ id: 'product' }) },
    };
    const service = new ProductsService(prisma as unknown as PrismaService);
    await service.create({ title: 'Audífonos', basePrice: 99, stock: 2, categoryId: '', storeId: 'store', images: ['/foto.jpg'] });
    expect(prisma.category.upsert).toHaveBeenCalledWith({ where: { slug: 'electronica' }, create: { name: 'Electrónica', slug: 'electronica', icon: 'package' }, update: {} });
    expect(prisma.product.create.mock.calls[0][0].data.categoryId).toBe('category');
    expect(prisma.product.create.mock.calls[0][0].data.offers.create.storeId).toBe('store');
  });
});
