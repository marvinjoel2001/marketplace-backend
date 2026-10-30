import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { PAYMENT_METHODS } from '../orders/orders.service';
import { distanceKm, effectiveRates, shippingPrice } from '../dsp/shipping';

const DAY_MS = 24 * 60 * 60 * 1000;
const LIVE_ORDER_STATUSES = ['SCHEDULED', 'CONFIRMED', 'PREPARING', 'DSP_DISPATCHED', 'IN_TRANSIT'];
const PAYOUT_ALERT_BS = 100;

const round = (n: number) => Math.round(n * 100) / 100;
const dayKey = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/La_Paz' });

interface OrderRow {
  storeId: string | null;
  status: string;
  subtotal: number;
  shippingFee: number;
  platformCommission: number | null;
  vendorEarnings: number | null;
  createdAt: Date;
}

/** Read models and payout bookkeeping behind the /admin panel. Money figures come from real orders only. */
@Injectable()
export class AdminInsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async overview() {
    const now = new Date();
    const since = new Date(now.getTime() - 13 * DAY_MS);
    since.setHours(0, 0, 0, 0);

    const [stores, orders, activeLives, payouts, users] = await Promise.all([
      this.prisma.store.findMany({ select: { id: true, name: true, status: true, walletBalance: true, createdAt: true, latitude: true, longitude: true } }),
      this.prisma.order.findMany({
        select: { id: true, orderNumber: true, storeId: true, status: true, subtotal: true, shippingFee: true, platformCommission: true, vendorEarnings: true, createdAt: true, customerName: true, totalAmount: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.liveStream.count({ where: { status: 'LIVE' } }),
      this.prisma.payout.findMany(),
      this.prisma.user.count({ where: { role: { not: 'ADMIN' } } }),
    ]);

    const counted = orders.filter((o) => o.status !== 'CANCELLED');
    const delivered = orders.filter((o) => o.status === 'DELIVERED');
    const todayKey = dayKey(now);
    const today = counted.filter((o) => dayKey(o.createdAt) === todayKey);

    const series = new Map<string, { orders: number; sales: number }>();
    for (let i = 13; i >= 0; i--) series.set(dayKey(new Date(now.getTime() - i * DAY_MS)), { orders: 0, sales: 0 });
    for (const o of counted) {
      const slot = series.get(dayKey(o.createdAt));
      if (slot && o.createdAt >= since) {
        slot.orders += 1;
        slot.sales = round(slot.sales + o.subtotal);
      }
    }

    const perStore = new Map<string, { orders: number; sales: number }>();
    for (const o of counted) {
      if (!o.storeId) continue;
      const row = perStore.get(o.storeId) ?? { orders: 0, sales: 0 };
      row.orders += 1;
      row.sales = round(row.sales + o.subtotal);
      perStore.set(o.storeId, row);
    }
    const names = new Map(stores.map((s) => [s.id, s.name]));
    const topStores = [...perStore.entries()]
      .sort((a, b) => b[1].sales - a[1].sales)
      .slice(0, 5)
      .map(([id, v]) => ({ id, name: names.get(id) ?? 'Tienda', ...v }));

    const storeOwed = round(stores.reduce((sum, s) => sum + s.walletBalance, 0));
    const driverOwed = round(
      delivered.reduce((sum, o) => sum + o.shippingFee, 0) - payouts.filter((p) => p.kind === 'DRIVER').reduce((sum, p) => sum + p.amount, 0),
    );

    return {
      stores: {
        total: stores.length,
        active: stores.filter((s) => s.status === 'ACTIVE').length,
        suspended: stores.filter((s) => s.status === 'SUSPENDED').length,
        blocked: stores.filter((s) => s.status === 'BANNED').length,
        newThisWeek: stores.filter((s) => now.getTime() - s.createdAt.getTime() < 7 * DAY_MS).length,
      },
      orders: {
        total: counted.length,
        today: today.length,
        inProgress: orders.filter((o) => LIVE_ORDER_STATUSES.includes(o.status)).length,
        delivered: delivered.length,
        cancelled: orders.length - counted.length,
      },
      money: {
        salesTotal: round(counted.reduce((sum, o) => sum + o.subtotal, 0)),
        salesToday: round(today.reduce((sum, o) => sum + o.subtotal, 0)),
        shippingTotal: round(counted.reduce((sum, o) => sum + o.shippingFee, 0)),
        commissionTotal: round(delivered.reduce((sum, o) => sum + (o.platformCommission ?? 0), 0)),
        storeOwed,
        driverOwed: Math.max(0, driverOwed),
      },
      customers: users,
      activeLives,
      series: [...series.entries()].map(([date, v]) => ({ date, ...v })),
      topStores,
      recentOrders: orders.slice(0, 6).map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        storeName: o.storeId ? names.get(o.storeId) ?? '' : '',
        customerName: o.customerName,
        total: o.totalAmount,
        status: o.status,
        createdAt: o.createdAt,
      })),
    };
  }

  async stores() {
    const [stores, orders, payouts, defaults] = await Promise.all([
      this.prisma.store.findMany({
        include: { _count: { select: { offers: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.order.findMany({
        select: { storeId: true, status: true, subtotal: true, shippingFee: true, platformCommission: true, vendorEarnings: true, createdAt: true },
      }),
      this.prisma.payout.findMany(),
      this.settings.getShipping(),
    ]);
    const owners = await this.prisma.user.findMany({
      where: { id: { in: stores.map((s) => s.ownerId).filter((id): id is string => Boolean(id)) } },
      select: { id: true, name: true, email: true, phone: true, phoneVerifiedAt: true, provider: true },
    });
    const ownerById = new Map(owners.map((o) => [o.id, o]));

    return stores.map((store) => {
      const mine = orders.filter((o) => o.storeId === store.id);
      const metrics = this.metrics(mine as OrderRow[]);
      const rates = effectiveRates(defaults, store);
      const driverPaid = payouts.filter((p) => p.storeId === store.id && p.kind === 'DRIVER').reduce((sum, p) => sum + p.amount, 0);
      const owner = store.ownerId ? ownerById.get(store.ownerId) : undefined;
      return {
        id: store.id,
        name: store.name,
        slug: store.slug,
        logo: store.logo,
        category: store.category,
        address: store.address,
        latitude: store.latitude,
        longitude: store.longitude,
        phone: store.phone,
        tiktokUsername: store.tiktokUsername,
        status: store.status,
        statusReason: store.statusReason,
        createdAt: store.createdAt,
        products: store._count.offers,
        paymentMethods: store.paymentMethods.split(',').filter(Boolean),
        rates: { baseFare: rates.baseFare, perKm: rates.perKm, custom: store.shippingBaseFare !== null || store.shippingPerKm !== null },
        customCommissionRate: store.customCommissionRate,
        walletBalance: store.walletBalance,
        driverOwed: Math.max(0, round(metrics.shippingDelivered - driverPaid)),
        owner: owner
          ? { name: owner.name, email: owner.email, phone: owner.phone, phoneVerified: Boolean(owner.phoneVerifiedAt), provider: owner.provider }
          : null,
        ...metrics,
      };
    });
  }

  async storeDetail(id: string) {
    const store = await this.prisma.store.findUnique({ where: { id } });
    if (!store) throw new NotFoundException('Tienda no encontrada');
    const [list, orders, payouts] = await Promise.all([
      this.stores().then((all) => all.find((s) => s.id === id)!),
      this.prisma.order.findMany({
        where: { storeId: id },
        include: { items: true },
        orderBy: { createdAt: 'desc' },
        take: 40,
      }),
      this.prisma.payout.findMany({ where: { storeId: id }, orderBy: { createdAt: 'desc' }, take: 30 }),
    ]);

    const since = new Date(Date.now() - 29 * DAY_MS);
    const days = new Map<string, { orders: number; sales: number }>();
    for (let i = 29; i >= 0; i--) days.set(dayKey(new Date(Date.now() - i * DAY_MS)), { orders: 0, sales: 0 });
    const all = await this.prisma.order.findMany({
      where: { storeId: id, status: { not: 'CANCELLED' }, createdAt: { gte: since } },
      select: { subtotal: true, createdAt: true },
    });
    for (const o of all) {
      const slot = days.get(dayKey(o.createdAt));
      if (slot) {
        slot.orders += 1;
        slot.sales = round(slot.sales + o.subtotal);
      }
    }

    return {
      store: list,
      salesByDay: [...days.entries()].map(([date, v]) => ({ date, ...v })),
      orders: orders.map((o) => this.orderRow(o, store.name)),
      payouts,
    };
  }

  /** Admin-editable configuration of one store: payment methods, driver tariff, commission, review state. */
  async updateStoreConfig(
    id: string,
    body: {
      paymentMethods?: string[];
      shippingBaseFare?: number | null;
      shippingPerKm?: number | null;
      customCommissionRate?: number | null;
      status?: string;
      statusReason?: string | null;
    },
  ) {
    const store = await this.prisma.store.findUnique({ where: { id } });
    if (!store) throw new NotFoundException('Tienda no encontrada');
    const data: Record<string, unknown> = {};

    if (body.paymentMethods !== undefined) {
      const methods = [...new Set(body.paymentMethods)].filter((m) => (PAYMENT_METHODS as readonly string[]).includes(m));
      if (methods.length === 0) throw new BadRequestException('Deja al menos un método de pago activo para esta tienda');
      data.paymentMethods = methods.join(',');
    }
    for (const key of ['shippingBaseFare', 'shippingPerKm', 'customCommissionRate'] as const) {
      const value = body[key];
      if (value === undefined) continue;
      if (value === null) data[key] = null;
      else if (Number.isFinite(Number(value)) && Number(value) >= 0) data[key] = round(Number(value));
      else throw new BadRequestException('Los montos deben ser números positivos');
    }
    if (body.status !== undefined) {
      if (!['ACTIVE', 'SUSPENDED', 'BANNED'].includes(body.status)) throw new BadRequestException('Estado no válido');
      data.status = body.status;
      data.statusReason = body.status === 'ACTIVE' ? null : (body.statusReason ?? store.statusReason ?? null);
      if (body.status !== 'ACTIVE') {
        data.isLiveNow = false;
        await this.prisma.liveStream.updateMany({ where: { storeId: id, status: 'LIVE' }, data: { status: 'ENDED' } });
      }
    } else if (body.statusReason !== undefined) {
      data.statusReason = body.statusReason;
    }

    await this.prisma.store.update({ where: { id }, data });
    return this.stores().then((all) => all.find((s) => s.id === id));
  }

  async orders(filter: { status?: string; storeId?: string; from?: string; to?: string; q?: string }) {
    const where: Record<string, unknown> = {};
    if (filter.status) where.status = filter.status;
    if (filter.storeId) where.storeId = filter.storeId;
    const range = this.range(filter.from, filter.to);
    if (range) where.deliveryAt = range;
    if (filter.q?.trim()) {
      const q = filter.q.trim();
      where.OR = [{ orderNumber: { contains: q } }, { customerName: { contains: q } }, { customerPhone: { contains: q } }];
    }
    const [orders, stores] = await Promise.all([
      this.prisma.order.findMany({ where, include: { items: true }, orderBy: { createdAt: 'desc' }, take: 200 }),
      this.prisma.store.findMany({ select: { id: true, name: true } }),
    ]);
    const names = new Map(stores.map((s) => [s.id, s.name]));
    return orders.map((o) => this.orderRow(o, o.storeId ? names.get(o.storeId) ?? '' : ''));
  }

  /** Scheduled deliveries between two dates, for the calendar view. */
  async shipments(from?: string, to?: string) {
    const start = from ? new Date(from) : new Date(new Date().setHours(0, 0, 0, 0));
    const end = to ? new Date(to) : new Date(start.getTime() + 7 * DAY_MS);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new BadRequestException('Fechas no válidas');
    const [orders, stores] = await Promise.all([
      this.prisma.order.findMany({
        where: { deliveryAt: { gte: start, lt: end }, status: { not: 'CANCELLED' } },
        include: { items: true },
        orderBy: { deliveryAt: 'asc' },
      }),
      this.prisma.store.findMany({ select: { id: true, name: true, latitude: true, longitude: true, address: true, phone: true } }),
    ]);
    const byId = new Map(stores.map((s) => [s.id, s]));
    return {
      from: start.toISOString(),
      to: end.toISOString(),
      shipments: orders.map((o) => ({
        ...this.orderRow(o, o.storeId ? byId.get(o.storeId)?.name ?? '' : ''),
        pickup: o.storeId ? byId.get(o.storeId) ?? null : null,
      })),
    };
  }

  async payouts() {
    const [stores, orders, payouts] = await Promise.all([
      this.prisma.store.findMany({ select: { id: true, name: true, slug: true, status: true, walletBalance: true, payoutQr: true, bankAccountInfo: true, phone: true } }),
      this.prisma.order.findMany({ where: { status: 'DELIVERED' }, select: { storeId: true, shippingFee: true } }),
      this.prisma.payout.findMany({ orderBy: { createdAt: 'desc' }, take: 200 }),
    ]);
    const names = new Map(stores.map((s) => [s.id, s.name]));
    const rows = stores.map((store) => {
      const delivered = orders.filter((o) => o.storeId === store.id);
      const driverEarned = round(delivered.reduce((sum, o) => sum + o.shippingFee, 0));
      const driverPaid = round(payouts.filter((p) => p.storeId === store.id && p.kind === 'DRIVER').reduce((sum, p) => sum + p.amount, 0));
      const storePaid = round(payouts.filter((p) => p.storeId === store.id && p.kind === 'STORE').reduce((sum, p) => sum + p.amount, 0));
      let bank: Record<string, string> | null = null;
      try {
        bank = store.bankAccountInfo ? JSON.parse(store.bankAccountInfo) : null;
      } catch {
        bank = null;
      }
      return {
        storeId: store.id,
        name: store.name,
        status: store.status,
        phone: store.phone,
        deliveredOrders: delivered.length,
        storeOwed: round(store.walletBalance),
        storePaid,
        driverOwed: Math.max(0, round(driverEarned - driverPaid)),
        driverPaid,
        hasQr: Boolean(store.payoutQr),
        payoutQr: store.payoutQr,
        bank,
      };
    });
    return {
      totals: {
        storeOwed: round(rows.reduce((sum, r) => sum + r.storeOwed, 0)),
        driverOwed: round(rows.reduce((sum, r) => sum + r.driverOwed, 0)),
      },
      stores: rows.sort((a, b) => b.storeOwed + b.driverOwed - (a.storeOwed + a.driverOwed)),
      history: payouts.map((p) => ({ ...p, storeName: p.storeId ? names.get(p.storeId) ?? '' : '' })),
    };
  }

  async createPayout(body: { kind?: string; storeId?: string; amount?: number; method?: string; reference?: string; note?: string }) {
    const kind = body.kind === 'DRIVER' ? 'DRIVER' : body.kind === 'STORE' ? 'STORE' : null;
    const amount = round(Number(body.amount));
    if (!kind || !body.storeId) throw new BadRequestException('Indica si es pago a la tienda o al repartidor, y la tienda');
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('El monto debe ser mayor a cero');

    const row = (await this.payouts()).stores.find((s) => s.storeId === body.storeId);
    if (!row) throw new NotFoundException('Tienda no encontrada');
    const owed = kind === 'STORE' ? row.storeOwed : row.driverOwed;
    if (amount > owed + 0.001) throw new BadRequestException(`Solo hay Bs. ${owed} pendientes de ${kind === 'STORE' ? 'pagar a la tienda' : 'pagar al repartidor'}`);

    const data = { kind, storeId: body.storeId, amount, method: body.method?.trim() || null, reference: body.reference?.trim() || null, note: body.note?.trim() || null };
    if (kind === 'STORE') {
      const [payout] = await this.prisma.$transaction([
        this.prisma.payout.create({ data }),
        this.prisma.store.update({ where: { id: body.storeId }, data: { walletBalance: { decrement: amount } } }),
      ]);
      return payout;
    }
    return this.prisma.payout.create({ data });
  }

  /** Events worth the admin's attention, derived from live data; "unread" counts those newer than the last visit. */
  async notifications() {
    const now = new Date();
    const seenAt = await this.settings.getNotificationsSeenAt();
    const seen = seenAt ? new Date(seenAt) : new Date(0);
    const [stores, orders, late] = await Promise.all([
      this.prisma.store.findMany({ where: { createdAt: { gte: new Date(now.getTime() - 7 * DAY_MS) } }, orderBy: { createdAt: 'desc' } }),
      this.prisma.order.findMany({ where: { createdAt: { gte: new Date(now.getTime() - 2 * DAY_MS) } }, orderBy: { createdAt: 'desc' }, take: 30 }),
      this.prisma.order.findMany({ where: { deliveryAt: { lt: now }, status: { in: LIVE_ORDER_STATUSES } }, orderBy: { deliveryAt: 'asc' }, take: 20 }),
    ]);
    const owing = await this.payouts();
    const names = new Map((await this.prisma.store.findMany({ select: { id: true, name: true } })).map((s) => [s.id, s.name]));

    const items = [
      ...stores.map((s) => ({ id: `store-${s.id}`, type: 'NEW_STORE', title: `Nueva tienda: ${s.name}`, detail: `${s.category} · ${s.address}`, at: s.createdAt, link: `/admin/tiendas/${s.id}` })),
      ...orders.map((o) => ({ id: `order-${o.id}`, type: 'NEW_ORDER', title: `Pedido ${o.orderNumber}`, detail: `${names.get(o.storeId ?? '') ?? 'Tienda'} · Bs. ${o.totalAmount} · para ${o.customerName}`, at: o.createdAt, link: '/admin/pedidos' })),
      ...late.map((o) => ({ id: `late-${o.id}`, type: 'LATE_DELIVERY', title: `Entrega vencida: ${o.orderNumber}`, detail: `Debía entregarse ${o.deliveryWindow ?? ''} y sigue ${o.status}`, at: o.deliveryAt ?? o.createdAt, link: '/admin/envios' })),
      ...owing.stores
        .filter((r) => r.storeOwed >= PAYOUT_ALERT_BS)
        .map((r) => ({ id: `payout-${r.storeId}`, type: 'PAYOUT_DUE', title: `Pago pendiente a ${r.name}`, detail: `Bs. ${r.storeOwed} de ventas entregadas`, at: now, link: '/admin/pagos' })),
    ].sort((a, b) => b.at.getTime() - a.at.getTime());

    return { items, unread: items.filter((i) => i.at > seen).length };
  }

  markNotificationsSeen() {
    return this.settings.markNotificationsSeen().then(() => ({ ok: true }));
  }

  /** Shipping preview so the admin can check a tariff before relying on it. */
  async previewShipping(body: { storeId?: string; dropoffLat?: number; dropoffLng?: number }) {
    const store = body.storeId ? await this.prisma.store.findUnique({ where: { id: body.storeId } }) : null;
    if (body.storeId && !store) throw new NotFoundException('Tienda no encontrada');
    const rates = effectiveRates(await this.settings.getShipping(), store);
    const lat = Number(body.dropoffLat);
    const lng = Number(body.dropoffLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new BadRequestException('Indica la ubicación de entrega');
    const from = { lat: store?.latitude ?? -17.7833, lng: store?.longitude ?? -63.1821 };
    return { rates, ...shippingPrice(distanceKm(from, { lat, lng }), rates) };
  }

  private metrics(orders: OrderRow[]) {
    const counted = orders.filter((o) => o.status !== 'CANCELLED');
    const delivered = orders.filter((o) => o.status === 'DELIVERED');
    return {
      orders: counted.length,
      inProgress: orders.filter((o) => LIVE_ORDER_STATUSES.includes(o.status)).length,
      deliveredOrders: delivered.length,
      cancelledOrders: orders.length - counted.length,
      sales: round(counted.reduce((sum, o) => sum + o.subtotal, 0)),
      commission: round(delivered.reduce((sum, o) => sum + (o.platformCommission ?? 0), 0)),
      shippingDelivered: round(delivered.reduce((sum, o) => sum + o.shippingFee, 0)),
      lastOrderAt: orders.reduce<Date | null>((latest, o) => (!latest || o.createdAt > latest ? o.createdAt : latest), null),
    };
  }

  private range(from?: string, to?: string) {
    const gte = from ? new Date(from) : undefined;
    const lt = to ? new Date(to) : undefined;
    if ((gte && Number.isNaN(gte.getTime())) || (lt && Number.isNaN(lt.getTime()))) throw new BadRequestException('Fechas no válidas');
    return gte || lt ? { ...(gte ? { gte } : {}), ...(lt ? { lt } : {}) } : null;
  }

  private orderRow(
    o: {
      id: string; orderNumber: string; storeId: string | null; status: string; paymentMethod: string; paymentStatus: string;
      subtotal: number; shippingFee: number; totalAmount: number; deliveryAt: Date | null; deliveryWindow: string | null;
      customerName: string; customerPhone: string; customerAddress: string; customerReference: string | null;
      customerLat: number; customerLng: number; dspDriverName: string | null; dspDriverPhone: string | null; createdAt: Date;
      items: { productTitle: string; quantity: number; unitPrice: number }[];
    },
    storeName: string,
  ) {
    return {
      id: o.id,
      orderNumber: o.orderNumber,
      storeId: o.storeId,
      storeName,
      status: o.status,
      paymentMethod: o.paymentMethod,
      paymentStatus: o.paymentStatus,
      subtotal: o.subtotal,
      shippingFee: o.shippingFee,
      total: o.totalAmount,
      deliveryAt: o.deliveryAt,
      deliveryWindow: o.deliveryWindow,
      createdAt: o.createdAt,
      // "Para quién es": the person receiving the order, as typed at checkout.
      recipient: { name: o.customerName, phone: o.customerPhone, address: o.customerAddress, reference: o.customerReference, lat: o.customerLat, lng: o.customerLng },
      driver: o.dspDriverName ? { name: o.dspDriverName, phone: o.dspDriverPhone } : null,
      items: o.items.map((i) => ({ title: i.productTitle, quantity: i.quantity, unitPrice: i.unitPrice })),
    };
  }
}
