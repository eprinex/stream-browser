const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA &&
    path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean);

function findChromePath() {
  for (const p of CHROME_CANDIDATES) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch (_) {}
  }
  return null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

class ChromeEngine {
  constructor({ userDataDir, onClose } = {}) {
    this.userDataDir = userDataDir;
    this.onClose = onClose;
    this.browser = null;
    this.executablePath = findChromePath();
    this.windowId = null;
    this.cdp = null;
    this.initialPageTaken = false;
  }

  available() {
    return !!this.executablePath;
  }

  async launch({ x = 100, y = 140, width = 1280, height = 720 } = {}) {
    if (!this.executablePath) {
      throw new Error('Google Chrome bulunamadı. Lütfen Chrome kurun.');
    }
    if (!fs.existsSync(this.userDataDir)) {
      fs.mkdirSync(this.userDataDir, { recursive: true });
    }

    // Kilitli profil / yarım kalan oturum
    for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
      try {
        fs.unlinkSync(path.join(this.userDataDir, name));
      } catch (_) {}
    }

    this.initialPageTaken = false;
    this.browser = await puppeteer.launch({
      executablePath: this.executablePath,
      headless: false,
      defaultViewport: null,
      userDataDir: this.userDataDir,
      ignoreDefaultArgs: ['--enable-automation'],
      args: [
        '--autoplay-policy=no-user-gesture-required',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling,PauseBackgroundTabs,TranslateUI',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-session-crashed-bubble',
        '--hide-crash-restore-bubble',
        '--disable-infobars',
        '--disable-blink-features=AutomationControlled',
        '--new-window',
        `--window-position=${Math.round(x)},${Math.round(y)}`,
        `--window-size=${Math.round(width)},${Math.round(height)}`,
      ],
    });

    this.browser.on('disconnected', () => {
      this.browser = null;
      this.windowId = null;
      this.cdp = null;
      this.initialPageTaken = false;
      if (typeof this.onClose === 'function') this.onClose();
    });

    await sleep(500);
    await this._bindWindow();
    return this.browser;
  }

  async _bindWindow() {
    const pages = await this.browser.pages();
    const page = pages[0] || (await this._createPageSafe());
    this.cdp = await page.createCDPSession();
    try {
      const { windowId } = await this.cdp.send('Browser.getWindowForTarget');
      this.windowId = windowId;
    } catch (_) {
      this.windowId = null;
    }
  }

  async _createPageSafe() {
    // Önce mevcut boş sekmeyi kullan (Target.createTarget sık fail oluyor)
    const pages = await this.browser.pages();
    if (!this.initialPageTaken) {
      const reusable = pages.find((p) => {
        try {
          const u = p.url();
          return !u || u === 'about:blank' || u.startsWith('chrome://newtab');
        } catch (_) {
          return false;
        }
      });
      if (reusable) {
        this.initialPageTaken = true;
        return reusable;
      }
      if (pages[0]) {
        this.initialPageTaken = true;
        return pages[0];
      }
    }

    try {
      return await this.browser.newPage();
    } catch (err) {
      // Son çare: CDP ile hedef oluştur
      const existing = await this.browser.pages();
      const base = existing[0];
      if (!base) throw err;
      const session = await base.createCDPSession();
      const { targetId } = await session.send('Target.createTarget', {
        url: 'about:blank',
        newWindow: false,
      });
      const target = await this.browser.waitForTarget((t) => t._targetId === targetId || t.url() === 'about:blank', {
        timeout: 10000,
      });
      const page = await target.page();
      if (!page) throw err;
      return page;
    }
  }

  async setBounds({ x, y, width, height }) {
    if (!this.browser) return;
    if (this.windowId == null || !this.cdp) {
      try {
        await this._bindWindow();
      } catch (_) {
        return;
      }
    }
    if (this.windowId == null || !this.cdp) return;
    const bounds = {
      left: Math.round(x),
      top: Math.round(y),
      width: Math.max(200, Math.round(width)),
      height: Math.max(200, Math.round(height)),
      windowState: 'normal',
    };
    try {
      await this.cdp.send('Browser.setWindowBounds', { windowId: this.windowId, bounds });
    } catch (_) {
      try {
        await this._bindWindow();
        if (this.cdp && this.windowId != null) {
          await this.cdp.send('Browser.setWindowBounds', { windowId: this.windowId, bounds });
        }
      } catch (_) {}
    }
  }

  async newPage(url) {
    if (!this.browser) throw new Error('Chrome kapalı');
    const page = await this._createPageSafe();
    await page.setBypassCSP(true).catch(() => {});
    await page.bringToFront().catch(() => {});
    if (url) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    }
    return page;
  }

  async close() {
    if (!this.browser) return;
    try {
      await this.browser.close();
    } catch (_) {}
    this.browser = null;
    this.initialPageTaken = false;
  }
}

module.exports = { ChromeEngine, findChromePath };
