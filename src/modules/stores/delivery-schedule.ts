import { BadRequestException } from '@nestjs/common';

// Bolivia has no daylight saving: local time is always UTC-4.
const BOLIVIA_OFFSET_MS = 4 * 60 * 60 * 1000;
/** Customers can't pick a window that starts sooner than this, so the store has time to pack. */
export const MIN_LEAD_MINUTES = 60;
export const SLOT_MINUTES = 60;
export const BOOKING_DAYS = 7;

export interface DeliverySchedule {
  deliveryDays: string;
  deliveryStart: string;
  deliveryEnd: string;
}

export function toMinutes(time: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!match) return NaN;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function parseDays(days: string): number[] {
  return [...new Set(days.split(',').filter((d) => d.trim() !== '').map((d) => Number(d.trim())))]
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    .sort();
}

/** Validates and normalizes a schedule coming from the store settings. */
export function normalizeSchedule(input: Partial<DeliverySchedule>): Partial<DeliverySchedule> {
  const out: Partial<DeliverySchedule> = {};
  if (input.deliveryDays !== undefined) {
    const days = parseDays(String(input.deliveryDays));
    if (days.length === 0) throw new BadRequestException('Elige al menos un día de entrega');
    out.deliveryDays = days.join(',');
  }
  if (input.deliveryStart !== undefined) out.deliveryStart = String(input.deliveryStart);
  if (input.deliveryEnd !== undefined) out.deliveryEnd = String(input.deliveryEnd);
  if (out.deliveryStart !== undefined || out.deliveryEnd !== undefined) {
    const start = toMinutes(out.deliveryStart ?? '09:00');
    const end = toMinutes(out.deliveryEnd ?? '18:00');
    if (Number.isNaN(start) || Number.isNaN(end))
      throw new BadRequestException('Usa horas con formato HH:MM, por ejemplo 09:00');
    if (end - start < SLOT_MINUTES)
      throw new BadRequestException('El horario de entregas debe durar al menos una hora');
  }
  return out;
}

function localParts(date: Date) {
  const local = new Date(date.getTime() - BOLIVIA_OFFSET_MS);
  return {
    day: local.getUTCDay(),
    minutes: local.getUTCHours() * 60 + local.getUTCMinutes(),
    seconds: local.getUTCSeconds() + local.getUTCMilliseconds(),
  };
}

/**
 * True when `at` is the start of one of the store's one-hour windows, inside the booking range.
 * The frontend offers the same windows; this check keeps a tampered request from booking others.
 */
export function isBookableWindow(schedule: DeliverySchedule, at: Date, now = new Date()): boolean {
  if (Number.isNaN(at.getTime())) return false;
  const lead = at.getTime() - now.getTime();
  if (lead < MIN_LEAD_MINUTES * 60_000 || lead > BOOKING_DAYS * 24 * 60 * 60_000) return false;
  const { day, minutes, seconds } = localParts(at);
  const start = toMinutes(schedule.deliveryStart);
  const end = toMinutes(schedule.deliveryEnd);
  return (
    parseDays(schedule.deliveryDays).includes(day) &&
    seconds === 0 &&
    minutes >= start &&
    minutes + SLOT_MINUTES <= end &&
    (minutes - start) % SLOT_MINUTES === 0
  );
}

export function windowLabel(at: Date): string {
  const { minutes } = localParts(at);
  const fmt = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return `${fmt(minutes)} - ${fmt(minutes + SLOT_MINUTES)}`;
}
