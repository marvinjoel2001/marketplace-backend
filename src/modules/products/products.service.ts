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

    if (!title || !basePrice || !categoryId || !storeId) {
      throw new BadRequestException('Faltan campos obligatorios');
    }

    const slug = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString().slice(-4)}`;

    return this.prisma.product.create({
      data: {
        title,
        slug,
        description: description || '',
        basePrice: typeof basePrice === 'string' ? parseFloat(basePrice) : basePrice,
        categoryId,
        images: Array.isArray(images) ? JSON.stringify(images) : typeof images === 'string' && images.startsWith('[') ? images : JSON.stringify([images]),
        tags: tags || '',
        specifications: typeof specifications === 'object' ? JSON.stringify(specifications) : specifications || '{}',
        color: color || '',
        material: material || '',
        warranty: warranty || '7 días',
        hasInvoice: Boolean(hasInvoice),
        offers: {
          create: {
            storeId,
            price: typeof basePrice === 'string' ? parseFloat(basePrice) : basePrice,
            stock: typeof stock === 'string' ? parseInt(stock, 10) : stock,
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
}
