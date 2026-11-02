import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
const source = name => readFileSync(new URL(`../extension/${name}.js`, import.meta.url), 'utf8');

function fixture(html = '<button id="reserve"><span>예매하기</span></button>') {
  const dom = new JSDOM(html, {
    url: 'https://nol.yanolja.com/ticket/genre/sports/postseason', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const w = dom.window;
  let now = Date.parse('2026-11-02T03:00:00Z'), mono = 100, listener;
  const timers = new Map(); let id = 0;
  let frameCallback = null;
  w.requestAnimationFrame = fn => { frameCallback = fn; return 1; };
  w.cancelAnimationFrame = () => { frameCallback = null; };
  w.Date.now = () => now;
  Object.defineProperty(w.performance, 'now', { value: () => mono });
  w.setTimeout = fn => { timers.set(++id, fn); return id; };
  w.clearTimeout = key => timers.delete(key);
  w.setInterval = () => 0;
  w.CSS = { escape: value => value };
  w.chrome = { runtime: { onMessage: { addListener: fn => { listener = fn; } } } };
  const button = w.document.querySelector('#reserve');
  let clicks = 0;
  function watch(element) {
    element.getClientRects = () => [{ width: 100, height: 30 }];
    element.addEventListener('click', () => clicks++);
    return element;
  }
  watch(button);
  w.eval(source('core')); w.eval(source('content'));
  const send = message => { let result; listener(message, {}, response => { result = response; }); return result; };
  function select() {
    assert.equal(send({ type: 'pick' }).ok, true);
    button.querySelector('span').dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  }
  function sync() { send({ type: 'setSync', sync: { offset: 2000, measuredAt: now, origin: w.location.origin } }); }
  function arm(options = {}) { return send({ type: 'arm', time: '2026-11-02T12:00:06', ...options }); }
  function advance(ms, wall = ms) {
    mono += ms; now += wall;
    const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn());
  }
  function render() { const fn = frameCallback; frameCallback = null; fn?.(mono); }
  return { dom, w, button, send, select, sync, arm, advance, watch, render, clicks: () => clicks };
}
test('visual selection suppresses site click; corrected timer clicks exactly once', () => {
  const f = fixture();
  try {
    f.select(); assert.equal(f.clicks(), 0);
    assert.equal(f.send({ type: 'state' }).selected.selector, '#reserve');
    f.sync(); assert.equal(f.arm().ok, true);
    assert.equal(f.arm().ok, false);
    f.advance(3990); assert.equal(f.clicks(), 0);
    f.advance(10); assert.equal(f.clicks(), 1);
    f.advance(1000); assert.equal(f.clicks(), 1);
    assert.equal(f.send({ type: 'state' }).armed, false);
  } finally { f.dom.window.close(); }
});
for (const reason of ['cancel', 'hidden', 'changed', 'disabled', 'late', 'clock', 'navigation']) {
  test(`does not click after ${reason}`, () => {
    const f = fixture();
    try {
      f.select(); f.sync(); assert.equal(f.arm().ok, true);
      if (reason === 'cancel') f.send({ type: 'cancel' });
      if (reason === 'hidden') {
        Object.defineProperty(f.w.document, 'visibilityState', { value: 'hidden' });
        f.w.document.dispatchEvent(new f.w.Event('visibilitychange'));
      }
      if (reason === 'changed') f.button.textContent = '다른 상품';
      if (reason === 'disabled') f.button.disabled = true;
      if (reason === 'navigation') f.w.history.pushState({}, '', '/other');
      f.advance(reason === 'late' ? 5500 : 4000, reason === 'clock' ? 1000 : reason === 'late' ? 5500 : 4000);
      assert.equal(f.clicks(), 0);
      assert.equal(f.send({ type: 'state' }).armed, false);
    } finally { f.dom.window.close(); }
  });
}
test('allows reserving a disabled button but clicks only if enabled by target time', () => {
  const f = fixture();
  try {
    f.select(); f.sync(); f.button.disabled = true;
    assert.equal(f.arm().ok, true);
    f.button.disabled = false; f.advance(4000); assert.equal(f.clicks(), 1);
  } finally { f.dom.window.close(); }
});
test('selects disabled native button on pointerdown', () => {
  const f = fixture();
  try {
    f.button.disabled = true;
    f.send({ type: 'pick' });
    f.button.dispatchEvent(new f.w.MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    assert.equal(f.send({ type: 'state' }).selected.selector, '#reserve');
    assert.equal(f.clicks(), 0);
  } finally { f.dom.window.close(); }
});
test('rejects missing and expired synchronization', () => {
  const f = fixture();
  try {
    f.select(); assert.equal(f.arm().ok, false);
    f.sync(); f.advance(121000); assert.equal(f.arm().ok, false);
  } finally { f.dom.window.close(); }
});
const countdown = '<article id="game"><h2>2026 한국시리즈 2차전 KT vs 삼성</h2><div id="reserve"><span>남은시간 24:51</span></div></article>';
test('countdown updates and node replacement wait for an enabled booking button, then click once', () => {
  const f = fixture(countdown);
  try {
    f.select(); f.sync();
    f.button.textContent = '남은시간 00:01';
    assert.equal(f.arm({ waitForActive: true }).ok, true);
    f.advance(4000); assert.equal(f.clicks(), 0);
    const ready = f.watch(f.w.document.createElement('button'));
    ready.textContent = '예매하기'; ready.disabled = true;
    f.button.replaceWith(ready);
    f.advance(100); assert.equal(f.clicks(), 0);
    ready.disabled = false;
    f.advance(20); assert.equal(f.clicks(), 1);
    f.advance(500); assert.equal(f.clicks(), 1);
  } finally { f.dom.window.close(); }
});
for (const reason of ['timeout', 'different game', 'wrong label', 'hidden', 'cancel', 'ambiguous buttons']) {
  test(`countdown mode refuses ${reason}`, () => {
    const f = fixture(countdown);
    try {
      f.select(); f.sync(); assert.equal(f.arm({ waitForActive: true }).ok, true);
      f.advance(4000);
      if (reason === 'different game') f.w.document.querySelector('h2').textContent = '다른 경기';
      if (reason === 'hidden') {
        Object.defineProperty(f.w.document, 'visibilityState', { value: 'hidden' });
        f.w.document.dispatchEvent(new f.w.Event('visibilitychange'));
      }
      if (reason === 'cancel') f.send({ type: 'cancel' });
      if (reason === 'ambiguous buttons') f.button.innerHTML = '<button>예매하기</button><button>예매하기</button>';
      else if (reason !== 'timeout') f.button.textContent = reason === 'wrong label' ? '상세보기' : '예매하기';
      f.advance(20); assert.equal(f.clicks(), 0);
      f.advance(10000); assert.equal(f.clicks(), 0);
      assert.equal(f.send({ type: 'state' }).armed, false);
    } finally { f.dom.window.close(); }
  });
}
test('countdown mode needs a card context instead of a page-wide button search', () => {
  const f = fixture();
  try {
    f.select(); f.sync(); assert.equal(f.arm({ waitForActive: true }).ok, false);
  } finally { f.dom.window.close(); }
});
test('instant mode clicks an already enabled selected button without any clock sync', () => {
  const f = fixture();
  try {
    f.select(); assert.equal(f.send({ type: 'watch' }).ok, true);
    assert.equal(f.clicks(), 1); assert.equal(f.send({ type: 'state' }).armed, false);
  } finally { f.dom.window.close(); }
});
test('selection gesture guard never swallows the immediate automated click', () => {
  const f = fixture();
  try {
    f.send({ type: 'pick' });
    f.button.dispatchEvent(new f.w.MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    assert.equal(f.clicks(), 0);
    assert.equal(f.send({ type: 'watch' }).ok, true);
    assert.equal(f.clicks(), 1);
  } finally { f.dom.window.close(); }
});
test('instant mode responds to disabled removal in the mutation microtask without advancing timers', async () => {
  const f = fixture();
  try {
    f.select(); f.button.disabled = true;
    assert.equal(f.send({ type: 'watch' }).ok, true);
    assert.equal(f.clicks(), 0);
    assert.equal(f.arm().ok, false);
    f.button.disabled = false;
    await Promise.resolve();
    assert.equal(f.clicks(), 1);
    f.button.setAttribute('data-rerender', 'true'); await Promise.resolve();
    assert.equal(f.clicks(), 1);
  } finally { f.dom.window.close(); }
});
test('instant mode observes countdown node replacement inside the same game', async () => {
  const f = fixture(countdown);
  try {
    f.select(); assert.equal(f.send({ type: 'watch' }).ok, true);
    const ready = f.watch(f.w.document.createElement('button')); ready.textContent = '예매하기';
    f.button.replaceWith(ready);
    await Promise.resolve(); assert.equal(f.clicks(), 1);
  } finally { f.dom.window.close(); }
});
test('instant mode tolerates a label-only wrapper and captures the game card', async () => {
  const f = fixture('<article><h2>한국시리즈 4차전 삼성 vs KT</h2><aside><button id="reserve" disabled><span>예매하기</span></button></aside></article>');
  try {
    f.select(); assert.match(f.send({ type: 'state' }).selected.slot.context, /4차전/);
    assert.equal(f.send({ type: 'watch' }).ok, true);
    f.button.disabled = false; await Promise.resolve(); assert.equal(f.clicks(), 1);
  } finally { f.dom.window.close(); }
});
for (const reason of ['cancel', 'hidden', 'navigation', 'timeout', 'different game']) {
  test(`instant mode stops after ${reason}`, async () => {
    const f = fixture(countdown);
    try {
      f.select(); assert.equal(f.send({ type: 'watch' }).ok, true);
      if (reason === 'cancel') f.send({ type: 'cancel' });
      if (reason === 'hidden') {
        Object.defineProperty(f.w.document, 'visibilityState', { value: 'hidden' });
        f.w.document.dispatchEvent(new f.w.Event('visibilitychange'));
      }
      if (reason === 'navigation') f.w.history.pushState({}, '', '/other');
      if (reason === 'timeout') { f.advance(30 * 60 * 1000); f.render(); }
      if (reason === 'different game') f.w.document.querySelector('h2').textContent = '다른 경기';
      f.button.textContent = '예매하기'; await Promise.resolve();
      assert.equal(f.clicks(), 0); assert.equal(f.send({ type: 'state' }).armed, false);
    } finally { f.dom.window.close(); }
  });
}
test('scheduled wait responds to mutation immediately once target time has passed', async () => {
  const f = fixture(countdown);
  try {
    f.select(); f.sync(); assert.equal(f.arm({ waitForActive: true }).ok, true);
    f.advance(4000);
    f.button.textContent = '예매하기'; await Promise.resolve();
    assert.equal(f.clicks(), 1);
  } finally { f.dom.window.close(); }
});
test('PC-clock watch starts 30 minutes later without sync and cannot click early', async () => {
  const f = fixture();
  try {
    f.select();
    assert.equal(f.send({ type: 'watch', startAt: '2026-11-02T12:30:00' }).ok, true);
    f.button.setAttribute('data-update', 'before-start'); await Promise.resolve();
    assert.equal(f.clicks(), 0);
    f.advance(30 * 60000 - 1); f.render(); assert.equal(f.clicks(), 0);
    f.advance(1); f.render(); assert.equal(f.clicks(), 1);
    f.render(); assert.equal(f.clicks(), 1);
  } finally { f.dom.window.close(); }
});
test('watch duration counts from scheduled start instead of reservation creation', () => {
  const f = fixture();
  try {
    f.select(); f.button.disabled = true;
    assert.equal(f.send({ type: 'watch', startAt: '2026-11-02T12:30:00' }).ok, true);
    f.advance(31 * 60000); f.render(); assert.equal(f.send({ type: 'state' }).armed, true);
    f.advance(29 * 60000); f.render(); assert.equal(f.send({ type: 'state' }).armed, false);
    assert.equal(f.clicks(), 0);
  } finally { f.dom.window.close(); }
});
test('PC-clock watch rejects invalid horizons and cancels on PC clock adjustment', () => {
  const f = fixture();
  try {
    f.select();
    assert.equal(f.send({ type: 'watch', startAt: '2026-11-02T11:59:59' }).ok, false);
    assert.equal(f.send({ type: 'watch', startAt: '2026-11-03T12:00:01' }).ok, false);
    assert.equal(f.send({ type: 'watch', startAt: '2026-11-02T12:30:00' }).ok, true);
    f.advance(1000, 2000); f.render();
    assert.equal(f.send({ type: 'state' }).armed, false); assert.equal(f.clicks(), 0);
  } finally { f.dom.window.close(); }
});
test('browser input mode sends one request without synthetic click and does not retry a failure', async () => {
  const f = fixture();
  try {
    const requests = [];
    let finish;
    f.w.chrome.runtime.sendMessage = request => { requests.push(request); return new Promise(resolve => { finish = resolve; }); };
    f.select();
    assert.equal(f.send({ type: 'watch', browserInput: true }).ok, true);
    assert.equal(f.clicks(), 0); assert.equal(requests.length, 1);
    assert.equal(requests[0].type, 'browserClick');
    assert.equal(f.send({ type: 'watch', browserInput: true }).ok, false);
    finish({ ok: false, error: 'blocked' });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    f.button.setAttribute('data-mutation', 'later'); await Promise.resolve();
    assert.equal(requests.length, 1); assert.equal(f.clicks(), 0);
    assert.equal(f.button.hasAttribute('data-autoclick-target'), false);
    assert.match(f.send({ type: 'state' }).status, /자동 재시도하지 않습니다/);
  } finally { f.dom.window.close(); }
});
