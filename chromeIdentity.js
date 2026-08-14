/**
 * Chromium sürümüne uygun masaüstü / mobil Chrome UA + Client Hints.
 */
function chromeVersion() {
  const v = process.versions.chrome || '138.0.0.0';
  return v;
}

function majorVersion() {
  return String(chromeVersion().split('.')[0] || '138');
}

function chromeUserAgent() {
  const v = chromeVersion();
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36`;
}

function mobileUserAgent() {
  const v = chromeVersion();
  return `Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Mobile Safari/537.36`;
}

function clientHintHeaders(mobile = false) {
  const major = majorVersion();
  const full = chromeVersion();
  return {
    'User-Agent': mobile ? mobileUserAgent() : chromeUserAgent(),
    'sec-ch-ua': `"Google Chrome";v="${major}", "Chromium";v="${major}", "Not.A/Brand";v="24"`,
    'sec-ch-ua-mobile': mobile ? '?1' : '?0',
    'sec-ch-ua-platform': mobile ? '"Android"' : '"Windows"',
    'sec-ch-ua-platform-version': mobile ? '"14.0.0"' : '"15.0.0"',
    'sec-ch-ua-arch': mobile ? '""' : '"x86"',
    'sec-ch-ua-bitness': mobile ? '""' : '"64"',
    'sec-ch-ua-full-version': `"${full}"`,
    'sec-ch-ua-full-version-list': `"Google Chrome";v="${full}", "Chromium";v="${full}", "Not.A/Brand";v="10.0.2.3"`,
    'sec-ch-ua-model': mobile ? '"Pixel 8"' : '""',
    'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
  };
}

module.exports = { chromeVersion, chromeUserAgent, mobileUserAgent, clientHintHeaders };
