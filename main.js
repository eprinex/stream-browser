const {
  app,
  BrowserWindow,
  WebContentsView,
  ipcMain,
  session,
  shell,
  Menu,
  Tray,
  nativeImage,
  globalShortcut,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { chromeUserAgent, mobileUserAgent, clientHintHeaders } = require('./chromeIdentity');
const { loadSettings, saveSettings } = require('./settings');
const { getCbVideoOnlyScript, getCbVideoOnlyDisableScript, isCbRoomUrl } = require('./cbVideoOnly');

const HOME = pathToFileURL(path.join(__dirname, 'ui', 'start.html')).href;
const PARTITION = 'persist:stream';
const DATA_DIR = path.join(app.getPath('userData'), 'stream-browser');
const FAVORITES_FILE = path.join(DATA_DIR, 'favorites.json');
const TABS_FILE = path.join(DATA_DIR, 'tabs.json');
const VIEW_PRELOAD = path.join(__dirname, 'view-preload.js');
const CHROME_UA = chromeUserAgent();
const MOBILE_UA = mobileUserAgent();
const SIDE_W = 200;
const PANEL_W = 320;
const TOOLBAR_H = 48;
const TABSTRIP_H = 36;

let mainWindow = null;
let tray = null;
let tabs = [];
let tabGroups = [];
let nextGroupId = 1;
let activeTabId = null;
let nextTabId = 1;
let alwaysOnTop = false;
let tabsUpdateTimer = null;
let settings = null;
let panicHidden = false;
let mutedByPanic = false;
let uiPanelOpen = false;

function tabUA(tab) {
  return tab?.mobile ? MOBILE_UA : CHROME_UA;
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadJson(file, fallback) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {}
  return fallback;
}

function saveJson(file, data) {
  ensureDataDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function streamSession() {
  return session.fromPartition(PARTITION);
}

function canGoBack(wc) {
  return wc.navigationHistory?.canGoBack?.() ?? wc.canGoBack();
}

function canGoForward(wc) {
  return wc.navigationHistory?.canGoForward?.() ?? wc.canGoForward();
}

function isChaturbateHome(url) {
  return /^https?:\/\/(www\.)?chaturbate\.com\/?$/i.test(url || '');
}

function sanitizeTabUrl(url) {
  if (!url || isChaturbateHome(url)) return HOME;
  return url;
}

function normalizeRoomUrl(input) {
  const raw = (input || '').trim();
  if (!raw) return HOME;
  if (/^https?:\/\//i.test(raw) || raw.startsWith('file:')) return raw;
  if (raw.includes('.') && !raw.includes(' ')) return 'https://' + raw.replace(/^\/+/, '');
  return `https://www.google.com/search?q=${encodeURIComponent(raw)}`;
}

function isRoomUrl(url) {
  return isCbRoomUrl(url);
}

function warmNetwork() {
  const ses = streamSession();
  for (const url of [
    'https://chaturbate.com',
    'https://www.chaturbate.com',
    'https://roomimg.stream.highwebmedia.com',
    'https://live.mmcdn.com',
  ]) {
    try {
      ses.preconnect({ url, numSockets: 2 });
    } catch (_) {}
  }
}

function setupSession() {
  const ses = streamSession();
  ses.setUserAgent(CHROME_UA, 'tr-TR,tr,en-US,en');
  const hintsDesktop = clientHintHeaders(false);
  const hintsMobile = clientHintHeaders(true);
  ses.webRequest.onBeforeSendHeaders(
    { urls: ['*://accounts.google.com/*', '*://*.accounts.google.com/*'] },
    (details, callback) => {
      const tab = tabs.find((t) => t.id === activeTabId);
      const hints = tab?.mobile ? hintsMobile : hintsDesktop;
      const headers = { ...details.requestHeaders, ...hints };
      if (headers['User-Agent']) {
        headers['User-Agent'] = String(headers['User-Agent']).replace(/\s*Electron\/[\d.]+/gi, '');
      }
      callback({ requestHeaders: headers });
    }
  );
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(
      ['media', 'mediaKeySystem', 'fullscreen', 'pointerLock', 'notifications', 'clipboard-read'].includes(
        permission
      )
    );
  });
  ses.setPermissionCheckHandler((_wc, permission) =>
    ['media', 'mediaKeySystem', 'fullscreen', 'pointerLock', 'notifications', 'clipboard-read'].includes(
      permission
    )
  );
  warmNetwork();
  setInterval(warmNetwork, 4 * 60 * 1000);
}

function chromeHeights() {
  const vertical = !!(settings && settings.verticalTabs);
  if (vertical) return { top: TOOLBAR_H, side: SIDE_W };
  return { top: TOOLBAR_H + TABSTRIP_H, side: 0 };
}

function contentBounds() {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const [width, height] = mainWindow.getContentSize();
  const { top, side } = chromeHeights();
  const t = mainWindow.isFullScreen() ? 0 : top;
  const s = mainWindow.isFullScreen() ? 0 : side;
  const panel = !mainWindow.isFullScreen() && uiPanelOpen ? PANEL_W : 0;
  return {
    x: s,
    y: t,
    width: Math.max(0, width - s - panel),
    height: Math.max(0, height - t),
  };
}

function keepTabAlive(tab) {
  if (!tab?.view) return;
  try {
    tab.view.webContents.setBackgroundThrottling(false);
  } catch (_) {}
}

function layoutAllViews() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const bounds = contentBounds();
  if (!bounds) return;
  const active = tabs.find((t) => t.id === activeTabId);
  for (const t of tabs) {
    try {
      mainWindow.contentView.addChildView(t.view);
    } catch (_) {}
    t.view.setBounds(bounds);
    keepTabAlive(t);
  }
  if (active?.view) {
    try {
      mainWindow.contentView.removeChildView(active.view);
    } catch (_) {}
    try {
      mainWindow.contentView.addChildView(active.view);
    } catch (_) {}
    active.view.setBounds(bounds);
    keepTabAlive(active);
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('layout-chrome', {
      verticalTabs: !!(settings && settings.verticalTabs),
      sideWidth: SIDE_W,
      toolbarH: TOOLBAR_H,
      tabstripH: TABSTRIP_H,
    });
  }
}

function detachView(view) {
  if (!mainWindow || !view) return;
  try {
    mainWindow.contentView.removeChildView(view);
  } catch (_) {}
}

function sortedTabs() {
  const list = [...tabs];
  if (settings?.pinTabs) {
    list.sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || a.id - b.id);
  }
  return list;
}

function sendTabsUpdate() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (tabsUpdateTimer) return;
  tabsUpdateTimer = setTimeout(() => {
    tabsUpdateTimer = null;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('tabs-updated', {
      tabs: sortedTabs().map((t) => ({
        id: t.id,
        title: t.title || 'Yeni sekme',
        url: t.url || HOME,
        loading: !!t.loading,
        mobile: !!t.mobile,
        pinned: !!t.pinned,
        groupId: t.groupId || null,
        canGoBack: t.view ? canGoBack(t.view.webContents) : false,
        canGoForward: t.view ? canGoForward(t.view.webContents) : false,
      })),
      groups: tabGroups,
      activeTabId,
      alwaysOnTop,
      panicHidden,
      settings,
    });
  }, 40);
}

function persistTabs() {
  const active = tabs.find((t) => t.id === activeTabId);
  saveJson(TABS_FILE, [{ url: sanitizeTabUrl(active?.url || HOME), title: active?.title || '' }]);
}

function sendFavorites() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('favorites-updated', loadJson(FAVORITES_FILE, []));
}

function applyTabUA(tab) {
  if (!tab?.view) return;
  const ua = tabUA(tab);
  tab.view.webContents.setUserAgent(ua);
  return ua;
}

function applyCbVideoOnly(tab) {
  if (!tab?.view) return;
  const url = tab.url || '';
  if (!settings?.cbVideoOnly || !isCbRoomUrl(url)) {
    tab.view.webContents.executeJavaScript(getCbVideoOnlyDisableScript()).catch(() => {});
    return;
  }
  tab.view.webContents.executeJavaScript(getCbVideoOnlyScript()).catch(() => {});
}

function setTabAudioMuted(tab, muted) {
  if (!tab?.view) return;
  try {
    tab.view.webContents.setAudioMuted(!!muted);
  } catch (_) {}
}

function muteAllTabs(muted) {
  for (const t of tabs) setTabAudioMuted(t, muted);
}

function applyMuteInactive() {
  if (!settings?.muteInactiveTabs) {
    if (!panicHidden) muteAllTabs(false);
    return;
  }
  for (const t of tabs) setTabAudioMuted(t, t.id !== activeTabId);
}

function destroyTray() {
  if (!tray) return;
  try {
    tray.destroy();
  } catch (_) {}
  tray = null;
}

function togglePanic() {
  if (!mainWindow) return;
  if (!panicHidden) {
    if (settings?.panicMute !== false) {
      muteAllTabs(true);
      mutedByPanic = true;
    }
    mainWindow.setSkipTaskbar(true);
    mainWindow.hide();
    panicHidden = true;
    // Tam gizlilik: gizli simgeler menüsünden de kaldır
    destroyTray();
  } else {
    mainWindow.setSkipTaskbar(false);
    mainWindow.show();
    mainWindow.focus();
    panicHidden = false;
    if (mutedByPanic) {
      muteAllTabs(false);
      mutedByPanic = false;
      applyMuteInactive();
    }
    // Panic sonrası tepsiyi yalnızca ayar açıksa ve pencere açıksa yeniden oluşturma —
    // ikon sadece "kapat → tepsiye in" için kalsın
  }
  refreshTrayMenu();
  sendTabsUpdate();
}

function trayIcon() {
  const iconPath = path.join(__dirname, 'tray-icon.png');
  if (fs.existsSync(iconPath)) {
    const img = nativeImage.createFromPath(iconPath);
    if (!img.isEmpty()) return img;
  }
  // yedek: 16x16 turuncu daire
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAbElEQVR4nGNgoAX4UqzI+aVYMeRLsWI1FIPYnMRqBmn48qVY8T8aBolVE9K8CItGdLwIn82ENMNwNbpmThzOxoW/oIQJNJCI1YzDIeQ6H9Mb1DCAYi9QFogURyNVEhKaS5hLymhhQl5mIhUAAFtKc0CdMUl1AAAAAElFTkSuQmCC',
    'base64'
  );
  return nativeImage.createFromBuffer(png);
}

function refreshTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: panicHidden ? 'Göster' : 'Gizle (panic)',
        click: () => togglePanic(),
      },
      {
        label: 'Çıkış',
        click: () => {
          app.isQuitting = true;
          app.quit();
        },
      },
    ])
  );
}

/** @param {{ force?: boolean }} [opts] force: X ile küçültünce ikon oluştur (panic’te kullanılmaz) */
function ensureTray(opts = {}) {
  if (settings?.showTray === false) {
    destroyTray();
    return;
  }
  // Panic gizlemesinde ikon yok; yalnızca force (X ile kapat) ikon bırakır
  if (panicHidden && !opts.force) {
    destroyTray();
    return;
  }
  if (!tray) {
    tray = new Tray(trayIcon());
    tray.setToolTip('Stream Browser — tıkla: göster');
    tray.on('click', () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.setSkipTaskbar(false);
      mainWindow.show();
      mainWindow.focus();
      panicHidden = false;
      if (mutedByPanic) {
        muteAllTabs(false);
        mutedByPanic = false;
        applyMuteInactive();
      }
      destroyTray();
      sendTabsUpdate();
    });
  }
  refreshTrayMenu();
}

function registerPanicHotkey() {
  try {
    globalShortcut.unregisterAll();
  } catch (_) {}
  if (!settings?.panicEnabled) return;
  const accel = settings.panicHotkey || 'CommandOrControl+Shift+Space';
  try {
    const ok = globalShortcut.register(accel, () => togglePanic());
    if (!ok) console.error('Hotkey alınamadı:', accel);
  } catch (e) {
    console.error('Hotkey hata:', e);
  }
}

function attachViewEvents(tab) {
  const wc = tab.view.webContents;

  wc.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url);
      if (/chaturbate\.com$/i.test(u.hostname) || /\.google\.com$/i.test(u.hostname)) {
        createTab(url, true);
      }
    } catch (_) {}
    return { action: 'deny' };
  });

  wc.on('page-title-updated', (_e, title) => {
    let clean = (title || '').trim();
    if (/^about:/i.test(clean)) return;
    clean = clean.replace(/\s*[@|–—-]\s*Chaturbate.*$/i, '').trim();
    clean = clean.replace(/\s*-\s*YouTube.*$/i, '').trim();
    tab.title = clean || 'Sekme';
    sendTabsUpdate();
  });

  wc.on('did-navigate', (_e, url) => {
    if (!url || url === 'about:blank') return;
    tab.url = url;
    sendTabsUpdate();
    persistTabs();
    if (isRoomUrl(url)) warmNetwork();
  });

  wc.on('did-navigate-in-page', (_e, url) => {
    if (!url || url === 'about:blank') return;
    tab.url = url;
    sendTabsUpdate();
  });

  wc.on('did-start-loading', () => {
    tab.loading = true;
    sendTabsUpdate();
  });

  wc.on('did-stop-loading', () => {
    tab.loading = false;
    const url = wc.getURL();
    if (url && url !== 'about:blank') {
      tab.url = url;
      const title = wc.getTitle();
      if (title && !/^about:/i.test(title)) tab.title = title;
    }
    sendTabsUpdate();
    persistTabs();
    applyCbVideoOnly(tab);
  });

  wc.on('dom-ready', () => {
    applyCbVideoOnly(tab);
  });

  wc.on('did-fail-load', (_e, code, _d, _u, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    tab.loading = false;
    sendTabsUpdate();
  });

  wc.on('render-process-gone', (_e, details) => {
    console.error('render-process-gone', details?.reason);
    tab.loading = false;
    sendTabsUpdate();
  });
}

function createTab(url = HOME, switchTo = true) {
  const view = new WebContentsView({
    webPreferences: {
      session: streamSession(),
      preload: VIEW_PRELOAD,
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
      webgl: true,
    },
  });

  const wc = view.webContents;
  wc.setBackgroundThrottling(false);

  const tab = {
    id: nextTabId++,
    view,
    url,
    title: url === HOME || String(url).startsWith('file:') ? 'Yeni sekme' : 'Yükleniyor…',
    loading: true,
    mobile: false,
    pinned: false,
    groupId: null,
  };

  applyTabUA(tab);
  attachViewEvents(tab);
  tabs.push(tab);
  wc.loadURL(url, { userAgent: tabUA(tab) }).catch(() => {});

  if (switchTo) switchToTab(tab.id);
  else {
    layoutAllViews();
    sendTabsUpdate();
  }
  return tab;
}

function switchToTab(id) {
  const tab = tabs.find((t) => t.id === id);
  if (!tab || !mainWindow) return;
  activeTabId = id;
  applyMuteInactive();
  layoutAllViews();
  sendTabsUpdate();
}

function closeTab(id) {
  const tab = tabs.find((t) => t.id === id);
  if (!tab) return;
  if (settings?.pinTabs && tab.pinned) return;
  const idx = tabs.findIndex((t) => t.id === id);
  tabs.splice(idx, 1);
  detachView(tab.view);
  try {
    tab.view.webContents.destroy();
  } catch (_) {}

  if (!tabs.length) {
    createTab(HOME, true);
    return;
  }
  if (activeTabId === id) switchToTab(tabs[Math.min(idx, tabs.length - 1)].id);
  else {
    layoutAllViews();
    sendTabsUpdate();
  }
  persistTabs();
}

function getActiveTab() {
  return tabs.find((t) => t.id === activeTabId);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: '#0d0d0f',
    title: 'Stream Browser',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  Menu.setApplicationMenu(null);
  mainWindow.loadFile(path.join(__dirname, 'ui', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.on('resize', layoutAllViews);
  mainWindow.on('maximize', layoutAllViews);
  mainWindow.on('unmaximize', layoutAllViews);
  mainWindow.on('enter-full-screen', layoutAllViews);
  mainWindow.on('leave-full-screen', layoutAllViews);
  mainWindow.on('blur', () => {
    for (const t of tabs) keepTabAlive(t);
  });
  mainWindow.on('focus', () => {
    for (const t of tabs) keepTabAlive(t);
  });
  mainWindow.on('close', (e) => {
    if (settings?.showTray !== false && !app.isQuitting) {
      e.preventDefault();
      mainWindow.setSkipTaskbar(true);
      mainWindow.hide();
      panicHidden = true;
      // X: tepside kalsın. Panic tuşu: tepsiyi de siler.
      ensureTray({ force: true });
      sendTabsUpdate();
    }
  });

  setInterval(() => {
    for (const t of tabs) keepTabAlive(t);
  }, 15000);

  mainWindow.webContents.on('did-finish-load', () => {
    const saved = loadJson(TABS_FILE, null);
    let start = HOME;
    if (Array.isArray(saved) && saved.length > 0) start = sanitizeTabUrl(saved[0].url) || HOME;
    createTab(start, true);
    sendFavorites();
    sendTabsUpdate();
  });
}

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-background-media-suspend');
app.commandLine.appendSwitch('disk-cache-size', String(512 * 1024 * 1024));
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch(
  'disable-features',
  'CalculateNativeWinOcclusion,IntensiveWakeUpThrottling,PauseBackgroundTabs,BackForwardCache'
);
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
app.userAgentFallback = CHROME_UA;

app.whenReady().then(() => {
  ensureDataDir();
  settings = loadSettings(DATA_DIR);
  setupSession();
  createWindow();
  // Tepsi ikonu uygulama açıkken görünmesin; sadece X ile küçültünce oluşur
  registerPanicHotkey();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  app.isQuitting = true;
  try {
    globalShortcut.unregisterAll();
  } catch (_) {}
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('nav-go', (_e, url) => {
  const tab = getActiveTab();
  if (!tab) return;
  const target = normalizeRoomUrl(url);
  tab.url = target;
  if (isRoomUrl(target) || /chaturbate\.com/i.test(target)) warmNetwork();
  tab.view.webContents.loadURL(target, { userAgent: tabUA(tab) }).catch(() => {});
});

ipcMain.handle('nav-back', () => {
  const tab = getActiveTab();
  const wc = tab?.view.webContents;
  if (!wc || !canGoBack(wc)) return;
  if (wc.navigationHistory?.goBack) wc.navigationHistory.goBack();
  else wc.goBack();
});

ipcMain.handle('nav-forward', () => {
  const tab = getActiveTab();
  const wc = tab?.view.webContents;
  if (!wc || !canGoForward(wc)) return;
  if (wc.navigationHistory?.goForward) wc.navigationHistory.goForward();
  else wc.goForward();
});

ipcMain.handle('nav-reload', (_e, hard) => {
  const tab = getActiveTab();
  if (!tab) return;
  if (hard) tab.view.webContents.reloadIgnoringCache();
  else tab.view.webContents.reload();
});

ipcMain.handle('nav-home', () => {
  const tab = getActiveTab();
  if (!tab) return;
  tab.view.webContents.loadURL(HOME, { userAgent: tabUA(tab) }).catch(() => {});
});

ipcMain.handle('tab-new', (_e, url) => {
  createTab(normalizeRoomUrl(url || HOME), true);
});
ipcMain.handle('tab-close', (_e, id) => {
  closeTab(id ?? activeTabId);
});
ipcMain.handle('tab-switch', (_e, id) => {
  switchToTab(id);
});

ipcMain.handle('tab-pin', (_e, id) => {
  if (!settings?.pinTabs) return false;
  const tab = tabs.find((t) => t.id === id);
  if (!tab) return false;
  tab.pinned = !tab.pinned;
  sendTabsUpdate();
  return tab.pinned;
});

ipcMain.handle('tab-set-group', (_e, id, groupId) => {
  if (!settings?.tabGroups) return;
  const tab = tabs.find((t) => t.id === id);
  if (!tab) return;
  tab.groupId = groupId || null;
  sendTabsUpdate();
});

ipcMain.handle('group-create', (_e, name) => {
  if (!settings?.tabGroups) return null;
  const g = {
    id: nextGroupId++,
    name: name || `Grup ${nextGroupId - 1}`,
    color: ['#f47321', '#3b82f6', '#22c55e', '#a855f7', '#eab308'][(nextGroupId - 2) % 5],
  };
  tabGroups.push(g);
  sendTabsUpdate();
  return g;
});

ipcMain.handle('group-rename', (_e, id, name) => {
  const g = tabGroups.find((x) => x.id === id);
  if (!g) return;
  g.name = name || g.name;
  sendTabsUpdate();
});

ipcMain.handle('group-delete', (_e, id) => {
  tabGroups = tabGroups.filter((g) => g.id !== id);
  for (const t of tabs) {
    if (t.groupId === id) t.groupId = null;
  }
  sendTabsUpdate();
});

ipcMain.handle('toggle-mobile', () => {
  const tab = getActiveTab();
  if (!tab) return false;
  tab.mobile = !tab.mobile;
  const ua = applyTabUA(tab);
  const url = tab.view.webContents.getURL() || tab.url || HOME;
  tab.view.webContents.loadURL(url, { userAgent: ua }).catch(() => {});
  sendTabsUpdate();
  return tab.mobile;
});

ipcMain.handle('toggle-always-on-top', () => {
  alwaysOnTop = !alwaysOnTop;
  if (mainWindow) mainWindow.setAlwaysOnTop(alwaysOnTop, 'floating');
  sendTabsUpdate();
  return alwaysOnTop;
});

ipcMain.handle('panic-toggle', () => {
  togglePanic();
  return panicHidden;
});

ipcMain.handle('ui-panel', (_e, open) => {
  uiPanelOpen = !!open;
  layoutAllViews();
  return uiPanelOpen;
});

ipcMain.handle('settings-get', () => settings || loadSettings(DATA_DIR));

ipcMain.handle('settings-set', (_e, partial) => {
  settings = saveSettings(DATA_DIR, partial || {});
  registerPanicHotkey();
  if (!settings.showTray) destroyTray();
  applyMuteInactive();
  layoutAllViews();
  for (const t of tabs) applyCbVideoOnly(t);
  sendTabsUpdate();
  return settings;
});

ipcMain.handle('favorites-list', () => loadJson(FAVORITES_FILE, []));

ipcMain.handle('favorites-add', (_e, item) => {
  const favorites = loadJson(FAVORITES_FILE, []);
  const url = item?.url || getActiveTab()?.url || HOME;
  const title = item?.title || getActiveTab()?.title || 'Favori';
  if (favorites.some((f) => f.url === url)) return favorites;
  favorites.unshift({ url, title, addedAt: Date.now() });
  saveJson(FAVORITES_FILE, favorites.slice(0, 50));
  sendFavorites();
  return favorites;
});

ipcMain.handle('favorites-remove', (_e, url) => {
  const favorites = loadJson(FAVORITES_FILE, []).filter((f) => f.url !== url);
  saveJson(FAVORITES_FILE, favorites);
  sendFavorites();
  return favorites;
});

ipcMain.handle('open-external', (_e, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url);
});
