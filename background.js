// ============================================================
// Bug Extension – Background Script
// Combines: request capture (rep+), endpoint hunting, context menus
// ============================================================

const connectedPanels = new Map(); // Track active devtools tabs: tabId -> port
const requestMap = new Map();
const interceptState = new Map();

function normalizeTabId(tabId) {
  const id = Number(tabId);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function isTargetTab(tabId) {
  const id = normalizeTabId(tabId);
  return id !== null && connectedPanels.has(id);
}

function getPanelPort(tabId) {
  const id = normalizeTabId(tabId);
  return id !== null ? connectedPanels.get(id) : null;
}

// ── Endpoint Hunter state ──
let endpoints = new Map();
let dynamicPatterns = new Map();
let saveTimeout = null;

// ── Config (from endpoint-hunter) ──
const CONFIG = {
  IGNORED_EXTENSIONS: ['.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.woff', '.woff2', '.ttf', '.m4s', '.ico', '.eot', '.otf'],
  SENSITIVE_PATHS: TAG_DETECTION.SENSITIVE_PATHS,
  SENSITIVE_PARAMS: TAG_DETECTION.SENSITIVE_PARAMS,
  SENSITIVE_METHODS: TAG_DETECTION.SENSITIVE_METHODS,
  TAG_RULES: TAG_DETECTION.TAG_RULES
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
  if (urlLower.includes('?')) return true;

  try {
    const parsed = new URL(details.url);
    if (parsed.pathname.split('/').some(segment => segment.includes('=') && !segment.startsWith('='))) {
      return true;
    }
  } catch (e) {}

  return false;
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
// Clear endpoints on start/close per user request
function clearEndpointsStorage() {
  endpoints.clear();
  dynamicPatterns.clear();
  try { browser.storage.local.remove(['endpoints', 'dynamicPatterns', 'lastUpdate']); } catch (e) {}
}

// Run immediately on load so previous sessions are not restored
clearEndpointsStorage();

// Also register lifecycle hooks to clear on uninstall/start/shutdown when available
try {
  if (browser.runtime && browser.runtime.onInstalled) browser.runtime.onInstalled.addListener(clearEndpointsStorage);
  if (browser.runtime && browser.runtime.onStartup) browser.runtime.onStartup.addListener(clearEndpointsStorage);
  if (browser.runtime && browser.runtime.onSuspend) browser.runtime.onSuspend.addListener(clearEndpointsStorage);
} catch (e) {}

// Still attempt to load persisted endpoints if anything remains (should be empty)
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


// ── 1. BEFORE REQUEST LISTENER ──
function handleBeforeRequest(details) {
  if (details.url.startsWith('moz-extension://') || details.url.startsWith('chrome-extension://')) return;

  if (!isTargetTab(details.tabId)) return;

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

// ── 2. HEADERS LISTENER ──
function handleBeforeSendHeaders(details) {
  if (!isTargetTab(details.tabId)) return;

  const tabId = normalizeTabId(details.tabId);
  const intercept = interceptState.get(tabId);
  const req = requestMap.get(details.requestId);

  if (intercept && intercept.enabled) {
    const held = {
      ...(req || {}),
      requestId: details.requestId,
      url: details.url,
      method: details.method,
      type: details.type,
      timeStamp: req?.timeStamp || Date.now(),
      requestBody: req?.requestBody || null,
      tabId,
      requestHeaders: details.requestHeaders || [],
      intercepted: true
    };

    const targetPort = getPanelPort(tabId);
    if (targetPort) {
      try {
        targetPort.postMessage({ type: 'intercepted_request', data: held });
      } catch {
        connectedPanels.delete(tabId);
      }
    }

    requestMap.delete(details.requestId);
    return { cancel: true };
  }

  if (req) {
    req.requestHeaders = details.requestHeaders;
  }
}

function handleCompleted(details) {
  if (details.url.startsWith('moz-extension://') || details.url.startsWith('chrome-extension://')) return;

  if (!isTargetTab(details.tabId)) return;

  const tabId = normalizeTabId(details.tabId);
  const req = requestMap.get(details.requestId);
  if (req) {
    req.statusCode = details.statusCode;
    req.statusLine = details.statusLine;
    req.responseHeaders = details.responseHeaders;

    const message = { type: 'captured_request', data: req };

    const targetPort = getPanelPort(tabId);
    if (targetPort) {
      try {
        targetPort.postMessage(message);
      } catch {
        connectedPanels.delete(tabId);
      }
    }
    requestMap.delete(details.requestId);
  }

  // ── Endpoint Hunter: detect and store ──
  if (!isTargetTab(details.tabId)) return;
  
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

  // Also detect path parameters of the form /key=value when query strings are absent.
  url.pathname.split('/').forEach(segment => {
    if (!segment || !segment.includes('=')) return;
    const [keyPart, ...rest] = segment.split('=');
    const valuePart = rest.join('=');
    if (keyPart && valuePart !== undefined) {
      allParams.add(keyPart);
      if (!currentParamValues[keyPart]) {
        currentParamValues[keyPart] = valuePart;
      }
    }
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
    existing.status = details.statusCode;
    Array.from(allParams).forEach(p => {
      if (!existing.params.includes(p)) existing.params.push(p);
    });
    const params = existing.params;
    existing.sensitive = isSensitiveEndpoint(url.href, details.method, params);
    existing.tags = detectTags(url.href, details.method, params, details.statusCode, details.responseHeaders);
  }
  saveEndpoints();
}

function handleErrorOccurred(details) {
  requestMap.delete(details.requestId);
}


// Register listeners
browser.webRequest.onBeforeRequest.addListener(handleBeforeRequest, { urls: ["<all_urls>"] }, ["requestBody", "blocking"]);
browser.webRequest.onBeforeSendHeaders.addListener(handleBeforeSendHeaders, { urls: ["<all_urls>"] }, ["requestHeaders", "blocking"]);
browser.webRequest.onCompleted.addListener(handleCompleted, { urls: ["<all_urls>"] }, ["responseHeaders"]);
browser.webRequest.onErrorOccurred.addListener(handleErrorOccurred, { urls: ["<all_urls>"] });

// ── Port Handshake (Ensures strict mapping) ──
browser.runtime.onConnect.addListener((port) => {
  if (port.name !== "bug-panel") return;

  port.onMessage.addListener((msg) => {
    if (msg.type === "init_panel") {
      const tabId = normalizeTabId(msg.tabId);
      if (!tabId) return;

      for (const [k, v] of connectedPanels.entries()) {
        if (v === port || k === tabId) connectedPanels.delete(k);
      }
      connectedPanels.set(tabId, port);
      try {
        port.postMessage({ type: 'panel_registered', tabId });
      } catch (e) {}
      return;
    }

    if (msg.type === 'set_intercept') {
      let tabId = normalizeTabId(msg.tabId);
      if (!tabId) {
        const matched = Array.from(connectedPanels.entries()).find(([, panelPort]) => panelPort === port);
        tabId = matched ? matched[0] : null;
      }
      if (tabId) {
        interceptState.set(tabId, {
          enabled: Boolean(msg.enabled),
          rule: msg.rule || null
        });
        try {
          port.postMessage({ type: 'intercept_state', tabId, enabled: Boolean(msg.enabled) });
        } catch (e) {}
      }
      return;
    }
  });

  port.onDisconnect.addListener(() => {
    for (const [k, v] of connectedPanels.entries()) {
      if (v === port) connectedPanels.delete(k);
    }
  });
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
