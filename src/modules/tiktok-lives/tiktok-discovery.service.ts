import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { addExtra } from 'puppeteer-extra';
import StealthPlugin = require('puppeteer-extra-plugin-stealth');
import type { Browser, Page } from 'puppeteer';
import { TikTokLivesConfig } from './tiktok-lives.config';
import {
  imageUrl,
  LiveCandidate,
  normalizeUsername,
  TikTokBlockedError,
  viewerCount,
} from './tiktok-lives.types';
import { parseRooms } from './tiktok-payload.parser';

const loadPuppeteer = new Function(
  'return import("puppeteer")',
) as () => Promise<typeof import('puppeteer')>;

@Injectable()
export class TikTokDiscoveryService implements OnModuleDestroy {
  private browser?: Browser;
  private stopping = false;
  constructor(private readonly config: TikTokLivesConfig) {}

  async discover(): Promise<LiveCandidate[]> {
    if (this.stopping) return [];
    // puppeteer-extra's typings still mention the removed createBrowserFetcher API.
    const puppeteer = await loadPuppeteer();
    const extra = addExtra(
      puppeteer.default as unknown as Parameters<typeof addExtra>[0],
    );
    const stealth = StealthPlugin();
    // Preserve the region/language configured below instead of the plugin's default en-US.
    stealth.enabledEvasions.delete('user-agent-override');
    extra.use(stealth);
    const proxy = this.config.proxy;
    const browser = await extra.launch({
      headless: this.config.headless,
      executablePath: this.config.browserPath,
      args: [
        '--lang=es-BO',
        ...(proxy ? [`--proxy-server=${proxy.origin}`] : []),
      ],
      timeout: 30000,
    });
    this.browser = browser;
    try {
      const page = await browser.newPage();
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'es-BO,es;q=0.9,en;q=0.5',
      });
      await page.emulateTimezone('America/La_Paz');
      await page.setViewport({ width: 1366, height: 900 });
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'language', { get: () => 'es-BO' });
        Object.defineProperty(navigator, 'languages', {
          get: () => ['es-BO', 'es', 'en'],
        });
      });
      if (proxy?.username)
        await page.authenticate({
          username: decodeURIComponent(proxy.username),
          password: decodeURIComponent(proxy.password),
        });
      const candidates = new Map<string, LiveCandidate>();
      const pending = new Set<Promise<void>>();
      let responses = 0;
      page.on('response', (response) => {
        const url = new URL(response.url());
        if (
          !(
            url.hostname === 'tiktok.com' ||
            url.hostname.endsWith('.tiktok.com')
          ) ||
          !response.headers()['content-type']?.includes('application/json') ||
          !/live|webcast|room/i.test(url.pathname) ||
          responses++ > 40 ||
          Number(response.headers()['content-length'] ?? 0) > 2e6
        )
          return;
        const task = response
          .text()
          .then((body) => {
            if (body.length <= 2e6)
              for (const live of parseRooms(JSON.parse(body)))
                candidates.set(live.username, live);
          })
          .catch(() => undefined)
          .then(() => {
            pending.delete(task);
          });
        pending.add(task);
      });
      const response = await page.goto('https://www.tiktok.com/live', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      if (response && [403, 429].includes(response.status()))
        throw new TikTokBlockedError();
      if (response && response.status() >= 400)
        throw new Error('TikTok discovery HTTP error');
      await page
        .waitForSelector('a[href*="/live"], #captcha-verify-container', {
          timeout: 10000,
        })
        .catch(() => undefined);
      for (let step = 0; step < this.config.scrolls && !this.stopping; step++) {
        await this.assertNotBlocked(page);
        for (const payload of await page.$$eval(
          'script#SIGI_STATE, script#__UNIVERSAL_DATA_FOR_REHYDRATION__',
          (scripts) => scripts.map((s) => s.textContent ?? ''),
        )) {
          if (payload.length > 2e6) continue;
          try {
            for (const live of parseRooms(JSON.parse(payload)))
              candidates.set(live.username, live);
          } catch {
            /* malformed hydration */
          }
        }
        const cards = await page.$$eval('a[href*="/live"]', (links) =>
          links.slice(0, 250).map((link) => {
            const href = (link as HTMLAnchorElement).href;
            const username = new URL(href).pathname.match(
              /^\/@([^/]+)\/live\/?$/,
            )?.[1];
            const card =
              link.closest(
                '[data-e2e="live-card"], [data-e2e="live-room"], article',
              ) ??
              link.parentElement?.parentElement ??
              link;
            const text = (selector: string) =>
              card.querySelector(selector)?.textContent?.trim() ?? '';
            const img = (selector: string) =>
              (card.querySelector(selector) as HTMLImageElement)?.src;
            return {
              username,
              title:
                text(
                  '[data-e2e="live-card-title"], [data-e2e="live-title"], h2, h3',
                ) ||
                link.getAttribute('title') ||
                '',
              viewerCount: text(
                '[data-e2e="live-card-viewer-count"], [data-e2e="live-viewer-count"]',
              ),
              avatarUrl: img('img[data-e2e*="avatar"], img[alt*="avatar"]'),
              coverImageUrl: img('img[data-e2e*="cover"], img'),
              tags: [...card.querySelectorAll('a[href*="/tag/"]')].map(
                (t) => t.textContent?.trim() ?? '',
              ),
            };
          }),
        );
        for (const card of cards) {
          const username = normalizeUsername(card.username);
          if (username && !candidates.has(username))
            candidates.set(username, {
              username,
              title: card.title.slice(0, 500),
              viewerCount: viewerCount(card.viewerCount),
              avatarUrl: imageUrl(card.avatarUrl),
              coverImageUrl: imageUrl(card.coverImageUrl),
              tags: card.tags.slice(0, 30),
            });
        }
        if (candidates.size >= this.config.maxCandidates) break;
        // TikTok uses both document scrolling and nested scrollable exploration panels.
        await page.evaluate(() => {
          const elements = [
            document.scrollingElement,
            ...document.querySelectorAll('main, main div'),
          ];
          for (const element of elements) {
            if (
              element &&
              element.scrollHeight > element.clientHeight + 100 &&
              element.clientHeight > 200
            )
              element.scrollBy(0, element.clientHeight);
          }
        });
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
      await Promise.allSettled(pending);
      await this.assertNotBlocked(page);
      return [...candidates.values()].slice(0, this.config.maxCandidates);
    } finally {
      await browser.close();
      if (this.browser === browser) this.browser = undefined;
    }
  }

  private async assertNotBlocked(page: Page): Promise<void> {
    const blocked = await page.evaluate(
      () =>
        !!document.querySelector(
          '#captcha-verify-container, [id*="captcha"], iframe[src*="captcha"]',
        ) ||
        /verify to continue|unusual traffic|too many requests|verifica que eres humano/i.test(
          document.body?.innerText?.slice(0, 8000) ?? '',
        ),
    );
    if (blocked) throw new TikTokBlockedError();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    await this.browser?.close().catch(() => undefined);
  }
}
