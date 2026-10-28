import { ForbiddenException } from '@nestjs/common';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hasTikTokSession, TikTokDiscoveryService } from '../tiktok-discovery.service';
import { TikTokSessionController } from '../tiktok-session.controller';

const session = { name: 'sessionid', value: 'x', domain: '.tiktok.com' };

describe('TikTok operator session', () => {
  let profileDir: string;
  beforeEach(async () => {
    profileDir = await mkdtemp(join(tmpdir(), 'tiktok-profile-'));
  });
  afterEach(async () => {
    await rm(profileDir, { recursive: true, force: true });
  });

  it('reconoce la cookie de sesión de TikTok sin depender de su valor', () => {
    expect(hasTikTokSession([session])).toBe(true);
    expect(hasTikTokSession([{ ...session, name: 'sessionid_ss', domain: 'www.tiktok.com' }])).toBe(true);
    expect(hasTikTokSession([{ ...session, value: '' }])).toBe(false);
    expect(hasTikTokSession([{ ...session, domain: '.nottiktok.com' }])).toBe(false);
    expect(hasTikTokSession([{ ...session, name: 'ttwid' }])).toBe(false);
  });

  it('abre la ventana, pausa el descubrimiento y guarda solo el estado de la sesión', async () => {
    const discovery = new TikTokDiscoveryService({ profileDir } as any);
    let cookies: (typeof session)[] = [];
    const page = { goto: jest.fn().mockResolvedValue(null), authenticate: jest.fn() };
    const browser = {
      connected: true,
      pages: jest.fn().mockResolvedValue([page]),
      cookies: jest.fn(async () => cookies),
      close: jest.fn().mockResolvedValue(undefined),
    };
    const launch = jest.spyOn(discovery as any, 'launch').mockResolvedValue(browser);

    expect((await discovery.sessionStatus()).logged_in).toBe(false);
    const login = discovery.login();
    expect(discovery.login()).toBe(login);
    expect((await discovery.sessionStatus()).login_in_progress).toBe(true);
    expect(await discovery.discover()).toEqual([]);

    cookies = [session];
    await expect(login).resolves.toBe(true);
    expect(launch).toHaveBeenCalledWith(false);
    expect(page.goto).toHaveBeenCalledWith('https://www.tiktok.com/login', expect.anything());
    expect(browser.close).toHaveBeenCalled();
    expect(await discovery.sessionStatus()).toMatchObject({ logged_in: true, login_in_progress: false });
    const saved = await readFile(join(profileDir, 'vitrina-session.json'), 'utf8');
    expect(JSON.parse(saved)).toMatchObject({ loggedIn: true });
    expect(saved).not.toContain(session.value + '"');
  }, 15000);

  it('termina sin sesión si el operador cierra la ventana', async () => {
    const discovery = new TikTokDiscoveryService({ profileDir } as any);
    const browser = {
      connected: true,
      pages: jest.fn().mockResolvedValue([{ goto: jest.fn().mockResolvedValue(null) }]),
      cookies: jest.fn().mockRejectedValue(new Error('Target closed')),
      close: jest.fn().mockResolvedValue(undefined),
    };
    jest.spyOn(discovery as any, 'launch').mockResolvedValue(browser);
    await expect(discovery.login()).resolves.toBe(false);
    expect((await discovery.sessionStatus()).logged_in).toBe(false);
  });

  describe('POST /tiktok-lives/session/login', () => {
    const discovery: any = {
      sessionStatus: jest.fn().mockResolvedValue({ logged_in: false, checked_at: null, login_in_progress: true }),
    };
    const request = (remoteAddress: string) => ({ socket: { remoteAddress } }) as any;

    it('rechaza abrir la ventana si no está habilitado en este equipo', async () => {
      const worker = { startLogin: jest.fn() };
      const controller = new TikTokSessionController(discovery, worker as any, { interactiveLogin: false } as any);
      await expect(controller.login(request('127.0.0.1'))).rejects.toBeInstanceOf(ForbiddenException);
      expect(worker.startLogin).not.toHaveBeenCalled();
    });

    it('solo acepta peticiones del propio equipo', async () => {
      const worker = { startLogin: jest.fn() };
      const controller = new TikTokSessionController(discovery, worker as any, { interactiveLogin: true, enabled: true } as any);
      await expect(controller.login(request('203.0.113.7'))).rejects.toBeInstanceOf(ForbiddenException);
      expect(worker.startLogin).not.toHaveBeenCalled();
      await expect(controller.login(request('::ffff:127.0.0.1'))).resolves.toMatchObject({
        login_in_progress: true,
        interactive_login: true,
      });
      expect(worker.startLogin).toHaveBeenCalledTimes(1);
    });
  });
});
