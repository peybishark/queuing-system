const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("queueApp", {
  getConfig: () => ipcRenderer.invoke("app:getConfig"),
  printTicket: (ticket) => ipcRenderer.invoke("ticket:print", ticket),
  openDisplay: () => ipcRenderer.invoke("app:openDisplay"),
  openCounter: () => ipcRenderer.invoke("app:openCounter"),
});
