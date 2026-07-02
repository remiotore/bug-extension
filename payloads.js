var NucleiFuzzDictionaries = {};

async function initPayloads() {
  try {
    const data = await browser.storage.local.get('custom_payloads_json');
    if (data.custom_payloads_json) {
      NucleiFuzzDictionaries = JSON.parse(data.custom_payloads_json);
      return;
    }
  } catch (e) {
    console.error('Failed to parse custom payloads JSON', e);
  }

  try {
    const url = browser.runtime.getURL('payloads.json');
    const res = await fetch(url);
    NucleiFuzzDictionaries = await res.json();
  } catch (e) {
    console.error('Failed to load default payloads.json', e);
  }
}
initPayloads();