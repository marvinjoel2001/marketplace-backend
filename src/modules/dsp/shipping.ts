import { ShippingRates } from '../settings/settings.service';

export interface Point {
  lat: number;
  lng: number;
}

/** Great-circle distance in km, rounded to 0.1. */
export function distanceKm(from: Point, to: Point): number {
  const R = 6371;
  const dLat = ((to.lat - from.lat) * Math.PI) / 180;
  const dLng = ((to.lng - from.lng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((from.lat * Math.PI) / 180) * Math.cos((to.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
}

/** What the driver charges for one delivery: base fare plus a rate per km, never less than the minimum distance. */
export function shippingPrice(km: number, rates: ShippingRates): { distanceKm: number; price: number; estimatedMinutes: number } {
  const billed = Math.max(rates.minDistanceKm, km);
  return {
    distanceKm: billed,
    price: Math.round(rates.baseFare + billed * rates.perKm),
    estimatedMinutes: Math.min(45, Math.max(15, Math.round(billed * 4 + 8))),
  };
}

/** A store's own rates win over the platform defaults, field by field. */
export function effectiveRates(
  defaults: ShippingRates,
  store?: { shippingBaseFare?: number | null; shippingPerKm?: number | null } | null,
): ShippingRates {
  return {
    ...defaults,
    baseFare: store?.shippingBaseFare ?? defaults.baseFare,
    perKm: store?.shippingPerKm ?? defaults.perKm,
  };
}

/** A purchase can gather products from this many stores at most (every pickup order is tried, so it stays small). */
export const MAX_STORES_PER_PURCHASE = 4;

export interface StoreStop {
  storeId: string;
  point: Point;
  rates: ShippingRates;
}

export interface PurchaseShipping {
  /** True when one driver visits every store and then the customer, because that is cheaper than separate trips. */
  combined: boolean;
  /** What the customer pays for delivery in total. */
  total: number;
  /** What the same deliveries cost as separate trips. */
  separateTotal: number;
  /** Each store's share of the total; the shares always add up to it. */
  fees: Record<string, number>;
  /** Stores in the order the driver picks up. */
  pickupOrder: string[];
  distanceKm: number;
}

/** The pickup order with the shortest trip that ends at the customer. */
export function shortestRoute(stops: StoreStop[], dropoff: Point): { order: StoreStop[]; km: number } {
  let best: { order: StoreStop[]; km: number } = { order: stops, km: Infinity };
  const visit = (done: StoreStop[], left: StoreStop[], km: number) => {
    if (km >= best.km) return;
    if (!left.length) {
      const total = km + distanceKm(done[done.length - 1].point, dropoff);
      if (total < best.km) best = { order: done, km: Math.round(total * 10) / 10 };
      return;
    }
    for (const next of left) {
      const leg = done.length ? distanceKm(done[done.length - 1].point, next.point) : 0;
      visit([...done, next], left.filter((s) => s !== next), km + leg);
    }
  };
  visit([], stops, 0);
  return best;
}

/**
 * Delivery price for a purchase from several stores. One driver doing the whole route is charged as a single trip
 * (base fare + km of the route) plus a fee per extra stop; when the stores are too far apart for that to be cheaper,
 * each store keeps its own trip and price. The highest rate among the stores applies to the combined trip.
 */
export function purchaseShipping(stops: StoreStop[], dropoff: Point, canCombine = true): PurchaseShipping {
  const separate = stops.map((s) => shippingPrice(distanceKm(s.point, dropoff), s.rates).price);
  const separateTotal = separate.reduce((sum, price) => sum + price, 0);
  const fees = (prices: number[]) => Object.fromEntries(stops.map((s, i) => [s.storeId, prices[i]]));
  const apart: PurchaseShipping = {
    combined: false,
    total: separateTotal,
    separateTotal,
    fees: fees(separate),
    pickupOrder: stops.map((s) => s.storeId),
    distanceKm: 0,
  };
  if (stops.length < 2 || !canCombine) return apart;

  const route = shortestRoute(stops, dropoff);
  const highest = (pick: (r: ShippingRates) => number) => Math.max(...stops.map((s) => pick(s.rates)));
  const rates: ShippingRates = {
    baseFare: highest((r) => r.baseFare),
    perKm: highest((r) => r.perKm),
    minDistanceKm: highest((r) => r.minDistanceKm),
    extraStopFee: highest((r) => r.extraStopFee),
  };
  const total = shippingPrice(route.km, rates).price + Math.round(rates.extraStopFee * (stops.length - 1));
  if (total >= separateTotal) return apart;

  // Each store pays in proportion to what its own trip would cost; the last one takes the rounding difference.
  const shares = separate.map((price) => Math.floor((total * price) / separateTotal));
  shares[shares.length - 1] += total - shares.reduce((sum, share) => sum + share, 0);
  return {
    combined: true,
    total,
    separateTotal,
    fees: fees(shares),
    pickupOrder: route.order.map((s) => s.storeId),
    distanceKm: route.km,
  };
}
