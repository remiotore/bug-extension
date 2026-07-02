/**
 * FuzzerGenerator
 * Generates dynamic payloads for the bug extension fuzzing capabilities,
 * including letters, numbers, dates, and common wordlists.
 */
const FuzzerGenerator = {
  // Generates alphabetical combinations up to maxLength (e.g., a-z, aa-zz)
  letterRange(maxLength = 3) {
    const payloads = [];
    const alphabet = 'abcdefghijklmnopqrstuvwxyz';
    for (let len = 1; len <= maxLength; len++) {
      this._generateCombinations(alphabet, len, '', payloads);
    }
    return payloads;
  },

  _generateCombinations(chars, len, prefix, result) {
    if (len === 0) {
      result.push(prefix);
      return;
    }
    if (result.length > 10000) return;
    for (let i = 0; i < chars.length; i++) {
      this._generateCombinations(chars, len - 1, prefix + chars[i], result);
    }
  },

  // Generates numeric ranges with optional zero-padding
  numberRange(start = 0, end = 9999, padding = 'none') {
    const payloads = [];
    const paddingNum = padding === 'none' ? 0 : parseInt(padding, 10) || 0;
    for (let i = start; i <= end; i++) {
      if (paddingNum > 0) payloads.push(String(i).padStart(paddingNum, '0'));
      else payloads.push(String(i));
    }
    return payloads;
  },

  // Generates sequential dates within a given range in YYYY-MM-DD format
  dateRange(startDate = '2020-01-01', endDate = '2025-12-31') {
    const payloads = [];
    try {
      let current = new Date(startDate + 'T00:00:00Z');
      const end = new Date(endDate + 'T23:59:59Z');
      while (current <= end) {
        const year = current.getUTCFullYear();
        const month = String(current.getUTCMonth() + 1).padStart(2, '0');
        const day = String(current.getUTCDate()).padStart(2, '0');
        payloads.push(`${year}-${month}-${day}`);
        current.setUTCDate(current.getUTCDate() + 1);
      }
    } catch (e) {
      console.warn('Date range error:', e);
    }
    return payloads;
  },

  // Returns multiple encoded variations of a given base payload
  encodeVariations(payload) {
    return {
      plain: payload,
      urlEncoded: encodeURIComponent(payload),
      base64: this._toBase64(payload),
      hex: this._toHex(payload),
      htmlEntity: this._toHtmlEntity(payload),
      doubleEncoded: encodeURIComponent(encodeURIComponent(payload))
    };
  },

  _toBase64(str) {
    try { return btoa(unescape(encodeURIComponent(str))); }
    catch (e) { return btoa(str); }
  },

  _toHex(str) {
    let hex = '';
    for (let i = 0; i < str.length; i++) {
      hex += '\\x' + str.charCodeAt(i).toString(16).padStart(2, '0');
    }
    return hex;
  },

  _toHtmlEntity(str) {
    return str.split('').map((c) => `&#${c.charCodeAt(0)};`).join('');
  },

  // Returns common fuzzing parameters, paths, or extensions
  commonWordlist(type = 'common_params') {
    const lists = {
      common_params: ['id', 'user_id', 'admin', 'test', 'debug', 'api_key', 'token', 'password', 'secret', 'key', 'token_id', 'user', 'username', 'email', 'role', 'permission', 'access'],
      common_paths: ['/api', '/admin', '/api/admin', '/api/v1', '/v1', '/user', '/users', '/api/users', '/config', '/settings', '/profile', '/auth', '/login', '/register'],
      common_extensions: ['.php', '.aspx', '.jsp', '.html', '.js', '.json', '.xml', '.txt', '.pdf', '.doc', '.sql', '.bak']
    };
    return lists[type] || [];
  },

  // Generates a combined array of payloads based on the provided configuration
  generateMultiple(config = {}) {
    const {
      includeLetters = true, letterMax = 3,
      includeNumbers = true, numberMax = 9999, numberPadding = 'none',
      includeDates = true, startDate = '2020-01-01', endDate = '2025-12-31',
      includeWordlists = true
    } = config;

    const payloads = [];
    if (includeLetters) payloads.push(...this.letterRange(letterMax));
    if (includeNumbers) payloads.push(...this.numberRange(0, numberMax, numberPadding));
    if (includeDates) payloads.push(...this.dateRange(startDate, endDate));
    if (includeWordlists) {
      payloads.push(...this.commonWordlist('common_params'));
      payloads.push(...this.commonWordlist('common_paths'));
    }
    return payloads;
  }
};

if (typeof module !== 'undefined' && module.exports) module.exports = FuzzerGenerator;
