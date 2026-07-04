const port = browser.runtime.connect({ name: "bug-panel" });

function getCurrentTabId() {
  const tabId = browser.devtools?.inspectedWindow?.tabId;
  return typeof tabId === 'number' && tabId > 0 ? tabId : null;
}

function registerCurrentPanelTarget() {
  const tabId = getCurrentTabId();
  if (tabId !== null) {
    port.postMessage({ type: "init_panel", tabId });
  }
}

registerCurrentPanelTarget();

function headersArrayToObject(headers) {
  const out = {};
  (headers || []).forEach(h => {
    if (h && h.name) out[h.name] = h.value || '';
  });
  return out;
}

function headersObjectToArray(headers) {
  return Object.entries(headers || {}).map(([name, value]) => ({ name, value: String(value) }));
}

function performRequestInPage(req) {
  return new Promise((resolve, reject) => {
    if (!browser.devtools?.inspectedWindow?.eval) {
      reject(new Error('DevTools inspectedWindow API unavailable'));
      return;
    }

    const fetchBody = req.body != null && req.body !== '' ? JSON.stringify(req.body) : 'null';
    const code = `(async () => {
      try {
        const res = await fetch(${JSON.stringify(req.url)}, {
          method: ${JSON.stringify(req.method || 'GET')},
          headers: ${JSON.stringify(req.headers || {})},
          body: ${fetchBody},
          credentials: 'include',
          cache: 'no-store'
        });
        const text = await res.text();
        return {
          ok: true,
          status: res.status,
          statusText: res.statusText,
          bodyLength: text.length
        };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    })()`;

    browser.devtools.inspectedWindow.eval(code, (result, exceptionInfo) => {
      if (exceptionInfo && exceptionInfo.isException) {
        reject(new Error(exceptionInfo.value || 'Request failed in page context'));
        return;
      }
      if (result && result.ok === false) {
        reject(new Error(result.error || 'Request failed'));
        return;
      }
      resolve(result || { ok: true });
    });
  });
}
let capturedRequests = [];
let filteredRequests = [];
let selectedRequest = null;
let isPaused = false;
let activeTheme = 'dark';
let activeEndpoints = [];
let interceptEnabled = false;
let useDevtoolsNetworkCapture = false;
let favorites = new Set();
let collectionFilterActive = false;
async function loadCustomSettings() {
  try {
    const data = await browser.storage.local.get(['target_identifiers', 'custom_payloads']);
    if (data.target_identifiers && Array.isArray(data.target_identifiers) && data.target_identifiers.length > 0) {
      if (!TAG_DETECTION.SENSITIVE_PARAMS) {
        TAG_DETECTION.SENSITIVE_PARAMS = [];
      }
      data.target_identifiers.forEach(identifier => {
        const normalized = identifier.trim().toLowerCase();
        if (normalized && !TAG_DETECTION.SENSITIVE_PARAMS.includes(normalized)) {
          TAG_DETECTION.SENSITIVE_PARAMS.push(normalized);
        }
      });
    }
    if (data.custom_payloads && Array.isArray(data.custom_payloads) && data.custom_payloads.length > 0) {
      if (typeof NucleiFuzzDictionaries === 'object' && NucleiFuzzDictionaries) {
        NucleiFuzzDictionaries.custom = data.custom_payloads.filter(p => p.trim());
      }
    }
  } catch (e) {
    console.warn('Failed to load custom settings:', e);
  }
}

function recordCapturedRequest(req, source = 'network') {
  if (!req || !req.url) return;
  if (isPaused && !req.intercepted) return;

  const requestId = req.requestId || `capture-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  if (capturedRequests.some(existing => existing.requestId === requestId)) return;

  const captured = {
    requestId,
    url: req.url,
    method: (req.method || 'GET').toUpperCase(),
    type: req.type || source,
    timeStamp: req.timeStamp || Date.now(),
    requestBody: req.requestBody || null,
    tabId: req.tabId ?? getCurrentTabId(),
    initiator: req.initiator || '',
    requestHeaders: req.requestHeaders || [],
    statusCode: req.statusCode ?? null,
    statusLine: req.statusLine || '',
    responseHeaders: req.responseHeaders || [],
    intercepted: Boolean(req.intercepted)
  };

  capturedRequests.push(captured);
  updateRequestCountBadge();
  updateDomainFilters(captured.url);
  updateExtensionFilters();
  applyRequestFilters();
}

function initNetworkCapture() {
  if (!browser.devtools?.network?.onRequestFinished) return;
  useDevtoolsNetworkCapture = true;

  browser.devtools.network.onRequestFinished.addListener((harEntry) => {
    if (isPaused) return;

    const request = harEntry.request || {};
    const response = harEntry.response || {};
    const req = {
      requestId: harEntry.id || harEntry.requestId || `har-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      url: request.url,
      method: request.method,
      type: 'devtools',
      timeStamp: Date.now(),
      requestBody: request.postData?.text || null,
      tabId: getCurrentTabId(),
      requestHeaders: request.headers || [],
      statusCode: response.status,
      statusLine: response.statusText ? `HTTP ${response.status} ${response.statusText}` : '',
      responseHeaders: response.headers || []
    };

    recordCapturedRequest(req, 'devtools');
  });

  if (browser.devtools.network.onNavigated) {
    browser.devtools.network.onNavigated.addListener(() => {
      registerCurrentPanelTarget();
    });
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
registerCurrentPanelTarget();
setTimeout(registerCurrentPanelTarget, 250);
setTimeout(registerCurrentPanelTarget, 1000);
port.onMessage.addListener((msg) => {
  if (msg.type === 'panel_registered') {
    console.log('Bug Extension panel registered for tab', msg.tabId);
    return;
  }

  if (msg.type === 'intercept_state') {
    interceptEnabled = Boolean(msg.enabled);
    isPaused = interceptEnabled;
    updateCapturePauseButton();
    return;
  }

  if (msg.type === 'intercepted_request') {
    recordCapturedRequest(msg.data, 'intercept');
    showInterceptedRequest(msg.data);
    return;
  }

  if (msg.type === 'sent_request') {
    try {
      const req = msg.data;
      const ts = Date.now();
      const captured = {
        requestId: `sent-${ts}-${Math.floor(Math.random() * 1000)}`,
        url: req.url,
        method: (req.method || 'GET').toUpperCase(),
        type: 'fetch',
        timeStamp: ts,
        requestBody: req.body || null,
        tabId: (browser.devtools && browser.devtools.inspectedWindow) ? browser.devtools.inspectedWindow.tabId : null,
        initiator: window.location && window.location.origin ? window.location.origin : '',
        requestHeaders: Object.keys(req.headers || {}).map(k => ({ name: k, value: req.headers[k] })),
        statusCode: null
      };
      recordCapturedRequest(captured, 'sent');
      try {
        const resultsConsole = document.getElementById('fuzz-results');
        if (resultsConsole) {
          const line = `<div style="color: var(--accent);">↳ Sent: <strong>${escapeHtml(captured.method)}</strong> ${escapeHtml(captured.url)}</div>`;
          resultsConsole.innerHTML += line;
          resultsConsole.scrollTop = resultsConsole.scrollHeight;
        }
      } catch (e) { }

      console.log('Sent request (fuzz/replay):', captured);
    } catch (e) { }
  }
});

document.addEventListener("DOMContentLoaded", () => {
  loadCustomSettings();
  initTabs();
  initTheme();
  initRequestTab();
  initNetworkCapture();
  initResizeHandle();
  initContextMenu();
  loadFavorites();
  initToolsTab();
  registerCurrentPanelTarget();
  loadEndpointsFromStorage();
  browser.storage.onChanged.addListener((changes) => {
    if (changes.endpoints) {
      loadEndpointsFromStorage();
    }
    if (changes.favorites) {
      loadFavorites();
      applyRequestFilters();
    }
    if (changes.target_identifiers || changes.custom_payloads) {
      loadCustomSettings();
    }
  });
});
port.onMessage.addListener((msg) => {
  if (msg.type === 'captured_request' && !useDevtoolsNetworkCapture) {
    recordCapturedRequest(msg.data, 'webRequest');
  }
});
function initTabs() {
  const mainTabs = document.querySelectorAll("#top-nav .nav-tab");
  mainTabs.forEach(tab => {
    tab.addEventListener("click", () => {
      mainTabs.forEach(t => t.classList.remove("active"));
      tab.classList.add("active");

      const targetTab = tab.getAttribute("data-tab");
      document.querySelectorAll(".tab-panel").forEach(panel => {
        panel.classList.remove("active");
      });
      document.getElementById(`tab-${targetTab}`).classList.add("active");
    });
  });
  const detailTabs = document.querySelectorAll(".detail-tab");
  detailTabs.forEach(tab => {
    tab.addEventListener("click", () => {
      detailTabs.forEach(t => t.classList.remove("active"));
      tab.classList.add("active");

      const targetDetail = tab.getAttribute("data-detail");
      document.querySelectorAll(".detail-content").forEach(content => {
        content.classList.remove("active");
      });
      document.getElementById(`detail-${targetDetail}`).classList.add("active");
    });
  });
}
function initTheme() {
  const themeBtn = document.getElementById("theme-toggle");
  if (themeBtn) {
    themeBtn.addEventListener("click", () => {
      activeTheme = activeTheme === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute("data-theme", activeTheme);
      themeBtn.textContent = activeTheme === 'dark' ? '🌙' : '☀️';
    });
  }
  const settingsBtn = document.getElementById("settings-btn");
  if (settingsBtn) {
    settingsBtn.addEventListener("click", () => {
      window.open(browser.runtime.getURL("options/options.html"), "_blank");
    });
  }
  const clearBtn = document.getElementById("clear-all-btn");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      clearRequests();
      clearEndpoints();
    });
  }
  const collectionBtn = document.getElementById("collection-filter");
  if (collectionBtn) {
    collectionBtn.addEventListener("click", () => {
      collectionFilterActive = !collectionFilterActive;
      collectionBtn.classList.toggle("active");
      applyRequestFilters();
    });
  }
}
function initRequestTab() {
  document.getElementById("req-search").addEventListener("input", applyRequestFilters);
  document.getElementById("req-method-filter").addEventListener("change", applyRequestFilters);
  document.getElementById("req-status-filter").addEventListener("change", applyRequestFilters);
  document.getElementById("req-param-filter").addEventListener("change", applyRequestFilters);
  document.getElementById("req-domain-filter").addEventListener("change", applyRequestFilters);
  document.getElementById("req-extension-filter").addEventListener("change", applyRequestFilters);

  document.querySelectorAll("#req-finding-tags .tag-filter").forEach(btn => {
    btn.addEventListener("click", () => {
      btn.classList.toggle("active");
      applyRequestFilters();
    });
  });

  const pauseBtn = document.getElementById("req-pause-btn");
  pauseBtn.addEventListener("click", () => {
    isPaused = !isPaused;
    interceptEnabled = isPaused;
    updateCapturePauseButton();
    sendInterceptConfig();
  });

  document.getElementById("req-export-btn").addEventListener("click", exportCapturedUrls);
  document.getElementById("copy-curl-btn").addEventListener("click", () => {
    if (!selectedRequest) return;
    let curl = `curl -X ${selectedRequest.method} "${selectedRequest.url}"`;
    if (selectedRequest.requestHeaders) {
      selectedRequest.requestHeaders.forEach(h => {
        curl += ` \\n  -H "${h.name}: ${h.value}"`;
      });
    }
    if (selectedRequest.requestBody) {
      curl += ` \\n  --data ${JSON.stringify(selectedRequest.requestBody)}`;
    }
    copyToClipboard(curl, "Copied as cURL command!");
  });

  document.getElementById("copy-python-btn").addEventListener("click", () => {
    if (!selectedRequest) return;
    let headersObj = {};
    if (selectedRequest.requestHeaders) {
      selectedRequest.requestHeaders.forEach(h => { headersObj[h.name] = h.value; });
    }
    let py = `import requests\\n\\nurl = "${selectedRequest.url}"\\n`;
    py += `headers = ${JSON.stringify(headersObj, null, 4)}\\n`;
    if (selectedRequest.requestBody) {
      py += `data = ${JSON.stringify(selectedRequest.requestBody)}\\n`;
      py += `response = requests.${selectedRequest.method.toLowerCase()}(url, headers=headers, data=data)\\n`;
    } else {
      py += `response = requests.${selectedRequest.method.toLowerCase()}(url, headers=headers)\\n`;
    }
    py += `print(response.status_code)\\nprint(response.text)\\n`;
    copyToClipboard(py, "Copied as Python script!");
  });

  document.getElementById("copy-fetch-btn").addEventListener("click", () => {
    if (!selectedRequest) return;
    let headersObj = {};
    if (selectedRequest.requestHeaders) {
      selectedRequest.requestHeaders.forEach(h => { headersObj[h.name] = h.value; });
    }
    let opts = { method: selectedRequest.method, headers: headersObj };
    if (selectedRequest.requestBody) opts.body = selectedRequest.requestBody;
    let js = `fetch("${selectedRequest.url}", ${JSON.stringify(opts, null, 2)})\\n  .then(res => res.text())\\n  .then(console.log);`;
    copyToClipboard(js, "Copied as fetch() call!");
  });
  document.getElementById("replay-send-btn").addEventListener("click", executeReplay);
  const addParamBtn = document.getElementById("fuzz-add-param-btn");
  const startFuzzBtn = document.getElementById("fuzz-start-btn");

  if (addParamBtn) addParamBtn.addEventListener("click", addNewBlankParameterRow);
  if (startFuzzBtn) startFuzzBtn.addEventListener("click", executeAttackMatrixPipeline);

  const customHeaderEnable = document.getElementById("custom-header-enable");
  const customHeaderName = document.getElementById("custom-header-name");
  const customHeaderValue = document.getElementById("custom-header-value");

  function saveCustomHeaderConfig() {
    const config = { enabled: customHeaderEnable?.checked || false, name: customHeaderName?.value.trim() || 'User-Agent', value: customHeaderValue?.value.trim() || 'x-bug-bounty' };
    browser.storage.local.set({ custom_header_config: config });
    port.postMessage({ type: 'set_custom_header', ...config });
  }

  if (customHeaderEnable) {
    customHeaderEnable.addEventListener("change", saveCustomHeaderConfig);
  }
  if (customHeaderName) {
    customHeaderName.addEventListener("input", saveCustomHeaderConfig);
  }
  if (customHeaderValue) {
    customHeaderValue.addEventListener("input", saveCustomHeaderConfig);
  }

  browser.storage.local.get('custom_header_config').then(data => {
    if (data.custom_header_config) {
      const cfg = data.custom_header_config;
      if (customHeaderEnable) customHeaderEnable.checked = cfg.enabled;
      if (customHeaderName) customHeaderName.value = cfg.name || 'User-Agent';
      if (customHeaderValue) customHeaderValue.value = cfg.value || 'x-bug-bounty';
      port.postMessage({ type: 'set_custom_header', enabled: cfg.enabled, name: cfg.name || 'User-Agent', value: cfg.value || 'x-bug-bounty' });
    }
  });
}

function updateRequestCountBadge() {
  document.getElementById("request-count").textContent = capturedRequests.length;
}

function updateDomainFilters(urlStr) {
  try {
    const url = new URL(urlStr);
    const select = document.getElementById("req-domain-filter");
    let exists = false;
    for (let i = 0; i < select.options.length; i++) {
      if (select.options[i].value === url.origin) { exists = true; break; }
    }

    if (!exists) {
      const opt = new Option(url.hostname, url.origin);
      select.add(opt);
    }
  } catch (e) { }
}

function getRequestExtension(urlStr) {
  try {
    const pathname = new URL(urlStr).pathname;
    const lastSlash = pathname.lastIndexOf('/');
    const lastDot = pathname.lastIndexOf('.');
    if (lastDot > lastSlash) {
      return pathname.substring(lastDot).toLowerCase();
    }
  } catch (e) { }
  return 'none';
}

function getSelectedFilterValues(select) {
  if (!select) return [];
  return Array.from(select.selectedOptions).map(option => option.value).filter(Boolean);
}

function isFilterSelectionAll(values) {
  return values.length === 0 || values.includes('all');
}

function getEndpointMetadataForRequest(req) {
  if (!req || !Array.isArray(activeEndpoints) || activeEndpoints.length === 0) return null;
  try {
    const reqUrl = new URL(req.url);
    return activeEndpoints.find(ep => {
      try {
        const epUrl = new URL(ep.url);
        return (ep.method || 'GET').toUpperCase() === (req.method || 'GET').toUpperCase() && reqUrl.origin === epUrl.origin && reqUrl.pathname === epUrl.pathname;
      } catch {
        return false;
      }
    });
  } catch {
    return null;
  }
}

function getRequestFindings(req) {
  if (!req) return [];

  const body = req.requestBody || null;
  const localFindings = getRequestFindingsFromData(
    req.url,
    req.method,
    body,
    req.statusCode,
    req.responseHeaders
  );

  const endpoint = getEndpointMetadataForRequest(req);
  if (!endpoint) return localFindings;

  const merged = new Set(localFindings);
  if (endpoint.sensitive) merged.add('sensitive');
  if (endpoint.tags) {
    Object.entries(endpoint.tags).forEach(([tag, value]) => {
      if (value) merged.add(tag);
    });
  }
  return Array.from(merged);
}

function getFindingIcon(tag) {
  return (TAG_DETECTION.TAG_ICONS && TAG_DETECTION.TAG_ICONS[tag]) || '•';
}

function getRequestFindingBadges(req) {
  const findings = getRequestFindings(req);
  if (!findings.length) return '';

  return `<span class="req-findings">${findings.map(tag => {
    const label = tag === 'sensitive' ? 'Sensitive' : tag.toUpperCase();
    const icon = getFindingIcon(tag);
    return `<span class="req-finding-chip ${tag === 'sensitive' ? 'sensitive' : tag}" title="${escapeHtml(label)}">${icon} ${escapeHtml(label)}</span>`;
  }).join('')}</span>`;
}

function updateExtensionFilters() {
  const select = document.getElementById("req-extension-filter");
  if (!select) return;

  const selectedValues = getSelectedFilterValues(select);
  const extensions = new Set();

  capturedRequests.forEach(req => {
    const ext = getRequestExtension(req.url);
    if (ext) extensions.add(ext);
  });

  select.innerHTML = '';
  const allOption = new Option('All Extensions', 'all');
  allOption.selected = selectedValues.includes('all') || selectedValues.length === 0;
  select.add(allOption);

  const sortedExtensions = Array.from(extensions).sort((a, b) => a.localeCompare(b));
  sortedExtensions.forEach(ext => {
    const option = new Option(ext === 'none' ? 'No Extension' : ext, ext);
    option.selected = selectedValues.includes(ext);
    select.add(option);
  });
}

function applyRequestFilters() {
  const query = document.getElementById("req-search").value.toLowerCase();
  const methodSelect = document.getElementById("req-method-filter");
  const domainSelect = document.getElementById("req-domain-filter");
  const extensionSelect = document.getElementById("req-extension-filter");
  const statusSelect = document.getElementById("req-status-filter");
  const paramSelect = document.getElementById("req-param-filter");

  const selectedMethods = getSelectedFilterValues(methodSelect);
  const selectedDomains = getSelectedFilterValues(domainSelect);
  const selectedExtensions = getSelectedFilterValues(extensionSelect);
  const selectedStatuses = getSelectedFilterValues(statusSelect);
  const selectedParams = getSelectedFilterValues(paramSelect);
  const selectedFindings = Array.from(document.querySelectorAll("#req-finding-tags .tag-filter.active")).map(btn => btn.getAttribute('data-tag'));

  filteredRequests = capturedRequests.filter(r => {
    if (collectionFilterActive && !favorites.has(r.requestId)) {
      return false;
    }
    const matchesQuery = r.url.toLowerCase().includes(query) ||
      String(r.statusCode || '').includes(query) ||
      r.method.toLowerCase().includes(query);
    let matchesMethod = true;
    if (!isFilterSelectionAll(selectedMethods)) {
      matchesMethod = selectedMethods.includes(r.method);
    }
    let matchesDomain = true;
    if (!isFilterSelectionAll(selectedDomains)) {
      try {
        matchesDomain = selectedDomains.includes(new URL(r.url).origin);
      } catch { matchesDomain = false; }
    }
    let matchesStatus = true;
    if (!isFilterSelectionAll(selectedStatuses)) {
      const statusCode = r.statusCode;
      if (!statusCode) {
        matchesStatus = false;
      } else {
        matchesStatus = selectedStatuses.some(statusValue => {
          const structuralRange = statusValue[0];
          const rangeFloor = parseInt(structuralRange) * 100;
          const rangeCeiling = rangeFloor + 99;
          return statusCode >= rangeFloor && statusCode <= rangeCeiling;
        });
      }
    }
    let matchesParams = true;
    if (!isFilterSelectionAll(selectedParams)) {
      let hasParameters = false;

      if (r.url.includes("?") && r.url.split("?")[1] !== "") {
        hasParameters = true;
      }
      if (r.requestBody && r.requestBody.trim().length > 0) {
        hasParameters = true;
      }

      matchesParams = selectedParams.some(paramValue => (paramValue === 'has-params' && hasParameters) || (paramValue === 'no-params' && !hasParameters));
    }
    let matchesExtension = true;
    if (!isFilterSelectionAll(selectedExtensions)) {
      matchesExtension = selectedExtensions.includes(getRequestExtension(r.url));
    }
    let matchesFindings = true;
    if (selectedFindings.length > 0) {
      const findings = getRequestFindings(r);
      matchesFindings = selectedFindings.some(f => findings.includes(f));
    }

    return matchesQuery && matchesMethod && matchesDomain && matchesStatus && matchesParams && matchesExtension && matchesFindings;
  });

  renderRequestList();
}

function renderRequestList() {
  const container = document.getElementById("request-list");
  if (filteredRequests.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📡</div>
        <div>No matching requests found</div>
      </div>`;
    return;
  }

  container.innerHTML = "";
  filteredRequests.forEach(req => {
    const item = document.createElement("div");
    const findingChips = getRequestFindings(req);
    const primaryFinding = findingChips.length ? findingChips[0] : '';
    const isFavorite = favorites.has(req.requestId);

    item.className = `req-item ${selectedRequest && selectedRequest.requestId === req.requestId ? 'selected' : ''} ${isFavorite ? 'favorited' : ''} ${findingChips.length ? 'has-findings' : ''} ${primaryFinding ? `finding-${primaryFinding}` : ''} ${req.dropped ? 'dropped' : ''}`;

    let statusClass = "s2xx";
    if (req.statusCode >= 300 && req.statusCode < 400) statusClass = "s3xx";
    if (req.statusCode >= 400 && req.statusCode < 500) statusClass = "s4xx";
    if (req.statusCode >= 500) statusClass = "s5xx";

    const interceptBtns = req.intercepted && !req.interceptProcessed
      ? `<button class="intercept-btn intercept-fwd" data-action="fwd">Fwd</button>
         <button class="intercept-btn intercept-drop" data-action="drop">Drop</button>
         <button class="intercept-btn intercept-mod" data-action="mod">Mod</button>`
      : '';

    item.innerHTML = `
      <button class="favorite-btn ${isFavorite ? 'active' : ''}" data-request-id="${req.requestId}" title="Add to collection">⭐</button>
      ${interceptBtns}
      <span class="req-method ${req.method}">${req.method}</span>
      <span class="req-url" title="${escapeHtml(req.url)}">${escapeHtml(req.url)}</span>
      ${getRequestFindingBadges(req)}
      <span class="req-status ${statusClass}">${req.statusCode || '---'}</span>
      <span class="req-type">${escapeHtml(req.type || '')}</span>
    `;

    const favBtn = item.querySelector('.favorite-btn');
    favBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFavorite(req.requestId);
    });

    item.querySelectorAll('.intercept-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        if (action === 'fwd') handleForward(req);
        else if (action === 'drop') handleDrop(req);
        else if (action === 'mod') handleModify(req);
      });
    });

    item.addEventListener("click", () => {
      document.querySelectorAll(".req-item").forEach(i => i.classList.remove("selected"));
      item.classList.add("selected");
      selectRequestItem(req);
    });

    container.appendChild(item);
  });
}

function selectRequestItem(req) {
  selectedRequest = req;
  document.getElementById("copy-curl-btn").removeAttribute("disabled");
  document.getElementById("copy-python-btn").removeAttribute("disabled");
  document.getElementById("copy-fetch-btn").removeAttribute("disabled");
  let reqText = `${req.method} ${req.url}\n`;
  if (req.requestHeaders) {
    req.requestHeaders.forEach(h => { reqText += `${h.name}: ${h.value}\n`; });
  }
  if (req.requestBody) {
    reqText += `\n${req.requestBody}`;
  }
  document.getElementById("request-display").textContent = reqText;
  let respText = `${req.statusLine || ''}\n`;
  if (req.responseHeaders) {
    req.responseHeaders.forEach(h => { respText += `${h.name}: ${h.value}\n`; });
  }
  document.getElementById("response-display").textContent = respText;
  document.getElementById("replay-method").value = req.method;

  let headersString = "";
  if (req.requestHeaders) {
    req.requestHeaders.forEach(h => { headersString += `${h.name}: ${h.value}\n`; });
  }
  document.getElementById("replay-headers").value = headersString;
  document.getElementById("replay-body").value = req.requestBody || "";
  setupFuzzerTabFromSelectedRequest(req);
  document.getElementById("fuzz-url").value = req.url;
  document.getElementById("tools-base-url").value = req.url;
}

function clearRequests() {
  capturedRequests = [];
  filteredRequests = [];
  selectedRequest = null;
  favorites.clear();
  browser.storage.local.set({ favorites: [] });
  updateRequestCountBadge();
  updateExtensionFilters();
  applyRequestFilters();

  document.getElementById("request-display").textContent = "Select a request from the list";
  document.getElementById("response-display").textContent = "Select a request to see its response";
  document.getElementById("copy-curl-btn").setAttribute("disabled", "true");
  document.getElementById("copy-python-btn").setAttribute("disabled", "true");
  document.getElementById("copy-fetch-btn").setAttribute("disabled", "true");
}
async function executeReplay() {
  const method = document.getElementById("replay-method").value;
  const url = document.getElementById("fuzz-url").value.trim();
  const headersRaw = document.getElementById("replay-headers").value;
  const body = document.getElementById("replay-body").value;
  const resultsConsole = document.getElementById("fuzz-results");

  if (!url) {
    return alert('Please enter a request URL before replaying.');
  }

  const headers = {};
  headersRaw.split("\n").forEach(line => {
    const idx = line.indexOf(":");
    if (idx !== -1) {
      const name = line.substring(0, idx).trim();
      const val = line.substring(idx + 1).trim();
      if (name) headers[name] = val;
    }
  });

  const req = { method: method.toUpperCase(), url, headers, body: null };
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method) && body) {
    req.body = body;
  }

  if (resultsConsole) {
    resultsConsole.innerHTML += `<div style="color: var(--accent);">↳ Sending request: <strong>${escapeHtml(req.method)}</strong> ${escapeHtml(url)}</div>`;
    resultsConsole.scrollTop = resultsConsole.scrollHeight;
  }

  try {
    port.postMessage({ type: 'set_fuzz_replay_active', active: true });
    registerCurrentPanelTarget();
    const result = await performRequestInPage(req);
    if (resultsConsole) {
      const status = result?.status || '---';
      resultsConsole.innerHTML += `<div style="color: var(--accent2);">↳ Response status: <strong>${escapeHtml(String(status))}</strong></div>`;
      resultsConsole.scrollTop = resultsConsole.scrollHeight;
    }
  } catch (e) {
    if (resultsConsole) {
      resultsConsole.innerHTML += `<div style="color: var(--danger);">Replay Failed: ${escapeHtml(e.message)}</div>`;
      resultsConsole.scrollTop = resultsConsole.scrollHeight;
    }
  } finally {
    port.postMessage({ type: 'set_fuzz_replay_active', active: false });
  }
}

function updateCapturePauseButton() {
  const pauseBtn = document.getElementById("req-pause-btn");
  if (!pauseBtn) return;
  if (isPaused) {
    pauseBtn.textContent = "▶️";
    pauseBtn.title = "Resume capture (disable intercept)";
    pauseBtn.classList.add("active", "intercept-mode");
  } else {
    pauseBtn.textContent = "⏸️";
    pauseBtn.title = "Pause capture & intercept requests";
    pauseBtn.classList.remove("active", "intercept-mode");
  }
}

function hasActiveRequestFilters() {
  const query = document.getElementById("req-search")?.value?.trim();
  if (query) return true;

  const selects = ['req-method-filter', 'req-status-filter', 'req-param-filter', 'req-domain-filter', 'req-extension-filter'];
  for (const id of selects) {
    const values = getSelectedFilterValues(document.getElementById(id));
    if (!isFilterSelectionAll(values)) return true;
  }

  return document.querySelectorAll("#req-finding-tags .tag-filter.active").length > 0;
}

function exportCapturedUrls() {
  const source = hasActiveRequestFilters() ? filteredRequests : capturedRequests;
  const seen = new Set();
  const lines = [];
  source.forEach(r => {
    if (r.url && !seen.has(r.url)) {
      seen.add(r.url);
      let line = `${r.method}\t${r.url}`;
      if (r.statusCode) line += `\t${r.statusCode}`;
      if (r.requestBody) line += `\t${r.requestBody}`;
      lines.push(line);
    }
  });
  if (!lines.length) {
    const resultsConsole = document.getElementById("fuzz-results");
    if (resultsConsole) {
      resultsConsole.innerHTML += `<div style="color: var(--danger);">No matching requests to export.</div>`;
      resultsConsole.scrollTop = resultsConsole.scrollHeight;
    }
    return;
  }
  const text = lines.join("\n");
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `bug-export-${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  const resultsConsole = document.getElementById("fuzz-results");
  if (resultsConsole) {
    resultsConsole.innerHTML += `<div style="color: var(--accent2);">📥 Exported ${lines.length} request${lines.length === 1 ? '' : 's'} to <strong>bug-export-${Date.now()}.txt</strong></div>`;
    resultsConsole.scrollTop = resultsConsole.scrollHeight;
  }
}

function sendInterceptConfig() {
  try {
    const tabId = getCurrentTabId();
    registerCurrentPanelTarget();
    port.postMessage({ type: 'set_intercept', tabId, enabled: interceptEnabled });
  } catch (e) {
    console.warn('Panel: failed to send intercept config', e);
  }
}

function showInterceptedRequest(req) {
  const resultsConsole = document.getElementById("fuzz-results");
  if (resultsConsole) {
    resultsConsole.innerHTML += `<div style="color: var(--warning, #ffb347); margin-top: 6px;">⛔ Intercepted: <strong>${escapeHtml(req.method)}</strong> ${escapeHtml(req.url)}</div>`;
    resultsConsole.scrollTop = resultsConsole.scrollHeight;
  }

  document.querySelectorAll("#top-nav .nav-tab").forEach(t => t.classList.remove("active"));
  document.getElementById("tab-btn-requests")?.classList.add("active");
  document.querySelectorAll(".tab-panel").forEach(panel => panel.classList.remove("active"));
  document.getElementById("tab-requests")?.classList.add("active");
  document.querySelector('[data-detail="attack"]')?.click();
  selectRequestItem(req);
}

async function handleForward(req) {
  const entry = capturedRequests.find(r => r.requestId === req.requestId);
  if (entry) entry.interceptProcessed = true;
  applyRequestFilters();

  const resultsConsole = document.getElementById("fuzz-results");
  if (resultsConsole) {
    resultsConsole.innerHTML += `<div style="color: var(--accent);">↪ Forwarding intercepted request...</div>`;
    resultsConsole.scrollTop = resultsConsole.scrollHeight;
  }

  const headers = headersArrayToObject(req.requestHeaders);
  const msgId = `fwd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    const result = await new Promise((resolve, reject) => {
      function handler(msg) {
        if (msg.type === 'forward_result' && msg.msgId === msgId) {
          port.onMessage.removeListener(handler);
          if (msg.error) reject(new Error(msg.error));
          else resolve(msg);
        }
      }
      port.onMessage.addListener(handler);
      port.postMessage({ type: 'forward_request', msgId, method: req.method || 'GET', url: req.url, headers, body: req.requestBody || null });
      setTimeout(() => { port.onMessage.removeListener(handler); reject(new Error('Forward timeout')); }, 30000);
    });

    if (entry) {
      entry.statusCode = result.status;
      entry.statusLine = result.statusText ? `HTTP ${result.status} ${result.statusText}` : `HTTP ${result.status}`;
    }
    applyRequestFilters();

    if (resultsConsole) {
      resultsConsole.innerHTML += `<div style="color: var(--accent2);">↪ Forwarded — status ${escapeHtml(String(result.status || '---'))}</div>`;
      resultsConsole.scrollTop = resultsConsole.scrollHeight;
    }
  } catch (e) {
    if (resultsConsole) {
      resultsConsole.innerHTML += `<div style="color: var(--danger);">Forward failed: ${escapeHtml(e.message)}</div>`;
      resultsConsole.scrollTop = resultsConsole.scrollHeight;
    }
  }
}

function handleDrop(req) {
  const entry = capturedRequests.find(r => r.requestId === req.requestId);
  if (entry) {
    entry.dropped = true;
    entry.interceptProcessed = true;
  }
  if (selectedRequest && selectedRequest.requestId === req.requestId) {
    selectedRequest = null;
  }
  applyRequestFilters();

  const resultsConsole = document.getElementById("fuzz-results");
  if (resultsConsole) {
    resultsConsole.innerHTML += `<div style="color: var(--danger);">🗑️ Dropped: <strong>${escapeHtml(req.method)}</strong> ${escapeHtml(req.url)}</div>`;
    resultsConsole.scrollTop = resultsConsole.scrollHeight;
  }
}

function handleModify(req) {
  const entry = capturedRequests.find(r => r.requestId === req.requestId);
  if (entry) {
    entry.dropped = true;
    entry.interceptProcessed = true;
  }
  applyRequestFilters();

  document.getElementById("replay-body").value = req.requestBody || "";
  document.getElementById("replay-method").value = req.method || 'GET';
  let headersString = "";
  if (req.requestHeaders) {
    req.requestHeaders.forEach(h => { headersString += `${h.name}: ${h.value}\n`; });
  }
  document.getElementById("replay-headers").value = headersString;
  document.getElementById("fuzz-url").value = req.url;
  setupFuzzerTabFromSelectedRequest(req);

  document.querySelectorAll("#top-nav .nav-tab").forEach(t => t.classList.remove("active"));
  document.getElementById("tab-btn-requests")?.classList.add("active");
  document.querySelectorAll(".tab-panel").forEach(panel => panel.classList.remove("active"));
  document.getElementById("tab-requests")?.classList.add("active");
  document.querySelector('[data-detail="attack"]')?.click();
  selectRequestItem(entry || req);

  const resultsConsole = document.getElementById("fuzz-results");
  if (resultsConsole) {
    resultsConsole.innerHTML += `<div style="color: var(--accent);">↪ Loaded into Modify: <strong>${escapeHtml(req.method)}</strong> ${escapeHtml(req.url)} — edit and press "Replay"</div>`;
    resultsConsole.scrollTop = resultsConsole.scrollHeight;
  }
}

let currentFuzzParameters = [];
let selectedFuzzParamIndex = -1;

function createDefaultFuzzParam(type, key, value, active) {
  return { type, key, value, active, fuzzMode: 'preset', fuzzPreset: '', customPayloads: '', numberFrom: 0, numberTo: 9999, numberPadding: 'none', dateFrom: '2020-01-01', dateTo: '2025-12-31', letterMax: 3, wordlistType: 'common_params' };
}

function setupFuzzerTabFromSelectedRequest(req) {
  if (!req) return;
  let baseSplit = req.url.split('?');
  const urlInput = document.getElementById("fuzz-url");
  urlInput.value = baseSplit[0];
  urlInput.dataset.cleanBase = baseSplit[0];
  currentFuzzParameters = [];
  if (baseSplit.length > 1) {
    let searchParams = new URLSearchParams(baseSplit[1]);
    for (let [key, value] of searchParams.entries()) {
      currentFuzzParameters.push(createDefaultFuzzParam('query', key, value, true));
    }
  }
  try {
    const pathSegments = new URL(baseSplit[0]).pathname.split('/').filter(Boolean);
    pathSegments.forEach(segment => {
      if (segment.includes('=')) {
        const [key, ...rest] = segment.split('=');
        const value = rest.join('=');
        if (key && value !== undefined) {
          currentFuzzParameters.push(createDefaultFuzzParam('path', key, value, true));
        }
      } else {
        currentFuzzParameters.push(createDefaultFuzzParam('path', segment, segment, false));
      }
    });
  } catch (e) {
  }
  if (req.requestBody && req.requestBody.trim().length > 0) {
    let bodyStr = req.requestBody.trim();
    if (bodyStr.startsWith('{')) {
      try {
        let json = JSON.parse(bodyStr);
        for (let [key, value] of Object.entries(json)) {
          currentFuzzParameters.push(createDefaultFuzzParam('body-json', key, String(value), true));
        }
      } catch (e) { }
    } else {
      let bodyParams = new URLSearchParams(bodyStr);
      for (let [key, value] of bodyParams.entries()) {
        currentFuzzParameters.push(createDefaultFuzzParam('body-form', key, value, true));
      }
    }
  }
  if (req.requestHeaders && Array.isArray(req.requestHeaders)) {
    const headersToSkip = ['content-length', 'content-type', 'host', 'connection', 'user-agent', 'accept-encoding'];
    req.requestHeaders.forEach(h => {
      const headerName = (h.name || '').toLowerCase();
      if (h.name && !headersToSkip.includes(headerName)) {
        currentFuzzParameters.push(createDefaultFuzzParam('header', h.name, h.value || '', false));
      }
    });
  }

  selectedFuzzParamIndex = currentFuzzParameters.length > 0 ? 0 : -1;
  renderFuzzerParamList();
  syncRequestFromParams();
}

function addNewBlankParameterRow() {
  currentFuzzParameters.push(createDefaultFuzzParam('query', 'param_name', 'test_value', false));
  selectedFuzzParamIndex = currentFuzzParameters.length - 1;
  renderFuzzerParamList();
  syncRequestFromParams();
}

function renderFuzzerParamList() {
  const container = document.getElementById('fuzz-param-list');
  if (!container) return;

  if (currentFuzzParameters.length === 0) {
    container.innerHTML = `<div style="color: var(--text3); font-size: 11px; text-align: center; margin-top: 20px;">No targets identified. Click "+ Add Target" to add custom rows.</div>`;
    renderFuzzerOptionsPanel();
    return;
  }

  if (selectedFuzzParamIndex >= currentFuzzParameters.length) selectedFuzzParamIndex = currentFuzzParameters.length - 1;
  if (selectedFuzzParamIndex < 0 && currentFuzzParameters.length > 0) selectedFuzzParamIndex = 0;

  container.innerHTML = '';
  currentFuzzParameters.forEach((param, index) => {
    const sel = index === selectedFuzzParamIndex;
    const row = document.createElement('div');
    row.style.cssText = `display: flex; align-items: center; gap: 4px; padding: 4px 6px; border-radius: 4px; cursor: pointer; background: ${sel ? 'var(--accent)' : 'var(--bg3)'}; border: 1px solid ${sel ? 'var(--accent2)' : 'var(--border)'}; opacity: ${param.active ? '1' : '0.55'}; transition: background 0.1s;`;
    row.addEventListener('click', () => {
      selectedFuzzParamIndex = index;
      renderFuzzerParamList();
    });

    const typeLabel = (param.type === 'body-form' || param.type === 'body-json') ? 'body' : param.type;

    row.innerHTML = `
      <input type="checkbox" ${param.active ? 'checked' : ''} style="margin: 0; cursor: pointer; flex-shrink: 0;" title="Enable fuzzing">
      <span style="font-size: 9px; font-family: var(--mono); color: ${sel ? '#fff' : 'var(--accent2)'}; background: ${sel ? 'rgba(255,255,255,0.2)' : 'var(--bg4)'}; padding: 1px 4px; border-radius: 3px; min-width: 36px; text-align: center; flex-shrink: 0;">${typeLabel}</span>
      <span style="flex: 1; font-size: 11px; font-family: var(--mono); color: ${sel ? '#fff' : 'var(--accent)'}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(param.key)}</span>
      <span style="font-size: 9px; color: ${sel ? 'rgba(255,255,255,0.7)' : 'var(--text3)'}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 55px; flex-shrink: 0;">${escapeHtml(param.value)}</span>
      <button style="background: none; border: none; color: ${sel ? 'rgba(255,255,255,0.7)' : 'var(--danger)'}; cursor: pointer; padding: 0 2px; font-size: 11px; flex-shrink: 0;" title="Remove">&times;</button>`;

    const chk = row.querySelector('input[type="checkbox"]');
    chk.addEventListener('click', (e) => { e.stopPropagation(); });
    chk.addEventListener('change', (e) => { param.active = e.target.checked; renderFuzzerParamList(); syncRequestFromParams(); });
    row.querySelector('button').addEventListener('click', (e) => {
      e.stopPropagation();
      currentFuzzParameters.splice(index, 1);
      if (selectedFuzzParamIndex >= currentFuzzParameters.length) selectedFuzzParamIndex = currentFuzzParameters.length - 1;
      renderFuzzerParamList();
      syncRequestFromParams();
    });

    container.appendChild(row);
  });

  renderFuzzerOptionsPanel();
}

function renderFuzzerOptionsPanel() {
  const placeholder = document.getElementById('fuzz-options-placeholder');
  const content = document.getElementById('fuzz-options-content');
  if (!placeholder || !content) return;

  if (currentFuzzParameters.length === 0 || selectedFuzzParamIndex < 0 || selectedFuzzParamIndex >= currentFuzzParameters.length) {
    placeholder.style.display = '';
    content.style.display = 'none';
    return;
  }
  placeholder.style.display = 'none';
  content.style.display = 'flex';
  content.style.flexDirection = 'column';

  const param = currentFuzzParameters[selectedFuzzParamIndex];
  content.innerHTML = buildFuzzOptionsHtml(param);

  content.querySelectorAll('.fuzz-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => { param.fuzzMode = btn.dataset.mode; renderFuzzerOptionsPanel(); renderFuzzerParamList(); });
  });
  content.querySelector('#fuzz-opt-type')?.addEventListener('change', (e) => { param.type = e.target.value; renderFuzzerParamList(); syncRequestFromParams(); });
  content.querySelector('#fuzz-opt-key')?.addEventListener('input', (e) => { param.key = e.target.value; renderFuzzerParamList(); syncRequestFromParams(); });
  content.querySelector('#fuzz-opt-val')?.addEventListener('input', (e) => { param.value = e.target.value; renderFuzzerParamList(); syncRequestFromParams(); });

  const h = (sel, prop, evt, fn) => { const el = content.querySelector(sel); if (el) el.addEventListener(evt || 'change', (e) => { param[prop] = fn ? fn(e.target.value) : e.target.value; updateFuzzPayloadPreview(); }); };
  h('#fuzz-opt-custom', 'customPayloads', 'input');
  h('#fuzz-opt-num-from', 'numberFrom', 'input', v => parseInt(v) || 0);
  h('#fuzz-opt-num-to', 'numberTo', 'input', v => parseInt(v) || 0);
  h('#fuzz-opt-num-pad', 'numberPadding');
  h('#fuzz-opt-date-from', 'dateFrom');
  h('#fuzz-opt-date-to', 'dateTo');
  h('#fuzz-opt-letter-max', 'letterMax', 'input', v => parseInt(v) || 1);
  h('#fuzz-opt-wordlist', 'wordlistType');
  h('#fuzz-opt-preset', 'fuzzPreset');

  updateFuzzPayloadPreview();
}

function buildFuzzOptionsHtml(p) {
  const mode = p.fuzzMode || 'preset';
  const modes = ['preset', 'custom', 'numbers', 'dates', 'letters', 'wordlist'];
  const modeLabels = { preset: '📖 Preset', custom: '✏️ Custom', numbers: '🔢 Numbers', dates: '📅 Dates', letters: '🔤 Letters', wordlist: '📋 Wordlist' };

  let modeConfigHtml = '';
  switch (mode) {
    case 'custom':
      modeConfigHtml = `<label style="font-size: 10px; color: var(--text3); display: block; margin-bottom: 2px;">Payloads (one per line):</label><textarea id="fuzz-opt-custom" style="width: 100%; height: 70px; font-size: 11px; font-family: var(--mono); background: var(--bg3); border: 1px solid var(--border); color: var(--text); padding: 4px; border-radius: 4px; resize: vertical; box-sizing: border-box;">${escapeHtml(p.customPayloads)}</textarea>`;
      break;
    case 'numbers':
      modeConfigHtml = `<div style="display: grid; grid-template-columns: auto 1fr; gap: 4px 8px; align-items: center; font-size: 11px;">
        <span style="color: var(--text3);">From:</span><input type="number" id="fuzz-opt-num-from" value="${p.numberFrom}" style="width: 100px; font-size: 11px; padding: 2px 6px; border-radius: 4px; background: var(--bg3); border: 1px solid var(--border); color: var(--text);">
        <span style="color: var(--text3);">To:</span><input type="number" id="fuzz-opt-num-to" value="${p.numberTo}" style="width: 100px; font-size: 11px; padding: 2px 6px; border-radius: 4px; background: var(--bg3); border: 1px solid var(--border); color: var(--text);">
        <span style="color: var(--text3);">Padding:</span>
        <select id="fuzz-opt-num-pad" style="width: 110px; font-size: 10px; padding: 2px 4px; border-radius: 4px; background: var(--bg3); border: 1px solid var(--border); color: var(--text);">
          <option value="none" ${p.numberPadding === 'none' ? 'selected' : ''}>None</option>
          <option value="zero" ${p.numberPadding === 'zero' ? 'selected' : ''}>Zero-padded</option>
          <option value="space" ${p.numberPadding === 'space' ? 'selected' : ''}>Space-padded</option>
        </select>
      </div>`;
      break;
    case 'dates':
      modeConfigHtml = `<div style="display: grid; grid-template-columns: auto 1fr; gap: 4px 8px; align-items: center; font-size: 11px;">
        <span style="color: var(--text3);">From:</span><input type="date" id="fuzz-opt-date-from" value="${p.dateFrom}" style="width: 140px; font-size: 11px; padding: 2px 6px; border-radius: 4px; background: var(--bg3); border: 1px solid var(--border); color: var(--text);">
        <span style="color: var(--text3);">To:</span><input type="date" id="fuzz-opt-date-to" value="${p.dateTo}" style="width: 140px; font-size: 11px; padding: 2px 6px; border-radius: 4px; background: var(--bg3); border: 1px solid var(--border); color: var(--text);">
      </div>`;
      break;
    case 'letters':
      modeConfigHtml = `<div style="display: grid; grid-template-columns: auto 1fr; gap: 4px 8px; align-items: center; font-size: 11px;">
        <span style="color: var(--text3);">Max Length:</span><input type="number" id="fuzz-opt-letter-max" value="${p.letterMax}" min="1" max="5" style="width: 80px; font-size: 11px; padding: 2px 6px; border-radius: 4px; background: var(--bg3); border: 1px solid var(--border); color: var(--text);">
      </div>`;
      break;
    case 'wordlist':
      modeConfigHtml = `<div style="display: grid; grid-template-columns: auto 1fr; gap: 4px 8px; align-items: center; font-size: 11px;">
        <span style="color: var(--text3);">Wordlist:</span>
        <select id="fuzz-opt-wordlist" style="width: 150px; font-size: 10px; padding: 2px 4px; border-radius: 4px; background: var(--bg3); border: 1px solid var(--border); color: var(--text);">
          <option value="common_params" ${p.wordlistType === 'common_params' ? 'selected' : ''}>Common Params</option>
          <option value="common_paths" ${p.wordlistType === 'common_paths' ? 'selected' : ''}>Common Paths</option>
        </select>
      </div>`;
      break;
    default:
      modeConfigHtml = `<div style="display: grid; grid-template-columns: auto 1fr; gap: 4px 8px; align-items: center; font-size: 11px;">
        <span style="color: var(--text3);">Dictionary:</span>
        <select id="fuzz-opt-preset" style="width: 200px; font-size: 10px; padding: 2px 4px; border-radius: 4px; background: var(--bg3); border: 1px solid var(--border); color: var(--text);">
          <option value="" ${p.fuzzPreset === '' ? 'selected' : ''}>-- None --</option>
          <option value="cmdi" ${p.fuzzPreset === 'cmdi' ? 'selected' : ''}>&#x1F41A; CMDi</option>
          <option value="lfi" ${p.fuzzPreset === 'lfi' ? 'selected' : ''}>&#x1F4C2; LFI</option>
          <option value="xss" ${p.fuzzPreset === 'xss' ? 'selected' : ''}>&#x1F3A8; XSS</option>
          <option value="sqli" ${p.fuzzPreset === 'sqli' ? 'selected' : ''}>&#x1F5C4;&#xFE0F; SQLi</option>
          <option value="nosqli" ${p.fuzzPreset === 'nosqli' ? 'selected' : ''}>&#x1F9E9; NoSQLi</option>
          <option value="ssrf" ${p.fuzzPreset === 'ssrf' ? 'selected' : ''}>&#x1F310; SSRF</option>
          <option value="ssti" ${p.fuzzPreset === 'ssti' ? 'selected' : ''}>&#x1F9E9; SSTI</option>
          <option value="xxe" ${p.fuzzPreset === 'xxe' ? 'selected' : ''}>&#x1F4DC; XXE</option>
          <option value="open_redirect" ${p.fuzzPreset === 'open_redirect' ? 'selected' : ''}>&#x21AA;&#xFE0F; Redirect</option>
          <option value="crlf" ${p.fuzzPreset === 'crlf' ? 'selected' : ''}>&#x21A9;&#xFE0F; CRLF</option>
          <option value="prototype_pollution" ${p.fuzzPreset === 'prototype_pollution' ? 'selected' : ''}>&#x1F9EC; Proto</option>
          <option value="rce_deserialization" ${p.fuzzPreset === 'rce_deserialization' ? 'selected' : ''}>&#x26A1; RCE</option>
          <option value="idor" ${p.fuzzPreset === 'idor' ? 'selected' : ''}>&#x1F511; IDOR</option>
          <option value="hidden_params" ${p.fuzzPreset === 'hidden_params' ? 'selected' : ''}>&#x2699;&#xFE0F; Params</option>
          <option value="csv" ${p.fuzzPreset === 'csv' ? 'selected' : ''}>&#x1F4CA; CSV</option>
          <option value="business_logic_hpp" ${p.fuzzPreset === 'business_logic_hpp' ? 'selected' : ''}>&#x1F4B0; HPP</option>
        </select>
      </div>`;
  }

  return `
    <div style="background: var(--bg3); border: 1px solid var(--border); border-radius: var(--radius); padding: 8px;">
      <div style="display: grid; grid-template-columns: auto 1fr; gap: 4px 8px; align-items: center; font-size: 11px;">
        <span style="color: var(--text3);">Location:</span>
        <select id="fuzz-opt-type" style="font-size: 10px; padding: 2px 4px; border-radius: 4px; background: var(--bg); border: 1px solid var(--border); color: var(--text); font-family: var(--mono); width: 120px;">
          ${['query', 'body-form', 'body-json', 'header', 'url', 'path'].map(t => `<option value="${t}" ${p.type === t ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
        <span style="color: var(--text3);">Name:</span>
        <input type="text" id="fuzz-opt-key" value="${escapeHtml(p.key)}" style="font-size: 11px; padding: 2px 6px; border-radius: 4px; background: var(--bg); border: 1px solid var(--border); color: var(--accent); font-family: var(--mono);">
        <span style="color: var(--text3);">Value:</span>
        <input type="text" id="fuzz-opt-val" value="${escapeHtml(p.value)}" style="font-size: 11px; padding: 2px 6px; border-radius: 4px; background: var(--bg); border: 1px solid var(--border); color: var(--text); font-family: var(--mono);">
      </div>
    </div>

    <div style="flex: 1; background: var(--bg3); border: 1px solid var(--border); border-radius: var(--radius); padding: 8px; display: flex; flex-direction: column; min-height: 0;">
      <div style="font-size: 10px; font-weight: bold; color: var(--text2); text-transform: uppercase; margin-bottom: 4px;">Fuzzing Mode</div>
      <div style="display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 6px;">
        ${modes.map(m => `<button class="fuzz-mode-btn" data-mode="${m}" style="font-size: 10px; padding: 3px 8px; border-radius: 4px; border: 1px solid ${mode === m ? 'var(--accent2)' : 'var(--border)'}; background: ${mode === m ? 'var(--accent)' : 'var(--bg4)'}; color: ${mode === m ? '#fff' : 'var(--text)'}; cursor: pointer;">${modeLabels[m]}</button>`).join('')}
      </div>
      <div id="fuzz-opt-mode-config">${modeConfigHtml}</div>
      <div style="margin-top: 8px; padding-top: 6px; border-top: 1px solid var(--border); flex: 1; display: flex; flex-direction: column; min-height: 0;">
        <div style="font-size: 10px; font-weight: bold; color: var(--text2); text-transform: uppercase; margin-bottom: 3px;">Payload Preview</div>
        <textarea id="fuzz-payload-preview" readonly style="width: 100%; flex: 1; min-height: 40px; font-size: 10px; font-family: var(--mono); background: var(--bg); border: 1px solid var(--border); color: var(--text); padding: 4px; border-radius: 4px; resize: vertical; box-sizing: border-box;"></textarea>
      </div>
    </div>`;
}

function getPayloadsForParam(param) {
  const dictionaries = (typeof NucleiFuzzDictionaries === 'object' && NucleiFuzzDictionaries) ? NucleiFuzzDictionaries : (window.NucleiFuzzDictionaries || null);
  switch (param.fuzzMode) {
    case 'custom':
      return param.customPayloads ? param.customPayloads.split('\n').map(s => s.trim()).filter(Boolean) : [];
    case 'numbers': {
      const from = param.numberFrom || 0;
      const to = param.numberTo || 9999;
      return FuzzerGenerator.numberRange(from, to, param.numberPadding || 'none');
    }
    case 'dates':
      return FuzzerGenerator.dateRange(param.dateFrom || '2020-01-01', param.dateTo || '2025-12-31');
    case 'letters':
      return FuzzerGenerator.letterRange(param.letterMax || 3);
    case 'wordlist':
      return FuzzerGenerator.commonWordlist(param.wordlistType || 'common_params');
    default:
      if (!param.fuzzPreset || !dictionaries) return [];
      return dictionaries[param.fuzzPreset] || [];
  }
}

function updateFuzzPayloadPreview() {
  const textarea = document.getElementById('fuzz-payload-preview');
  if (!textarea) return;
  if (!currentFuzzParameters[selectedFuzzParamIndex]) { textarea.value = ''; return; }
  const payloads = getPayloadsForParam(currentFuzzParameters[selectedFuzzParamIndex]);
  if (!payloads || payloads.length === 0) { textarea.value = '(no payloads configured)'; return; }
  const maxPreview = 100;
  const lines = payloads.slice(0, maxPreview);
  textarea.value = lines.join('\n') + (payloads.length > maxPreview ? `\n\n... and ${payloads.length - maxPreview} more` : '');
}

function buildFuzzedUrl(baseUrl, runtimeValue) {
  try {
    return new URL(runtimeValue, baseUrl).toString();
  } catch (e) {
    return runtimeValue || baseUrl;
  }
}

function replacePathSegment(url, key, newValue) {
  try {
    const u = new URL(url);
    let replaced = false;
    const segments = u.pathname.split('/').filter(Boolean);
    const newSegments = segments.map(segment => {
      if (replaced) return segment;
      if (segment.includes('=')) {
        const [paramName, ...rest] = segment.split('=');
        if (paramName === key && rest.length > 0) {
          replaced = true;
          return `${paramName}=${newValue}`;
        }
        return segment;
      } else if (segment === key) {
        replaced = true;
        return newValue;
      }
      return segment;
    });
    u.pathname = '/' + newSegments.join('/');
    return u.toString();
  } catch (e) {
    return url;
  }
}

function appendQueryString(url, queryString) {
  if (!queryString) return url;
  return url.includes('?') ? `${url}&${queryString}` : `${url}?${queryString}`;
}

function syncRequestFromParams() {
  const urlInput = document.getElementById('fuzz-url');
  if (!urlInput) return;
  const cleanBase = urlInput.dataset.cleanBase;
  if (cleanBase === undefined) return;

  const queryParams = currentFuzzParameters.filter(p => p.type === 'query');
  const qs = queryParams.map(p => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`).join('&');
  urlInput.value = qs ? `${cleanBase}?${qs}` : cleanBase;

  const headerParams = currentFuzzParameters.filter(p => p.type === 'header');
  document.getElementById('replay-headers').value = headerParams.map(p => `${p.key}: ${p.value}`).join('\n');

  const bodyParams = currentFuzzParameters.filter(p => p.type === 'body-form' || p.type === 'body-json');
  if (bodyParams.length > 0) {
    const isJson = bodyParams.some(p => p.type === 'body-json');
    if (isJson) {
      const obj = {};
      bodyParams.forEach(p => { obj[p.key] = p.value; });
      document.getElementById('replay-body').value = JSON.stringify(obj, null, 2);
    } else {
      const usp = new URLSearchParams();
      bodyParams.forEach(p => usp.append(p.key, p.value));
      document.getElementById('replay-body').value = usp.toString();
    }
  } else {
    document.getElementById('replay-body').value = '';
  }
}

async function executeAttackMatrixPipeline() {
  port.postMessage({ type: 'set_fuzz_replay_active', active: true });
  const urlInput = document.getElementById("fuzz-url");
  const baseUrl = urlInput.dataset.cleanBase || urlInput.value.trim();
  const oastDomain = document.getElementById("fuzz-oast-domain").value.trim() || "interact.sh";
  const fuzzDelay = parseInt(document.getElementById("fuzz-delay").value, 10) || 0;
  const useFfufAc = document.getElementById("fuzz-ffuf-ac").checked;
  const resultsConsole = document.getElementById("fuzz-results");

  if (!baseUrl) {
    alert("Please provide a Base Target URL destination path.");
    return;
  }

  const dictionaries = (typeof NucleiFuzzDictionaries === 'object' && NucleiFuzzDictionaries) ? NucleiFuzzDictionaries : (window.NucleiFuzzDictionaries || null);
  if (!dictionaries) {
    alert('Fuzzing dictionaries failed to load. Please ensure payloads.js is available.');
    return;
  }

  const targetParameters = currentFuzzParameters.filter(p => p.active && p.key.trim().length > 0);
  if (targetParameters.length === 0) {
    alert("Please check at least one parameter to fuzz and select a dictionary.");
    return;
  }
  const missingConfig = targetParameters.filter(p => { const pl = getPayloadsForParam(p); return !pl || pl.length === 0; });
  if (missingConfig.length > 0) {
    alert(`Please configure fuzzing options for: ${missingConfig.map(p => p.key).join(', ')}`);
    return;
  }

  resultsConsole.innerHTML = `<span style="color: var(--accent);">⚡ Running attack loop cycles against ${targetParameters.length} parameter(s)...</span><br><br>`;

  let totalRequests = 0;
  let baselineStatuses = new Set();
  let baselineSizes = new Set();

  if (useFfufAc) {
    resultsConsole.innerHTML += `<span style="color: var(--accent);">⏳ Calibrating base responses...</span><br>`;
    try {
      const baselineReq = {
        method: document.getElementById("replay-method").value,
        url: baseUrl,
        headers: {},
        body: null
      };
      const baselineRes = await performRequestInPage(baselineReq);
      if (baselineRes.ok) {
        baselineStatuses.add(baselineRes.status);
        baselineSizes.add(baselineRes.bodyLength);
        resultsConsole.innerHTML += `<span style="color: var(--accent2);">✅ Calibration complete: status=${baselineRes.status}, size=${baselineRes.bodyLength || 0}</span><br><br>`;
      }
    } catch (e) {
      resultsConsole.innerHTML += `<span style="color: var(--danger);">⚠️ Calibration failed: ${e.message}</span><br><br>`;
    }
  }

  for (const fuzzTarget of targetParameters) {
    let payloads = getPayloadsForParam(fuzzTarget);
    if (!payloads || payloads.length === 0) {
      resultsConsole.innerHTML += `<div style="color: var(--danger);">No payloads for: ${escapeHtml(fuzzTarget.key)}</div>`;
      continue;
    }

    let targetLabel = 'param';
    if (fuzzTarget.type === 'url' || fuzzTarget.type === 'path') {
      targetLabel = 'URL target';
    } else if (fuzzTarget.type === 'header') {
      targetLabel = 'header';
    }
    const modeLabel = fuzzTarget.fuzzMode === 'preset' ? (fuzzTarget.fuzzPreset || 'none') : fuzzTarget.fuzzMode;
    resultsConsole.innerHTML += `<div style="color: var(--accent); border-bottom: 1px solid var(--border); padding: 4px 0; margin-bottom: 4px; font-weight: bold;">🎯 Fuzzing ${targetLabel}: <code>${escapeHtml(fuzzTarget.key || fuzzTarget.type)}</code> with <strong>${modeLabel}</strong> (${payloads.length} payloads)</div>`;

    for (const rawPayload of payloads) {
      const currentPayload = rawPayload.replace(/{{marker}}/g, oastDomain);

      let queryBuilder = new URLSearchParams();
      let formBodyBuilder = new URLSearchParams();
      let jsonBodyObj = {};
      let hasBody = false;
      let bodyType = 'form';
      let executionUrl = baseUrl;
      let fetchOptions = { method: 'GET', cache: 'no-store' };

      currentFuzzParameters.forEach(p => {
        const runtimeValue = (p === fuzzTarget) ? currentPayload : p.value;

        if (p.type === 'url') {
          executionUrl = buildFuzzedUrl(baseUrl, runtimeValue);
        } else if (p.type === 'path') {
          executionUrl = replacePathSegment(executionUrl, p.key, runtimeValue);
        } else if (p.type === 'query') {
          queryBuilder.append(p.key, runtimeValue);
        } else if (p.type === 'header') {
          fetchOptions.headers = fetchOptions.headers || {};
          fetchOptions.headers[p.key] = runtimeValue;
        } else if (p.type === 'body-form') {
          formBodyBuilder.append(p.key, runtimeValue);
          hasBody = true;
          bodyType = 'form';
        } else if (p.type === 'body-json') {
          jsonBodyObj[p.key] = runtimeValue;
          hasBody = true;
          bodyType = 'json';
        }
      });

      let finalQueryStr = queryBuilder.toString();
      executionUrl = appendQueryString(executionUrl, finalQueryStr);

      if (hasBody && bodyType === 'form' && formBodyBuilder.toString()) {
        fetchOptions.method = 'POST';
        fetchOptions.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
        fetchOptions.body = formBodyBuilder.toString();
      } else if (hasBody && bodyType === 'json' && Object.keys(jsonBodyObj).length > 0) {
        fetchOptions.method = 'POST';
        fetchOptions.headers = { 'Content-Type': 'application/json' };
        fetchOptions.body = JSON.stringify(jsonBodyObj);
      }

      const req = {
        method: (fetchOptions.method || 'GET').toUpperCase(),
        url: executionUrl,
        headers: fetchOptions.headers || {},
        body: fetchOptions.body || null
      };

      try {
        registerCurrentPanelTarget();
        const result = await performRequestInPage(req);

        let shouldFilter = false;
        if (useFfufAc && result.ok) {
          if (baselineStatuses.has(result.status) && (baselineSizes.has(result.bodyLength) || result.bodyLength === undefined)) {
            shouldFilter = true;
          }
        }

        if (!shouldFilter) {
          resultsConsole.innerHTML += `
              <div style="margin-bottom: 4px; padding-bottom: 2px; border-bottom: 1px dashed var(--border);">
                <span style="color: var(--text3); font-size: 10px;">[${escapeHtml(fuzzTarget.key)}]</span> Payload: <code style="color: var(--accent2); font-weight: bold;">${escapeHtml(currentPayload)}</code><br>
                ↳ <span class="meta-badge s2xx">${escapeHtml(String(result?.status || 'SENT'))}</span> <code style="color: var(--accent);">${escapeHtml(req.method)}</code> ${escapeHtml(req.url)}
              </div>`;
        }
      } catch (networkErr) {
        resultsConsole.innerHTML += `<div style="color: var(--danger); margin-bottom: 4px;">❌ Drop [${escapeHtml(fuzzTarget.key)}=${escapeHtml(currentPayload)}]: ${escapeHtml(networkErr.message)}</div>`;
      }
      resultsConsole.scrollTop = resultsConsole.scrollHeight;
      totalRequests++;

      const delayAmount = fuzzDelay > 0 ? fuzzDelay : 25;
      await delay(delayAmount);
    }
  }

  resultsConsole.innerHTML += `<br><span style="color: var(--accent2); font-weight: bold;">🏁 Complete. ${totalRequests} requests sent.</span><br>`;
  port.postMessage({ type: 'set_fuzz_replay_active', active: false });
}
function initEndpointsTab() {
  document.getElementById("ep-search").addEventListener("input", renderEndpointsList);
  document.getElementById("ep-domain-filter").addEventListener("change", renderEndpointsList);

  const sensBtn = document.getElementById("ep-sensitive-btn");
  sensBtn.addEventListener("click", () => {
    sensBtn.classList.toggle("active");
    renderEndpointsList();
  });
  document.querySelectorAll("#tag-filters .tag-filter").forEach(btn => {
    btn.addEventListener("click", () => {
      btn.classList.toggle("active");
      renderEndpointsList();
    });
  });

  document.getElementById("ep-clear-btn").addEventListener("click", clearEndpoints);

  document.getElementById("ep-export-btn").addEventListener("click", () => {
    if (activeEndpoints.length === 0) return alert("No discovered endpoints to export.");
    const blob = new Blob([JSON.stringify(activeEndpoints, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "discovered-endpoints.json";
    a.click();
  });

  document.getElementById("ep-export-urls-btn").addEventListener("click", () => {
    const urls = activeEndpoints.map(e => e.url).join("\n");
    if (!urls) return alert("No paths to copy.");
    copyToClipboard(urls, "Endpoints copied to clipboard!");
  });
}

function loadEndpointsFromStorage() {
  browser.storage.local.get(['endpoints']).then(data => {
    activeEndpoints = data.endpoints || [];
    applyRequestFilters();
  });
}

function renderEndpointsList() {
  const container = document.getElementById("endpoint-list");
  const query = document.getElementById("ep-search").value.toLowerCase();
  const domain = document.getElementById("ep-domain-filter").value;
  const showOnlySensitive = document.getElementById("ep-sensitive-btn").classList.contains("active");
  const activeTags = [];
  document.querySelectorAll("#tag-filters .tag-filter.active").forEach(btn => {
    activeTags.push(btn.getAttribute("data-tag"));
  });

  const filtered = activeEndpoints.filter(ep => {
    const matchesQuery = ep.url.toLowerCase().includes(query) || ep.method.toLowerCase().includes(query);
    let matchesDomain = true;
    if (domain !== "all") {
      try { matchesDomain = new URL(ep.url).origin === domain; } catch { matchesDomain = false; }
    }
    const matchesSensitive = !showOnlySensitive || ep.sensitive;

    let matchesTags = true;
    if (activeTags.length > 0) {
      matchesTags = activeTags.some(t => ep.tags && ep.tags[t]);
    }

    return matchesQuery && matchesDomain && matchesSensitive && matchesTags;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🎯</div>
        <div>No matching discovered endpoints found</div>
      </div>`;
    return;
  }

  container.innerHTML = "";
  filtered.forEach(ep => {
    const item = document.createElement("div");
    item.className = `ep-item ${ep.sensitive ? 'sensitive' : ''}`;

    let tagBadges = "";
    if (ep.tags) {
      Object.entries(ep.tags).forEach(([tag, val]) => {
        if (val) tagBadges += `<span class="ep-tag ${tag}">${tag.toUpperCase()}</span>`;
      });
    }

    item.innerHTML = `
      <div class="ep-header">
        <div>
          <span class="ep-method ${ep.method}">${ep.method}</span>
          ${ep.sensitive ? '<span class="sensitive-badge">SENSITIVE</span>' : ''}
        </div>
        <div class="ep-tags">${tagBadges}</div>
      </div>
      <div class="ep-url">${escapeHtml(ep.url)}</div>
      ${ep.params && ep.params.length > 0 ? `<div class="ep-params">Params: ${escapeHtml(ep.params.join(', '))}</div>` : ''}
      <div class="ep-meta">
        <span>Seen: ${ep.count}x</span>
        <span>Status: ${ep.status || '---'}</span>
        <span>Last: ${new Date(ep.lastSeen).toLocaleTimeString()}</span>
      </div>
    `;
    item.addEventListener("click", () => {
      document.getElementById("tab-btn-requests").click();
      document.querySelector('[data-detail="attack"]').click();
      document.getElementById("replay-method").value = ep.method;
      document.getElementById("fuzz-url").value = ep.url;
      document.getElementById("replay-body").value = "";

      let headerStr = "";
      if (ep.latestValues) {
        let paramsArr = [];
        Object.entries(ep.latestValues).forEach(([k, v]) => paramsArr.push(`${k}=${v}`));
        if (ep.method === "GET" && paramsArr.length > 0) {
          document.getElementById("fuzz-url").value = `${ep.url}?${paramsArr.join('&')}`;
        } else if (paramsArr.length > 0) {
          headerStr = "Content-Type: application/x-www-form-urlencoded\\n";
          document.getElementById("replay-body").value = paramsArr.join('&');
        }
      }
      document.getElementById("replay-headers").value = headerStr;
    });

    container.appendChild(item);
  });
}

function clearEndpoints() {
  browser.runtime.sendMessage({ action: "clear-endpoints" });
  activeEndpoints = [];
  applyRequestFilters();
}
function initToolsTab() {
  const input = document.getElementById("tool-input");
  const output = document.getElementById("tool-output");

  document.querySelectorAll(".tool-btn[data-action]").forEach(btn => {
    btn.addEventListener("click", () => {
      const action = btn.getAttribute("data-action");
      const val = input.value;

      switch (action) {
        case "base64-encode": try { output.value = btoa(val); } catch { output.value = "Error Encoding Base64"; } break;
        case "base64-decode": try { output.value = atob(val); } catch { output.value = "Error Decoding Base64"; } break;
        case "url-encode": output.value = encodeURIComponent(val); break;
        case "url-decode": try { output.value = decodeURIComponent(val); } catch { output.value = val; } break;
        case "url-encode-all": output.value = val.split('').map(c => '%' + c.charCodeAt(0).toString(16).toUpperCase()).join(''); break;
        case "html-encode": output.value = val.replace(/[ -香<>&]/g, i => '&#' + i.charCodeAt(0) + ';'); break;
        case "html-decode": {
          const doc = new DOMParser().parseFromString(val, "text/html");
          output.value = doc.documentElement.textContent;
          break;
        }
        case "hex-encode": output.value = val.split('').map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join(' '); break;
        case "hex-decode":
          try {
            const clean = val.replace(/\\s+/g, '');
            let res = '';
            for (let i = 0; i < clean.length; i += 2) { res += String.fromCharCode(parseInt(clean.substr(i, 2), 16)); }
            output.value = res;
          } catch { output.value = "Error Decoding Hex"; }
          break;
        case "unicode-escape": output.value = val.split('').map(c => '\\\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')).join(''); break;
        case "unicode-unescape": try { output.value = JSON.parse(`"${val.replace(/"/g, '\\"')}"`); } catch { output.value = "Error Unescaping Unicode"; } break;
      }
    });
  });

  document.getElementById("tool-copy-btn").addEventListener("click", () => copyToClipboard(output.value, "Result copied!"));
  document.getElementById("tool-swap-btn").addEventListener("click", () => {
    const temp = input.value;
    input.value = output.value;
    output.value = temp;
  });
  document.getElementById("jwt-decode-btn").addEventListener("click", () => {
    const jwt = document.getElementById("jwt-input").value.trim();
    const jwtOut = document.getElementById("jwt-output");
    const parts = jwt.split('.');
    if (parts.length !== 3) {
      jwtOut.textContent = "Invalid JWT Format. Must have 3 parts separated by dots.";
      return;
    }
    try {
      const header = JSON.parse(atob(parts[0].replace(/-/g, '+').replace(/_/g, '/')));
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      jwtOut.textContent = `// HEADER\\n${JSON.stringify(header, null, 2)}\\n\\n// PAYLOAD\\n${JSON.stringify(payload, null, 2)}`;
    } catch (e) {
      jwtOut.textContent = `Error Decoding JWT Parts: ${e.message}`;
    }
  });
  document.querySelectorAll(".hash-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const algo = btn.getAttribute("data-algo");
      const txt = document.getElementById("hash-input").value;
      const hashOut = document.getElementById("hash-output");

      if (algo === "MD5") {
        hashOut.value = "MD5 not natively supported in Crypto API (use SHA-256)";
        return;
      }
      try {
        const msgBuffer = new TextEncoder().encode(txt);
        const hashBuffer = await crypto.subtle.digest(algo, msgBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        hashOut.value = hashHex;
      } catch (err) {
        hashOut.value = `Crypto Error: ${err.message}`;
      }
    });
  });
  document.getElementById("hash-copy-btn").addEventListener("click", () => {
    copyToClipboard(document.getElementById("hash-output").value, "Hash copied!");
  });
  document.getElementById("wb-quick-check").addEventListener("click", () => {
    const url = document.getElementById("wb-url-input").value;
    const resDiv = document.getElementById("wb-quick-result");
    if (!url) return;
    resDiv.textContent = "Checking...";
    fetch(`https://archive.org/wayback/available?url=${encodeURIComponent(url)}`)
      .then(res => res.json())
      .then(data => {
        const snap = data.archived_snapshots?.closest;
        if (snap?.available) {
          resDiv.innerHTML = `Available! Latest: <a href="${snap.url}" target="_blank">${snap.timestamp}</a>`;
        } else {
          resDiv.textContent = "No history archive found.";
        }
      })
      .catch(e => resDiv.textContent = "Lookup error.");
  });
}
function initResizeHandle() {
  const handle = document.getElementById("split-resize");
  const leftPanel = document.getElementById("request-list-panel");
  let isResizing = false;

  handle.addEventListener("mousedown", (e) => {
    isResizing = true;
    handle.classList.add("active");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  });

  document.addEventListener("mousemove", (e) => {
    if (!isResizing) return;
    const offsetLeft = e.clientX;
    const totalWidth = window.innerWidth;
    const percentage = (offsetLeft / totalWidth) * 100;
    if (percentage > 15 && percentage < 70) {
      leftPanel.style.width = `${percentage}%`;
    }
  });

  document.addEventListener("mouseup", () => {
    if (isResizing) {
      isResizing = false;
      handle.classList.remove("active");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
  });
}
function notifyConsole(msg) {
  const resultsConsole = document.getElementById("fuzz-results");
  if (resultsConsole && msg) {
    resultsConsole.innerHTML += `<div style="color: var(--accent2);">📋 ${msg}</div>`;
    resultsConsole.scrollTop = resultsConsole.scrollHeight;
  }
}

function copyToClipboard(text, successMessage) {
  const fallbackCopy = () => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) notifyConsole(successMessage || "Copied to clipboard!");
      else notifyConsole("Copy failed - select and copy manually.");
    } catch (err) {
      document.body.removeChild(ta);
      console.error("Clipboard copy failed", err);
      notifyConsole("Copy failed - select and copy manually.");
    }
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      notifyConsole(successMessage || "Copied to clipboard!");
    }).catch(err => {
      console.warn("Clipboard API failed, using fallback", err);
      fallbackCopy();
    });
  } else {
    fallbackCopy();
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
function initContextMenu() {
  const ctxMenu = document.getElementById("panel-ctx-menu");
  if (!ctxMenu) return;

  let ctxTarget = null; // The element the context menu was triggered on
  document.addEventListener("contextmenu", (e) => {
    const target = e.target.closest("pre, textarea");
    if (!target) {
      ctxMenu.classList.add("hidden");
      return;
    }

    e.preventDefault();
    ctxTarget = target;
    ctxMenu.style.left = `${e.clientX}px`;
    ctxMenu.style.top = `${e.clientY}px`;
    ctxMenu.classList.remove("hidden");
    requestAnimationFrame(() => {
      const rect = ctxMenu.getBoundingClientRect();
      if (rect.right > window.innerWidth) {
        ctxMenu.style.left = `${window.innerWidth - rect.width - 4}px`;
      }
      if (rect.bottom > window.innerHeight) {
        ctxMenu.style.top = `${window.innerHeight - rect.height - 4}px`;
      }
    });
  });
  document.addEventListener("click", () => {
    ctxMenu.classList.add("hidden");
  });
  document.addEventListener("scroll", () => {
    ctxMenu.classList.add("hidden");
  }, true);

    function getSelectedText() {
    if (!ctxTarget) return '';
    if (ctxTarget.tagName === 'TEXTAREA') {
      const start = ctxTarget.selectionStart;
      const end = ctxTarget.selectionEnd;
      if (start !== end) {
        return ctxTarget.value.substring(start, end);
      }
      return ctxTarget.value; // fallback: entire content
    }
    const sel = window.getSelection();
    if (sel && sel.toString().trim().length > 0) {
      return sel.toString();
    }
    return ctxTarget.textContent; // fallback: entire content
  }

    function replaceSelectedText(transformed) {
    if (!ctxTarget) return;
    if (ctxTarget.tagName === 'TEXTAREA') {
      const start = ctxTarget.selectionStart;
      const end = ctxTarget.selectionEnd;
      if (start !== end) {
        ctxTarget.value = ctxTarget.value.substring(0, start) + transformed + ctxTarget.value.substring(end);
        ctxTarget.selectionStart = start;
        ctxTarget.selectionEnd = start + transformed.length;
      } else {
        ctxTarget.value = transformed;
      }
      ctxTarget.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      const sel = window.getSelection();
      if (sel && sel.toString().trim().length > 0) {
        const fullText = ctxTarget.textContent;
        const selText = sel.toString();
        ctxTarget.textContent = fullText.replace(selText, transformed);
      } else {
        ctxTarget.textContent = transformed;
      }
    }
  }
  ctxMenu.querySelectorAll(".ctx-item").forEach(item => {
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      ctxMenu.classList.add("hidden");

      const action = item.getAttribute("data-action");
      const selectedText = getSelectedText();
      if (!selectedText) return;

      let result = selectedText;
      switch (action) {
        case "ctx-base64-encode":
          try { result = btoa(selectedText); } catch { result = "Error encoding Base64"; }
          break;
        case "ctx-base64-decode":
          try { result = atob(selectedText); } catch { result = "Error decoding Base64"; }
          break;
        case "ctx-url-encode":
          result = encodeURIComponent(selectedText);
          break;
        case "ctx-url-decode":
          try { result = decodeURIComponent(selectedText); } catch { result = selectedText; }
          break;
        case "ctx-hex-encode":
          result = selectedText.split('').map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join(' ');
          break;
        case "ctx-hex-decode":
          try {
            const clean = selectedText.replace(/\s+/g, '');
            let decoded = '';
            for (let i = 0; i < clean.length; i += 2) { decoded += String.fromCharCode(parseInt(clean.substr(i, 2), 16)); }
            result = decoded;
          } catch { result = "Error decoding Hex"; }
          break;
        case "ctx-copy":
          copyToClipboard(selectedText, "Copied to clipboard!");
          return; // Don't replace text for copy
      }

      replaceSelectedText(result);
    });
  });
}

function populateFuzzDictionary(type, interactiveUrl = "INTERACTSH_DOMAIN_HERE") {
  if (!NucleiFuzzDictionaries[type]) return;

  const formattedPayloads = NucleiFuzzDictionaries[type].map(payload => {
    return payload.replace(/{{marker}}/g, interactiveUrl);
  });

  document.getElementById("fuzz-payloads").value = formattedPayloads.join("\n");
}
function loadFavorites() {
  browser.storage.local.get(['favorites'], (data) => {
    if (data.favorites && Array.isArray(data.favorites)) {
      favorites = new Set(data.favorites);
    }
  });
}

function toggleFavorite(requestId) {
  if (favorites.has(requestId)) {
    favorites.delete(requestId);
  } else {
    favorites.add(requestId);
  }
  browser.storage.local.set({ favorites: Array.from(favorites) });
  renderRequestList();
}
function initToolsTab() {
  document.getElementById('tools-subdomains-btn')?.addEventListener('click', checkToolsSubdomains);
  document.getElementById('tools-wayback-btn')?.addEventListener('click', checkToolsWayback);
  document.getElementById('tools-vt-btn')?.addEventListener('click', checkToolsVirusTotal);
  document.getElementById('tools-intelx-btn')?.addEventListener('click', checkToolsIntelX);
  document.getElementById('tools-network-btn')?.addEventListener('click', checkToolsNetwork);
}

async function checkToolsSubdomains() {
  if (!selectedRequest) return;
  const resultsDiv = document.getElementById('tools-subdomains-results');
  resultsDiv.innerHTML = '<p style="color: var(--accent);">⏳ Enumerating subdomains...</p>';

  try {
    const domain = new URL(selectedRequest.url).hostname;
    const q = `%.${domain}`;
    const resp = await fetch(`https://crt.sh/?q=${encodeURIComponent(q)}&output=json`);
    if (!resp.ok) { resultsDiv.innerHTML = `<p style="color: var(--danger);">HTTP ${resp.status}</p>`; return; }

    const certs = await resp.json();
    const seen = new Set();
    const subs = [];
    for (const cert of certs) {
      const names = (cert.name_value || '').split('\n');
      for (const n of names) {
        const cleaned = n.replace(/^\*\./, '').trim();
        if (cleaned && !seen.has(cleaned)) {
          seen.add(cleaned);
          subs.push(cleaned);
        }
      }
    }
    subs.sort();

    if (subs.length === 0) {
      resultsDiv.innerHTML = '<p style="color: var(--text3);">No subdomains found.</p>';
      return;
    }

    resultsDiv.innerHTML = `<p style="color: var(--accent2); font-size: 11px; margin: 0 0 6px 0;">Found ${subs.length} subdomains</p><div style="display: flex; flex-direction: column; gap: 3px; max-height: 240px; overflow-y: auto;">${subs.map(s => `<a href="https://${escapeHtml(s)}" target="_blank" rel="noopener" style="color: var(--accent); text-decoration: none; font-family: var(--mono); font-size: 11px; padding: 2px 4px; border-radius: 3px;">${escapeHtml(s)}</a>`).join('')}</div>`;
  } catch (e) {
    resultsDiv.innerHTML = `<p style="color: var(--danger);">Error: ${escapeHtml(e.message)}</p>`;
  }
}

async function checkToolsWayback() {
  if (!selectedRequest) return;

  const url = selectedRequest.url;
  const resultsDiv = document.getElementById('tools-wayback-results');
  resultsDiv.innerHTML = '<p style="color: var(--accent);">⏳ Work in progress... please be patient.</p>';

  try {
    const domain = new URL(url).hostname;
    const response = await fetch(
      `https://archive.org/wayback/available?url=${encodeURIComponent(domain)}&output=json`,
      { headers: { 'Accept': 'application/json' } }
    );
    const data = await response.json();

    if (data.archived_snapshots?.closest) {
      const closest = data.archived_snapshots.closest;
      resultsDiv.innerHTML = `
        <div style="padding: 8px; background: var(--bg3); border-radius: 4px; border: 1px solid var(--border);">
          <p style="margin: 0 0 4px 0; color: var(--accent);">📅 Snapshot Found!</p>
          <p style="margin: 0 0 8px 0; font-size: 11px; color: var(--text2);">Date: <strong>${closest.timestamp}</strong></p>
          <p style="margin: 0;">
            <a href="${closest.url}" target="_blank" style="color: var(--accent2); text-decoration: none;">View Snapshot →</a>
          </p>
        </div>
      `;
    } else {
      resultsDiv.innerHTML = '<p style="color: var(--text3);">❌ No snapshots found for this domain</p>';
    }
  } catch (e) {
    resultsDiv.innerHTML = `<p style="color: var(--danger);">Error: ${escapeHtml(e.message)}</p>`;
  }
}

async function checkToolsVirusTotal() {
  if (!selectedRequest) return;

  const resultsDiv = document.getElementById('tools-vt-results');
  resultsDiv.innerHTML = '<p style="color: var(--accent);">⏳ Work in progress... please be patient.</p>';

  const data = await browser.storage.local.get(['api_keys']);
  const apiKey = data.api_keys?.virustotal;

  if (!apiKey) {
    resultsDiv.innerHTML = `
      <p style="color: var(--danger);">⚠️ API key not configured</p>
      <p style="font-size: 11px; color: var(--text3);">Go to Settings → API Keys to add your VirusTotal API key</p>
    `;
    return;
  }

  const url = selectedRequest.url;

  try {
    const response = await fetch('https://www.virustotal.com/api/v3/urls', {
      method: 'POST',
      headers: {
        'x-apikey': apiKey,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: `url=${encodeURIComponent(url)}`
    });

    if (response.ok) {
      const data = await response.json();
      resultsDiv.innerHTML = `
        <div style="padding: 8px; background: var(--bg3); border-radius: 4px; border: 1px solid var(--border);">
          <p style="margin: 0 0 4px 0; color: var(--accent);">🔍 Submission Successful</p>
          <p style="margin: 0 0 8px 0; font-size: 11px; color: var(--text2);">ID: <code style="color: var(--accent2);">${data.data.id}</code></p>
          <p style="margin: 0;">
            <a href="https://www.virustotal.com/gui/home/upload" target="_blank" style="color: var(--accent2); text-decoration: none;">View on VirusTotal →</a>
          </p>
        </div>
      `;
    } else {
      resultsDiv.innerHTML = `<p style="color: var(--danger);">Error: ${response.statusText}</p>`;
    }
  } catch (e) {
    resultsDiv.innerHTML = `<p style="color: var(--danger);">Error: ${escapeHtml(e.message)}</p>`;
  }
}

async function checkToolsIntelX() {
  if (!selectedRequest) return;

  const resultsDiv = document.getElementById('tools-intelx-results');
  resultsDiv.innerHTML = '<p style="color: var(--accent);">⏳ Work in progress... please be patient.</p>';

  const data = await browser.storage.local.get(['api_keys']);
  const apiKey = data.api_keys?.intelx;

  if (!apiKey) {
    resultsDiv.innerHTML = `
      <p style="color: var(--danger);">⚠️ API key not configured</p>
      <p style="font-size: 11px; color: var(--text3);">Go to Settings → API Keys to add your IntelX API key</p>
    `;
    return;
  }

  const url = selectedRequest.url;
  const domain = new URL(url).hostname;

  try {
    const response = await fetch(`https://intelx.io/api/1/search?term=${encodeURIComponent(domain)}`, {
      headers: {
        'x-apikey': apiKey
      }
    });

    if (response.ok) {
      const data = await response.json();
      if (data.total > 0) {
        resultsDiv.innerHTML = `
          <div style="padding: 8px; background: var(--bg3); border-radius: 4px; border: 1px solid var(--border);">
            <p style="margin: 0 0 4px 0; color: var(--accent2);">💾 Found ${data.total} results</p>
            <p style="margin: 0; font-size: 11px; color: var(--text3);">Check IntelX dashboard for details</p>
          </div>
        `;
      } else {
        resultsDiv.innerHTML = '<p style="color: var(--text3);">✅ No leaks found for this domain</p>';
      }
    } else {
      resultsDiv.innerHTML = `<p style="color: var(--danger);">Error: ${response.statusText}</p>`;
    }
  } catch (e) {
    resultsDiv.innerHTML = `<p style="color: var(--danger);">Error: ${escapeHtml(e.message)}</p>`;
  }
}

async function checkToolsNetwork() {
  if (!selectedRequest) return;

  const url = selectedRequest.url;
  const domain = new URL(url).hostname;
  const resultsDiv = document.getElementById('tools-network-results');
  resultsDiv.innerHTML = '<p style="color: var(--accent);">⏳ Work in progress... please be patient.</p>';

  try {
    const response = await fetch(`https://ipapi.co/${domain}/json/`);
    const data = await response.json();

    resultsDiv.innerHTML = `
      <div style="padding: 8px; background: var(--bg3); border-radius: 4px; border: 1px solid var(--border); font-size: 11px;">
        <p style="margin: 4px 0; color: var(--accent);"><strong>🌐 Network Information</strong></p>
        <p style="margin: 4px 0;">IP: <code style="color: var(--accent2);">${data.ip || 'N/A'}</code></p>
        <p style="margin: 4px 0;">ASN: <code style="color: var(--accent2);">${data.asn || 'N/A'}</code></p>
        <p style="margin: 4px 0;">Organization: <code style="color: var(--accent2);">${data.org || 'N/A'}</code></p>
        <p style="margin: 4px 0;">Country: <code style="color: var(--accent2);">${data.country_name || 'N/A'}</code></p>
        <p style="margin: 4px 0;">City: <code style="color: var(--accent2);">${data.city || 'N/A'}</code></p>
      </div>
    `;
  } catch (e) {
    resultsDiv.innerHTML = `<p style="color: var(--danger);">Error: ${escapeHtml(e.message)}</p>`;
  }
}