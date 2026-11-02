(() => {
  const core = {
    sample(date, start, end, age) {
      const server = Date.parse(date);
      if (!Number.isFinite(server) || !Number.isFinite(start) || !Number.isFinite(end) || end < start)
        throw new Error('유효한 Date 시간 헤더가 없습니다.');
      if (age !== null && age !== undefined && (!Number.isFinite(Number(age)) || Number(age) > 0))
        throw new Error('캐시된 시간 응답이라 동기화에 사용할 수 없습니다.');
      // HTTP Date has one-second resolution. Do not imply millisecond precision.
      return { offset: server + 500 - (start + end) / 2, rtt: end - start,
        uncertainty: 500 + (end - start) / 2 };
    },
    best(samples) {
      if (samples.length < 3) throw new Error('시간 측정이 3회 이상 성공해야 합니다.');
      return [...samples].sort((a, b) => a.rtt - b.rtt)[0];
    },
    parseKoreaTime(value) {
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value))
        throw new Error('목표 날짜와 시각을 입력하세요.');
      const time = Date.parse(value + '+09:00');
      if (!Number.isFinite(time)) throw new Error('유효하지 않은 목표 시각입니다.');
      const normalized = new Date(time + 9 * 3600000).toISOString().slice(0, 19);
      if (normalized !== (value.length === 16 ? value + ':00' : value)) throw new Error('존재하지 않는 날짜나 시각입니다.');
      return time;
    },
    text(element) { return (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200); },
    fingerprint(element) {
      return { tag: element.tagName, text: core.text(element),
        label: element.getAttribute('aria-label') || '', href: element.getAttribute('href') || '' };
    },
    matches(element, expected) {
      return !!element && JSON.stringify(core.fingerprint(element)) === JSON.stringify(expected);
    }
  };
  globalThis.AutoClickCore = core;
})();
