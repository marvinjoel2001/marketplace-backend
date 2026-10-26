// Local-only compatibility check. No requests to TikTok or any external service.
require('dotenv').config();
const assert = require('node:assert/strict');
const { addExtra } = require('puppeteer-extra');
const stealth = require('puppeteer-extra-plugin-stealth');

(async () => {
  const connector = await import('tiktok-live-connector');
  assert.equal(typeof connector.TikTokLiveConnection, 'function');
  assert.equal(typeof connector.RouteConfig.fetchRoomInfoFromHtml, 'function');
  const { default: puppeteer } = await import('puppeteer');
  const plugin = stealth();
  plugin.enabledEvasions.delete('user-agent-override');
  const browser = await addExtra(puppeteer).use(plugin).launch({
    headless: true, executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  });
  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', request => void request.abort());
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-BO,es;q=0.9' });
    await page.emulateTimezone('America/La_Paz');
    await page.setContent('<article data-e2e="live-card"><a href="https://www.tiktok.com/@tienda/live"><h3>Ropa Bolivia</h3></a></article>');
    const state = await page.evaluate(() => ({
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      cards: document.querySelectorAll('a[href*="/live"]').length,
      title: document.querySelector('h3').textContent,
    }));
    assert.equal(state.timezone, 'America/La_Paz');
    assert.equal(state.cards, 1);
    assert.equal(state.title, 'Ropa Bolivia');
    console.log(JSON.stringify({ browser_smoke: 'passed', ...state }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
