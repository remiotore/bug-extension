function loadSettings() {
  browser.storage.local.get(
    [
      'target_identifiers',
      'custom_payloads',
      'api_keys',
      'fuzzer_settings',
      'custom_payloads_json',
      'custom_tags_json'
    ],
    async (data) => {
      if (data.target_identifiers && Array.isArray(data.target_identifiers)) {
        document.getElementById('target-identifiers').value = data.target_identifiers.join('\n');
      }
      if (data.custom_payloads && Array.isArray(data.custom_payloads)) {
        document.getElementById('custom-payloads').value = data.custom_payloads.join('\n');
      }
      if (data.api_keys) {
        document.getElementById('vt-api-key').value = data.api_keys.virustotal || '';
        document.getElementById('intelx-api-key').value = data.api_keys.intelx || '';
      }
      if (data.fuzzer_settings) {
        document.getElementById('fuzzer-letter-max').value = data.fuzzer_settings.letter_max || 3;
        document.getElementById('fuzzer-number-max').value = data.fuzzer_settings.number_max || 9999;
        document.getElementById('fuzzer-padding').value = data.fuzzer_settings.padding || 'none';
      }
      
      if (data.custom_tags_json) {
        document.getElementById('edit-tags-code').value = data.custom_tags_json;
      } else {
        try {
          const res = await fetch(browser.runtime.getURL('tag-detection.json'));
          const text = await res.text();
          document.getElementById('edit-tags-code').value = text;
        } catch (e) {}
      }

      if (data.custom_payloads_json) {
        document.getElementById('edit-payloads-code').value = data.custom_payloads_json;
      } else {
        try {
          const res = await fetch(browser.runtime.getURL('payloads.json'));
          const text = await res.text();
          document.getElementById('edit-payloads-code').value = text;
        } catch (e) {}
      }
    }
  );
}

document.getElementById('save-identifiers').addEventListener('click', () => {
  const identifiers = document.getElementById('target-identifiers').value.split('\n').map((x) => x.trim()).filter((x) => x.length > 0);
  browser.storage.local.set({ target_identifiers: identifiers });
  showStatus('✅ Target Identifiers saved!', 'success');
});

document.getElementById('save-payloads').addEventListener('click', () => {
  const payloads = document.getElementById('custom-payloads').value.split('\n').map((x) => x.trim()).filter((x) => x.length > 0);
  browser.storage.local.set({ custom_payloads: payloads });
  showStatus('✅ Custom Payloads saved!', 'success');
});

document.getElementById('save-api-keys').addEventListener('click', () => {
  const apiKeys = {
    virustotal: document.getElementById('vt-api-key').value,
    intelx: document.getElementById('intelx-api-key').value
  };
  browser.storage.local.set({ api_keys: apiKeys });
  showStatus('✅ API Keys saved securely!', 'success');
});

document.getElementById('save-fuzzer-settings').addEventListener('click', () => {
  const fuzzerSettings = {
    letter_max: parseInt(document.getElementById('fuzzer-letter-max').value, 10) || 3,
    number_max: parseInt(document.getElementById('fuzzer-number-max').value, 10) || 9999,
    padding: document.getElementById('fuzzer-padding').value || 'none'
  };
  browser.storage.local.set({ fuzzer_settings: fuzzerSettings });
  showStatus('✅ Fuzzer Settings saved!', 'success');
});

document.getElementById('btn-update-payloads').addEventListener('click', async () => {
  try {
    showStatus('⏳ Fetching payloads JSON...', 'success');
    const res = await fetch("https://raw.githubusercontent.com/remiotore/bugextension/main/payloads.json", { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const text = await res.text();
    JSON.parse(text); // validate
    await browser.storage.local.set({ custom_payloads_json: text });
    document.getElementById('edit-payloads-code').value = text;
    showStatus('✅ Payloads JSON updated successfully!', 'success');
  } catch (e) {
    showStatus('❌ Failed to update payloads JSON: ' + e.message, 'error');
  }
});

document.getElementById('save-payloads-code').addEventListener('click', () => {
  const code = document.getElementById('edit-payloads-code').value;
  try {
    JSON.parse(code); // validate
    browser.storage.local.set({ custom_payloads_json: code }, () => {
      showStatus('✅ Payloads JSON saved locally!', 'success');
    });
  } catch (e) {
    showStatus('❌ Invalid JSON: ' + e.message, 'error');
  }
});

document.getElementById('btn-update-tags').addEventListener('click', async () => {
  try {
    showStatus('⏳ Fetching tag-detections JSON...', 'success');
    const res = await fetch("https://raw.githubusercontent.com/remiotore/bugextension/main/tag-detection.json", { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const text = await res.text();
    JSON.parse(text); // validate
    await browser.storage.local.set({ custom_tags_json: text });
    document.getElementById('edit-tags-code').value = text;
    showStatus('✅ Tag-Detections JSON updated successfully!', 'success');
  } catch (e) {
    showStatus('❌ Failed to update tag-detections JSON: ' + e.message, 'error');
  }
});

document.getElementById('save-tags-code').addEventListener('click', () => {
  const code = document.getElementById('edit-tags-code').value;
  try {
    JSON.parse(code); // validate
    browser.storage.local.set({ custom_tags_json: code }, () => {
      showStatus('✅ Tag-Detections JSON saved locally!', 'success');
    });
  } catch (e) {
    showStatus('❌ Invalid JSON: ' + e.message, 'error');
  }
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

document.addEventListener('DOMContentLoaded', loadSettings);
