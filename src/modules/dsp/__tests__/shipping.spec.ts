import { distanceKm, effectiveRates, shippingPrice } from '../shipping';

const rates = { baseFare: 8, perKm: 2.5, minDistanceKm: 1.2 };

describe('shipping tariff', () => {
  it('charges base fare plus rate per km', () => {
    expect(shippingPrice(4, rates)).toMatchObject({ distanceKm: 4, price: 18 });
    expect(shippingPrice(4, { ...rates, perKm: 5 }).price).toBe(28);
  });

  it('never bills less than the minimum distance', () => {
    expect(shippingPrice(0.2, rates)).toMatchObject({ distanceKm: 1.2, price: 11 });
  });

  it('a store rate overrides the platform default field by field', () => {
    expect(effectiveRates(rates, { shippingPerKm: 4, shippingBaseFare: null })).toMatchObject({ baseFare: 8, perKm: 4 });
    expect(effectiveRates(rates, null)).toEqual(rates);
  });

  it('measures real distances between two points in Santa Cruz', () => {
    const km = distanceKm({ lat: -17.7833, lng: -63.1821 }, { lat: -17.7685, lng: -63.1952 });
    expect(km).toBeGreaterThan(1.5);
    expect(km).toBeLessThan(3);
  });
});
