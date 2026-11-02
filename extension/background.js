importScripts('core.js');
importScripts('native-click.js');

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message.type === 'browserClick') {
    dispatchBrowserClick(chrome, sender, message).then(reply, error => reply({ ok: false, error: error.message }));
    return true;
  }
  if (message.type !== 'sync') return;
  (async () => {
    const url = new URL(message.url);
    if (url.protocol !== 'https:') throw new Error('HTTPS 사이트만 지원합니다.');
    if (!await chrome.permissions.contains({ origins: [url.origin + '/*'] }))
      throw new Error('이 사이트의 접근 권한이 필요합니다.');
    const samples = [];
    let lastError = '';
    for (let i = 0; i < 5; i++) {
      const probe = new URL(url);
      probe.hash = '';
      probe.searchParams.set('_autoclick_time', `${Date.now()}-${i}`);
      const start = Date.now();
      const monotonicStart = performance.now();
      try {
        const response = await fetch(probe, { method: 'HEAD', cache: 'no-store',
          credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(5000) });
        const end = Date.now();
        if (Math.abs(end - start - (performance.now() - monotonicStart)) > 100)
          throw new Error('측정 중 PC 시간이 변경되었습니다.');
        if (!response.ok) throw new Error(`시간 조회 HTTP ${response.status}`);
        samples.push(AutoClickCore.sample(response.headers.get('date'), start, end, response.headers.get('age')));
      } catch (error) { lastError = error.message; }
    }
    if (samples.length < 3) throw new Error(`서버 시간 확인 실패: ${lastError || '응답 부족'}`);
    return { ...AutoClickCore.best(samples), measuredAt: Date.now(), origin: url.origin, count: samples.length };
  })().then(sync => reply({ ok: true, sync }), error => reply({ ok: false, error: error.message }));
  return true;
});
