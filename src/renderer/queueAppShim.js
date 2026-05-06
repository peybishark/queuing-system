// Polyfill window.queueApp when running in a browser (no Electron preload).
// In Electron, src/main/preload.js already exposes window.queueApp via contextBridge,
// so this file becomes a no-op there.

if (typeof window !== "undefined" && !window.queueApp) {
  const env = import.meta.env || {};

  const firebaseConfig = {
    apiKey: env.FIREBASE_API_KEY,
    authDomain: env.FIREBASE_AUTH_DOMAIN,
    projectId: env.FIREBASE_PROJECT_ID,
    storageBucket: env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.FIREBASE_MESSAGING_SENDER_ID,
    appId: env.FIREBASE_APP_ID,
  };

  if (!firebaseConfig.apiKey) {
    console.warn(
      "[queueAppShim] Firebase config missing in import.meta.env. " +
      "Make sure your .env has FIREBASE_* values and that vite.config.mjs has envPrefix including 'FIREBASE_'."
    );
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function buildTicketHtml(ticket) {
    return `
      <!doctype html>
      <html>
        <head>
          <meta charset="UTF-8" />
          <title>Queue Ticket</title>
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
  }

  window.queueApp = {
    async getConfig() {
      return {
        firebase: firebaseConfig,
        orgName: env.QUEUE_ORG_NAME || "LGU Queuing System",
      };
    },

    async printTicket(ticket) {
      try {
        const w = window.open("", "_blank", "width=340,height=560");
        if (!w) return { success: false, failureReason: "Popup blocked. Allow popups to print." };
        w.document.open();
        w.document.write(buildTicketHtml(ticket));
        w.document.close();
        w.focus();
        w.onload = () => {
          try { w.print(); } catch (_) {}
          setTimeout(() => { try { w.close(); } catch (_) {} }, 800);
        };
        return { success: true };
      } catch (err) {
        return { success: false, failureReason: err.message };
      }
    },

    openDisplay() { window.open("/display.html", "_blank"); },
    openCounter() { window.open("/counter.html", "_blank"); },
  };
}
