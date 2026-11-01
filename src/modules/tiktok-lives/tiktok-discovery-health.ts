import { Injectable } from '@nestjs/common';

/** Health of the most recently completed discovery cycle, separate from room freshness. */
@Injectable()
export class TikTokDiscoveryHealth {
  status: 'starting' | 'ok' | 'error' = 'starting';
  checkedAt: string | null = null;

  success(): void {
    this.status = 'ok';
    this.checkedAt = new Date().toISOString();
  }

  fail(): void {
    this.status = 'error';
    this.checkedAt = new Date().toISOString();
  }
}
