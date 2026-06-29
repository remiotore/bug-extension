# Bug Extension – Development & Debugging Guide

This repository contains the full source code for **Bug Extension**, an all-in-one security testing toolkit built as a Firefox Developer Tools panel extension. It includes real-time request capturing, automated endpoint and parameter vulnerability hunting, an active HTTP Request Replay engine, and multiple diagnostic encoding tools.

---

## Extension File Structure

Ensure all the following extension files are organized in the same root directory before loading:

*   `manifest.json` – The extension's configuration blueprint defining permissions, service scripts, and entry points.
*   `background.js` – Handles persistent background operations, network request capturing (`webRequest`), storage, and context menus.
*   `devtools.html` / `devtools.js` – Registers the custom panel ("Bug Extension") inside Firefox's native Developer Tools architecture.
*   `panel.html` – The core structure and user interface markup for the custom extension tab.
*   `panel.css` – Contains the comprehensive style architecture supporting the dark-first UI theme layout.
*   `panel.js` – Contains the core interactivity, message passing routing, script generation templates, and data rendering mechanics.

---

## How to Load into Firefox for Debugging

Since this extension hooks directly into the Firefox Developer Tools panel subsystem (`devtools_page`), it must be loaded as a temporary add-on for local debugging:

1. Open **Firefox**.
2. In the address bar, type `about:debugging` and press **Enter**.
3. Click on **"This Firefox"** (or *"This Nightly"* / *"This Developer Edition"*) in the left-hand sidebar menu.
4. Click the **"Load Temporary Add-on..."** button.
5. In the file picker dialog, navigate to your extension's project folder.
6. Select **any file** inside the root directory (such as `manifest.json`) and click **Open**.

The extension is now loaded temporarily! It will remain active until you completely restart Firefox or click the "Remove" button on the `about:debugging` page.

---

## How to View and Use the Extension

Because this toolkit is a DevTools add-on rather than a standard toolbar popup, you access it via the browser's inspection console:

1. Navigate to any web page you want to analyze (e.g., `https://example.com`).
2. Open the Firefox Developer Tools by pressing `F12` (or `Ctrl+Shift+I` on Windows/Linux, `Cmd+Opt+I` on macOS).
3. Look at the tab menu rows on the top of the DevTools panel (next to *Inspector*, *Console*, *Network*, etc.).
4. Click on the **"Bug Extension"** tab.
5. Browse your target website normally. The **Requests** tab will dynamically record raw HTTP packets via `background.js` and display them live in your custom UI.

---

## How to Debug the Extension Code Itself

When developing, you may need to inspect errors, check `console.log` messages, or place debugger breakpoints inside your extension components. Firefox isolates these processes into separate environments:

### 1. Debugging `background.js`
* Go back to the `about:debugging` page where you loaded the extension.
* Locate **Bug Extension** under the temporary extensions list.
* Click the **"Inspect"** button next to it.
* A new dedicated Developer Tools window will open. This console handles all logs, storage inspections (`browser.storage.local`), and network intercepts managed by the persistent background loop.

### 2. Debugging `panel.js` or UI Elements
* Open your extension's **Bug Extension** panel inside the normal web page DevTools tray.
* Right-click **anywhere inside the custom panel UI layout** and select **"Inspect Element (Q)"**.
* A *second* nested DevTools window will open. This window lets you inspect your extension's layout elements (`panel.html`), view layout rule behaviors (`panel.css`), and debug panel interactions (`panel.js`).

### 3. Applying Changes
* Firefox tracks local directory code modifications in real-time. If you edit `panel.js` or `panel.css`, simply **close and reopen your target web page's DevTools assembly** to re-render changes.
* If you edit structural hooks inside `background.js` or `manifest.json`, return to `about:debugging` and click the **"Reload"** button on your extension entry.