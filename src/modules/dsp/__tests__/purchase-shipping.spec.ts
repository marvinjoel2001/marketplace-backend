import { purchaseShipping, shortestRoute, StoreStop } from '../shipping';

const rates = { baseFare: 8, perKm: 2.5, minDistanceKm: 1.2, extraStopFee: 4 };
// Santa Cruz: 0.009° of latitude is about 1 km.
const customer = { lat: -17.78, lng: -63.18 };
const stop = (storeId: string, kmNorth: number, kmEast = 0): StoreStop => ({
  storeId,
  point: { lat: customer.lat + kmNorth * 0.009, lng: customer.lng + kmEast * 0.0095 },
  rates,
});

describe('purchaseShipping', () => {
  it('una sola tienda paga su envío normal', () => {
    const result = purchaseShipping([stop('a', 3)], customer);
    expect(result).toMatchObject({ combined: false, total: 16, fees: { a: 16 } });
  });

  it('dos tiendas cercanas: un solo viaje sale más barato y se reparte entre ellas', () => {
    const result = purchaseShipping([stop('a', 3), stop('b', 4)], customer);
    // Ruta b → a → cliente = 4 km: 8 + 4 × 2,5 = 18, más Bs 4 por la parada extra.
    expect(result.combined).toBe(true);
    expect(result.total).toBe(22);
    expect(result.separateTotal).toBe(34);
    expect(result.pickupOrder).toEqual(['b', 'a']);
    expect(result.fees.a + result.fees.b).toBe(22);
    expect(result.fees.a).toBeLessThan(result.fees.b);
  });

  it('tiendas en lados opuestos: juntarlas no conviene, cada una paga su viaje', () => {
    const result = purchaseShipping([stop('a', 6), stop('b', -6)], customer);
    expect(result.combined).toBe(false);
    expect(result.total).toBe(result.separateTotal);
    expect(result.fees).toEqual({ a: 23, b: 23 });
  });

  it('con tres tiendas las partes siempre suman el total', () => {
    const result = purchaseShipping([stop('a', 2), stop('b', 3, 1), stop('c', 5)], customer);
    expect(result.combined).toBe(true);
    expect(Object.values(result.fees).reduce((sum, fee) => sum + fee, 0)).toBe(result.total);
  });
});

describe('shortestRoute', () => {
  it('recoge primero en la tienda más lejana para terminar en el cliente', () => {
    const route = shortestRoute([stop('cerca', 1), stop('lejos', 5), stop('medio', 3)], customer);
    expect(route.order.map((s) => s.storeId)).toEqual(['lejos', 'medio', 'cerca']);
    expect(route.km).toBeCloseTo(5, 0);
  });
});
