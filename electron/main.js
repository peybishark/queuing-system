const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { spawn } = require("child_process");

const isDev = !app.isPackaged;
const DEV_URL = process.env.ELECTRON_DEV_URL || "http://localhost:3000";
const STARTUP_PATH = process.env.ELECTRON_STARTUP_PATH || "/kiosk";

let mainWindow;
let nextProcess;

function startNextServerIfNeeded() {
  if (isDev) return; // dev expects user to run `npm run dev` separately
  // In packaged builds we boot Next.js as a child process so /api routes work.
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
    fullscreen: process.env.ELECTRON_FULLSCREEN === "1",
    kiosk: process.env.ELECTRON_KIOSK === "1",
    title: "Queuing System",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Wait until the dev/prod server is ready, then load the URL.
  const url = `${DEV_URL}${STARTUP_PATH}`;
  const tryLoad = (attempt = 0) => {
    mainWindow.loadURL(url).catch(() => {
      if (attempt < 30) setTimeout(() => tryLoad(attempt + 1), 1000);
    });
  };
  tryLoad();

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

// Silent print: render the ticket HTML in a hidden BrowserWindow and print
// directly to the system default printer (no dialog). True silent printing
// that the browser web-only path cannot achieve.
ipcMain.handle("queue:silent-print", async (_event, html) => {
  const printerName = process.env.PRINTER_NAME || undefined;
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
          deviceName: printerName,
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
