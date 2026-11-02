// Browser input is opt-in. Never retry a dispatched click automatically.
globalThis.dispatchBrowserClick = async (api, sender, message) => {
  if (!Number.isInteger(sender.tab?.id) || sender.frameId !== 0 || !sender.url?.startsWith('https://'))
    throw new Error('대상 페이지에서 보낸 요청만 실행할 수 있습니다.');
  if (!await api.permissions.contains({ permissions: ['debugger'] })) throw new Error('브라우저 마우스 입력 권한을 먼저 허용하세요.');
  if (!/^[a-f0-9-]{36}$/.test(message.token || '')) throw new Error('잘못된 버튼 식별자입니다.');
  const target = { tabId: sender.tab.id };
  const tab = await api.tabs.get(target.tabId);
  if (!tab.active || tab.url !== sender.url) throw new Error('대상 탭이나 주소가 바뀌었습니다.');
  let attached = false;
  try {
    await api.debugger.attach(target, '1.3'); attached = true;
    const expression = `(() => {
      if (location.href !== ${JSON.stringify(sender.url)} || document.visibilityState !== 'visible') throw new Error('페이지 상태가 변경되었습니다.');
      const element = document.querySelector('[data-autoclick-target="${message.token}"]');
      if (!element || element.disabled || element.matches(':disabled') || element.closest('[inert],[aria-disabled="true"]')) throw new Error('버튼이 사라졌거나 비활성화됐습니다.');
      element.scrollIntoView({block:'center',inline:'center',behavior:'instant'});
      const rect=element.getBoundingClientRect(), style=getComputedStyle(element);
      const x=rect.left+rect.width/2, y=rect.top+rect.height/2;
      const hit=document.elementFromPoint(x,y);
      if (!rect.width || !rect.height || style.visibility==='hidden' || style.display==='none' || style.opacity==='0' || style.pointerEvents==='none' || !hit || !(hit===element || element.contains(hit))) throw new Error('다른 요소가 버튼을 가리거나 버튼이 보이지 않습니다.');
      return {x,y};
    })()`;
    const result = await api.debugger.sendCommand(target, 'Runtime.evaluate', { expression, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || '버튼 위치를 확인하지 못했습니다.');
    const point = result.result?.value;
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) throw new Error('버튼 위치가 올바르지 않습니다.');
    await api.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await api.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 });
    await api.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1 });
    return { ok: true };
  } finally {
    if (attached) { try { await api.debugger.detach(target); } catch {} }
  }
};
