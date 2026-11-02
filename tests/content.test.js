import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
const source = name => readFileSync(new URL(`../extension/${name}.js`, import.meta.url), 'utf8');

function fixture() {
  const dom = new JSDOM('<button id="reserve"><span>예매하기</span></button>', {
    url: 'https://nol.yanolja.com/ticket/genre/sports/postseason', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const w = dom.window;
  let now = Date.parse('2026-11-02T03:00:00Z'), mono = 100, listener;
  const timers = new Map(); let id = 0;
  w.Date.now = () => now;
  Object.defineProperty(w.performance, 'now', { value: () => mono });
  w.setTimeout = fn => { timers.set(++id, fn); return id; };
  w.clearTimeout = key => timers.delete(key);
  w.setInterval = () => 0;
  w.CSS = { escape: value => value };
  w.chrome = { runtime: { onMessage: { addListener: fn => { listener = fn; } } } };
  const button = w.document.querySelector('button');
  button.getClientRects = () => [{ width: 100, height: 30 }];
  let clicks = 0; button.addEventListener('click', () => clicks++);
  w.eval(source('core')); w.eval(source('content'));
  const send = message => { let result; listener(message, {}, response => { result = response; }); return result; };
  function select() {
    assert.equal(send({ type: 'pick' }).ok, true);
    button.querySelector('span').dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  }
  function sync() { send({ type: 'setSync', sync: { offset: 2000, measuredAt: now, origin: w.location.origin } }); }
  function arm() { return send({ type: 'arm', time: '2026-11-02T12:00:06' }); }
  function advance(ms, wall = ms) {
    mono += ms; now += wall;
    const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn());
  }
  return { dom, w, button, send, select, sync, arm, advance, clicks: () => clicks };
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
