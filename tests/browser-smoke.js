import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const profile = await mkdtemp(join(tmpdir(), 'autoclick-browser-'));
const extension = resolve('extension');
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true,
    args: ['--no-sandbox']
  });
  context.setDefaultTimeout(15000);
  await context.route('https://nol.yanolja.com/**', async route => {
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/html', date: new Date().toUTCString(), age: '0' },
      body: '<!doctype html><button id="reserve" onclick="window.clicks=(window.clicks||0)+1"><span>예매하기</span></button>' });
  });
  const page = await context.newPage();
  await page.goto('https://nol.yanolja.com/ticket/genre/sports/postseason');
  await page.evaluate(() => {
    window.chrome.runtime = { onMessage: { addListener: listener => {
      window.__testSend = request => new Promise(resolve => listener(request, {}, resolve));
    } } };
  });
  await page.addScriptTag({ path: join(extension, 'core.js') });
  await page.addScriptTag({ path: join(extension, 'content.js') });
  const send = request => page.evaluate(request => window.__testSend(request), request);
  assert.equal((await send({ type: 'pick' })).ok, true);
  await page.locator('#reserve span').click();
  assert.equal(await page.evaluate(() => window.clicks || 0), 0);
  assert.equal((await send({ type: 'state' })).selected.selector, '#reserve');
  const result = await page.evaluate(async () => {
    const samples = [];
    for (let i = 0; i < 5; i++) {
      const start = Date.now();
      const response = await fetch(location.href + '?sample=' + i, { method: 'HEAD', cache: 'no-store' });
      samples.push(AutoClickCore.sample(response.headers.get('date'), start, Date.now(), response.headers.get('age')));
    }
    return { sync: { ...AutoClickCore.best(samples), count: samples.length, measuredAt: Date.now(), origin: location.origin } };
  });
  assert.equal(result.sync.count, 5);
  assert.equal((await send({ type: 'setSync', sync: result.sync })).ok, true);
  const target = new Date(Date.now() + result.sync.offset + 6000 + 9 * 3600000).toISOString().slice(0, 19);
  assert.equal((await send({ type: 'arm', time: target })).ok, true);
  await page.waitForFunction(() => window.clicks === 1, null, { timeout: 10000 });
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.clicks), 1);
  assert.equal((await send({ type: 'state' })).armed, false);
  console.log('PASS: Real Chromium DOM: selection suppressed click, HEAD clock measured 5 times, reservation clicked exactly once. Extension installation and live NOL were not tested.');
} finally {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}
