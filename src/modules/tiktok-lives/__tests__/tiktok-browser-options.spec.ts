import { ConfigService } from '@nestjs/config';
import { browserEnvironment, browserSandboxArgs } from '../tiktok-browser-options';
import { TikTokLivesConfig } from '../tiktok-lives.config';

describe('Chromium process boundaries', () => {
  it('does not inherit application or database credentials', () => {
    expect(browserEnvironment({
      PATH: '/usr/bin', HOME: '/home/node', SystemRoot: 'C:\\Windows',
      AUTH_INTERNAL_KEY: 'private', FIREBASE_API_KEY: 'private', SESSION_SECRET: 'private',
      DATABASE_URL: 'file:/data/db', TIKTOK_PROXY_URL: 'http://name:password@proxy',
    })).toEqual({ PATH: '/usr/bin', HOME: '/home/node', SystemRoot: 'C:\\Windows' });
  });

  it.each([undefined, 'false', '1', 'TRUE'])('keeps sandbox enabled for %s', (value) => {
    const config = new TikTokLivesConfig(new ConfigService({ TIKTOK_BROWSER_NO_SANDBOX: value }));
    expect(browserSandboxArgs(config.browserNoSandbox)).toEqual([]);
  });

  it('requires an explicit true opt-in to the compatibility flags', () => {
    const config = new TikTokLivesConfig(new ConfigService({ TIKTOK_BROWSER_NO_SANDBOX: 'true' }));
    expect(browserSandboxArgs(config.browserNoSandbox)).toEqual(['--no-sandbox', '--disable-setuid-sandbox']);
  });
});
