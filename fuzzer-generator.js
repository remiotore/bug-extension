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
    const width = String(end).length;
    const padFn = padding === 'zero' ? (s => s.padStart(width, '0')) : padding === 'space' ? (s => s.padStart(width, ' ')) : (s => s);
    for (let i = start; i <= end; i++) payloads.push(padFn(String(i)));
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

  // Returns common fuzzing parameters, paths, or extensions
  commonWordlist(type = 'common_params') {
    const lists = {
      common_params: ['id', 'user_id', 'admin', 'test', 'debug', 'api_key', 'token', 'password', 'secret', 'key', 'token_id', 'user', 'username', 'email', 'role', 'permission', 'access'],
      common_paths: ['/api', '/admin', '/api/admin', '/api/v1', '/v1', '/user', '/users', '/api/users', '/config', '/settings', '/profile', '/auth', '/login', '/register'],
      common_extensions: ['.php', '.aspx', '.jsp', '.html', '.js', '.json', '.xml', '.txt', '.pdf', '.doc', '.sql', '.bak']
    };
    return lists[type] || [];
  },

};

if (typeof module !== 'undefined' && module.exports) module.exports = FuzzerGenerator;
