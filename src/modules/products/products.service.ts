import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(params: { category?: string; flashSale?: boolean; q?: string; slug?: string }) {
    const { category, flashSale, q, slug } = params;

    if (slug) {
      const product = await this.prisma.product.findUnique({
        where: { slug },
        include: {
          category: true,
          offers: {
            where: { isActive: true },
            include: { store: true },
            orderBy: { price: 'asc' },
          },
        },
      });
      if (!product) throw new NotFoundException('Producto no encontrado');
      return product;
    }

    const whereClause: any = {};

    if (category) {
      whereClause.category = { slug: category };
    }

    if (flashSale) {
      whereClause.isFlashSale = true;
    }

    if (q) {
      whereClause.OR = [
        { title: { contains: q } },
        { description: { contains: q } },
        { tags: { contains: q } },
      ];
    }

    return this.prisma.product.findMany({
      where: whereClause,
      include: {
        category: true,
        offers: {
          where: { isActive: true },
          include: { store: true },
          orderBy: { price: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findBySlugOrId(idOrSlug: string) {
    let product = await this.prisma.product.findFirst({
      where: {
        OR: [{ id: idOrSlug }, { slug: idOrSlug }],
      },
      include: {
        category: true,
        offers: {
          where: { isActive: true },
          include: { store: true },
          orderBy: { price: 'asc' },
        },
      },
    });

    if (!product) {
      // Fallback demo a producto de referencia si no existe
      product = await this.prisma.product.findFirst({
        where: { slug: 'chompa-oversize-beige-talla-m' },
        include: {
          category: true,
          offers: {
            include: { store: true },
            orderBy: { price: 'asc' },
          },
        },
      });
    }

    if (!product) throw new NotFoundException('Producto no encontrado');
    return product;
  }

  async create(data: {
    title: string;
    description?: string;
    basePrice: number | string;
    categoryId: string;
    storeId: string;
    images: string | string[];
    tags?: string;
    specifications?: any;
    color?: string;
    material?: string;
    warranty?: string;
    hasInvoice?: boolean;
    stock?: number | string;
  }) {
    const {
      title,
      description,
      basePrice,
      categoryId,
      storeId,
      images,
      tags,
      specifications,
      color,
      material,
      warranty,
      hasInvoice,
      stock = 10,
    } = data;

    if (!title || typeof title !== 'string' || !title.trim()) {
      throw new BadRequestException('El título del producto es obligatorio');
    }

    const numericPrice = typeof basePrice === 'string' ? parseFloat(basePrice) : basePrice;
    if (isNaN(numericPrice) || numericPrice <= 0) {
      throw new BadRequestException('El precio del producto debe ser un número válido mayor a 0');
    }

    // Resolve Category dynamically (by id, slug, or name; fallback to first available)
    let targetCategory = null;
    if (categoryId) {
      targetCategory = await this.prisma.category.findFirst({
        where: {
          OR: [
            { id: categoryId },
            { slug: categoryId },
            { name: categoryId },
          ],
        },
      });
    }
    if (!targetCategory) {
      targetCategory = await this.prisma.category.findFirst();
    }
    if (!targetCategory) {
      throw new BadRequestException('No se encontró una categoría válida para el producto');
    }

    // Resolve Store dynamically (by id, slug, or name; fallback to first available)
    let targetStore = null;
    if (storeId) {
      targetStore = await this.prisma.store.findFirst({
        where: {
          OR: [
            { id: storeId },
            { slug: storeId },
            { name: storeId },
          ],
        },
      });
    }
    if (!targetStore) {
      targetStore = await this.prisma.store.findFirst();
    }
    if (!targetStore) {
      throw new BadRequestException('No se encontró una tienda válida para publicar la oferta');
    }

    const slug = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString().slice(-4)}`;

    return this.prisma.product.create({
      data: {
        title: title.trim(),
        slug,
        description: description || '',
        basePrice: numericPrice,
        categoryId: targetCategory.id,
        images: Array.isArray(images)
          ? JSON.stringify(images)
          : typeof images === 'string' && images.startsWith('[')
          ? images
          : JSON.stringify([images || 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=500']),
        tags: tags || '',
        specifications: typeof specifications === 'object' ? JSON.stringify(specifications) : specifications || '{}',
        color: color || '',
        material: material || '',
        warranty: warranty || '7 días',
        hasInvoice: Boolean(hasInvoice),
        offers: {
          create: {
            storeId: targetStore.id,
            price: numericPrice,
            stock: typeof stock === 'string' ? parseInt(stock, 10) : Number(stock) || 10,
            shippingCost: 0,
            estimatedDelivery: 'Llega en 24-48 hrs con OpenDSP',
            isRecommended: true,
          },
        },
      },
      include: {
        category: true,
        offers: {
          include: { store: true },
        },
      },
    });
  }

  async update(id: string, data: any) {
    const existing = await this.prisma.product.findUnique({
      where: { id },
      include: { offers: true },
    });

    if (!existing) {
      throw new NotFoundException(`Producto con ID ${id} no encontrado`);
    }

    const updateData: any = {};
    if (data.title) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.basePrice !== undefined) {
      const price = typeof data.basePrice === 'string' ? parseFloat(data.basePrice) : data.basePrice;
      if (price <= 0) throw new BadRequestException('El precio base debe ser mayor a 0');
      updateData.basePrice = price;
    }
    if (data.categoryId) updateData.categoryId = data.categoryId;
    if (data.images) {
      updateData.images = Array.isArray(data.images)
        ? JSON.stringify(data.images)
        : typeof data.images === 'string' && data.images.startsWith('[')
          ? data.images
          : JSON.stringify([data.images]);
    }
    if (data.tags !== undefined) updateData.tags = data.tags;
    if (data.specifications !== undefined) {
      updateData.specifications = typeof data.specifications === 'object'
        ? JSON.stringify(data.specifications)
        : data.specifications;
    }
    if (data.color !== undefined) updateData.color = data.color;
    if (data.material !== undefined) updateData.material = data.material;
    if (data.warranty !== undefined) updateData.warranty = data.warranty;
    if (data.hasInvoice !== undefined) updateData.hasInvoice = Boolean(data.hasInvoice);
    if (data.discountPercent !== undefined) updateData.discountPercent = Number(data.discountPercent);
    if (data.isFlashSale !== undefined) updateData.isFlashSale = Boolean(data.isFlashSale);

    // Si también se pasa stock y/o precio de oferta para una tienda específica
    if (data.storeId && (data.stock !== undefined || data.price !== undefined)) {
      const existingOffer = existing.offers.find((o) => o.storeId === data.storeId);
      if (existingOffer) {
        await this.prisma.productOffer.update({
          where: { id: existingOffer.id },
          data: {
            ...(data.stock !== undefined && {
              stock: typeof data.stock === 'string' ? parseInt(data.stock, 10) : data.stock,
            }),
            ...(data.price !== undefined && {
              price: typeof data.price === 'string' ? parseFloat(data.price) : data.price,
            }),
          },
        });
      }
    }

    return this.prisma.product.update({
      where: { id },
      data: updateData,
      include: {
        category: true,
        offers: {
          include: { store: true },
        },
      },
    });
  }

  async updateStock(productId: string, storeId: string, stock: number, price?: number) {
    if (stock < 0) {
      throw new BadRequestException('El stock no puede ser negativo');
    }

    const offer = await this.prisma.productOffer.findFirst({
      where: { productId, storeId },
    });

    if (!offer) {
      throw new NotFoundException('Oferta del producto no encontrada para esta tienda');
    }

    return this.prisma.productOffer.update({
      where: { id: offer.id },
      data: {
        stock,
        ...(price !== undefined && price > 0 && { price }),
      },
      include: {
        product: true,
        store: true,
      },
    });
  }

  async delete(id: string) {
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Producto con ID ${id} no encontrado`);
    }

    await this.prisma.product.delete({ where: { id } });
    return { success: true, message: `Producto ${id} eliminado correctamente` };
  }
}

