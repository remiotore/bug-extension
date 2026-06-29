// ============================================================
// Bug Extension – Panel Script (panel.js)
// Controls UI interactivity, tab switching, encoding tools,
// request capture visualization, replaying, and endpoint hunting.
// ============================================================

// ── Shared State ──
let capturedRequests = [];
let filteredRequests = [];
let selectedRequest = null;
let isPaused = false;
let activeTheme = 'dark';
let activeEndpoints = [];

// Connect to background script
const port = browser.runtime.connect({ name: "bug-panel" });

// ── DOM Initialization & Event Listeners ──
document.addEventListener("DOMContentLoaded", () => {
  initTabs();
  initTheme();
  initRequestTab();
  initEndpointsTab();
  initToolsTab();
  initResizeHandle();
  initContextMenu();

  // Load initial data
  loadEndpointsFromStorage();

  // Listen for storage changes to sync endpoints
  browser.storage.onChanged.addListener((changes) => {
    if (changes.endpoints) {
      loadEndpointsFromStorage();
    }
  });
});

// Listen for messages from background script via Port
port.onMessage.addListener((msg) => {
  if (isPaused) return;

  if (msg.type === 'captured_request') {
    const req = msg.data;
    capturedRequests.push(req);
    updateRequestCountBadge();
    updateDomainFilters(req.url);
    applyRequestFilters();
  }
});

// ── Tab Management ──
function initTabs() {
  // Main Top Tabs
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

  // Request Detail Tabs (Right Panel)
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

// ── Theme Management ──
function initTheme() {
  const themeBtn = document.getElementById("theme-toggle");
  themeBtn.addEventListener("click", () => {
    activeTheme = activeTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute("data-theme", activeTheme);
    themeBtn.textContent = activeTheme === 'dark' ? '🌙' : '☀️';
  });

  // Global Clear Button
  document.getElementById("clear-all-btn").addEventListener("click", () => {
    if (confirm("Clear all captured requests and endpoints?")) {
      clearRequests();
      clearEndpoints();
    }
  });
}

// ── Request Capturing Tab Logic ──
function initRequestTab() {
  document.getElementById("req-search").addEventListener("input", applyRequestFilters);
  document.getElementById("req-method-filter").addEventListener("change", applyRequestFilters);
  document.getElementById("req-status-filter").addEventListener("change", applyRequestFilters);
  document.getElementById("req-param-filter").addEventListener("change", applyRequestFilters);
  document.getElementById("req-domain-filter").addEventListener("change", applyRequestFilters);

  const pauseBtn = document.getElementById("req-pause-btn");
  pauseBtn.addEventListener("click", () => {
    isPaused = !isPaused;
    pauseBtn.textContent = isPaused ? "▶️" : "⏸️";
    pauseBtn.title = isPaused ? "Resume capture" : "Pause capture";
    pauseBtn.classList.toggle("active", isPaused);
  });

  document.getElementById("req-clear-btn").addEventListener("click", clearRequests);

  document.getElementById("req-export-btn").addEventListener("click", () => {
    const urls = capturedRequests.map(r => r.url).join("\n");
    if (!urls) return alert("No requests to export!");
    copyToClipboard(urls, "URLs exported to clipboard!");
  });

  // Code Generation Copy Buttons
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

  // Replay Send Button
  document.getElementById("replay-send-btn").addEventListener("click", executeReplay);

  // Fuzzing: Wire up the interactive fuzzer component controls safely
  const addParamBtn = document.getElementById("fuzz-add-param-btn");
  const startFuzzBtn = document.getElementById("fuzz-start-btn");

  if (addParamBtn) addParamBtn.addEventListener("click", addNewBlankParameterRow);
  if (startFuzzBtn) startFuzzBtn.addEventListener("click", executeAttackMatrixPipeline);

  // Wayback Check Button
  document.getElementById("wayback-check-btn").addEventListener("click", checkWayback);
  document.getElementById("wayback-open-btn").addEventListener("click", () => {
    const url = document.getElementById("wayback-url-input").value;
    if (url) window.open(`https://web.archive.org/web/*/${encodeURIComponent(url)}`, '_blank');
  });
}

function updateRequestCountBadge() {
  document.getElementById("request-count").textContent = capturedRequests.length;
}

function updateDomainFilters(urlStr) {
  try {
    const url = new URL(urlStr);
    const select = document.getElementById("req-domain-filter");
    const epSelect = document.getElementById("ep-domain-filter");

    // Check if domain already exists in list
    let exists = false;
    for (let i = 0; i < select.options.length; i++) {
      if (select.options[i].value === url.origin) { exists = true; break; }
    }

    if (!exists) {
      const opt1 = new Option(url.hostname, url.origin);
      const opt2 = new Option(url.hostname, url.origin);
      select.add(opt1);
      epSelect.add(opt2);
    }
  } catch (e) { }
}

function applyRequestFilters() {
  const query = document.getElementById("req-search").value.toLowerCase();
  const method = document.getElementById("req-method-filter").value;
  const domain = document.getElementById("req-domain-filter").value;

  // Fetch value selections from our new filters
  const statusFilter = document.getElementById("req-status-filter").value; // e.g., "all", "2xx", "4xx"
  const paramFilter = document.getElementById("req-param-filter").value;   // e.g., "all", "has-params"

  filteredRequests = capturedRequests.filter(r => {
    // 1. Core Text/Query search mapping
    const matchesQuery = r.url.toLowerCase().includes(query) ||
      String(r.statusCode || '').includes(query) ||
      r.method.toLowerCase().includes(query);

    // 2. HTTP Method Filter
    const matchesMethod = method === "all" || r.method === method;

    // 3. Domain/Origin Filter
    let matchesDomain = true;
    if (domain !== "all") {
      try { matchesDomain = new URL(r.url).origin === domain; } catch { matchesDomain = false; }
    }

    // 4. Status Code Range Evaluation
    let matchesStatus = true;
    if (statusFilter !== "all") {
      const statusCode = r.statusCode;
      if (!statusCode) {
        matchesStatus = false;
      } else {
        const structuralRange = statusFilter[0]; // Gets '1', '2', '3', '4', or '5'
        const rangeFloor = parseInt(structuralRange) * 100;
        const rangeCeiling = rangeFloor + 99;
        matchesStatus = statusCode >= rangeFloor && statusCode <= rangeCeiling;
      }
    }

    // 5. Parameter Presence Evaluation (Detects URL queries or POST/PUT bodies)
    let matchesParams = true;
    if (paramFilter !== "all") {
      let hasParameters = false;

      if (r.url.includes("?") && r.url.split("?")[1] !== "") {
        hasParameters = true;
      }
      if (r.requestBody && r.requestBody.trim().length > 0) {
        hasParameters = true;
      }

      matchesParams = (paramFilter === "has-params") ? hasParameters : !hasParameters;
    }

    return matchesQuery && matchesMethod && matchesDomain && matchesStatus && matchesParams;
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
    item.className = `req-item ${selectedRequest && selectedRequest.requestId === req.requestId ? 'selected' : ''}`;

    let statusClass = "s2xx";
    if (req.statusCode >= 300 && req.statusCode < 400) statusClass = "s3xx";
    if (req.statusCode >= 400 && req.statusCode < 500) statusClass = "s4xx";
    if (req.statusCode >= 500) statusClass = "s5xx";

    item.innerHTML = `
      <span class="req-method ${req.method}">${req.method}</span>
      <span class="req-url" title="${escapeHtml(req.url)}">${escapeHtml(req.url)}</span>
      <span class="req-status ${statusClass}">${req.statusCode || '---'}</span>
      <span class="req-type">${escapeHtml(req.type || '')}</span>
    `;

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

  // Enable copy action buttons
  document.getElementById("copy-curl-btn").removeAttribute("disabled");
  document.getElementById("copy-python-btn").removeAttribute("disabled");
  document.getElementById("copy-fetch-btn").removeAttribute("disabled");

  // Format Request view
  let reqText = `${req.method} ${req.url}\n`;
  if (req.requestHeaders) {
    req.requestHeaders.forEach(h => { reqText += `${h.name}: ${h.value}\n`; });
  }
  if (req.requestBody) {
    reqText += `\n${req.requestBody}`;
  }
  document.getElementById("request-display").textContent = reqText;

  // Format Response meta & headers view
  const respMeta = document.getElementById("response-meta");
  let statusClass = "s2xx";
  if (req.statusCode >= 400) statusClass = "s4xx";
  respMeta.innerHTML = `<span class="meta-badge ${statusClass}">Status: ${req.statusCode}</span>`;

  let respText = `${req.statusLine || ''}\n`;
  if (req.responseHeaders) {
    req.responseHeaders.forEach(h => { respText += `${h.name}: ${h.value}\n`; });
  }
  document.getElementById("response-display").textContent = respText;

  // Populate Replay Panel fields
  document.getElementById("replay-method").value = req.method;
  document.getElementById("replay-url").value = req.url;

  let headersString = "";
  if (req.requestHeaders) {
    req.requestHeaders.forEach(h => { headersString += `${h.name}: ${h.value}\n`; });
  }
  document.getElementById("replay-headers").value = headersString;
  document.getElementById("replay-body").value = req.requestBody || "";

  // Populate Fuzzer input field
  setupFuzzerTabFromSelectedRequest(req);
  document.getElementById("fuzz-url").value = req.url;

  // Populate Wayback URL input field
  document.getElementById("wayback-url-input").value = req.url;
}

function clearRequests() {
  capturedRequests = [];
  filteredRequests = [];
  selectedRequest = null;
  updateRequestCountBadge();
  applyRequestFilters();

  document.getElementById("request-display").textContent = "Select a request from the list";
  document.getElementById("response-display").textContent = "Select a request to see its response";
  document.getElementById("response-meta").innerHTML = "";

  document.getElementById("copy-curl-btn").setAttribute("disabled", "true");
  document.getElementById("copy-python-btn").setAttribute("disabled", "true");
  document.getElementById("copy-fetch-btn").setAttribute("disabled", "true");
}

// ── Replay Functionality ──
function executeReplay() {
  const method = document.getElementById("replay-method").value;
  const url = document.getElementById("replay-url").value;
  const headersRaw = document.getElementById("replay-headers").value;
  const body = document.getElementById("replay-body").value;
  const respDisplay = document.getElementById("replay-response");
  const metaDisplay = document.getElementById("replay-response-meta");

  respDisplay.textContent = "Sending request...";
  metaDisplay.innerHTML = "";

  const headers = {};
  headersRaw.split("\n").forEach(line => {
    const idx = line.indexOf(":");
    if (idx !== -1) {
      const name = line.substring(0, idx).trim();
      const val = line.substring(idx + 1).trim();
      if (name) headers[name] = val;
    }
  });

  const options = { method, headers };
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase()) && body) {
    options.body = body;
  }

  fetch(url, options)
    .then(async response => {
      const statusText = `Status: ${response.status} ${response.statusText}`;
      let statusClass = response.ok ? "s2xx" : "s4xx";
      metaDisplay.innerHTML = `<span class="meta-badge ${statusClass}">${statusText}</span>`;

      let headerStr = "";
      for (let [key, value] of response.headers.entries()) {
        headerStr += `${key}: ${value}\n`;
      }

      const text = await response.text();
      respDisplay.textContent = `${headerStr}\n${text}`;
    })
    .catch(err => {
      metaDisplay.innerHTML = `<span class="meta-badge s4xx">Error</span>`;
      respDisplay.textContent = `Replay Failed: ${err.message}`;
    });
}

// ── Active fuzzing ──// ============================================================================
// ⚡ CORE INTERACTIVE FUZZER AND TARGET PLANNER ENGINE
// ============================================================================

let currentFuzzParameters = [];

/**
 * Helper: generate the <option> tags for dictionary selectors
 */
function buildDictionaryOptionsHtml(selectedValue) {
  const presets = [
    { value: '', label: '-- None --' },
    { value: 'cmdi', label: '🐚 CMDi' },
    { value: 'lfi', label: '📂 LFI' },
    { value: 'xss', label: '🎨 XSS' },
    { value: 'sqli', label: '🗄️ SQLi' },
    { value: 'nosqli', label: '🧩 NoSQLi' },
    { value: 'ssrf', label: '🌐 SSRF' },
    { value: 'ssti', label: '🧩 SSTI' },
    { value: 'xxe', label: '📜 XXE' },
    { value: 'open_redirect', label: '↪️ Redirect' },
    { value: 'crlf', label: '↩️ CRLF' },
    { value: 'prototype_pollution', label: '🧬 Proto' },
    { value: 'rce_deserialization', label: '⚡ RCE' },
    { value: 'idor', label: '🔑 IDOR' },
    { value: 'hidden_params', label: '⚙️ Params' },
    { value: 'csv', label: '📊 CSV' },
    { value: 'business_logic_hpp', label: '💰 HPP' },
  ];
  return presets.map(p => `<option value="${p.value}" ${p.value === selectedValue ? 'selected' : ''}>${p.label}</option>`).join('');
}

/**
 * Parses query strings or payload bodies from selected requests into our checkboxes workspace
 */
function setupFuzzerTabFromSelectedRequest(req) {
  if (!req) return;

  let baseSplit = req.url.split('?');
  document.getElementById("fuzz-url").value = baseSplit[0];
  currentFuzzParameters = [];

  // Parse URL queries (?id=1&user=admin) – default unchecked (not fuzz)
  if (baseSplit.length > 1) {
    let searchParams = new URLSearchParams(baseSplit[1]);
    for (let [key, value] of searchParams.entries()) {
      currentFuzzParameters.push({ type: 'query', key: key, value: value, active: false, dictionary: '' });
    }
  }

  // Parse body properties based on Content-Type structures
  if (req.requestBody && req.requestBody.trim().length > 0) {
    let bodyStr = req.requestBody.trim();
    if (bodyStr.startsWith('{')) {
      try {
        let json = JSON.parse(bodyStr);
        for (let [key, value] of Object.entries(json)) {
          currentFuzzParameters.push({ type: 'body-json', key: key, value: String(value), active: false, dictionary: '' });
        }
      } catch (e) { }
    } else {
      let bodyParams = new URLSearchParams(bodyStr);
      for (let [key, value] of bodyParams.entries()) {
        currentFuzzParameters.push({ type: 'body-form', key: key, value: value, active: false, dictionary: '' });
      }
    }
  }

  renderFuzzerParameterMatrixRows();
}

/**
 * Draws the editable targeted input options grid tracking parameters inside memory arrays.
 * Each row: [checkbox:fuzz] [type badge] [key input] [value input] [dictionary dropdown] [✕ delete]
 */
function renderFuzzerParameterMatrixRows() {
  const container = document.getElementById("fuzz-param-list-container");
  if (!container) return;

  if (currentFuzzParameters.length === 0) {
    container.innerHTML = `<div class="empty-hint" style="text-align: center; margin-top: 20px;">No variables identified. Click "+ Add Param" to add custom rows.</div>`;
    return;
  }

  container.innerHTML = "";
  currentFuzzParameters.forEach((param, index) => {
    const row = document.createElement("div");
    row.style.cssText = "display: flex; gap: 4px; align-items: center; background: var(--bg3); padding: 4px; border-radius: var(--radius); border: 1px solid var(--border); margin-bottom: 2px;";

    const checkedAttr = param.active ? 'checked' : '';
    const rowOpacity = param.active ? '1' : '0.6';

    row.innerHTML = `
      <input type="checkbox" id="fuzz-chk-${index}" ${checkedAttr} style="margin: 0; cursor: pointer;" title="Check to fuzz this parameter">
      <span style="font-size: 9px; padding: 1px 4px; border-radius: 4px; background: var(--bg4); font-family: var(--mono); color: var(--text2); min-width: 50px; text-align: center;">${param.type}</span>
      <input type="text" value="${escapeHtml(param.key)}" id="fuzz-key-${index}" style="flex: 0.8; height: 18px; font-size: 11px; background: var(--bg); border: 1px solid var(--border); color: var(--accent); padding: 0 4px; border-radius: 4px; font-family: var(--mono); margin: 0;">
      <input type="text" value="${escapeHtml(param.value)}" id="fuzz-val-${index}" style="flex: 1.2; height: 18px; font-size: 11px; background: var(--bg); border: 1px solid var(--border); color: var(--text); padding: 0 4px; border-radius: 4px; font-family: var(--mono); margin: 0; opacity: ${rowOpacity};">
      <select id="fuzz-dict-${index}" style="flex: 1.4; height: 20px; font-size: 10px; background: var(--bg); border: 1px solid ${param.active && param.dictionary ? 'var(--accent2)' : 'var(--border)'}; color: var(--text); padding: 0 2px; border-radius: 4px; font-family: sans-serif; margin: 0; cursor: pointer;" ${!param.active ? 'disabled' : ''} title="Attack dictionary for this parameter">
        ${buildDictionaryOptionsHtml(param.dictionary)}
      </select>
      <button class="tool-btn" id="fuzz-del-${index}" style="height: 18px; padding: 0 4px; font-size: 10px; color: var(--danger); background: transparent; border: none; margin: 0; cursor: pointer;" title="Remove parameter">✕</button>
    `;

    // Checkbox toggles fuzz state
    row.querySelector(`#fuzz-chk-${index}`).addEventListener("change", (e) => {
      param.active = e.target.checked;
      renderFuzzerParameterMatrixRows(); // Re-render to update visual state
    });
    row.querySelector(`#fuzz-key-${index}`).addEventListener("input", (e) => { param.key = e.target.value; });
    row.querySelector(`#fuzz-val-${index}`).addEventListener("input", (e) => { param.value = e.target.value; });
    row.querySelector(`#fuzz-dict-${index}`).addEventListener("change", (e) => { param.dictionary = e.target.value; });
    row.querySelector(`#fuzz-del-${index}`).addEventListener("click", () => {
      currentFuzzParameters.splice(index, 1);
      renderFuzzerParameterMatrixRows();
    });

    container.appendChild(row);
  });
}

function addNewBlankParameterRow() {
  currentFuzzParameters.push({ type: 'query', key: 'param_name', value: 'test_value', active: false, dictionary: '' });
  renderFuzzerParameterMatrixRows();
}

/**
 * Attack Loop Handler: Iterates per-parameter dictionaries and fires requests.
 * Each active parameter uses its own dictionary. Payloads are iterated for each
 * fuzzed param independently (one param fuzzed at a time, others keep original values).
 */
async function executeAttackMatrixPipeline() {
  const baseUrl = document.getElementById("fuzz-url").value.trim();
  const oastDomain = document.getElementById("fuzz-oast-domain").value.trim() || "interact.sh";
  const resultsConsole = document.getElementById("fuzz-results");

  if (!baseUrl) {
    alert("Please provide a Base Target URL destination path.");
    return;
  }

  const targetParameters = currentFuzzParameters.filter(p => p.active && p.key.trim().length > 0);
  if (targetParameters.length === 0) {
    alert("Please check at least one parameter to fuzz and select a dictionary.");
    return;
  }

  // Validate that all fuzzed params have a dictionary selected
  const missingDict = targetParameters.filter(p => !p.dictionary);
  if (missingDict.length > 0) {
    alert(`Please select a dictionary for: ${missingDict.map(p => p.key).join(', ')}`);
    return;
  }

  resultsConsole.innerHTML = `<span style="color: var(--accent);">⚡ Running attack loop cycles against ${targetParameters.length} parameter(s)...</span><br><br>`;

  let totalRequests = 0;

  // For each active parameter, iterate its dictionary payloads
  for (const fuzzTarget of targetParameters) {
    const payloads = NucleiFuzzDictionaries[fuzzTarget.dictionary];
    if (!payloads || payloads.length === 0) continue;

    resultsConsole.innerHTML += `<div style="color: var(--accent); border-bottom: 1px solid var(--border); padding: 4px 0; margin-bottom: 4px; font-weight: bold;">🎯 Fuzzing param: <code>${escapeHtml(fuzzTarget.key)}</code> with <strong>${fuzzTarget.dictionary}</strong> (${payloads.length} payloads)</div>`;

    for (const rawPayload of payloads) {
      const currentPayload = rawPayload.replace(/{{marker}}/g, oastDomain);

      let queryBuilder = new URLSearchParams();
      let formBodyBuilder = new URLSearchParams();
      let jsonBodyObj = {};
      let hasBody = false;
      let bodyType = 'form';

      currentFuzzParameters.forEach(p => {
        // Use payload for the current fuzz target, original value for everything else
        const runtimeValue = (p === fuzzTarget) ? currentPayload : p.value;

        if (p.type === 'query') {
          queryBuilder.append(p.key, runtimeValue);
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
      let executionUrl = baseUrl + (finalQueryStr ? '?' + finalQueryStr : '');
      let fetchOptions = { method: 'GET', cache: 'no-store' };

      if (hasBody && bodyType === 'form' && formBodyBuilder.toString()) {
        fetchOptions.method = 'POST';
        fetchOptions.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
        fetchOptions.body = formBodyBuilder.toString();
      } else if (hasBody && bodyType === 'json' && Object.keys(jsonBodyObj).length > 0) {
        fetchOptions.method = 'POST';
        fetchOptions.headers = { 'Content-Type': 'application/json' };
        fetchOptions.body = JSON.stringify(jsonBodyObj);
      }

      try {
        const startClock = performance.now();
        const response = await fetch(executionUrl, fetchOptions);
        const latency = Math.round(performance.now() - startClock);
        const responseBody = await response.text();

        let statusBadgeClass = "s2xx";
        if (response.status >= 300 && response.status < 400) statusBadgeClass = "s3xx";
        if (response.status >= 400 && response.status < 500) statusBadgeClass = "s4xx";
        if (response.status >= 500) statusBadgeClass = "s5xx";

        resultsConsole.innerHTML += `
          <div style="margin-bottom: 4px; padding-bottom: 2px; border-bottom: 1px dashed var(--border);">
            <span style="color: var(--text3); font-size: 10px;">[${escapeHtml(fuzzTarget.key)}]</span> Payload: <code style="color: var(--accent2); font-weight: bold;">${escapeHtml(currentPayload)}</code><br>
            ↳ <span class="meta-badge ${statusBadgeClass}">HTTP ${response.status}</span> | Length: <strong>${responseBody.length}b</strong> | Latency: <strong>${latency}ms</strong>
          </div>`;
      } catch (networkErr) {
        resultsConsole.innerHTML += `<div style="color: var(--danger); margin-bottom: 4px;">❌ Drop [${escapeHtml(fuzzTarget.key)}=${escapeHtml(currentPayload)}]: ${escapeHtml(networkErr.message)}</div>`;
      }
      resultsConsole.scrollTop = resultsConsole.scrollHeight;
      totalRequests++;
    }
  }

  resultsConsole.innerHTML += `<br><span style="color: var(--accent2); font-weight: bold;">🏁 Complete. ${totalRequests} requests sent.</span><br>`;
}

// ── Wayback Machine Lookup ──
function checkWayback() {
  const url = document.getElementById("wayback-url-input").value;
  const resultsContainer = document.getElementById("wayback-results");
  if (!url) return alert("Please specify a URL");

  resultsContainer.innerHTML = "Checking Internet Archive availability...";

  fetch(`https://archive.org/wayback/available?url=${encodeURIComponent(url)}`)
    .then(res => res.json())
    .then(data => {
      const snapshot = data.archived_snapshots?.closest;
      if (snapshot && snapshot.available) {
        resultsContainer.innerHTML = `
          <div class="wb-snapshot">
            <div>
              <div><strong>Snapshot Found!</strong></div>
              <a href="${snapshot.url}" target="_blank">${snapshot.url}</a>
            </div>
            <span class="wb-date">${snapshot.timestamp}</span>
          </div>`;
      } else {
        resultsContainer.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">❌</div>
            <div>No snapshots found for this URL.</div>
          </div>`;
      }
    })
    .catch(err => {
      resultsContainer.innerHTML = `<div class="empty-state">Error querying Wayback API: ${err.message}</div>`;
    });
}

// ── Endpoints Hunting Tab Logic ──
function initEndpointsTab() {
  document.getElementById("ep-search").addEventListener("input", renderEndpointsList);
  document.getElementById("ep-domain-filter").addEventListener("change", renderEndpointsList);

  const sensBtn = document.getElementById("ep-sensitive-btn");
  sensBtn.addEventListener("click", () => {
    sensBtn.classList.toggle("active");
    renderEndpointsList();
  });

  // Tag filter toggle behavior
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
    renderEndpointsList();
  });
}

function renderEndpointsList() {
  const container = document.getElementById("endpoint-list");
  const query = document.getElementById("ep-search").value.toLowerCase();
  const domain = document.getElementById("ep-domain-filter").value;
  const showOnlySensitive = document.getElementById("ep-sensitive-btn").classList.contains("active");

  // Find active tag filters
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

    // Clicking an endpoint seeds the Replay system
    item.addEventListener("click", () => {
      document.getElementById("tab-btn-requests").click();
      document.querySelector('[data-detail="replay"]').click();
      document.getElementById("replay-method").value = ep.method;
      document.getElementById("replay-url").value = ep.url;
      document.getElementById("replay-body").value = "";

      let headerStr = "";
      if (ep.latestValues) {
        let paramsArr = [];
        Object.entries(ep.latestValues).forEach(([k, v]) => paramsArr.push(`${k}=${v}`));
        if (ep.method === "GET" && paramsArr.length > 0) {
          document.getElementById("replay-url").value = `${ep.url}?${paramsArr.join('&')}`;
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
  renderEndpointsList();
}

// ── Auxiliary Security Utilities/Tools ──
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

  // JWT Decoder
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

  // Crypto Hashes Generator
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

  // Wayback Quick Checker
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

// ── Panel Resizing Handle ──
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

// ── General Utilities ──
function copyToClipboard(text, successMessage) {
  navigator.clipboard.writeText(text).then(() => {
    alert(successMessage || "Copied to clipboard!");
  }).catch(err => {
    console.error("Clipboard copy failed", err);
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ── Context Menu for Encode/Decode ──
function initContextMenu() {
  const ctxMenu = document.getElementById("panel-ctx-menu");
  if (!ctxMenu) return;

  let ctxTarget = null; // The element the context menu was triggered on

  // Show context menu on right-click over pre and textarea elements
  document.addEventListener("contextmenu", (e) => {
    const target = e.target.closest("pre, textarea");
    if (!target) {
      ctxMenu.classList.add("hidden");
      return;
    }

    e.preventDefault();
    ctxTarget = target;

    // Position the menu
    ctxMenu.style.left = `${e.clientX}px`;
    ctxMenu.style.top = `${e.clientY}px`;
    ctxMenu.classList.remove("hidden");

    // Ensure menu stays within viewport
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

  // Hide context menu on click outside
  document.addEventListener("click", () => {
    ctxMenu.classList.add("hidden");
  });

  // Hide context menu on scroll
  document.addEventListener("scroll", () => {
    ctxMenu.classList.add("hidden");
  }, true);

  /**
   * Gets the selected text from the context target element.
   * For <textarea>: uses selectionStart/selectionEnd.
   * For <pre>: uses window.getSelection().
   * Falls back to full text content if nothing is selected.
   */
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
    // For <pre> and other elements, use window.getSelection
    const sel = window.getSelection();
    if (sel && sel.toString().trim().length > 0) {
      return sel.toString();
    }
    return ctxTarget.textContent; // fallback: entire content
  }

  /**
   * Replaces the selected text in the context target with the transformed result.
   * For <textarea>: replaces between selectionStart/selectionEnd.
   * For <pre>: replaces in textContent.
   */
  function replaceSelectedText(transformed) {
    if (!ctxTarget) return;
    if (ctxTarget.tagName === 'TEXTAREA') {
      const start = ctxTarget.selectionStart;
      const end = ctxTarget.selectionEnd;
      if (start !== end) {
        ctxTarget.value = ctxTarget.value.substring(0, start) + transformed + ctxTarget.value.substring(end);
        // Re-select the transformed text
        ctxTarget.selectionStart = start;
        ctxTarget.selectionEnd = start + transformed.length;
      } else {
        ctxTarget.value = transformed;
      }
      // Trigger input event for any listeners
      ctxTarget.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      // For <pre>: replace in textContent
      const sel = window.getSelection();
      if (sel && sel.toString().trim().length > 0) {
        const fullText = ctxTarget.textContent;
        const selText = sel.toString();
        // Replace first occurrence of selected text
        ctxTarget.textContent = fullText.replace(selText, transformed);
      } else {
        ctxTarget.textContent = transformed;
      }
    }
  }

  // Handle context menu item clicks
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
    // Dynamically replace template placeholder values if necessary
    return payload.replace(/{{marker}}/g, interactiveUrl);
  });

  document.getElementById("fuzz-payloads").value = formattedPayloads.join("\n");
}