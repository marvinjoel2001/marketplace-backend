import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { distanceKm, effectiveRates, shippingPrice } from './shipping';

export interface DSPQuoteRequest {
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  itemsCount?: number;
  declaredValue?: number;
  /** Pricing store: its own driver rates override the platform defaults. */
  storeId?: string;
}

export interface DSPQuoteResponse {
  quoteId: string;
  price: number;
  distanceKm: number;
  estimatedMinutes: number;
  expiresAt: string;
}

export interface DSPOrderRequest {
  quoteId: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  customerLat: number;
  customerLng: number;
  storeName: string;
  storeAddress: string;
  storeLat: number;
  storeLng: number;
  totalAmount: number;
  paymentMethod: string;
}

export interface DSPOrderResponse {
  dspOrderId: string;
  trackingToken: string;
  trackingUrl: string;
  status: string;
  driver?: {
    name: string;
    phone: string;
    rating: number;
    vehiclePlate: string;
    photoUrl: string;
  };
  estimatedMinutes: number;
}

@Injectable()
export class DspService {
  private readonly logger = new Logger(DspService.name);
  private readonly dspApiUrl = process.env.DSP_API_URL || 'http://localhost:3000/v1';
  // The fallback is the key the local OpenDSP seed creates; deployments must set their own.
  private readonly dspApiKey = process.env.DSP_API_KEY || (process.env.NODE_ENV === 'production' ? '' : 'dsp_live_marketplace_bolivia_2026');

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Shipping price for a delivery. The platform tariff (base fare + rate per km, configurable globally and per store
   * from /admin) is authoritative. OpenDSP Core is only asked for a quote when DSP_QUOTE_SOURCE=core.
   */
  async getQuote(params: DSPQuoteRequest): Promise<DSPQuoteResponse> {
    const store = params.storeId
      ? await this.prisma.store.findUnique({
          where: { id: params.storeId },
          select: { shippingBaseFare: true, shippingPerKm: true },
        })
      : null;
    const rates = effectiveRates(await this.settings.getShipping(), store);
    const km = distanceKm(
      { lat: params.pickupLat, lng: params.pickupLng },
      { lat: params.dropoffLat, lng: params.dropoffLng },
    );
    const local = shippingPrice(km, rates);

    if (process.env.DSP_QUOTE_SOURCE === 'core') {
      const remote = await this.coreQuote(params);
      if (remote) return remote;
    }

    return {
      quoteId: `dsp_q_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      ...local,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    };
  }

  private async coreQuote(params: DSPQuoteRequest): Promise<DSPQuoteResponse | null> {
    try {
      const response = await fetch(`${this.dspApiUrl}/quotes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.dspApiKey,
        },
        body: JSON.stringify({
          pickupAddress: 'Tienda CompraYa, Santa Cruz',
          pickupLat: params.pickupLat,
          pickupLng: params.pickupLng,
          dropoffAddress: 'Ubicación de Entrega del Cliente, Santa Cruz',
          dropoffLat: params.dropoffLat,
          dropoffLng: params.dropoffLng,
          vehicleType: 'MOTORCYCLE',
        }),
        signal: AbortSignal.timeout(2500),
      });
      if (!response.ok) {
        this.logger.warn(`OpenDSP Quote HTTP ${response.status}: ${await response.text()}`);
        return null;
      }
      const data = await response.json();
      return {
        quoteId: data.id || data.quoteId,
        price: data.totalPrice ?? data.price ?? 15,
        distanceKm: data.distanceKm ?? 3.4,
        estimatedMinutes: data.durationMinutes ?? 20,
        expiresAt: data.expiresAt ?? new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      };
    } catch (err: any) {
      this.logger.debug(`OpenDSP Core no disponible (${err.message}). Se usa la tarifa de la plataforma.`);
      return null;
    }
  }

  /** Asks OpenDSP for a courier. Throws when OpenDSP is unreachable or refuses, so the order stays scheduled and is retried. */
  async dispatchOrder(params: DSPOrderRequest): Promise<DSPOrderResponse> {
    if (!this.dspApiKey) throw new Error('Falta DSP_API_KEY');
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.quoteId);

    const dspPayload: Record<string, unknown> = {
      merchantReference: params.orderNumber,
      pickupAddress: params.storeAddress || params.storeName,
      pickupLat: params.storeLat,
      pickupLng: params.storeLng,
      dropoffAddress: params.customerAddress,
      dropoffLat: params.customerLat,
      dropoffLng: params.customerLng,
      packageNotes: `Cliente: ${params.customerName} (${params.customerPhone}) | Pedido #${params.orderNumber} | Pago: ${params.paymentMethod} | Monto: Bs. ${params.totalAmount}`,
      vehicleType: 'MOTORCYCLE',
    };
    if (isUuid) dspPayload.quoteId = params.quoteId;

    const response = await fetch(`${this.dspApiUrl}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.dspApiKey,
        'idempotency-key': `ord_${params.orderNumber}`,
      },
      body: JSON.stringify(dspPayload),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`OpenDSP HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);

    const data = await response.json();
    return {
      dspOrderId: data.id || data.orderId,
      trackingToken: data.trackingToken,
      trackingUrl: `/pedido/${params.orderNumber}`,
      status: data.status || 'SEARCHING_DRIVER',
      // Usually empty here: the courier arrives later through the order.assigned webhook.
      driver: data.driver
        ? {
            name: data.driver.fullName || data.driver.name,
            phone: data.driver.phone,
            rating: data.driver.rating,
            vehiclePlate: data.driver.vehiclePlate,
            photoUrl: data.driver.photoUrl,
          }
        : undefined,
      estimatedMinutes: data.durationMinutes ?? 20,
    };
  }

  /** Live courier position from OpenDSP, or null when it can't be reached. */
  async getTracking(trackingToken: string) {
    try {
      const response = await fetch(`${this.dspApiUrl}/orders/track/${encodeURIComponent(trackingToken)}`, {
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(3000),
      });
      if (response.ok) return await response.json();
    } catch (err: any) {
      this.logger.debug(`Telemetría OpenDSP Core no disponible (${err.message}).`);
    }
    return null;
  }
}
