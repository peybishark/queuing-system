const path = require("path");
const { app, BrowserWindow, ipcMain } = require("electron");

const isDev = !app.isPackaged;
const envPath = isDev
  ? path.join(__dirname, "..", "..", ".env")
  : path.join(process.resourcesPath, ".env");
require("dotenv").config({ path: envPath });

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || "http://localhost:5173";

let kioskWindow;
let displayWindow;
let counterWindow;

const getFirebaseConfig = () => ({
  apiKey: process.env.FIREBASE_API_KEY || "",
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || "",
  projectId: process.env.FIREBASE_PROJECT_ID || "",
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "",
  appId: process.env.FIREBASE_APP_ID || "",
});

const getPreloadPath = () => path.join(__dirname, "preload.js");

function createWindow(file, options = {}) {
  const win = new BrowserWindow({
    width: options.width || 1200,
    height: options.height || 800,
    fullscreen: Boolean(options.fullscreen),
    title: options.title || "Queue System",
    backgroundColor: "#F7F7F5",
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    win.loadURL(`${DEV_SERVER_URL}/${file}`);
  } else {
    win.loadFile(path.join(__dirname, "..", "..", "dist", "renderer", file));
  }
  return win;
}

function createAllWindows() {
  kioskWindow = createWindow("kiosk.html", { title: "Queue Kiosk", width: 1100, height: 800 });
  displayWindow = createWindow("display.html", { title: "Queue Display", width: 1400, height: 900 });
  counterWindow = createWindow("counter.html", { title: "Counter Control", width: 1200, height: 850 });
}

app.whenReady().then(() => {
  createAllWindows();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createAllWindows();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("app:getConfig", () => ({
  firebase: getFirebaseConfig(),
  orgName: process.env.QUEUE_ORG_NAME || "LGU Queuing System",
}));

ipcMain.handle("app:openDisplay", () => {
  if (!displayWindow || displayWindow.isDestroyed()) {
    displayWindow = createWindow("display.html", { title: "Queue Display", width: 1400, height: 900 });
  }
  displayWindow.focus();
});

ipcMain.handle("app:openCounter", () => {
  if (!counterWindow || counterWindow.isDestroyed()) {
    counterWindow = createWindow("counter.html", { title: "Counter Control", width: 1200, height: 850 });
  }
  counterWindow.focus();
});

ipcMain.handle("ticket:print", async (_event, ticket) => {
  const printWindow = new BrowserWindow({
    width: 320,
    height: 520,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const html = `
    <!doctype html>
    <html>
      <head>
        <meta charset="UTF-8" />
        <style>
          @page { size: 80mm auto; margin: 4mm; }
          body { font-family: Arial, sans-serif; text-align: center; margin: 0; color: #111827; }
          .org { font-size: 13px; font-weight: 800; margin-top: 8px; }
          .service { font-size: 14px; margin-top: 8px; }
          .number { font-size: 42px; font-weight: 900; letter-spacing: 1px; margin: 14px 0; }
          .priority { font-size: 16px; font-weight: 900; color: #DC2626; margin-bottom: 8px; }
          .name { font-size: 13px; margin-bottom: 4px; }
          .small { font-size: 11px; color: #374151; margin-top: 8px; }
          .line { border-top: 1px dashed #9CA3AF; margin: 10px 0; }
        </style>
      </head>
      <body>
        <div class="org">${escapeHtml(ticket.orgName || "Queue System")}</div>
        <div class="line"></div>
        <div class="service">${escapeHtml(ticket.serviceName || "Service")}</div>
        <div class="number">${escapeHtml(ticket.queueNumber || "---")}</div>
        ${ticket.priorityType ? `<div class="priority">${escapeHtml(ticket.priorityType)}</div>` : ""}
        ${ticket.customerName ? `<div class="name">${escapeHtml(ticket.customerName)}</div>` : ""}
        <div class="line"></div>
        <div class="small">Please wait for your number to be called.</div>
        <div class="small">${new Date().toLocaleString()}</div>
      </body>
    </html>
  `;

  await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

  const silentPrint = String(process.env.SILENT_PRINT || "true").toLowerCase() !== "false";
  const printerName = process.env.PRINTER_NAME || undefined;

  return new Promise((resolve) => {
    printWindow.webContents.print(
      {
        silent: silentPrint,
        printBackground: true,
        deviceName: printerName,
        margins: { marginType: "none" },
        pageSize: { width: 80000, height: 200000 },
      },
      (success, failureReason) => {
        printWindow.close();
        resolve({ success, failureReason: failureReason || null });
      }
    );
  });
});

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
