// ============================================================
// Bug Extension – Background Script
// Combines: request capture (rep+), endpoint hunting, context menus
// ============================================================

const ports = new Set();
const requestMap = new Map();

// ── Endpoint Hunter state ──
let endpoints = new Map();
let dynamicPatterns = new Map();
let saveTimeout = null;

// ── Config (from endpoint-hunter) ──
const CONFIG = {
  IGNORED_EXTENSIONS: ['.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.woff', '.woff2', '.ttf', '.m4s', '.ico', '.eot', '.otf'],
  SENSITIVE_PATHS: ['/admin', '/api', '/auth', '/login', '/logout', '/token', '/user', '/users', '/account', '/internal', '/private', '/debug', '/phpmyadmin', '/graphql'],
  SENSITIVE_PARAMS: ['token', 'auth', 'key', 'password', 'pwd', 'session', 'redirect', 'jwt', 'csrf', 'lostpassword', 'secret', 'api_key', 'apikey', 'access_token'],
  SENSITIVE_METHODS: ['PUT', 'DELETE', 'PATCH'],
  TAG_RULES: {
    xss: { params: ['q', 'query', 'search', 'searchTerm', 'term', 'filter', 's', 'msg', 'comment', 'text', 'input', 'body', 'payload', 'combine', 'keys', 'name', 'title', 'content', 'value', 'data', 'html', 'url', 'redirect_uri', 'return_url', 'callback', 'next'], methods: ['GET', 'POST'] },
    sqli: { params: ['id', 'user', 'uid', 'page', 'item', 'order', 'query', 'search', 'q', 'where', 'sql', 'sort', 'column', 'table', 'field', 'category', 'cat', 'type', 'group'], methods: ['GET', 'POST'] },
    lfi: { params: ['file', 'path', 'template', 'include', 'view', 'download', 'render', 'page', 'document', 'folder', 'root', 'dir', 'doc', 'img', 'filename'], paths: ['/view', '/download', '/render', '/read', '/include'], methods: ['GET', 'POST'] },
    idor: { params: ['id', 'user_id', 'account_id', 'order_id', 'uid', 'pid', 'profile_id', 'doc_id', 'invoice_id', 'record_id'], methods: ['GET', 'PUT', 'DELETE'] },
    rce: { params: ['cmd', 'exec', 'command', 'run', 'execute', 'ping', 'func', 'module', 'load', 'process', 'shell', 'code', 'eval', 'ip', 'host', 'daemon'], methods: ['GET', 'POST'] },
    ssrf: { params: ['url', 'uri', 'link', 'src', 'target', 'dest', 'source', 'callback', 'webhook', 'redirect', 'to', 'out', 'view', 'dir', 'path', 'domain', 'host', 'port', 'feed', 'validate', 'val', 'proxy', 'site', 'img_url', 'image_url'], methods: ['GET', 'POST'] },
    auth: { paths: ['/admin', '/auth', '/login', '/account', '/internal', '/dashboard', '/manage', '/settings'], methods: ['PUT', 'DELETE'], params: ['lostpassword', 'recover', 'reset', 'reset_password', 'forgot', 'password_reset'] }
  }
};

// ── Detection functions ──
function isInteresting(details) {
  const urlLower = (details.url || '').toLowerCase();
  const type = details.type || '';
  if (CONFIG.IGNORED_EXTENSIONS.some(ext => urlLower.includes(ext))) return false;
  if (urlLower.includes('.php')) return true;
  if (type === 'xmlhttprequest' || type === 'fetch') return true;
  if (urlLower.includes('.css') && type !== 'xmlhttprequest') return false;
  if (urlLower.includes('.js') && (type === 'xmlhttprequest' || urlLower.includes('config') || urlLower.includes('api') || urlLower.includes('admin'))) return true;
  if (urlLower.includes('/api/') || urlLower.includes('/graphql') || urlLower.includes('/rest/')) return true;
  return false;
}

function isSensitiveEndpoint(url, method, params) {
  let urlObj;
  try { urlObj = new URL(url); } catch { return false; }
  const path = urlObj.pathname.toLowerCase();
  if (CONFIG.SENSITIVE_METHODS.includes(method)) return true;
  if (CONFIG.SENSITIVE_PATHS.some(p => path.includes(p))) return true;
  if ((params || []).some(p => CONFIG.SENSITIVE_PARAMS.includes(String(p).toLowerCase()))) return true;
  return false;
}

function detectTags(url, method, params = [], status = 0, responseHeaders = []) {
  let urlObj;
  try { urlObj = new URL(url); } catch { return {}; }
  const path = urlObj.pathname.toLowerCase();
  const lowerParams = (params || []).map(p => String(p || '').toLowerCase());
  const getHeader = (name) => {
    if (!responseHeaders || !Array.isArray(responseHeaders)) return '';
    const h = responseHeaders.find(x => x.name && x.name.toLowerCase() === name.toLowerCase());
    return h ? (h.value || '').toLowerCase() : '';
  };
  const contentType = getHeader('content-type');
  const R = CONFIG.TAG_RULES;

  const xssDetected = R.xss.methods.includes(method) && lowerParams.some(p => R.xss.params.map(x => x.toLowerCase()).includes(p));
  const sqliDetected = R.sqli.methods.includes(method) && lowerParams.some(p => R.sqli.params.map(x => x.toLowerCase()).includes(p));
  const lfiDetected = R.lfi.methods.includes(method) && (lowerParams.some(p => R.lfi.params.map(x => x.toLowerCase()).includes(p)) || R.lfi.paths.some(p => path.includes(p)));
  const idorDetected = R.idor.methods.includes(method) && (lowerParams.some(p => R.idor.params.map(x => x.toLowerCase()).includes(p)) || /\/\d+/.test(path));
  const rceDetected = R.rce.methods.includes(method) && lowerParams.some(p => R.rce.params.map(x => x.toLowerCase()).includes(p));
  const ssrfDetected = R.ssrf.methods.includes(method) && lowerParams.some(p => R.ssrf.params.map(x => x.toLowerCase()).includes(p));
  const authDetected = R.auth.paths.some(p => path.includes(p)) || R.auth.methods.includes(method) || lowerParams.some(p => R.auth.params.map(x => x.toLowerCase()).includes(p)) || status === 403 || status === 401;

  return { xss: !!xssDetected, sqli: !!sqliDetected, lfi: !!lfiDetected, idor: !!idorDetected, rce: !!rceDetected, ssrf: !!ssrfDetected, auth: !!authDetected };
}

// ── Endpoint persistence ──
function saveEndpoints() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    browser.storage.local.set({
      endpoints: Array.from(endpoints.values()),
      dynamicPatterns: Array.from(dynamicPatterns.entries()),
      lastUpdate: Date.now()
    });
  }, 400);
}

// Load persisted endpoints
browser.storage.local.get(['endpoints', 'dynamicPatterns']).then(data => {
  if (data.endpoints) {
    endpoints = new Map(data.endpoints.map(e => [e.method + ' ' + e.url, e]));
  }
  if (data.dynamicPatterns) {
    dynamicPatterns = new Map(data.dynamicPatterns);
  }
});

// ── Request body parser ──
function parseRequestBody(requestBody) {
  if (!requestBody) return null;
  if (requestBody.raw && requestBody.raw.length > 0) {
    try {
      const decoder = new TextDecoder('utf-8');
      return requestBody.raw.map(bytes => bytes.bytes ? decoder.decode(bytes.bytes) : '').join('');
    } catch { return null; }
  }
  if (requestBody.formData) {
    const params = new URLSearchParams();
    for (const [key, values] of Object.entries(requestBody.formData)) {
      values.forEach(value => params.append(key, value));
    }
    return params.toString();
  }
  return null;
}

// ── WebRequest listeners ──
function handleBeforeRequest(details) {
  if (details.url.startsWith('moz-extension://')) return;

  // Store for rep+ capture
  requestMap.set(details.requestId, {
    requestId: details.requestId,
    url: details.url,
    method: details.method,
    type: details.type,
    timeStamp: Date.now(),
    requestBody: parseRequestBody(details.requestBody),
    tabId: details.tabId,
    initiator: details.initiator
  });
}

function handleBeforeSendHeaders(details) {
  const req = requestMap.get(details.requestId);
  if (req) {
    req.requestHeaders = details.requestHeaders;
  }
}

function handleCompleted(details) {
  if (details.url.startsWith('moz-extension://')) return;

  // ── Rep+ capture: send to panel ──
  const req = requestMap.get(details.requestId);
  if (req) {
    req.statusCode = details.statusCode;
    req.statusLine = details.statusLine;
    req.responseHeaders = details.responseHeaders;

    const message = { type: 'captured_request', data: req };
    ports.forEach(p => {
      try { p.postMessage(message); } catch { ports.delete(p); }
    });
    requestMap.delete(details.requestId);
  }

  // ── Endpoint Hunter: detect and store ──
  if (!isInteresting(details)) return;
  let url;
  try { url = new URL(details.url); } catch { return; }

  const pathname = url.pathname;
  const key = `${details.method} ${url.origin}${pathname}`;
  const allParams = new Set();
  const currentParamValues = {};

  if (endpoints.has(key)) {
    endpoints.get(key).params.forEach(p => allParams.add(p));
  }
  url.searchParams.forEach((v, k) => {
    allParams.add(k);
    currentParamValues[k] = v;
  });

  if (!endpoints.has(key)) {
    const params = Array.from(allParams);
    const sensitive = isSensitiveEndpoint(url, details.method, params);
    const tags = detectTags(url.href, details.method, params, details.statusCode, details.responseHeaders);

    endpoints.set(key, {
      method: details.method,
      url: `${url.origin}${pathname}`,
      params,
      latestValues: currentParamValues,
      status: details.statusCode,
      count: 1,
      sensitive,
      tags,
      detectedAt: Date.now(),
      lastSeen: Date.now()
    });
  } else {
    const existing = endpoints.get(key);
    existing.count++;
    existing.latestValues = { ...(existing.latestValues || {}), ...currentParamValues };
    existing.lastSeen = Date.now();
    // Merge new params
    Array.from(allParams).forEach(p => {
      if (!existing.params.includes(p)) existing.params.push(p);
    });
  }
  saveEndpoints();
}

function handleErrorOccurred(details) {
  requestMap.delete(details.requestId);
}

// Register listeners
browser.webRequest.onBeforeRequest.addListener(handleBeforeRequest, { urls: ["<all_urls>"] }, ["requestBody"]);
browser.webRequest.onBeforeSendHeaders.addListener(handleBeforeSendHeaders, { urls: ["<all_urls>"] }, ["requestHeaders"]);
browser.webRequest.onCompleted.addListener(handleCompleted, { urls: ["<all_urls>"] }, ["responseHeaders"]);
browser.webRequest.onErrorOccurred.addListener(handleErrorOccurred, { urls: ["<all_urls>"] });

// ── DevTools port connections ──
browser.runtime.onConnect.addListener((port) => {
  if (port.name !== "bug-panel") return;
  ports.add(port);
  port.onDisconnect.addListener(() => ports.delete(port));
});

// ── Message handling ──
browser.runtime.onMessage.addListener((msg) => {
  if (msg?.action === "clear-endpoints") {
    endpoints.clear();
    dynamicPatterns.clear();
    browser.storage.local.set({ endpoints: [], dynamicPatterns: [], lastUpdate: Date.now() });
  }
});

// ── Context menu for encoding tools ──
const CONTEXT_MENUS = [
  { id: "bug-base64-encode", title: "Base64 Encode" },
  { id: "bug-base64-decode", title: "Base64 Decode" },
  { id: "bug-url-encode", title: "URL Encode" },
  { id: "bug-url-decode", title: "URL Decode" },
  { id: "bug-wayback", title: "Check Wayback Machine" }
];

browser.contextMenus.removeAll().then(() => {
  browser.contextMenus.create({
    id: "bug-extension-parent",
    title: "🐛 Bug Extension",
    contexts: ["selection", "link", "page"]
  });
  CONTEXT_MENUS.forEach(item => {
    browser.contextMenus.create({
      id: item.id,
      parentId: "bug-extension-parent",
      title: item.title,
      contexts: ["selection", "link", "page"]
    });
  });
});

browser.contextMenus.onClicked.addListener((info, tab) => {
  const text = info.selectionText || info.linkUrl || info.pageUrl || '';
  let result = '';
  switch (info.menuItemId) {
    case 'bug-base64-encode':
      try { result = btoa(text); } catch { result = 'Error: invalid input'; }
      break;
    case 'bug-base64-decode':
      try { result = atob(text); } catch { result = 'Error: invalid base64'; }
      break;
    case 'bug-url-encode':
      result = encodeURIComponent(text);
      break;
    case 'bug-url-decode':
      try { result = decodeURIComponent(text); } catch { result = text; }
      break;
    case 'bug-wayback': {
      const targetUrl = info.linkUrl || info.pageUrl || text;
      const waybackUrl = `https://web.archive.org/web/*/${encodeURIComponent(targetUrl)}`;
      browser.tabs.create({ url: waybackUrl });
      return;
    }
  }
  if (result && tab?.id) {
    // Copy to clipboard via content script
    browser.tabs.executeScript(tab.id, {
      code: `
        navigator.clipboard.writeText(${JSON.stringify(result)}).then(() => {
          const toast = document.createElement('div');
          toast.textContent = 'Copied: ' + ${JSON.stringify(result.substring(0, 80))};
          toast.style.cssText = 'position:fixed;bottom:20px;right:20px;background:#1a1a2e;color:#0f0;padding:12px 20px;border-radius:8px;z-index:999999;font-family:monospace;border:1px solid #0f0;box-shadow:0 4px 20px rgba(0,255,0,0.2);';
          document.body.appendChild(toast);
          setTimeout(() => toast.remove(), 3000);
        });
      `
    });
  }
});

// ── Periodic cleanup ──
setInterval(() => {
  const now = Date.now();
  for (const [id, req] of requestMap.entries()) {
    if (now - req.timeStamp > 60000) requestMap.delete(id);
  }
}, 30000);

console.log("Bug Extension background loaded.");
