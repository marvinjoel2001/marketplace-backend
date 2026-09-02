import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding CompraYa marketplace database...');

  // Limpiar datos existentes
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.liveStream.deleteMany();
  await prisma.productOffer.deleteMany();
  await prisma.product.deleteMany();
  await prisma.category.deleteMany();
  await prisma.store.deleteMany();

  // 1. Categorías
  const categoriesData = [
    { name: 'Moda y Accesorios', slug: 'moda-y-accesorios', icon: 'Shirt', order: 1 },
    { name: 'Hogar y Muebles', slug: 'hogar-y-muebles', icon: 'Home', order: 2 },
    { name: 'Electrónica y Tecnología', slug: 'electronica-y-tecnologia', icon: 'Laptop', order: 3 },
    { name: 'Celulares y Telefonía', slug: 'celulares-y-telefonia', icon: 'Smartphone', order: 4 },
    { name: 'Deportes y Outdoors', slug: 'deportes-y-outdoors', icon: 'Dumbbell', order: 5 },
    { name: 'Belleza y Cuidado Personal', slug: 'belleza-y-cuidado-personal', icon: 'Sparkles', order: 6 },
    { name: 'Juguetes y Niños', slug: 'juguetes-y-ninos', icon: 'Gamepad2', order: 7 },
    { name: 'Abarrotes y Alimentos', slug: 'abarrotes-y-alimentos', icon: 'ShoppingBag', order: 8 },
    { name: 'Salud y Farmacia', slug: 'salud-y-farmacia', icon: 'HeartPulse', order: 9 },
    { name: 'Automotriz y Accesorios', slug: 'automotriz-y-accesorios', icon: 'Car', order: 10 },
    { name: 'Mascotas', slug: 'mascotas', icon: 'Dog', order: 11 },
  ];

  const categories = [];
  for (const cat of categoriesData) {
    const created = await prisma.category.create({ data: cat });
    categories.push(created);
  }

  const catFashion = categories.find((c) => c.slug === 'moda-y-accesorios')!;
  const catElectronics = categories.find((c) => c.slug === 'electronica-y-tecnologia')!;
  const catPhones = categories.find((c) => c.slug === 'celulares-y-telefonia')!;
  const catHome = categories.find((c) => c.slug === 'hogar-y-muebles')!;

  // 2. Tiendas
  const techPlus = await prisma.store.create({
    data: {
      name: 'TechPlus Bolivia',
      slug: 'techplus-bolivia',
      logo: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
      banner: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=1200&auto=format&fit=crop&q=80',
      description: 'Tienda especializada en tecnología y electrónicos de última generación con garantía oficial.',
      rating: 4.8,
      reviewCount: 2345,
      salesCount: 12500,
      isOfficial: true,
      isRecommended: true,
      category: 'Electrónica y Tecnología',
      address: 'Av. San Martín #450, Equipetrol, Santa Cruz de la Sierra',
      latitude: -17.7685,
      longitude: -63.1952,
      phone: '+591 3 3456789',
      tiktokUsername: '@techplus_bolivia',
      tiktokLiveUrl: 'https://www.tiktok.com/@techplus_bolivia/live',
      isLiveNow: true,
    },
  });

  const modaBol = await prisma.store.create({
    data: {
      name: 'ModaBol',
      slug: 'modabol',
      logo: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
      banner: 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=1200&auto=format&fit=crop&q=80',
      description: 'Prendas exclusivas, moda urbana y tendencias para toda Bolivia.',
      rating: 4.8,
      reviewCount: 2300,
      salesCount: 4800,
      isOfficial: true,
      isRecommended: true,
      category: 'Moda y Accesorios',
      address: 'Calle 21 de Calacoto #850, La Paz / Sucursal Santa Cruz 2do Anillo',
      latitude: -17.7812,
      longitude: -63.1798,
      phone: '+591 7 8899001',
      tiktokUsername: '@modabol_oficial',
      isLiveNow: false,
    },
  });

  const urbanStore = await prisma.store.create({
    data: {
      name: 'Urban Store',
      slug: 'urban-store',
      logo: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
      description: 'Estilo streetwear, zapatillas y chompas oversize de alta calidad.',
      rating: 4.6,
      reviewCount: 1100,
      salesCount: 2900,
      isOfficial: false,
      isRecommended: false,
      category: 'Moda y Accesorios',
      address: 'Centro Comercial Cañoto, Local 24, Santa Cruz',
      latitude: -17.7891,
      longitude: -63.1845,
      phone: '+591 7 1234987',
      isLiveNow: false,
    },
  });

  const outfitBolivia = await prisma.store.create({
    data: {
      name: 'Outfit Bolivia',
      slug: 'outfit-bolivia',
      logo: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150&auto=format&fit=crop&q=80',
      description: 'Ropa juvenil, básicos y moda nacional con envíos a todo el país.',
      rating: 4.5,
      reviewCount: 890,
      salesCount: 1950,
      isOfficial: false,
      isRecommended: false,
      category: 'Moda y Accesorios',
      address: 'Av. Monseñor Rivero #210, Santa Cruz',
      latitude: -17.7723,
      longitude: -63.1819,
      phone: '+591 7 5544332',
      tiktokUsername: '@outfitbolivia',
      isLiveNow: true,
    },
  });

  const trendys = await prisma.store.create({
    data: {
      name: 'Trendys',
      slug: 'trendys',
      logo: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=150&auto=format&fit=crop&q=80',
      description: 'Precios accesibles en moda de temporada.',
      rating: 4.4,
      reviewCount: 560,
      salesCount: 1200,
      isOfficial: false,
      isRecommended: false,
      category: 'Moda y Accesorios',
      address: 'Mercado Los Pozos nuevo, Pasillo 4, Santa Cruz',
      latitude: -17.7745,
      longitude: -63.1678,
      phone: '+591 7 9988776',
      isLiveNow: false,
    },
  });

  const tecnoShop = await prisma.store.create({
    data: {
      name: 'TecnoShop',
      slug: 'tecnoshop',
      logo: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80',
      description: 'Accesorios gamer, periféricos y audio bluetooth.',
      rating: 4.7,
      reviewCount: 1400,
      salesCount: 3800,
      isOfficial: false,
      category: 'Electrónica y Tecnología',
      address: 'Av. Irala #330, Santa Cruz',
      tiktokUsername: '@tecnoshop_bo',
      isLiveNow: true,
    },
  });

  const hogarFeliz = await prisma.store.create({
    data: {
      name: 'Hogar Feliz',
      slug: 'hogar-feliz',
      logo: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&auto=format&fit=crop&q=80',
      description: 'Muebles, decoración y organización para el hogar moderno.',
      rating: 4.9,
      reviewCount: 3100,
      salesCount: 7500,
      isOfficial: true,
      category: 'Hogar y Muebles',
      address: 'Av. Busch y 3er Anillo, Santa Cruz',
      tiktokUsername: '@hogarfeliz_bo',
      isLiveNow: true,
    },
  });

  const bellezaNatural = await prisma.store.create({
    data: {
      name: 'Belleza Natural',
      slug: 'belleza-natural',
      logo: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80',
      description: 'Cosméticos orgánicos y cuidado de la piel.',
      rating: 4.8,
      reviewCount: 1100,
      salesCount: 2200,
      isOfficial: false,
      category: 'Belleza y Cuidado Personal',
      address: 'Av. Las Américas #150, Santa Cruz',
      tiktokUsername: '@bellezanatural_bo',
      isLiveNow: true,
    },
  });

  const abarrotesDia = await prisma.store.create({
    data: {
      name: 'Abarrotes del Día',
      slug: 'abarrotes-del-dia',
      logo: 'https://images.unsplash.com/photo-1560250097-0b93528c311a?w=150&auto=format&fit=crop&q=80',
      description: 'Supermercado express con entrega rápida a domicilio.',
      rating: 4.9,
      reviewCount: 4200,
      salesCount: 14000,
      isOfficial: true,
      category: 'Abarrotes y Alimentos',
      address: 'Av. Banzer km 4, Santa Cruz',
      tiktokUsername: '@abarrotes_dia',
      isLiveNow: true,
    },
  });

  // 3. Productos y Comparador de Precios (Ej: Chompa Oversize Beige)
  const productChompa = await prisma.product.create({
    data: {
      title: 'Chompa Oversize Beige - Talla M',
      slug: 'chompa-oversize-beige-talla-m',
      description: 'Chompa con corte oversize relajado, confeccionada en mezcla premium de algodón y poliéster para máxima comodidad y abrigo. Ideal para clima templado o frío.',
      basePrice: 189,
      categoryId: catFashion.id,
      rating: 4.8,
      reviewCount: 230,
      images: JSON.stringify([
        'https://images.unsplash.com/photo-1556905055-8f358a7a47b2?w=800&auto=format&fit=crop&q=80',
        'https://images.unsplash.com/photo-1576871337622-98d48d1cf531?w=800&auto=format&fit=crop&q=80',
        'https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?w=800&auto=format&fit=crop&q=80',
      ]),
      tags: 'chompa, oversize, invierno, beige, moda urbana',
      specifications: JSON.stringify({
        'Color': 'Beige',
        'Talla disponible': 'S, M, L, XL',
        'Material': 'Algodón y poliéster 320gsm',
        'Garantía': '7 días contra defectos de fábrica',
        'Facturación': 'Sí, factura computarizada con NIT',
      }),
      color: 'Beige',
      material: 'Algodón y poliéster',
      warranty: '7 días',
      hasInvoice: true,
    },
  });

  // Ofertas de 4 tiendas para la Chompa (Comparador de Precios)
  await prisma.productOffer.create({
    data: {
      productId: productChompa.id,
      storeId: modaBol.id,
      price: 189,
      stock: 25,
      shippingCost: 0,
      estimatedDelivery: 'Llega mañana',
      isRecommended: true,
    },
  });

  await prisma.productOffer.create({
    data: {
      productId: productChompa.id,
      storeId: urbanStore.id,
      price: 175,
      stock: 14,
      shippingCost: 0,
      estimatedDelivery: 'Llega en 2 días',
      isRecommended: false,
    },
  });

  await prisma.productOffer.create({
    data: {
      productId: productChompa.id,
      storeId: outfitBolivia.id,
      price: 168,
      stock: 8,
      shippingCost: 10,
      estimatedDelivery: 'Llega en 2 - 3 días',
      isRecommended: false,
    },
  });

  await prisma.productOffer.create({
    data: {
      productId: productChompa.id,
      storeId: trendys.id,
      price: 160,
      stock: 5,
      shippingCost: 15,
      estimatedDelivery: 'Llega en 3 días',
      isRecommended: false,
    },
  });

  // 4. Productos de TechPlus (En vivo en TikTok)
  const productIPhone = await prisma.product.create({
    data: {
      title: 'iPhone 15 Pro Max 256GB Titanio Natural',
      slug: 'iphone-15-pro-max-256gb',
      description: 'Diseño en titanio de calidad aeroespacial, chip A17 Pro ultra potente, botón de acción personalizable y sistema de cámaras Pro con teleobjetivo 5x.',
      basePrice: 11999,
      categoryId: catPhones.id,
      rating: 4.9,
      reviewCount: 450,
      images: JSON.stringify([
        'https://images.unsplash.com/photo-1695048133142-1a20484d2569?w=800&auto=format&fit=crop&q=80',
        'https://images.unsplash.com/photo-1592750475338-74b7b21085ab?w=800&auto=format&fit=crop&q=80',
      ]),
      color: 'Titanio Natural',
      warranty: '1 año de garantía oficial Apple',
      hasInvoice: true,
    },
  });

  await prisma.productOffer.create({
    data: {
      productId: productIPhone.id,
      storeId: techPlus.id,
      price: 11999,
      stock: 12,
      shippingCost: 0,
      estimatedDelivery: 'Llega hoy mismo (Express)',
      isRecommended: true,
    },
  });

  const productBuds = await prisma.product.create({
    data: {
      title: 'Xiaomi Redmi Buds 5 Pro ANC 52dB',
      slug: 'xiaomi-redmi-buds-5-pro',
      description: 'Cancelación activa de ruido líder hasta 52dB, códec LHDC 5.0 de alta resolución, hasta 38 horas de batería con el estuche.',
      basePrice: 399,
      categoryId: catElectronics.id,
      rating: 4.7,
      reviewCount: 180,
      images: JSON.stringify([
        'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=800&auto=format&fit=crop&q=80',
      ]),
      color: 'Negro Medianoche',
      warranty: '6 meses',
      hasInvoice: true,
    },
  });

  await prisma.productOffer.create({
    data: {
      productId: productBuds.id,
      storeId: techPlus.id,
      price: 399,
      stock: 40,
      shippingCost: 0,
      estimatedDelivery: 'Llega mañana',
      isRecommended: true,
    },
  });

  const productWatch = await prisma.product.create({
    data: {
      title: 'Smartwatch Galaxy Watch 6 44mm Bluetooth',
      slug: 'samsung-galaxy-watch-6',
      description: 'Monitoreo de composición corporal BIA, seguimiento avanzado del sueño, cristal de zafiro y bisel ultradelgado.',
      basePrice: 1299,
      categoryId: catElectronics.id,
      rating: 4.8,
      reviewCount: 95,
      images: JSON.stringify([
        'https://images.unsplash.com/photo-1508685096489-7aacd43bd3b1?w=800&auto=format&fit=crop&q=80',
      ]),
      color: 'Grafito',
      warranty: '1 año',
      hasInvoice: true,
    },
  });

  await prisma.productOffer.create({
    data: {
      productId: productWatch.id,
      storeId: techPlus.id,
      price: 1299,
      stock: 18,
      shippingCost: 0,
      estimatedDelivery: 'Llega mañana',
      isRecommended: true,
    },
  });

  // 5. Ofertas Relámpago (Flash Sales)
  const flashProducts = [
    {
      title: 'Zapatillas Deportivas Running Air Zoom',
      slug: 'zapatillas-deportivas-air-zoom',
      desc: 'Amortiguación reactiva para trote y gimnasio.',
      price: 380,
      discount: 20,
      cat: catFashion.id,
      store: modaBol.id,
      img: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=600&auto=format&fit=crop&q=80',
    },
    {
      title: 'Smart TV 55" 4K UHD Crystal HDR',
      slug: 'smart-tv-55-4k-uhd',
      desc: 'Colores cristalinos y procesador 4K para tus series favoritas.',
      price: 3290,
      discount: 15,
      cat: catElectronics.id,
      store: techPlus.id,
      img: 'https://images.unsplash.com/photo-1593359677879-a4bb92f829d1?w=600&auto=format&fit=crop&q=80',
    },
    {
      title: 'Auriculares Inalámbricos Headphone Pro ANC',
      slug: 'auriculares-headphone-pro-anc',
      desc: 'Sonido inmersivo con cancelación de ruido y almohadillas viscoelásticas.',
      price: 450,
      discount: 25,
      cat: catElectronics.id,
      store: tecnoShop.id,
      img: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&auto=format&fit=crop&q=80',
    },
    {
      title: 'Freidora de Aire Digital 5.5L 1700W Touch',
      slug: 'freidora-de-aire-digital-5-5l',
      desc: 'Cocina saludable con 85% menos de grasa y panel táctil con 8 programas.',
      price: 520,
      discount: 30,
      cat: catHome.id,
      store: hogarFeliz.id,
      img: 'https://images.unsplash.com/photo-1584269600464-37b1b58a9fe7?w=600&auto=format&fit=crop&q=80',
    },
    {
      title: 'Smartphone Galaxy A54 5G 128GB Awesome Lime',
      slug: 'samsung-galaxy-a54-5g',
      desc: 'Pantalla Super AMOLED 120Hz, cámara de 50MP con OIS y resistencia al agua IP67.',
      price: 2150,
      discount: 10,
      cat: catPhones.id,
      store: techPlus.id,
      img: 'https://images.unsplash.com/photo-1610945265064-0e34e5519bbf?w=600&auto=format&fit=crop&q=80',
    },
    {
      title: 'Sofá Seccional Nórdico 3 Cuerpos Beige',
      slug: 'sofa-seccional-nordico-3-cuerpos',
      desc: 'Estructura en madera tratada y tapizado en lino de alta resistencia al derrame.',
      price: 2890,
      discount: 20,
      cat: catHome.id,
      store: hogarFeliz.id,
      img: 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=600&auto=format&fit=crop&q=80',
    },
  ];

  for (const fp of flashProducts) {
    const p = await prisma.product.create({
      data: {
        title: fp.title,
        slug: fp.slug,
        description: fp.desc,
        basePrice: fp.price,
        discountPercent: fp.discount,
        categoryId: fp.cat,
        rating: 4.8,
        reviewCount: 75,
        images: JSON.stringify([fp.img]),
        isFlashSale: true,
        flashSaleEnd: new Date(Date.now() + 1000 * 60 * 60 * 3), // 3 horas restantes
      },
    });

    await prisma.productOffer.create({
      data: {
        productId: p.id,
        storeId: fp.store,
        price: Math.round(fp.price * (1 - fp.discount / 100)),
        stock: 15,
        shippingCost: 0,
        estimatedDelivery: 'Llega mañana',
        isRecommended: true,
      },
    });
  }

  // 6. Live Streams (TikTok Live shopping sessions)
  await prisma.liveStream.create({
    data: {
      storeId: techPlus.id,
      title: 'Lanzamiento Exclusivo iPhone 15 Pro Max & Gadgets en Vivo',
      streamerName: 'Andrea Tech & TechPlus Team',
      streamerAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
      viewerCount: 1480,
      likeCount: 9800,
      status: 'LIVE',
      tiktokUrl: 'https://www.tiktok.com/@techplus_bolivia',
      featuredProductIds: `${productIPhone.id},${productBuds.id},${productWatch.id}`,
    },
  });

  await prisma.liveStream.create({
    data: {
      storeId: outfitBolivia.id,
      title: 'Moda Trendy: Nueva colección de Invierno y Sorteos en vivo',
      streamerName: 'Valeria R.',
      streamerAvatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150&auto=format&fit=crop&q=80',
      viewerCount: 1200,
      likeCount: 5400,
      status: 'LIVE',
      featuredProductIds: productChompa.id,
    },
  });

  await prisma.liveStream.create({
    data: {
      storeId: tecnoShop.id,
      title: 'TecnoShop: Setup Gamer y Periféricos con Descuento',
      streamerName: 'Carlos Gamer',
      streamerAvatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80',
      viewerCount: 1500,
      likeCount: 7200,
      status: 'LIVE',
    },
  });

  await prisma.liveStream.create({
    data: {
      storeId: hogarFeliz.id,
      title: 'Hogar Feliz: Tips de decoración y ofertas en sofás',
      streamerName: 'Lucía M.',
      streamerAvatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&auto=format&fit=crop&q=80',
      viewerCount: 842,
      likeCount: 3900,
      status: 'LIVE',
    },
  });

  await prisma.liveStream.create({
    data: {
      storeId: abarrotesDia.id,
      title: 'Abarrotes del Día: Canasta familiar y super combos',
      streamerName: 'Don Mario',
      streamerAvatar: 'https://images.unsplash.com/photo-1560250097-0b93528c311a?w=150&auto=format&fit=crop&q=80',
      viewerCount: 932,
      likeCount: 4100,
      status: 'LIVE',
    },
  });

  await prisma.liveStream.create({
    data: {
      storeId: bellezaNatural.id,
      title: 'Belleza Natural: Rutina de Skincare nocturna en vivo',
      streamerName: 'Camila S.',
      streamerAvatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80',
      viewerCount: 1100,
      likeCount: 6500,
      status: 'LIVE',
    },
  });

  console.log('✅ Base de datos sembrada con éxito con tiendas, productos, ofertas y TikTok Live Streams!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
