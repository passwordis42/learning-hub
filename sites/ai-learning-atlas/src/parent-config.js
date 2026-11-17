function askParent(message) {
  if (window.parent === window) {
    return Promise.reject(new Error('请从统一入口打开这一课。助手配置只留在入口页面这次打开的内存里。'));
  }
  const nonce = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new Error('统一入口没有返回助手配置。'));
    }, 2000);
    function onMessage(event) {
      if (event.origin !== location.origin || event.source !== window.parent) return;
      const data = event.data;
      if (!data || data.type !== 'hub-assistant-result' || data.nonce !== nonce) return;
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
      if (!data.ok) reject(Object.assign(new Error(data.error || '助手还没有配置。'), { code: data.code }));
      else resolve(data);
    }
    window.addEventListener('message', onMessage);
    window.parent.postMessage({ ...message, nonce, type: 'hub-assistant' }, location.origin);
  });
}

export function listAssistant(course) {
  return askParent({ action: 'list', course }).then((data) => data.providers || []);
}

export function prepareAssistant(course, vendor) {
  return askParent({ action: 'prepare', course, vendor }).then((data) => data.config);
}

export function directFailure(error) {
  if (error?.name === 'TimeoutError') return '供应商没有在时限内响应。这不是已经连通。';
  if (error instanceof TypeError) {
    return '浏览器没有收到可读响应。可能是网络中断，也可能是该地址不允许这个网页跨域访问。浏览器无法区分这两种情况，这次不能当作已经连通。';
  }
  return error?.message || '这次没有获得供应商的答复。';
}
