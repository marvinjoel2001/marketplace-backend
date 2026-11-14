/** Where one store's order stands, in the words of the tracking page. */
export type StopStep = 'IN_STORE' | 'SEARCHING_DRIVER' | 'DRIVER_TO_STORE' | 'PICKED_UP' | 'DELIVERED' | 'CANCELLED';

export interface TrackedStop {
  storeName: string;
  step: StopStep;
}

/** Turns an order's status into the step shown for its store. */
export function stopStep(order: { status: string; dspDriverName?: string | null }): StopStep {
  switch (order.status) {
    case 'CANCELLED':
      return 'CANCELLED';
    case 'DELIVERED':
      return 'DELIVERED';
    case 'IN_TRANSIT':
      return 'PICKED_UP';
    case 'DSP_DISPATCHED':
      return order.dspDriverName ? 'DRIVER_TO_STORE' : 'SEARCHING_DRIVER';
    default:
      return 'IN_STORE';
  }
}

const list = (names: string[]) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`);

/** One sentence that says what is happening right now, for one store or several. */
export function trackingHeadline(stops: TrackedStop[]): string {
  const open = stops.filter((s) => s.step !== 'CANCELLED');
  if (open.length === 0) return 'Este pedido fue cancelado';
  if (open.every((s) => s.step === 'DELIVERED')) return 'Entregado. Gracias por tu compra';

  const several = open.length > 1;
  const picked = open.filter((s) => s.step === 'PICKED_UP' || s.step === 'DELIVERED');
  const waiting = open.filter((s) => s.step !== 'PICKED_UP' && s.step !== 'DELIVERED');
  if (waiting.length === 0) return several ? 'El repartidor ya recogió todo y va a tu dirección' : 'El repartidor recogió tu pedido y va a tu dirección';

  const next = waiting.find((s) => s.step === 'DRIVER_TO_STORE');
  if (picked.length > 0) {
    const from = list(picked.map((s) => s.storeName));
    return next ? `El repartidor recogió en ${from} y va a ${next.storeName}` : `El repartidor recogió en ${from}. Falta ${list(waiting.map((s) => s.storeName))}`;
  }
  if (next) return `El repartidor va a recoger en ${next.storeName}`;
  if (waiting.some((s) => s.step === 'SEARCHING_DRIVER')) return 'Estamos buscando un repartidor';
  return several ? 'Tus pedidos están en las tiendas' : `Tu pedido está en ${waiting[0].storeName}`;
}

/** How long before the delivery window the customer can still move it. */
export const RESCHEDULE_BEFORE_MINUTES = 60;

/** Whether the delivery time can still be changed, and until when. */
export function rescheduleState(
  orders: { status: string; deliveryAt: Date | null; dispatchedAt?: Date | null }[],
  now = new Date(),
): { allowed: boolean; until: string | null; reason: string | null } {
  const open = orders.filter((o) => o.status !== 'CANCELLED');
  const first = open.map((o) => o.deliveryAt).filter((d): d is Date => Boolean(d)).sort((a, b) => a.getTime() - b.getTime())[0];
  if (!open.length || !first) return { allowed: false, until: null, reason: 'Este pedido ya no se puede reprogramar' };
  if (open.every((o) => o.status === 'DELIVERED')) return { allowed: false, until: null, reason: 'Este pedido ya fue entregado' };
  const until = new Date(first.getTime() - RESCHEDULE_BEFORE_MINUTES * 60_000);
  if (open.some((o) => o.dispatchedAt || !['SCHEDULED', 'CONFIRMED', 'PREPARING'].includes(o.status)))
    return { allowed: false, until: until.toISOString(), reason: 'El repartidor ya está en camino' };
  if (now.getTime() > until.getTime())
    return { allowed: false, until: until.toISOString(), reason: 'Solo se puede cambiar hasta 1 hora antes de la entrega' };
  return { allowed: true, until: until.toISOString(), reason: null };
}
