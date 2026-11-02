const $ = id => document.getElementById(id);
let tab, measured;
const message = text => { $('status').textContent = text; };
async function send(request) {
  const result = await chrome.tabs.sendMessage(tab.id, request);
  if (!result?.ok) throw new Error(result?.error || '페이지에 연결할 수 없습니다.');
  return result;
}
async function connect() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = new URL(tab.url);
  if (url.protocol !== 'https:') throw new Error('HTTPS 사이트 탭을 먼저 열어 주세요.');
  const origin = url.origin + '/*';
  if (!await chrome.permissions.contains({ origins: [origin] }))
    throw new Error('주소 열기를 눌러 이 사이트의 접근 권한을 허용하세요.');
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['core.js', 'content.js'] });
  const state = await send({ type: 'state' });
  $('selection').textContent = state.selected ? `선택: ${state.selected.fingerprint.text || state.selected.fingerprint.label || state.selected.fingerprint.tag}\n${state.selected.selector}` : '선택한 버튼 없음';
  if (state.selected?.slot) $('selection').textContent += `\n경기 확인: ${state.selected.slot.context}`;
  measured = state.sync;
  message(state.status);
  renderClock();
}
function renderClock() {
  if (!measured) return;
  const now = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'medium' }).format(Date.now() + measured.offset);
  $('clock').textContent = `보정 시각 ${now}\nPC 대비 ${Math.round(measured.offset)}ms · RTT ${Math.round(measured.rtt)}ms\n추정 불확실성 ±${Math.round(measured.uncertainty)}ms 이상 · ${measured.count}회 측정`;
}
async function run(action) { try { await action(); } catch (error) { message(error.message); } }
async function inputPermission() {
  if ($('browserInput').checked && !await chrome.permissions.request({ permissions: ['debugger'] }))
    throw new Error('브라우저 마우스 입력 권한이 허용되지 않았습니다.');
}
$('open').addEventListener('click', () => {
  // Request optional permissions directly inside a user gesture.
  let url;
  try { url = new URL($('url').value); if (url.protocol !== 'https:') throw new Error(); }
  catch { message('올바른 HTTPS 주소를 입력하세요.'); return; }
  chrome.permissions.request({ origins: [url.origin + '/*'] }).then(granted => run(async () => {
    if (!granted) throw new Error('사이트 접근 권한이 허용되지 않았습니다.');
    await chrome.storage.local.set({ siteUrl: url.href });
    await chrome.tabs.create({ url: url.href }); window.close();
  }));
});
$('pick').addEventListener('click', () => run(async () => { await connect(); await send({ type: 'pick' }); window.close(); }));
$('watch').addEventListener('click', () => run(async () => {
  await inputPermission();
  await connect(); await send({ type: 'watch', activeLabel: $('watchLabel').value, startAt: $('watchStart').value, browserInput: $('browserInput').checked });
  await chrome.storage.local.set({ watchLabel: $('watchLabel').value });
  const state = await send({ type: 'state' }); message(state.status);
}));
$('after30').addEventListener('click', () => { $('watchStart').value = new Date(Date.now() + 30 * 60000 + 9 * 3600000).toISOString().slice(0, 19); });
$('clearStart').addEventListener('click', () => { $('watchStart').value = ''; });
$('sync').addEventListener('click', () => run(async () => {
  $('sync').disabled = true; message('서버 시간을 5회 측정 중입니다…');
  try {
    await connect();
    const response = await chrome.runtime.sendMessage({ type: 'sync', url: tab.url });
    if (!response?.ok) throw new Error(response?.error || '측정 실패');
    await send({ type: 'setSync', sync: response.sync }); measured = response.sync;
    renderClock(); message('측정 완료. 날짜와 시각을 확인한 뒤 예약하세요.');
  } finally { $('sync').disabled = false; }
}));
$('arm').addEventListener('click', () => run(async () => {
  await inputPermission();
  await connect(); await send({ type: 'arm', time: $('time').value, waitForActive: $('waitActive').checked, activeLabel: $('activeLabel').value, browserInput: $('browserInput').checked });
  await chrome.storage.local.set({ targetTime: $('time').value, waitForActive: $('waitActive').checked, activeLabel: $('activeLabel').value });
  message('예약되었습니다. 팝업을 닫고 대상 탭을 화면에 유지하세요.');
}));
$('cancel').addEventListener('click', () => run(async () => { await connect(); await send({ type: 'cancel' }); message('예약을 취소했습니다.'); }));
run(async () => {
  const saved = await chrome.storage.local.get(['siteUrl', 'targetTime', 'waitForActive', 'activeLabel', 'watchLabel']);
  $('url').value = saved.siteUrl || 'https://nol.yanolja.com/ticket/genre/sports/postseason';
  if (saved.targetTime) $('time').value = saved.targetTime;
  $('waitActive').checked = saved.waitForActive === true;
  $('activeLabel').value = saved.activeLabel || '예매하기';
  $('watchLabel').value = saved.watchLabel || '예매하기';
  await connect();
});
setInterval(renderClock, 1000);
