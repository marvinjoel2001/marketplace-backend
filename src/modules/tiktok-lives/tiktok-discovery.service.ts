import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { addExtra } from 'puppeteer-extra';
import StealthPlugin = require('puppeteer-extra-plugin-stealth');
import type { Browser, Page } from 'puppeteer';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TikTokLivesConfig } from './tiktok-lives.config';
import {
  imageUrl,
  LiveCandidate,
  normalizeUsername,
  TikTokBlockedError,
  viewerCount,
} from './tiktok-lives.types';
import { parseRooms } from './tiktok-payload.parser';
import { EcommerceClassifier } from './ecommerce-classifier.service';

const loadPuppeteer = new Function(
  'return import("puppeteer")',
) as () => Promise<typeof import('puppeteer')>;

const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;

export interface TikTokSessionStatus {
  logged_in: boolean;
  checked_at: string | null;
  login_in_progress: boolean;
}

/** TikTok's auth cookie exists only while an account is signed in. Its value is never read or logged. */
export function hasTikTokSession(
  cookies: { name: string; value: string; domain: string }[],
): boolean {
  return cookies.some(
    (cookie) =>
      (cookie.name === 'sessionid' || cookie.name === 'sessionid_ss') &&
      cookie.value.length > 0 &&
      /(^|\.)tiktok\.com$/.test(cookie.domain.replace(/^\./, '')),
  );
}

@Injectable()
export class TikTokDiscoveryService implements OnModuleDestroy {
  private readonly logger = new Logger(TikTokDiscoveryService.name);
  private browser?: Browser;
  private stopping = false;
  private termCursor = 0;
  // Chromium locks its profile directory: discovery and the login window take turns on it.
  private profile: Promise<unknown> = Promise.resolve();
  private loginTask?: Promise<boolean>;
  private session = { loggedIn: false, checkedAt: null as string | null };
  private sessionLoaded?: Promise<void>;
  constructor(
    private readonly config: TikTokLivesConfig,
    private readonly classifier: EcommerceClassifier = new EcommerceClassifier(config),
  ) {}

  /** A pending login interrupts the running discovery, which returns what it already collected. */
  private get interrupted(): boolean {
    return this.stopping || !!this.loginTask;
  }

  /** `seeds`: known sellers whose rooms are visited to harvest TikTok's related-LIVE recommendations. */
  async discover(seeds: string[] = []): Promise<LiveCandidate[]> {
    if (this.interrupted) return [];
    return this.exclusive(() => this.explorePages(seeds));
  }

  /**
   * Opens a visible Chromium window on this machine where the operator signs in to TikTok themselves
   * (password or QR code). The session stays in the persistent profile and later discovery cycles
   * see that account's personalised LIVE feed and LIVE search. Resolves true once signed in.
   */
  login(): Promise<boolean> {
    this.loginTask ??= this.exclusive(() => this.waitForLogin()).finally(() => {
      this.loginTask = undefined;
    });
    return this.loginTask;
  }

  async sessionStatus(): Promise<TikTokSessionStatus> {
    await (this.sessionLoaded ??= this.loadSession());
    return {
      logged_in: this.session.loggedIn,
      checked_at: this.session.checkedAt,
      login_in_progress: !!this.loginTask,
    };
  }

  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.profile.then(task, task);
    this.profile = run.catch(() => undefined);
    return run;
  }

  private sessionFile(): string {
    return join(this.config.profileDir, 'vitrina-session.json');
  }

  private async loadSession(): Promise<void> {
    try {
      const saved = JSON.parse(await readFile(this.sessionFile(), 'utf8'));
      if (typeof saved.loggedIn === 'boolean')
        this.session = {
          loggedIn: saved.loggedIn,
          checkedAt: typeof saved.checkedAt === 'string' ? saved.checkedAt : null,
        };
    } catch {
      /* no session recorded yet */
    }
  }

  /** Persists only whether a session exists, never cookie values. */
  private async recordSession(loggedIn: boolean): Promise<void> {
    await (this.sessionLoaded ??= this.loadSession());
    this.session = { loggedIn, checkedAt: new Date().toISOString() };
    await writeFile(this.sessionFile(), JSON.stringify(this.session)).catch(() => undefined);
  }

  private async launch(headless: boolean): Promise<Browser> {
    // puppeteer-extra's typings still mention the removed createBrowserFetcher API.
    const puppeteer = await loadPuppeteer();
    const extra = addExtra(
      puppeteer.default as unknown as Parameters<typeof addExtra>[0],
    );
    const stealth = StealthPlugin();
    // Keep Chrome's user agent; regional preferences are sent via HTTP headers.
    stealth.enabledEvasions.delete('user-agent-override');
    extra.use(stealth);
    const proxy = this.config.proxy;
    await mkdir(this.config.profileDir, { recursive: true });
    return extra.launch({
      headless,
      executablePath: this.config.browserPath,
      userDataDir: this.config.profileDir,
      // A visible login window uses its real size instead of the 800x600 emulation.
      defaultViewport: headless ? undefined : null,
      args: [
        '--lang=es-BO',
        ...(headless ? [] : ['--window-size=1100,860']),
        ...(proxy ? [`--proxy-server=${proxy.origin}`] : []),
      ],
      timeout: 30000,
    });
  }

  private async waitForLogin(): Promise<boolean> {
    const browser = await this.launch(false);
    this.browser = browser;
    try {
      const page = (await browser.pages())[0] ?? (await browser.newPage());
      const proxy = this.config.proxy;
      if (proxy?.username)
        await page.authenticate({
          username: decodeURIComponent(proxy.username),
          password: decodeURIComponent(proxy.password),
        });
      await page
        .goto('https://www.tiktok.com/login', { waitUntil: 'domcontentloaded', timeout: 30000 })
        .catch(() => undefined);
      await this.revealWindow(page);
      const deadline = Date.now() + LOGIN_TIMEOUT_MS;
      while (!this.stopping && browser.connected && Date.now() < deadline) {
        let signedIn = false;
        try {
          signedIn = hasTikTokSession(await browser.cookies());
        } catch {
          break; // The operator closed the window.
        }
        if (signedIn) {
          // Let TikTok finish its post-login redirects so the profile stores the full session.
          await new Promise((resolve) => setTimeout(resolve, 3000));
          await this.recordSession(true);
          this.logger.log('Sesión de TikTok iniciada; el descubrimiento usará el feed de esa cuenta');
          return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      this.logger.warn('Inicio de sesión de TikTok cancelado o vencido');
      return false;
    } finally {
      await browser.close().catch(() => undefined);
      if (this.browser === browser) this.browser = undefined;
    }
  }

  /**
   * Puppeteer spawns Chrome with `windowsHide`, so on Windows the login window starts invisible.
   * Cycling the window state through DevTools shows it and brings it to the front.
   */
  private async revealWindow(page: Page): Promise<void> {
    try {
      const session = await page.createCDPSession();
      const { windowId } = await session.send('Browser.getWindowForTarget');
      await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
      await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
      await page.bringToFront();
      await session.detach();
    } catch {
      /* the window may still be usable from the taskbar */
    }
  }

  private async explorePages(seeds: string[]): Promise<LiveCandidate[]> {
    const browser = await this.launch(this.config.headless);
    this.browser = browser;
    try {
      const proxy = this.config.proxy;
      const page = await browser.newPage();
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'es-BO,es;q=0.9,en;q=0.5',
      });
      await page.emulateTimezone('America/La_Paz');
      await page.setViewport({ width: 1366, height: 900 });
      // Keep navigator.language native. Forcing es-BO here makes TikTok's
      // client send an unsupported language to its feed API, yielding no rooms.
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
          responses++ >= 100 ||
          Number(response.headers()['content-length'] ?? 0) > 2e6
        )
          return;
        const task = response
          .text()
          .then((body) => {
            if (body.length <= 2e6)
              for (const live of parseRooms(JSON.parse(body)))
                this.remember(candidates, live);
          })
          .catch(() => undefined)
          .then(() => {
            pending.delete(task);
          });
        pending.add(task);
      });
      // Public feeds, then known sellers' rooms (TikTok recommends similar, mostly shopping,
      // LIVEs there), then LIVE search, which stops the loop when it requires a login.
      // Room pages load a video; a few steps reach the related-LIVE list without stretching the cycle.
      const roomSteps = Math.min(3, this.config.scrolls);
      const targets: [string, number][] = [
        ['https://www.tiktok.com/live', this.config.scrolls],
        ['https://www.tiktok.com/live/lifestyle', this.config.scrolls],
        ['https://www.tiktok.com/live/category/lifestyle/chatting', this.config.scrolls],
        ...seeds.map((username): [string, number] => [
          `https://www.tiktok.com/@${encodeURIComponent(username)}/live`,
          roomSteps,
        ]),
        ...this.nextSearchTerms().map((term): [string, number] => [
          `https://www.tiktok.com/search/live?q=${encodeURIComponent(term)}`,
          this.config.scrolls,
        ]),
      ];
      for (const [target, steps] of targets) {
        if (this.interrupted) break;
        responses = 0;
        try {
          if (!(await this.explore(page, target, candidates, steps))) break;
        } catch (error) {
          await Promise.allSettled(pending);
          if (!candidates.size) throw error;
          this.logger.warn('Exploración adicional no disponible; se conservan las salas públicas para verificación');
          break;
        }
      }
      await Promise.allSettled(pending);
      return this.prioritize([...candidates.values()]);
    } finally {
      // Notice an expired session so the UI can ask the operator to sign in again.
      await browser
        .cookies()
        .then((cookies) => this.recordSession(hasTikTokSession(cookies)))
        .catch(() => undefined);
      await browser.close();
      if (this.browser === browser) this.browser = undefined;
    }
  }

  /** Round-robin slice of the search terms, so many terms don't stretch one cycle past the cron. */
  private nextSearchTerms(): string[] {
    const terms = this.config.searchTerms;
    const count = Math.min(this.config.searchTermsPerCycle, terms.length);
    const picked = Array.from(
      { length: count },
      (_, i) => terms[(this.termCursor + i) % terms.length],
    );
    this.termCursor = terms.length ? (this.termCursor + count) % terms.length : 0;
    return picked;
  }

  private prioritize(candidates: LiveCandidate[]): LiveCandidate[] {
    // Gaming recommendations must not consume the entire output budget before
    // the marketplace ever sees the sellers collected on later public pages.
    return candidates
      .map((live) => {
        const result = this.classifier.classify(live);
        return { live, priority: result.listable ? 2 : result.isSelling ? 1 : 0 };
      })
      .sort((a, b) => b.priority - a.priority)
      .slice(0, this.config.maxCandidates)
      .map(({ live }) => live);
  }

  private remember(candidates: Map<string, LiveCandidate>, live: LiveCandidate): void {
    const previous = candidates.get(live.username);
    if (!previous || (previous.roomId && live.roomId && previous.roomId !== live.roomId)) {
      candidates.set(live.username, live);
      return;
    }
    candidates.set(live.username, {
      ...previous, ...live,
      roomId: live.roomId ?? previous.roomId,
      title: live.title || previous.title,
      nickname: live.nickname || previous.nickname,
      bio: live.bio || previous.bio,
      countryCode: live.countryCode ?? previous.countryCode,
      tags: [...new Set([...previous.tags, ...live.tags])].slice(0, 30),
      streamHlsUrl: live.streamHlsUrl ?? previous.streamHlsUrl,
      streamFlvUrl: live.streamFlvUrl ?? previous.streamFlvUrl,
    });
  }

  private async explore(
    page: Page,
    target: string,
    candidates: Map<string, LiveCandidate>,
    steps = this.config.scrolls,
  ): Promise<boolean> {
    const pageLimit = candidates.size + Math.ceil(this.config.maxCandidates / 2);
    const response = await page.goto(target, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    if (response && [403, 429].includes(response.status()))
      throw new TikTokBlockedError();
    if (response && response.status() >= 400)
      throw new Error('TikTok discovery HTTP error');
    // Wait for creator links (/@user/live); the nav's plain /live link exists before the grid renders.
    await page
      .waitForSelector('a[href*="/@"][href*="/live"], #captcha-verify-container', {
        timeout: 10000,
      })
      .catch(() => undefined);
    if (target.includes('/search/') && await page.evaluate(() =>
      /log in to search|inicia sesi[oó]n para buscar/i.test(document.body?.innerText ?? ''),
    )) {
      this.logger.warn('La búsqueda LIVE requiere iniciar sesión; se utiliza el feed público');
      return false;
    }
    // The sidebar initially hides additional local creators behind "Ver todo".
    await page.evaluate(() => {
      const expand = [...document.querySelectorAll('span, button, div')].find(
        (el) => el.children.length === 0 && /^(ver todo|see all)$/i.test(el.textContent?.trim() ?? ''),
      ) as HTMLElement | undefined;
      expand?.click();
    });
    for (let step = 0; step < steps && !this.interrupted; step++) {
      await this.assertNotBlocked(page);
      for (const payload of await page.$$eval(
        'script#SIGI_STATE, script#__UNIVERSAL_DATA_FOR_REHYDRATION__',
        (scripts) => scripts.map((s) => s.textContent ?? ''),
      )) {
        if (payload.length > 2e6) continue;
        try {
          for (const live of parseRooms(JSON.parse(payload)))
            this.remember(candidates, live);
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
              (link as HTMLElement).innerText?.split('\n').map((s) => s.trim()).find(
                (s) => s && s !== username && !/^live$/i.test(s) && !/^[\d.,]+[km]?$/i.test(s),
              ) ||
              '',
            viewerCount: text(
              '[data-e2e="live-card-viewer-count"], [data-e2e="live-viewer-count"], [data-e2e="person-count"]',
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
      if (candidates.size >= pageLimit) break;
      // TikTok uses both document scrolling and nested scrollable exploration panels.
      await page.evaluate(() => {
        const elements = [
          document.scrollingElement,
          ...document.querySelectorAll('main, div, section'),
        ];
        for (const element of elements) {
          if (
            element &&
            element.scrollHeight > element.clientHeight + 100 &&
            element.clientHeight > 200 &&
            element.clientWidth > 200 &&
            (element === document.scrollingElement ||
              /auto|scroll/.test(getComputedStyle(element).overflowY))
          )
            element.scrollBy(0, element.clientHeight);
        }
      });
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
    return true;
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
