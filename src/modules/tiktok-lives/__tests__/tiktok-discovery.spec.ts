import { TikTokDiscoveryService } from '../tiktok-discovery.service';
import { LiveCandidate } from '../tiktok-lives.types';

describe('TikTok discovery page extraction', () => {
  const config: any = { scrolls: 1, maxCandidates: 2 };

  it('prioriza vendedores de páginas posteriores frente a recomendaciones de gaming', () => {
    const discovery = new TikTokDiscoveryService({ ...config, country: 'BO', regionTerms: ['bolivia'], requireRegion: true });
    const candidate = (username: string, title: string): LiveCandidate => ({ username, title, viewerCount: 0, tags: [] });
    const selected = (discovery as any).prioritize([
      candidate('gamer1', 'Jugando Minecraft'), candidate('gamer2', 'Free Fire'),
      candidate('tienda1', 'Ropa Bolivia'), candidate('tienda2', 'Venta de perfumes Bolivia'),
    ]);
    expect(selected.map((live: LiveCandidate) => live.username)).toEqual(['tienda1', 'tienda2']);
  });

  it('conserva metadata comercial y regional de la misma sala, sin heredársela a otra', () => {
    const discovery = new TikTokDiscoveryService(config);
    const candidates = new Map<string, LiveCandidate>();
    const live: LiveCandidate = {
      username: 'tienda', roomId: '12345678', title: 'Ropa Bolivia', viewerCount: 4,
      nickname: 'Mi tienda', bio: 'Envíos Bolivia', tags: ['ropa'],
    };
    (discovery as any).remember(candidates, live);
    (discovery as any).remember(candidates, { ...live, title: '', bio: undefined, nickname: undefined, tags: [] });
    expect(candidates.get('tienda')).toMatchObject(live);
    (discovery as any).remember(candidates, { username: 'tienda', roomId: '99999999', title: '', tags: [], viewerCount: 1 });
    expect(candidates.get('tienda')).not.toHaveProperty('bio');
    expect(candidates.get('tienda')?.tags).toEqual([]);
  });

  it('extrae tarjetas actuales sin mezclar título o espectadores entre enlaces hermanos', async () => {
    const link = (username: string, title: string, viewers: string) => ({
      href: `https://www.tiktok.com/@${username}/live`,
      innerText: `LIVE\n${username}\n${title}\n${viewers}`,
      closest: () => null,
      getAttribute: () => null,
      // The old fallback selected a shared ancestor containing other creators.
      parentElement: { parentElement: { querySelector: () => ({ textContent: 'Otra tienda' }) } },
      querySelector: (selector: string) =>
        selector.includes('person-count') ? { textContent: viewers } : null,
      querySelectorAll: () => [],
    });
    const page: any = {
      goto: jest.fn().mockResolvedValue({ status: () => 200 }),
      waitForSelector: jest.fn().mockResolvedValue(undefined),
      evaluate: jest.fn().mockResolvedValue(false),
      $$eval: jest.fn(async (selector, evaluate) =>
        evaluate(selector.startsWith('script') ? [] : [
          link('tienda1', 'Ropa Bolivia', '12'),
          link('tienda2', 'Cosméticos', '35'),
        ]),
      ),
    };
    const candidates = new Map<string, LiveCandidate>();
    const discovery = new TikTokDiscoveryService(config);
    expect(await (discovery as any).explore(page, 'https://www.tiktok.com/live', candidates)).toBe(true);
    expect([...candidates.values()]).toMatchObject([
      { username: 'tienda1', title: 'Ropa Bolivia', viewerCount: 12 },
      { username: 'tienda2', title: 'Cosméticos', viewerCount: 35 },
    ]);
  });

  it('detiene búsquedas que requieren login y conserva las salas del feed', async () => {
    const discovery = new TikTokDiscoveryService(config);
    const candidates = new Map([['tienda', { username: 'tienda' } as LiveCandidate]]);
    const page: any = {
      goto: jest.fn().mockResolvedValue({ status: () => 200 }),
      waitForSelector: jest.fn().mockResolvedValue(undefined),
      evaluate: jest.fn().mockResolvedValue(true),
      $$eval: jest.fn(),
    };
    expect(await (discovery as any).explore(page, 'https://www.tiktok.com/search/live?q=ropa', candidates)).toBe(false);
    expect(candidates.has('tienda')).toBe(true);
    expect(page.$$eval).not.toHaveBeenCalled();
  });
});
