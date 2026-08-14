const path = require('path');
const fs = require('fs');

const DEFAULTS = {
  panicEnabled: true,
  panicHotkey: 'CommandOrControl+Shift+Space',
  panicMute: true,
  verticalTabs: false,
  pinTabs: false,
  tabGroups: false,
  cbVideoOnly: false,
  muteInactiveTabs: false,
  showTray: true, // X ile kapatınca tepside kalsın; panic tepsiyi tamamen siler
  restoreOnPanic: true,
};

function settingsPath(dataDir) {
  return path.join(dataDir, 'settings.json');
}

function loadSettings(dataDir) {
  const file = settingsPath(dataDir);
  try {
    if (fs.existsSync(file)) {
      return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    }
  } catch (_) {}
  return { ...DEFAULTS };
}

function saveSettings(dataDir, partial) {
  const next = { ...loadSettings(dataDir), ...partial };
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(settingsPath(dataDir), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

module.exports = { DEFAULTS, loadSettings, saveSettings };
