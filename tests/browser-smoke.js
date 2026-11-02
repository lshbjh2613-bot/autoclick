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
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8', date: new Date().toUTCString(), age: '0' },
      body: route.request().url().includes('scenario=instant')
        ? '<!doctype html><article id="game"><h2>한국시리즈 4차전 삼성 vs KT</h2><aside><button id="reserve" disabled onclick="window.clicks=(window.clicks||0)+1;window.clickedAt=performance.now()"><span>예매하기</span></button></aside></article>'
        : route.request().url().includes('scenario=countdown')
        ? '<!doctype html><article id="game"><h2>2026 한국시리즈 2차전 KT vs 삼성</h2><div id="reserve"><span>남은시간 00:05</span></div></article>'
        : '<!doctype html><button id="reserve" onclick="window.clicks=(window.clicks||0)+1"><span>예매하기</span></button>' });
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
  await page.goto('https://nol.yanolja.com/ticket/genre/sports/postseason?scenario=countdown');
  await page.evaluate(() => {
    window.chrome.runtime = { onMessage: { addListener: listener => {
      window.__testSend = request => new Promise(resolve => listener(request, {}, resolve));
    } } };
  });
  await page.addScriptTag({ path: join(extension, 'core.js') });
  await page.addScriptTag({ path: join(extension, 'content.js') });
  await send({ type: 'pick' });
  await page.locator('#reserve span').click();
  assert.equal((await send({ type: 'state' })).selected.slot.context, '2026 한국시리즈 2차전 KT vs 삼성');
  await send({ type: 'setSync', sync: result.sync });
  const opening = new Date(Date.now() + result.sync.offset + 5000 + 9 * 3600000).toISOString().slice(0, 19);
  await page.evaluate(({ opening, offset }) => {
    const localOpening = Date.parse(opening + '+09:00') - offset;
    const interval = setInterval(() => { document.querySelector('#reserve span').textContent = '남은시간 00:01'; }, 100);
    setTimeout(() => {
      clearInterval(interval);
      const button = document.createElement('button'); button.textContent = '예매하기'; button.disabled = true;
      button.onclick = () => { window.clicks = (window.clicks || 0) + 1; };
      document.querySelector('#reserve').replaceWith(button);
      setTimeout(() => { button.disabled = false; }, 200);
    }, localOpening - Date.now() + 200);
  }, { opening, offset: result.sync.offset });
  const reservation = await send({ type: 'arm', time: opening, waitForActive: true });
  assert.equal(reservation.ok, true, JSON.stringify(reservation));
  await page.waitForFunction(() => window.clicks === 1, null, { timeout: 10000 });
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.clicks), 1);
  assert.equal((await send({ type: 'state' })).armed, false);
  console.log('PASS: Real Chromium countdown changes text, is replaced by a disabled booking button, then enables after opening and receives exactly one click.');
  await page.goto('https://nol.yanolja.com/ticket/genre/sports/postseason?scenario=instant');
  await page.evaluate(() => {
    window.chrome.runtime = { onMessage: { addListener: listener => {
      window.__testSend = request => new Promise(resolve => listener(request, {}, resolve));
    } } };
  });
  await page.addScriptTag({ path: join(extension, 'core.js') });
  await page.addScriptTag({ path: join(extension, 'content.js') });
  await send({ type: 'pick' });
  await page.locator('#reserve').dispatchEvent('pointerdown');
  assert.equal((await send({ type: 'watch' })).ok, true);
  assert.equal(await page.evaluate(() => window.clicks || 0), 0);
  const reaction = await page.evaluate(async () => {
    const activatedAt = performance.now();
    document.querySelector('#reserve').disabled = false;
    const clicksNextTask = await new Promise(resolve => setTimeout(() => resolve(window.clicks || 0), 0));
    return { clicksNextTask, delay: window.clickedAt - activatedAt };
  });
  assert.equal(reaction.clicksNextTask, 1);
  assert.ok(Number.isFinite(reaction.delay) && reaction.delay >= 0);
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.clicks), 1);
  assert.equal((await send({ type: 'state' })).armed, false);
  console.log(`PASS: Instant mode without sync clicked before next timer task, once only. Mock-page reaction ${reaction.delay.toFixed(2)}ms (not a live-site latency guarantee).`);
} finally {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}
