# Bug Extension

All-in-one security testing toolkit for Firefox DevTools. Captures requests, fuzzes parameters, tags endpoints, decodes payloads, and compares responses.

## Features

**Capture & Intercept**
- Real-time HTTP request capture via `webRequest` API
- Request interception with Forward/Drop/Modify controls
- Status code, method, domain, parameter, and extension filters
- Favorites/collection system
- Finding tag chips (XSS, SQLi, LFI, IDOR, RCE, SSRF, Auth, Sensitive, Interesting)

**Replay & Fuzz**
- HTTP request replay with editable method/URL/headers/body
- Parameter-based fuzzing with per-target config (preset, custom, numbers, dates, letters, wordlists)
- 16 attack presets: cmdi, lfi, xss, sqli, nosqli, ssrf, ssti, xxe, open_redirect, crlf, prototype_pollution, rce_deserialization, idor, hidden_params, csv, business_logic_hpp
- {{marker}} substitution with OAST domain for OOB detection
- FFUF-style auto-calibrate filtering
- Configurable delay between requests

**Quick Fuzz ⚡** — One-click fuzzing from any request item. Click ⚡ → pick preset (XSS, SQLi, LFI, CMDi, SSRF, SSTI, XXE, Redirect) → automatically loads and fires.

**OOB Auto-Probe 📡** — After every fuzz session, if a non-default OAST domain is set, automatically sends `nslookup`, `curl`, `ping`, `wget` probes through each target parameter for blind detection.

**Auto-Tagging**
- Tags: xss, sqli, lfi, idor, rce, ssrf, auth, sensitive
- **Keyword Highlighter 🔥** — auto-flags requests with interesting patterns (403/401/500, `/api`, `/admin`, `/debug`, `?debug=`, `?file=`, `?cmd=`, debug headers like `x-debug-`, `via:`, `x-forwarded-`)
- Endpoint storage with deduplication and metadata

**Tools**
- **Comparer 📐** — Side-by-side LCS line diff with +/-/= counts and color highlighting
- **Hex / Multi-Decoder 🔬** — Live-updating hex ladder (offset:hex:ASCII) + base64 enc/dec, URL enc/dec, HTML entities
- Subdomain enumeration via crt.sh
- Wayback Machine snapshot lookup
- VirusTotal URL scan
- IntelX leak search
- Network (IP/ASN) lookup
- Context menu: base64/URL encode/decode, hex encode/decode, copy

**Endpoint Discovery**
- Automatic endpoint extraction from captured requests
- Sensitive endpoint detection by path/param/method patterns
- Tag-based filtering
- Export endpoints to JSON

## File Structure

- `manifest.json` — Extension config, permissions, and entry points
- `background.js` — Background script: webRequest capture, context menus, storage
- `devtools.html` / `devtools.js` — DevTools panel registration
- `panel.html` — UI markup
- `panel.css` — CSS (dark/light theme)
- `panel.js` — Panel logic: capture list, fuzzer, tools, comparer, decoder
- `tag-detection.js` — Tag detection logic and data
- `tag-detection.json` — Tag detection rules (paths, params, methods by tag)
- `payloads.js` — Fuzz dictionary loader (custom storage → bundled JSON)
- `payloads.json` — Fuzz payloads by attack type
- `fuzzer-generator.js` — Dynamic payload generators (letters, numbers, dates, wordlists)
- `options/` — Extension settings page

## Loading into Firefox

1. Open `about:debugging` → This Firefox
2. Click "Load Temporary Add-on..."
3. Select `manifest.json`

The panel appears in DevTools as "Bug Extension" tab after you inspect a page.

## Debugging

- **background.js**: Inspect from `about:debugging` → extension entry → "Inspect"
- **panel.js/UI**: Right-click inside the Bug Extension panel → "Inspect Element"
- After editing `panel.js` or `panel.css`, close and reopen DevTools
- After editing `background.js` or `manifest.json`, reload from `about:debugging`
