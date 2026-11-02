import test from 'node:test';
import assert from 'node:assert/strict';
import '../extension/core.js';
const core = globalThis.AutoClickCore;

test('HTTP Date uses midpoint and includes quantization and network uncertainty', () => {
  const start = Date.parse('2026-11-02T01:00:00Z');
  assert.deepEqual(core.sample('Mon, 02 Nov 2026 01:00:02 GMT', start, start + 200, '0'),
    { offset: 2400, rtt: 200, uncertainty: 600 });
  assert.throws(() => core.sample(null, start, start + 200, null));
  assert.throws(() => core.sample('Mon, 02 Nov 2026 01:00:02 GMT', start, start + 200, '5'));
});
test('needs three successful samples and chooses minimum round trip', () => {
  assert.throws(() => core.best([{ rtt: 20 }]));
  assert.equal(core.best([{ rtt: 30 }, { rtt: 10 }, { rtt: 20 }]).rtt, 10);
});
test('target time uses Korea time independently of PC timezone', () => {
  assert.equal(core.parseKoreaTime('2026-11-02T12:30:15'), Date.parse('2026-11-02T03:30:15Z'));
  assert.throws(() => core.parseKoreaTime(''));
  assert.throws(() => core.parseKoreaTime('2026-02-30T12:00:00'));
});
