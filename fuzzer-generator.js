// ============================================================
// Bug Extension – Fuzzer Generator
// Dynamic payload generation: letters, numbers, dates, encodings
// ============================================================

const FuzzerGenerator = {
  /**
   * Generate letter ranges: a→z, aa→zz, aaa→zzz, etc.
   * @param {number} maxLength - Maximum length of combinations
   * @returns {Array} Array of letter combinations
   */
  letterRange(maxLength = 3) {
    const payloads = [];
    const alphabet = 'abcdefghijklmnopqrstuvwxyz';

    for (let len = 1; len <= maxLength; len++) {
      this._generateCombinations(alphabet, len, '', payloads);
    }

    return payloads;
  },

  /**
   * Helper: recursively generate combinations
   * @private
   */
  _generateCombinations(chars, len, prefix, result) {
    if (len === 0) {
      result.push(prefix);
      return;
    }

    // Limit results for performance
    if (result.length > 10000) return;

    for (let i = 0; i < chars.length; i++) {
      this._generateCombinations(chars, len - 1, prefix + chars[i], result);
    }
  },

  /**
   * Generate number ranges: 0→end
   * @param {number} start - Start number
   * @param {number} end - End number
   * @param {number|string} padding - Padding zeros ('none', 2, 3, 4, 5)
   * @returns {Array} Array of numbers as strings
   */
  numberRange(start = 0, end = 9999, padding = 'none') {
    const payloads = [];
    const paddingNum = padding === 'none' ? 0 : parseInt(padding, 10) || 0;

    for (let i = start; i <= end; i++) {
      if (paddingNum > 0) {
        payloads.push(String(i).padStart(paddingNum, '0'));
      } else {
        payloads.push(String(i));
      }
    }

    return payloads;
  },

  /**
   * Generate date ranges: YYYY-MM-DD
   * @param {string} startDate - Start date (YYYY-MM-DD)
   * @param {string} endDate - End date (YYYY-MM-DD)
   * @returns {Array} Array of dates
   */
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

  /**
   * Generate encoded variations of a payload
   * @param {string} payload - Base payload
   * @returns {Object} Object with different encodings
   */
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

  /**
   * Encode string to Base64
   * @private
   */
  _toBase64(str) {
    try {
      return btoa(unescape(encodeURIComponent(str)));
    } catch (e) {
      return btoa(str);
    }
  },

  /**
   * Encode string to Hex
   * @private
   */
  _toHex(str) {
    let hex = '';
    for (let i = 0; i < str.length; i++) {
      hex += '\\x' + str.charCodeAt(i).toString(16).padStart(2, '0');
    }
    return hex;
  },

  /**
   * Encode string to HTML entities
   * @private
   */
  _toHtmlEntity(str) {
    return str
      .split('')
      .map((c) => `&#${c.charCodeAt(0)};`)
      .join('');
  },

  /**
   * Generate common fuzzing wordlists (quick presets)
   * @param {string} type - Type: 'common_paths', 'common_params', 'common_extensions'
   * @returns {Array} Array of payloads
   */
  commonWordlist(type = 'common_params') {
    const lists = {
      common_params: [
        'id',
        'user_id',
        'admin',
        'test',
        'debug',
        'api_key',
        'token',
        'password',
        'secret',
        'key',
        'token_id',
        'user',
        'username',
        'email',
        'role',
        'permission',
        'access'
      ],
      common_paths: [
        '/api',
        '/admin',
        '/api/admin',
        '/api/v1',
        '/v1',
        '/user',
        '/users',
        '/api/users',
        '/config',
        '/settings',
        '/profile',
        '/auth',
        '/login',
        '/register'
      ],
      common_extensions: [
        '.php',
        '.aspx',
        '.jsp',
        '.html',
        '.js',
        '.json',
        '.xml',
        '.txt',
        '.pdf',
        '.doc',
        '.sql',
        '.bak'
      ]
    };

    return lists[type] || [];
  },

  /**
   * Generate payloads with multiple strategies
   * @param {Object} config - Configuration object
   * @returns {Array} Combined array of payloads
   */
  generateMultiple(config = {}) {
    const {
      includeLetters = true,
      letterMax = 3,
      includeNumbers = true,
      numberMax = 9999,
      numberPadding = 'none',
      includeDates = true,
      startDate = '2020-01-01',
      endDate = '2025-12-31',
      includeWordlists = true
    } = config;

    const payloads = [];

    if (includeLetters) {
      payloads.push(...this.letterRange(letterMax));
    }

    if (includeNumbers) {
      payloads.push(...this.numberRange(0, numberMax, numberPadding));
    }

    if (includeDates) {
      payloads.push(...this.dateRange(startDate, endDate));
    }

    if (includeWordlists) {
      payloads.push(...this.commonWordlist('common_params'));
      payloads.push(...this.commonWordlist('common_paths'));
    }

    return payloads;
  }
};

// Export for use in Node/module contexts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = FuzzerGenerator;
}
