// ============================================================
// Bug Extension – Options Script
// Handles persistent settings configuration
// ============================================================

function loadSettings() {
  browser.storage.local.get(
    [
      'target_identifiers',
      'custom_payloads',
      'api_keys',
      'fuzzer_settings',
      'updated_payloads_code',
      'updated_tags_code'
    ],
    (data) => {
      // Load Target Identifiers
      if (data.target_identifiers && Array.isArray(data.target_identifiers)) {
        document.getElementById('target-identifiers').value =
          data.target_identifiers.join('\n');
      }

      // Load Custom Payloads
      if (data.custom_payloads && Array.isArray(data.custom_payloads)) {
        document.getElementById('custom-payloads').value =
          data.custom_payloads.join('\n');
      }

      // Load API Keys
      if (data.api_keys) {
        document.getElementById('vt-api-key').value =
          data.api_keys.virustotal || '';
        document.getElementById('intelx-api-key').value =
          data.api_keys.intelx || '';
      }

      // Load Fuzzer Settings
      if (data.fuzzer_settings) {
        document.getElementById('fuzzer-letter-max').value =
          data.fuzzer_settings.letter_max || 3;
        document.getElementById('fuzzer-number-max').value =
          data.fuzzer_settings.number_max || 9999;
        document.getElementById('fuzzer-padding').value =
          data.fuzzer_settings.padding || 'none';
      }

      // Load Custom Code Dictionaries
      if (data.updated_tags_code) {
        document.getElementById('edit-tags-code').value = data.updated_tags_code;
      }
      if (data.updated_payloads_code) {
        document.getElementById('edit-payloads-code').value = data.updated_payloads_code;
      }
    }
  );
}

// Save Target Identifiers
document.getElementById('save-identifiers').addEventListener('click', () => {
  const identifiers = document
    .getElementById('target-identifiers')
    .value.split('\n')
    .map((x) => x.trim())
    .filter((x) => x.length > 0);

  browser.storage.local.set({ target_identifiers: identifiers });
  showStatus('✅ Target Identifiers saved!', 'success');
});

// Save Custom Payloads
document.getElementById('save-payloads').addEventListener('click', () => {
  const payloads = document
    .getElementById('custom-payloads')
    .value.split('\n')
    .map((x) => x.trim())
    .filter((x) => x.length > 0);

  browser.storage.local.set({ custom_payloads: payloads });
  showStatus('✅ Custom Payloads saved!', 'success');
});

// Save API Keys
document.getElementById('save-api-keys').addEventListener('click', () => {
  const apiKeys = {
    virustotal: document.getElementById('vt-api-key').value,
    intelx: document.getElementById('intelx-api-key').value
  };

  browser.storage.local.set({ api_keys: apiKeys });
  showStatus('✅ API Keys saved securely!', 'success');
});

// Save Fuzzer Settings
document.getElementById('save-fuzzer-settings').addEventListener('click', () => {
  const fuzzerSettings = {
    letter_max: parseInt(
      document.getElementById('fuzzer-letter-max').value,
      10
    ) || 3,
    number_max: parseInt(
      document.getElementById('fuzzer-number-max').value,
      10
    ) || 9999,
    padding: document.getElementById('fuzzer-padding').value || 'none'
  };

  browser.storage.local.set({ fuzzer_settings: fuzzerSettings });
  showStatus('✅ Fuzzer Settings saved!', 'success');
});

// Update Payloads
document.getElementById('btn-update-payloads').addEventListener('click', async () => {
  try {
    showStatus('⏳ Fetching payloads...', 'success');
    const res = await fetch("https://raw.githubusercontent.com/remiotore/bugextension/main/payloads.js", { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const text = await res.text();
    await browser.storage.local.set({ updated_payloads_code: text });
    document.getElementById('edit-payloads-code').value = text;
    showStatus('✅ Payloads updated successfully!', 'success');
  } catch (e) {
    showStatus('❌ Failed to update payloads: ' + e.message, 'error');
  }
});

// Save Payloads Code
document.getElementById('save-payloads-code').addEventListener('click', () => {
  const code = document.getElementById('edit-payloads-code').value;
  browser.storage.local.set({ updated_payloads_code: code }, () => {
    showStatus('✅ Payloads code saved locally!', 'success');
  });
});

// Update Tag-Detections
document.getElementById('btn-update-tags').addEventListener('click', async () => {
  try {
    showStatus('⏳ Fetching tag-detections...', 'success');
    const res = await fetch("https://raw.githubusercontent.com/remiotore/bugextension/main/tag-detection.js", { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const text = await res.text();
    await browser.storage.local.set({ updated_tags_code: text });
    document.getElementById('edit-tags-code').value = text;
    showStatus('✅ Tag-Detections updated successfully!', 'success');
  } catch (e) {
    showStatus('❌ Failed to update tag-detections: ' + e.message, 'error');
  }
});

// Save Tag-Detections Code
document.getElementById('save-tags-code').addEventListener('click', () => {
  const code = document.getElementById('edit-tags-code').value;
  browser.storage.local.set({ updated_tags_code: code }, () => {
    showStatus('✅ Tag-Detections code saved locally!', 'success');
  });
});

function showStatus(msg, type = 'success') {
  const el = document.getElementById('status-message');
  el.textContent = msg;
  el.className = `status-message status-${type}`;
  el.style.display = 'block';
  setTimeout(() => {
    el.style.display = 'none';
  }, 3000);
}

// Load settings on page load
document.addEventListener('DOMContentLoaded', loadSettings);
