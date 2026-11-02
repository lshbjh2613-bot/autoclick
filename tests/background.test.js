import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = name => readFileSync(new URL(`../extension/${name}.js`, import.meta.url), 'utf8');
async function measure({ permission = true, age = '0', date = new Date().toUTCString(), status = 200 } = {}) {
  let listener, calls = 0;
  const context = vm.createContext({ URL, Date, performance, AbortSignal,
    chrome: { permissions: { contains: async () => permission }, runtime: { onMessage: { addListener: fn => { listener = fn; } } } },
    fetch: async (url, options) => {
      calls++;
      assert.equal(options.method, 'HEAD'); assert.equal(options.cache, 'no-store');
      assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
      assert.equal(new URL(url).origin, 'https://nol.yanolja.com');
      return { ok: status === 200, status, headers: new Headers({ ...(date ? { date } : {}), age }) };
    }
  });
  context.importScripts = () => vm.runInContext(source('core'), context);
  vm.runInContext(source('background'), context);
  const response = await new Promise(resolve => listener({ type: 'sync', url: 'https://nol.yanolja.com/ticket/genre/sports/postseason' }, {}, resolve));
  return { response, calls };
}
test('background sync probes five times without credentials', async () => {
  const { response, calls } = await measure();
  assert.equal(response.ok, true); assert.equal(calls, 5); assert.equal(response.sync.count, 5);
});
for (const [label, options] of [['permission', { permission: false }], ['cached', { age: '10' }], ['missing date', { date: null }], ['HTTP failure', { status: 403 }]]) {
  test(`background rejects ${label}`, async () => { assert.equal((await measure(options)).response.ok, false); });
}
