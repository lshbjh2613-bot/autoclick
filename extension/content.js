(() => {
  if (globalThis.__serverTimeClick) return;
  globalThis.__serverTimeClick = true;
  const core = globalThis.AutoClickCore;
  let selected = null, sync = null, timer = null, target = null, status = '버튼을 선택하세요.';
  let picking = false, outline = null, highlighted = null;
  let anchor = null, clockAnchor = null;
  let waitForActive = false, waiting = false;
  let watching = false, watchDeadline = null, observer = null, frameId = null;
  let gestureGuard = null;
  function clearGestureGuard() {
    if (gestureGuard) document.removeEventListener('click', gestureGuard, true);
    gestureGuard = null;
  }
  const armed = () => target !== null || watching;
  const clickable = 'button,a,[role="button"],input[type="submit"],input[type="button"]';
  const normalize = value => value.replace(/\s+/g, ' ').trim();
  function pickElement(event) {
    let element = event.target.closest(clickable) || event.target;
    // Track the entire countdown area so its inner span or even tag may be replaced.
    if (/남은\s*시간/.test(core.text(element))) {
      while (element.parentElement && !['BODY', 'HTML'].includes(element.parentElement.tagName)
        && normalize(element.parentElement.textContent) === normalize(element.textContent)) element = element.parentElement;
    }
    return element;
  }
  const contextText = (parent, slot) => normalize([...parent.childNodes].filter(node => node !== slot).map(node => node.textContent).join(' '));
  function captureSlot(element) {
    let region = element;
    while (region.parentElement && !['BODY', 'HTML'].includes(region.parentElement.tagName)) {
      const parent = region.parentElement;
      const context = contextText(parent, region);
      if (context.length >= 4 && context.length <= 1000)
        return { parent: selectorFor(parent), index: [...parent.children].indexOf(region), count: parent.children.length, context };
      if (context.length) break;
      region = parent;
    }
    return null;
  }
  const box = document.createElement('div');
  box.id = '__server_time_click_status';
  box.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:2147483647;max-width:360px;';
  const shadow = box.attachShadow({ mode: 'closed' });
  shadow.innerHTML = '<style>:host{all:initial}div{font:14px/1.5 system-ui;background:#16213b;color:white;padding:14px 18px;border-radius:12px;box-shadow:0 3px 20px #0005}button{margin-top:8px;padding:5px 12px;cursor:pointer}</style><div><span></span><br><button>취소 / 선택 종료</button></div>';
  const label = shadow.querySelector('span');
  const update = message => { status = message; label.textContent = message; };
  const show = () => { if (!box.isConnected) document.documentElement.append(box); };
  function cancel(message = '예약이 취소되었습니다.') {
    clearTimeout(timer); timer = null; target = null; watching = false;
    observer?.disconnect(); observer = null; stopPicking(); update(message);
    if (frameId !== null) cancelAnimationFrame(frameId);
    frameId = null;
  }
  shadow.querySelector('button').addEventListener('click', () => cancel());
  function selectorFor(element) {
    const parts = [];
    for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
      if (node.id) {
        const id = '#' + CSS.escape(node.id);
        if (document.querySelectorAll(id).length === 1) { parts.unshift(id); break; }
      }
      let part = node.localName;
      const siblings = node.parentElement ? [...node.parentElement.children].filter(e => e.localName === node.localName) : [];
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
      parts.unshift(part);
    }
    const selector = parts.join(' > ');
    if (document.querySelectorAll(selector).length !== 1 || document.querySelector(selector) !== element)
      throw new Error('이 요소는 자동 선택할 수 없습니다. 일반 페이지의 버튼을 선택하세요.');
    return selector;
  }
  function restoreHighlight() {
    if (highlighted) highlighted.style.outline = outline;
    highlighted = null;
  }
  function hover(event) {
    if (event.composedPath().includes(box)) return;
    restoreHighlight();
    highlighted = pickElement(event);
    outline = highlighted.style.outline;
    highlighted.style.outline = '3px solid #ee4c70';
  }
  function choose(event) {
    if (event.composedPath().includes(box)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const element = pickElement(event);
    try {
      selected = { selector: selectorFor(element), fingerprint: core.fingerprint(element), slot: captureSlot(element) };
      stopPicking(); update(`선택 완료: ${selected.fingerprint.text || selected.fingerprint.label || element.tagName}. 확장 프로그램을 다시 열어 시간을 설정하세요.`);
      if (event.type === 'pointerdown') {
        // Disabled native buttons do not emit click. Pick on pointerdown,
        // then consume the click that an enabled button may emit on release.
        clearGestureGuard();
        const swallow = next => {
          if (next.composedPath().includes(box)) return;
          next.preventDefault(); next.stopImmediatePropagation(); clearGestureGuard();
        };
        gestureGuard = swallow;
        document.addEventListener('click', swallow, true);
        setTimeout(() => { if (gestureGuard === swallow) clearGestureGuard(); }, 700);
      }
    } catch (error) { update(error.message); }
  }
  function key(event) { if (event.key === 'Escape') cancel('선택을 종료했습니다.'); }
  function stopPicking() {
    picking = false; restoreHighlight();
    document.removeEventListener('mouseover', hover, true);
    document.removeEventListener('pointerdown', choose, true);
    document.removeEventListener('click', choose, true);
    document.removeEventListener('keydown', key, true);
  }
  function validate(allowDisabled = false) {
    if (document.visibilityState !== 'visible') throw new Error('페이지가 숨겨져 예약을 취소했습니다. 탭을 화면에 유지하세요.');
    if (target === null && selected.url && location.href !== selected.url) throw new Error('페이지 주소가 바뀌었습니다. 버튼을 다시 선택하세요.');
    const elements = document.querySelectorAll(selected.selector);
    if (elements.length !== 1 || !core.matches(elements[0], selected.fingerprint))
      throw new Error('선택한 버튼이 바뀌었거나 사라졌습니다. 다시 선택하세요.');
    const element = elements[0];
    if (!allowDisabled && (element.disabled || element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true' || element.closest('[inert]')))
      throw new Error('버튼이 비활성화되어 클릭하지 않았습니다.');
    const style = getComputedStyle(element);
    if (!element.getClientRects().length || style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0')
      throw new Error('버튼이 보이지 않아 클릭하지 않았습니다.');
    return element;
  }
  function currentSlot() {
    if (document.visibilityState !== 'visible') throw new Error('탭이 숨겨져 예약을 취소했습니다.');
    if (selected.url && location.href !== selected.url) throw new Error('페이지 주소가 바뀌었습니다. 다시 선택하세요.');
    if (!selected.slot) throw new Error('경기 제목을 확인할 수 없습니다. 개별 경기 카드의 남은시간 영역을 다시 선택하세요.');
    const parents = document.querySelectorAll(selected.slot.parent);
    const parent = parents[0], slot = parent?.children[selected.slot.index];
    if (parents.length !== 1 || !slot || parent.children.length !== selected.slot.count
      || contextText(parent, slot) !== selected.slot.context)
      throw new Error('경기 정보나 버튼 영역의 구조가 바뀌어 중단했습니다. 다시 선택하세요.');
    return slot;
  }
  function readyButton(exactFallback = false) {
    let slot;
    if (selected.slot) slot = currentSlot();
    else if (exactFallback) {
      if (document.visibilityState !== 'visible' || location.href !== selected.url) throw new Error('탭 상태나 페이지 주소가 바뀌어 중단했습니다.');
      const elements = document.querySelectorAll(selected.selector);
      if (elements.length !== 1 || !core.matches(elements[0], selected.fingerprint)) throw new Error('선택한 버튼이 바뀌었습니다. 다시 선택하세요.');
      slot = elements[0];
    } else slot = currentSlot();
    const candidates = [...slot.querySelectorAll(clickable)];
    if (slot.matches(clickable)) candidates.unshift(slot);
    // Some sites render a React onClick on a div instead of a native button.
    if (!candidates.length) candidates.push(slot);
    const matching = candidates.filter(element => normalize(element.textContent || element.value || element.getAttribute('aria-label') || '') === selected.activeLabel);
    if (matching.length > 1) throw new Error('예매 버튼이 여러 개라 중단했습니다. 다시 선택하세요.');
    const element = matching[0];
    if (!element || element.disabled || element.matches(':disabled') || element.closest('[inert]')
      || element.closest('[aria-disabled="true"]')) return null;
    const style = getComputedStyle(element);
    if (!element.getClientRects().length || style.visibility === 'hidden' || style.display === 'none'
      || style.opacity === '0' || style.pointerEvents === 'none') return null;
    return element;
  }
  function clickOnce(element, late) {
    const immediate = watching;
    clearTimeout(timer); target = null; timer = null; watching = false;
    observer?.disconnect(); observer = null;
    if (frameId !== null) cancelAnimationFrame(frameId);
    frameId = null;
    clearGestureGuard();
    update(immediate ? '버튼 활성화를 확인해 클릭 이벤트를 1회 전달했습니다. 사이트 결과를 직접 확인하세요.'
      : `클릭 이벤트를 1회 전달했습니다 (목표 시각 이후 ${Math.round(late)}ms). 사이트 결과를 직접 확인하세요.`);
    element.click();
  }
  function startObserver() {
    observer?.disconnect();
    observer = new MutationObserver(() => {
      if (watching) checkWatch();
      else if (target !== null && waitForActive && waiting) { clearTimeout(timer); timer = null; tick(); }
    });
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  }
  function checkWatch() {
    if (!watching) return;
    if (performance.now() >= watchDeadline) { cancel('30분 내 활성화되지 않아 감시를 종료했습니다.'); return; }
    try {
      const element = readyButton(true);
      if (element) clickOnce(element, 0);
    } catch (error) { cancel(error.message); }
  }
  function tick() {
    if (target === null) return;
    const now = anchor + performance.now();
    if (Math.abs(Date.now() - (clockAnchor + performance.now())) > 250) { cancel('PC 시간이 변경되어 예약을 취소했습니다. 다시 동기화하세요.'); return; }
    const remaining = target - now;
    if (remaining <= 0) {
      const late = -remaining;
      if (waitForActive) {
        if (!waiting && late > 1000) { cancel('실행이 1초 이상 지연되어 클릭하지 않았습니다.'); return; }
        waiting = true;
        if (late >= 10000) { cancel('10초 내 예매 버튼이 활성화되지 않아 종료했습니다.'); return; }
        try {
          const element = readyButton();
          if (element) { clickOnce(element, late); return; }
          update(`예매 버튼 활성화 대기 중 · 최대 ${Math.ceil((10000 - late) / 1000)}초 · 클릭은 1회만 실행합니다.`);
          // MutationObserver handles DOM activation without a polling delay.
          // A periodic check also handles computed styles changed by CSS animations.
          timer = setTimeout(tick, 250);
        } catch (error) { cancel(error.message); }
        return;
      }
      target = null; timer = null;
      if (late > 1000) { update('실행이 1초 이상 지연되어 클릭하지 않았습니다.'); return; }
      try {
        const element = validate();
        // Consume the reservation before clicking, including when page handlers throw or navigate.
        clickOnce(element, late);
      } catch (error) { update(error.message); }
      return;
    }
    update(`예약 중 · 약 ${Math.ceil(remaining / 1000)}초 남음 · 이 탭을 화면에 유지하세요.`);
    timer = setTimeout(tick, Math.min(remaining > 1000 ? 250 : 10, remaining));
  }
  document.addEventListener('visibilitychange', () => { if (armed() && document.visibilityState !== 'visible') cancel('탭이 숨겨져 예약을 취소했습니다.'); });
  window.addEventListener('pagehide', () => cancel());
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    try {
      if (message.type === 'state') { reply({ ok: true, selected, sync, status, armed: armed() }); return; }
      show();
      if (message.type === 'pick') {
        cancel(); picking = true; update('원하는 버튼을 클릭하세요. 이 선택 클릭은 사이트에 전달하지 않습니다. Esc로 종료합니다.');
        document.addEventListener('mouseover', hover, true);
        document.addEventListener('pointerdown', choose, true);
        document.addEventListener('click', choose, true);
        document.addEventListener('keydown', key, true);
      } else if (message.type === 'cancel') cancel();
      else if (message.type === 'setSync') {
        cancel('서버 시간 측정을 적용했습니다.'); sync = message.sync;
      } else if (message.type === 'watch') {
        if (armed()) throw new Error('이미 예약 또는 감시 중입니다. 먼저 취소하세요.');
        if (!selected) throw new Error('먼저 버튼을 선택하세요.');
        selected.activeLabel = normalize(message.activeLabel || '예매하기');
        if (selected.activeLabel.length < 2 || /남은\s*시간|\d+:\d+/.test(selected.activeLabel)) throw new Error('활성화 후 버튼 문구를 입력하세요.');
        selected.url = location.href;
        if (selected.slot) currentSlot();
        else validate(true);
        watchDeadline = performance.now() + 30 * 60 * 1000;
        watching = true;
        update('활성화 즉시 감시 중 · 최대 30분 · 이미 활성화된 버튼은 바로 1회 클릭합니다.');
        startObserver(); checkWatch();
        if (watching) frameId = requestAnimationFrame(frame);
      } else if (message.type === 'arm') {
        if (armed()) throw new Error('이미 예약 또는 감시 중입니다. 먼저 취소하세요.');
        if (!selected) throw new Error('먼저 버튼을 선택하세요.');
        if (!sync || sync.origin !== location.origin || Date.now() - sync.measuredAt > 120000 || Date.now() < sync.measuredAt)
          throw new Error('서버 시간을 다시 측정하세요 (측정 유효 기간 2분).');
        const requested = core.parseKoreaTime(message.time);
        const remaining = requested - (Date.now() + sync.offset);
        if (remaining < 3000 || remaining > 600000) throw new Error('목표 시각은 보정된 현재 시각의 3초 뒤부터 10분 이내로 설정하세요.');
        waitForActive = message.waitForActive === true; waiting = false;
        if (waitForActive) {
          selected.activeLabel = normalize(message.activeLabel || '예매하기');
          if (selected.activeLabel.length < 2 || /남은\s*시간|\d+:\d+/.test(selected.activeLabel)) throw new Error('활성화 후 버튼 문구를 입력하세요. 예: 예매하기');
          currentSlot();
        } else validate(true);
        selected.url = location.href;
        clockAnchor = Date.now() - performance.now();
        anchor = clockAnchor + sync.offset; target = requested;
        if (waitForActive) startObserver();
        tick();
      } else throw new Error('지원하지 않는 요청입니다.');
      reply({ ok: true });
    } catch (error) { reply({ ok: false, error: error.message }); }
  });
  // SPA navigation must not carry a reservation to a different page.
  setInterval(() => { if (armed() && location.href !== selected.url) cancel('페이지 주소가 변경되어 예약을 취소했습니다.'); }, 100);
  // Animation-only visibility changes may not mutate the DOM. Checking once per
  // rendered frame is a fallback; DOM mutations trigger the observer directly.
  function frame() {
    frameId = null;
    if (watching) checkWatch();
    if (watching) frameId = requestAnimationFrame(frame);
  }
})();
