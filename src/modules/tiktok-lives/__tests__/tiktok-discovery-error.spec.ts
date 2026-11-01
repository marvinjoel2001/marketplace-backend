import { discoveryFailureReason } from '../tiktok-discovery-error';

describe('discovery failure diagnostics', () => {
  it.each([
    ['Running as root without --no-sandbox is not supported', 'browser_root:'],
    ['No usable sandbox!', 'browser_sandbox:'],
    ['Failed to move to new namespace: Operation not permitted', 'browser_sandbox:'],
    ['EACCES: permission denied, mkdir /app/.tiktok-profile', 'browser_permissions:'],
    ['Failed to create SingletonLock: File exists', 'browser_profile_locked:'],
    ['spawn /usr/bin/chromium ENOENT', 'browser_missing:'],
    ['Navigation timeout of 30000 ms exceeded', 'timeout:'],
    ['net::ERR_CONNECTION_RESET at https://www.tiktok.com/live', 'network:'],
  ])('identifies %s without exposing raw launch errors', (message, expected) => {
    expect(discoveryFailureReason(new Error(message))).toMatch(new RegExp(`^${expected}`));
  });

  it('does not log credentials or user-supplied content', () => {
    for (const error of [new Error('https://user:secret@proxy.test cookie=private'), 'token=private', null]) {
      expect(discoveryFailureReason(error)).toBe('unknown: el ciclo no pudo terminar');
    }
  });
});
