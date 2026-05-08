const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronQueue", {
  isElectron: true,
  silentPrint: (html) => ipcRenderer.invoke("queue:silent-print", html),
  listPrinters: () => ipcRenderer.invoke("queue:list-printers"),
});
