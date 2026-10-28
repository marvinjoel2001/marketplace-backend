import { isBookableWindow, normalizeSchedule, windowLabel } from '../delivery-schedule';

describe('delivery schedule', () => {
  const schedule = { deliveryDays: '1,2,3,4,5', deliveryStart: '09:00', deliveryEnd: '18:00' };
  // Monday 10:00 in Bolivia (UTC-4).
  const now = new Date('2026-11-02T14:00:00Z');

  it('acepta el inicio de una ventana de una hora dentro del horario', () => {
    expect(isBookableWindow(schedule, new Date('2026-11-02T16:00:00Z'), now)).toBe(true); // 12:00
    expect(isBookableWindow(schedule, new Date('2026-11-03T13:00:00Z'), now)).toBe(true); // Tue 09:00
    expect(windowLabel(new Date('2026-11-02T16:00:00Z'))).toBe('12:00 - 13:00');
  });

  it('rechaza ventanas fuera del horario, mal alineadas, muy pronto o muy lejos', () => {
    expect(isBookableWindow(schedule, new Date('2026-11-02T22:00:00Z'), now)).toBe(false); // 18:00 closes
    expect(isBookableWindow(schedule, new Date('2026-11-02T16:30:00Z'), now)).toBe(false); // 12:30
    expect(isBookableWindow(schedule, new Date('2026-11-02T14:00:00Z'), now)).toBe(false); // now
    expect(isBookableWindow(schedule, new Date('2026-11-07T14:00:00Z'), now)).toBe(false); // Saturday
    expect(isBookableWindow(schedule, new Date('2026-11-16T14:00:00Z'), now)).toBe(false); // > 7 days
  });

  it('valida el horario que guarda la tienda', () => {
    expect(normalizeSchedule({ deliveryDays: '5,1,1,9' })).toEqual({ deliveryDays: '1,5' });
    expect(() => normalizeSchedule({ deliveryDays: '' })).toThrow('al menos un día');
    expect(() => normalizeSchedule({ deliveryStart: '17:30', deliveryEnd: '18:00' })).toThrow('una hora');
    expect(() => normalizeSchedule({ deliveryStart: '9am', deliveryEnd: '18:00' })).toThrow('HH:MM');
  });
});
