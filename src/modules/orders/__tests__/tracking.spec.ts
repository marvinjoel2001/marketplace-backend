import { rescheduleState, stopStep, trackingHeadline } from '../tracking';

describe('seguimiento del pedido', () => {
  it('traduce el estado del pedido al paso de su tienda', () => {
    expect(stopStep({ status: 'SCHEDULED' })).toBe('IN_STORE');
    expect(stopStep({ status: 'DSP_DISPATCHED' })).toBe('SEARCHING_DRIVER');
    expect(stopStep({ status: 'DSP_DISPATCHED', dspDriverName: 'Ana' })).toBe('DRIVER_TO_STORE');
    expect(stopStep({ status: 'IN_TRANSIT', dspDriverName: 'Ana' })).toBe('PICKED_UP');
    expect(stopStep({ status: 'DELIVERED' })).toBe('DELIVERED');
  });

  it('una tienda: dice dónde está el pedido en cada momento', () => {
    const at = (step: any) => trackingHeadline([{ storeName: 'Tienda shifu', step }]);
    expect(at('IN_STORE')).toBe('Tu pedido está en Tienda shifu');
    expect(at('SEARCHING_DRIVER')).toBe('Estamos buscando un repartidor');
    expect(at('DRIVER_TO_STORE')).toBe('El repartidor va a recoger en Tienda shifu');
    expect(at('PICKED_UP')).toBe('El repartidor recogió tu pedido y va a tu dirección');
    expect(at('DELIVERED')).toBe('Entregado. Gracias por tu compra');
  });

  it('varias tiendas: cuenta en cuál ya recogió y a cuál va', () => {
    expect(trackingHeadline([{ storeName: 'A', step: 'IN_STORE' }, { storeName: 'B', step: 'IN_STORE' }])).toBe('Tus pedidos están en las tiendas');
    expect(trackingHeadline([{ storeName: 'A', step: 'DRIVER_TO_STORE' }, { storeName: 'B', step: 'DRIVER_TO_STORE' }])).toBe('El repartidor va a recoger en A');
    expect(trackingHeadline([{ storeName: 'A', step: 'PICKED_UP' }, { storeName: 'B', step: 'DRIVER_TO_STORE' }])).toBe('El repartidor recogió en A y va a B');
    expect(trackingHeadline([{ storeName: 'A', step: 'PICKED_UP' }, { storeName: 'B', step: 'PICKED_UP' }])).toBe('El repartidor ya recogió todo y va a tu dirección');
    // Una tienda canceló: el resto sigue.
    expect(trackingHeadline([{ storeName: 'A', step: 'CANCELLED' }, { storeName: 'B', step: 'PICKED_UP' }])).toBe('El repartidor recogió tu pedido y va a tu dirección');
  });

  it('se puede reprogramar hasta 1 hora antes y solo si el repartidor no salió', () => {
    const deliveryAt = new Date('2026-11-14T19:00:00Z');
    const order = { status: 'SCHEDULED', deliveryAt, dispatchedAt: null };
    expect(rescheduleState([order], new Date('2026-11-14T17:59:00Z'))).toMatchObject({ allowed: true, until: '2026-11-14T18:00:00.000Z' });
    expect(rescheduleState([order], new Date('2026-11-14T18:01:00Z'))).toMatchObject({ allowed: false, reason: 'Solo se puede cambiar hasta 1 hora antes de la entrega' });
    expect(rescheduleState([{ ...order, status: 'DSP_DISPATCHED' }], new Date('2026-11-14T10:00:00Z'))).toMatchObject({ allowed: false, reason: 'El repartidor ya está en camino' });
    expect(rescheduleState([{ ...order, status: 'DELIVERED' }], new Date('2026-11-14T10:00:00Z')).reason).toBe('Este pedido ya fue entregado');
    expect(rescheduleState([{ ...order, status: 'CANCELLED' }], new Date('2026-11-14T10:00:00Z')).allowed).toBe(false);
  });
});
