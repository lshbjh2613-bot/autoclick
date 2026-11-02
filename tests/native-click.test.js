import test from 'node:test';
import assert from 'node:assert/strict';
import '../extension/native-click.js';
const sender = { tab: { id: 10 }, frameId: 0, url: 'https://nol.yanolja.com/game' };
const message = { token: '12345678-1234-1234-1234-123456789abc' };
function fixture({ permission = true, blocked = false, failAttach = false } = {}) {
  const calls = [];
  const api = {
    permissions: { contains: async () => permission },
    tabs: { get: async () => ({ active: true, url: sender.url }) },
    debugger: {
      attach: async () => { calls.push('attach'); if (failAttach) throw new Error('already attached'); },
      detach: async () => { calls.push('detach'); },
      sendCommand: async (target, method, params) => {
        calls.push(params.type || method);
        if (method === 'Runtime.evaluate') return blocked ? { exceptionDetails: {} } : { result: { value: { x: 120, y: 80 } } };
      }
    }
  };
  return { api, calls };
}
test('browser click uses exactly one press/release and always detaches', async () => {
  const f = fixture();
  assert.equal((await dispatchBrowserClick(f.api, sender, message)).ok, true);
  assert.deepEqual(f.calls, ['attach', 'Runtime.evaluate', 'mouseMoved', 'mousePressed', 'mouseReleased', 'detach']);
});
for (const [name, options] of [['missing permission', { permission: false }], ['obstructed button', { blocked: true }], ['another debugger attached', { failAttach: true }]]) {
  test(`browser click rejects ${name} without dispatching input`, async () => {
    const f = fixture(options);
    await assert.rejects(dispatchBrowserClick(f.api, sender, message));
    assert.equal(f.calls.includes('mousePressed'), false);
    if (options.blocked) assert.equal(f.calls.at(-1), 'detach');
  });
}
test('browser click rejects popup-origin and subframe requests', async () => {
  const f = fixture();
  await assert.rejects(dispatchBrowserClick(f.api, {}, message));
  await assert.rejects(dispatchBrowserClick(f.api, { ...sender, frameId: 1 }, message));
  assert.equal(f.calls.length, 0);
});
