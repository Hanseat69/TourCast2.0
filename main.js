'use strict';
const { app, BrowserWindow, ipcMain, dialog, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');

// ── .ENV LOADER (kein dotenv-Paket nötig) ────────────────
function loadEnv() {
  try {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) return {};
    const env = {};
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const idx = t.indexOf('=');
      if (idx < 0) continue;
      env[t.slice(0, idx).trim()] = t.slice(idx + 1).trim();
    }
    return env;
  } catch (e) { return {}; }
}
const ENV = loadEnv();

// ── FORCE LIGHT MODE (Deaktiviere Dark-Mode komplett) ──
nativeTheme.themeSource = 'light';

// ── LOG-DATEI SYSTEM ──
// Wird später in createWindow() initialisiert, wenn app.setPath() bereits gesetzt ist
let logDir;
let logFile;

// Custom Console-Logging
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

console.log = function(...args) {
  originalLog(...args);
  logToFile('[LOG]', args.join(' '));
};

console.warn = function(...args) {
  originalWarn(...args);
  logToFile('[WARN]', args.join(' '));
};

console.error = function(...args) {
  originalError(...args);
  logToFile('[ERROR]', args.join(' '));
};

function logToFile(level, message) {
  try {
    const timestamp = new Date().toISOString();
    const logMessage = `${timestamp} ${level} ${message}\n`;
    fs.appendFileSync(logFile, logMessage);
  } catch (err) {
    originalWarn('⚠️ Log-Schreibfehler:', err.message);
  }
}

// Cache-Pfad setzen (behebe Cache-Fehler auf OneDrive/Cloud-Umgebungen)
const appData = path.join(process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE, 'AppData', 'Local'), 'TourCast-Pro-Cache');
if (!fs.existsSync(appData)) {
  try {
    fs.mkdirSync(appData, { recursive: true });
  } catch (err) {
    console.warn('⚠️ Cache-Verzeichnis konnte nicht erstellt werden:', err.message);
  }
}
app.setPath('cache', appData);

// Performance-Optimierung für AMD RX 6950 XT
app.commandLine.appendSwitch('ignore-gpu-blacklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');

let mainWindow;
let store; // Wird asynchron initialisiert

async function createWindow() {
  // electron-store ist ein ES-Modul. In einer CommonJS-Umgebung (wie dieser Datei)
  // muss es dynamisch via import() geladen werden.
  if (!store) {
    const { default: Store } = await import('electron-store');
    store = new Store();
  }

  const lastWindowState = store.get('windowState', {
    width: 1400,
    height: 900,
    x: undefined,
    y: undefined,
  });

  mainWindow = new BrowserWindow({
    width: lastWindowState.width,
    height: lastWindowState.height,
    x: lastWindowState.x,
    y: lastWindowState.y,
    title: "TourCast 2.0 Pro",
    backgroundColor: '#EEF2F7',  // ← LIGHT MODE (war: #1c1c1c)
    minWidth: 800,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 10, y: 10 },
    webContentDebugging: true,
    show: false,
    icon: path.join(__dirname, 'icons/favicon-32.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      powerPreference: 'high-performance'
    }
  });

  mainWindow.loadFile('index.html');
  // DevTools entfernt - Log-Fenster kann über Settings geöffnet werden

  // Fenster erst anzeigen, wenn der Inhalt geladen ist, um Flackern zu vermeiden
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Fenstergröße und -position speichern
  mainWindow.on('resize', () => {
    const { width, height } = mainWindow.getBounds();
    store.set('windowState.width', width);
    store.set('windowState.height', height);
  });
  mainWindow.on('move', () => {
    const { x, y } = mainWindow.getBounds();
    store.set('windowState.x', x);
    store.set('windowState.y', y);
  });
}

app.whenReady().then(async () => {
  // ── Log-Datei VOR allem anderen initialisieren ──────────────────────────
  // process.env.APPDATA direkt verwenden — app.getPath('appData') wird durch
  // app.setPath('cache', ...) weiter oben in Electron 28 verfälscht
  const userData = path.join(process.env.APPDATA || app.getPath('home'), 'TourCast-Pro');
  app.setPath('userData', userData);
  logDir  = path.join(userData, 'logs');
  logFile = path.join(logDir, 'app.log');
  try { fs.mkdirSync(logDir, { recursive: true }); } catch (_) {}
  try {
    const MAX_LOG_BYTES = 500 * 1024;
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > MAX_LOG_BYTES) {
      const backup = logFile + '.1';
      if (fs.existsSync(backup)) fs.unlinkSync(backup);
      fs.renameSync(logFile, backup);
    }
    fs.appendFileSync(logFile,
      `\n${'═'.repeat(60)}\n[${new Date().toISOString()}] TourCast 2.0 gestartet\n${'═'.repeat(60)}\n`,
      'utf8'
    );
    originalLog('✅ Log-Datei bereit:', logFile);
  } catch (err) {
    originalWarn('⚠️ Log-Init fehlgeschlagen:', err.message);
  }

  await createWindow();

  // ── Geolocation-Berechtigung für Renderer freigeben ──────────────────────
  // Electron blockiert navigator.geolocation ohne diesen Handler standardmäßig.
  // "Failed to query location from network service" = fehlende Permission, nicht Windows.
  const { session } = require('electron');
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'geolocation') {
      callback(true); // Standort immer erlauben (lokale Desktop-App, kein Sicherheitsrisiko)
    } else {
      callback(false);
    }
  });
});
app.on('window-all-closed', () => {
  logToFile('[LOG]', 'TourCast 2.0 beendet');
  if (process.platform !== 'darwin') app.quit();
});

// ── MAIN-PROZESS Crash-Sicherung ──
process.on('uncaughtException', (err) => {
  logToFile('[MAIN-CRASH]',
    `${err.message} | Stack: ${(err.stack || '').split('\n').slice(0, 4).join(' | ')}`);
});
process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? (reason.stack || '').split('\n').slice(0, 3).join(' | ') : '';
  logToFile('[MAIN-PROMISE]', stack ? `${msg} | Stack: ${stack}` : msg);
});

// ── API-Konfiguration sicher an Renderer übergeben ──
ipcMain.handle('get-config', async () => {
  return {
    orsKey: ENV.ORS_API_KEY || null
  };
});

// ── RENDERER-FEHLER → Log-Datei ──────────────────────────────────────────────
// Empfängt strukturierte Fehlerdaten aus der UI (window.onerror, unhandledRejection)
ipcMain.handle('renderer-log', (event, data) => {
  if (!logFile) return null;
  try {
    const ts  = new Date().toISOString();
    const lvl = String(data?.level || 'ERROR').toUpperCase();
    const lines = [
      `${ts} [RENDERER-${lvl}] ${String(data?.msg || 'Unbekannter Fehler')}`,
      data?.file  ? `  → Datei: ${String(data.file)}:${data.line ?? '?'}` : null,
      data?.stack ? `  → Stack: ${String(data.stack).split('\n').filter(l => l.trim()).slice(0, 4).join(' | ')}` : null,
      data?.state ? `  → State: ${String(data.state)}` : null,
    ].filter(Boolean).join('\n');
    fs.appendFileSync(logFile, lines + '\n');
  } catch (err) {
    originalWarn('⚠️ Renderer-Log Schreibfehler:', err.message);
  }
  return null;
});

// Sicherer Kanal für den GPX-Export
ipcMain.handle('save-gpx', async (event, { content, filename }) => {
  const { filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'GPX Export für TomTom Rider',
    defaultPath: filename,
    filters: [{ name: 'GPX Datei', extensions: ['gpx'] }]
  });

  if (filePath) {
    try {
      fs.writeFileSync(filePath, content, 'utf8');
      return { success: true, path: filePath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
  return { success: false, cancelled: true };
});

// ── LOG-FENSTER HANDLER ──
let logWindow = null;

function escapeHtml(text) {
  const chars = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return String(text).replace(/[&<>"']/g, c => chars[c]);
}

ipcMain.handle('open-log-window', async () => {
  if (logWindow && !logWindow.isDestroyed()) {
    logWindow.focus();
    return;
  }

  logWindow = new BrowserWindow({
    parent: mainWindow,
    modal: false,
    width: 800,
    height: 600,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  const logContent = fs.existsSync(logFile) 
    ? fs.readFileSync(logFile, 'utf8').split('\n').filter(l => l).map(line => `<div>${escapeHtml(line)}</div>`).join('')
    : '<div style="color:#999;">Keine Logs vorhanden</div>';

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>TourCast 2.0 Pro - Logs</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { background: #EEF2F7; color: #2D3E50; font-family: 'Courier New', monospace; font-size: 12px; }
        #header { position: sticky; top: 0; padding: 10px 15px; background: #FFFFFF; border-bottom: 1px solid #D0D8E0; display: flex; justify-content: space-between; align-items: center; }
        #log-container { padding: 15px; height: calc(100vh - 50px); overflow-y: auto; }
        .log-line { padding: 2px 0; line-height: 1.4; }
        .log-line:hover { background: #F0F4F8; }
        button { padding: 6px 14px; background: #D35400; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; }
        button:hover { background: #C84400; }
      </style>
    </head>
    <body>
      <div id="header">
        <span>📋 TourCast 2.0 Pro - Logs</span>
        <button onclick="window.close()">Schließen</button>
      </div>
      <div id="log-container"></div>
      <script>
        const container = document.getElementById('log-container');
        const logs = '${logContent.replace(/'/g, "\\'")}';
        
        function loadLogs() {
          fetch('').catch(() => {
            // Refresh not available, static mode
          });
        }
        
        function renderLogs(html) {
          container.innerHTML = html || '<div style="color:#999;">Keine Logs</div>';
          container.scrollTop = container.scrollHeight;
        }
        
        renderLogs(logs);
        setInterval(loadLogs, 2000);
      </script>
    </body>
    </html>
  `;

  const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
  logWindow.loadURL(dataUrl);

  logWindow.on('closed', () => {
    logWindow = null;
  });
});

// Fenster-Steuerung (Minimize, Maximize, Close)
ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});
ipcMain.on('window-close', () => mainWindow?.close());