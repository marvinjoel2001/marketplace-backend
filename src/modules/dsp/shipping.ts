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
