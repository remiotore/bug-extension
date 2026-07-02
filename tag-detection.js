var TAG_DETECTION = {
  SENSITIVE_PATHS: [],
  SENSITIVE_PARAMS: [],
  SENSITIVE_METHODS: [],
  TAG_RULES: {
    xss: { params: [], methods: [] },
    sqli: { params: [], methods: [] },
    lfi: { params: [], paths: [], methods: [] },
    idor: { params: [], methods: [] },
    rce: { params: [], methods: [] },
    ssrf: { params: [], methods: [] },
    auth: { paths: [], methods: [], params: [] }
  },
  TAG_ICONS: {}
};

async function initTagDetection() {
  try {
    const data = await browser.storage.local.get('custom_tags_json');
    if (data.custom_tags_json) {
      TAG_DETECTION = JSON.parse(data.custom_tags_json);
      return;
    }
  } catch (e) {
    console.error('Failed to parse custom tags JSON', e);
  }

  try {
    const url = browser.runtime.getURL('tag-detection.json');
    const res = await fetch(url);
    TAG_DETECTION = await res.json();
  } catch (e) {
    console.error('Failed to load default tag-detection.json', e);
  }
}
initTagDetection();

function extractParamsFromUrl(urlStr) {
  const params = new Set();
  try {
    const url = new URL(urlStr);
    url.searchParams.forEach((_v, k) => params.add(k));
    url.pathname.split('/').forEach(segment => {
      if (!segment || !segment.includes('=')) return;
      const [keyPart] = segment.split('=');
      if (keyPart) params.add(keyPart);
    });
  } catch (e) {}
  return Array.from(params);
}

function extractParamsFromBody(body) {
  const params = new Set();
  if (!body || typeof body !== 'string') return [];
  const trimmed = body.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        Object.keys(parsed).forEach(k => params.add(k));
      }
    } catch (e) {}
  }

  if (trimmed.includes('=')) {
    try { new URLSearchParams(trimmed).forEach((_v, k) => params.add(k)); } catch (e) {}
  }
  return Array.from(params);
}

function extractRequestParams(urlStr, body) {
  const all = new Set([...extractParamsFromUrl(urlStr), ...extractParamsFromBody(body)]);
  return Array.from(all);
}

function isSensitiveEndpoint(url, method, params) {
  let urlObj;
  try { urlObj = new URL(url); } catch { return false; }
  const path = urlObj.pathname.toLowerCase();
  const upperMethod = (method || 'GET').toUpperCase();
  if (TAG_DETECTION.SENSITIVE_METHODS.includes(upperMethod)) return true;
  if (TAG_DETECTION.SENSITIVE_PATHS.some(p => path.includes(p))) return true;
  if ((params || []).some(p => TAG_DETECTION.SENSITIVE_PARAMS.includes(String(p).toLowerCase()))) return true;
  return false;
}

function detectTags(url, method, params = [], status = 0, responseHeaders = []) {
  let urlObj;
  try { urlObj = new URL(url); } catch { return {}; }
  const path = urlObj.pathname.toLowerCase();
  const upperMethod = (method || 'GET').toUpperCase();
  const lowerParams = (params || []).map(p => String(p || '').toLowerCase());
  
  const R = TAG_DETECTION.TAG_RULES;
  const xssDetected = R.xss.methods.includes(upperMethod) && lowerParams.some(p => R.xss.params.map(x => x.toLowerCase()).includes(p));
  const sqliDetected = R.sqli.methods.includes(upperMethod) && lowerParams.some(p => R.sqli.params.map(x => x.toLowerCase()).includes(p));
  const lfiDetected = R.lfi.methods.includes(upperMethod) && (lowerParams.some(p => R.lfi.params.map(x => x.toLowerCase()).includes(p)) || R.lfi.paths.some(p => path.includes(p)));
  const idorDetected = R.idor.methods.includes(upperMethod) && (lowerParams.some(p => R.idor.params.map(x => x.toLowerCase()).includes(p)) || /\/\d+/.test(path));
  const rceDetected = R.rce.methods.includes(upperMethod) && lowerParams.some(p => R.rce.params.map(x => x.toLowerCase()).includes(p));
  const ssrfDetected = R.ssrf.methods.includes(upperMethod) && lowerParams.some(p => R.ssrf.params.map(x => x.toLowerCase()).includes(p));
  const authDetected = R.auth.paths.some(p => path.includes(p)) || R.auth.methods.includes(upperMethod) || lowerParams.some(p => R.auth.params.map(x => x.toLowerCase()).includes(p)) || status === 403 || status === 401;

  return { xss: !!xssDetected, sqli: !!sqliDetected, lfi: !!lfiDetected, idor: !!idorDetected, rce: !!rceDetected, ssrf: !!ssrfDetected, auth: !!authDetected };
}

function getRequestFindingsFromData(url, method, body, statusCode, responseHeaders) {
  const params = extractRequestParams(url, body);
  const tags = detectTags(url, method, params, statusCode || 0, responseHeaders || []);
  const findings = [];
  if (isSensitiveEndpoint(url, method, params)) findings.push('sensitive');
  Object.entries(tags).forEach(([tag, value]) => { if (value) findings.push(tag); });
  return findings;
}
