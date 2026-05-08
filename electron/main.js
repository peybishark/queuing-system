const { app, BrowserWindow, ipcMain, Menu, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const isDev = !app.isPackaged;

// Runtime config — read from config.json next to the installed exe so admins
// can change URL / startup path / kiosk mode without rebuilding the app.
function readRuntimeConfig() {
  const candidates = [];
  if (!isDev) {
    candidates.push(path.join(path.dirname(app.getPath("exe")), "config.json"));
    candidates.push(path.join(process.resourcesPath, "config.json"));
  }
  candidates.push(path.join(__dirname, "..", "config.json"));
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        return JSON.parse(fs.readFileSync(p, "utf8"));
      }
    } catch (_) { /* ignore */ }
  }
  return {};
}

const runtime = readRuntimeConfig();

const REMOTE_URL = process.env.ELECTRON_REMOTE_URL || runtime.remoteUrl || "";
const DEV_URL = process.env.ELECTRON_DEV_URL || runtime.devUrl || "http://localhost:3000";
const STARTUP_PATH = process.env.ELECTRON_STARTUP_PATH || runtime.startupPath || "/kiosk";
const KIOSK_MODE = process.env.ELECTRON_KIOSK === "1" || runtime.kiosk === true;
const FULLSCREEN = process.env.ELECTRON_FULLSCREEN === "1" || runtime.fullscreen === true;
const PRINTER_NAME = process.env.PRINTER_NAME || runtime.printerName || undefined;
const USE_REMOTE = Boolean(REMOTE_URL);

let mainWindow;
let nextProcess;

function startNextServerIfNeeded() {
  if (isDev) return;
  if (USE_REMOTE) return; // No local server when loading a remote URL
  const nextBinary = path.join(process.resourcesPath, "app", "node_modules", "next", "dist", "bin", "next");
  nextProcess = spawn("node", [nextBinary, "start", "-p", "3000"], {
    cwd: path.join(process.resourcesPath, "app"),
    stdio: "ignore",
    detached: false,
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 900,
    backgroundColor: "#F0FDFA",
    autoHideMenuBar: true,
    fullscreen: FULLSCREEN || KIOSK_MODE,
    kiosk: KIOSK_MODE,
    title: "Queuing System",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (KIOSK_MODE) {
    Menu.setApplicationMenu(null);
    mainWindow.setMenuBarVisibility(false);
  }

  const baseUrl = USE_REMOTE ? REMOTE_URL.replace(/\/$/, "") : DEV_URL;
  const url = `${baseUrl}${STARTUP_PATH}`;

  const tryLoad = (attempt = 0) => {
    mainWindow.loadURL(url).catch((err) => {
      if (attempt < 30) {
        setTimeout(() => tryLoad(attempt + 1), 1000);
      } else if (!KIOSK_MODE) {
        dialog.showErrorBox("Cannot reach server", `${url}\n\n${err.message}`);
      }
    });
  };
  tryLoad();

  // Allow Ctrl+Shift+Q (or Cmd+Shift+Q) to exit kiosk mode for staff.
  mainWindow.webContents.on("before-input-event", (_event, input) => {
    if (KIOSK_MODE && input.shift && (input.control || input.meta) && input.key.toLowerCase() === "q") {
      app.quit();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  startNextServerIfNeeded();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (nextProcess) {
    try { nextProcess.kill(); } catch (_) { /* ignore */ }
  }
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("queue:silent-print", async (_event, html) => {
  const printWindow = new BrowserWindow({
    width: 320,
    height: 520,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  try {
    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    return await new Promise((resolve) => {
      printWindow.webContents.print(
        {
          silent: true,
          printBackground: true,
          deviceName: PRINTER_NAME,
          margins: { marginType: "none" },
          pageSize: { width: 80000, height: 200000 },
        },
        (success, failureReason) => {
          try { printWindow.close(); } catch (_) {}
          resolve({ success, failureReason: failureReason || null });
        }
      );
    });
  } catch (err) {
    try { printWindow.close(); } catch (_) {}
    return { success: false, failureReason: err.message };
  }
});

ipcMain.handle("queue:list-printers", async () => {
  if (!mainWindow) return [];
  try {
    const printers = await mainWindow.webContents.getPrintersAsync();
    return printers.map((p) => ({ name: p.name, isDefault: p.isDefault }));
  } catch (_) {
    return [];
  }
});
