let cachedConfig;

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

export async function getConfig() {
  if (cachedConfig) return cachedConfig;
  const response = await fetch("/api/config", { cache: "no-store" });
  if (!response.ok) throw new Error("Unable to load app configuration.");
  cachedConfig = await response.json();
  return cachedConfig;
}

export async function printTicket(ticket) {
  // Electron path — true silent printing via main process IPC. No browser
  // dialog, no kiosk-printing flag dependency, prints directly to default
  // printer.
  if (typeof window !== "undefined" && window.electronQueue?.silentPrint) {
    try {
      const result = await window.electronQueue.silentPrint(buildTicketHtml(ticket));
      return result || { success: true, failureReason: null };
    } catch (err) {
      return { success: false, failureReason: err.message };
    }
  }

  // Web fallback — iframe + window.print(). Silent only when the browser was
  // launched with --kiosk-printing (Edge/Chrome).
  return new Promise((resolve) => {
    try {
      const iframe = document.createElement("iframe");
      iframe.setAttribute("aria-hidden", "true");
      iframe.style.position = "fixed";
      iframe.style.right = "0";
      iframe.style.bottom = "0";
      iframe.style.width = "0";
      iframe.style.height = "0";
      iframe.style.border = "0";
      iframe.style.opacity = "0";
      document.body.appendChild(iframe);

      const cleanup = () => {
        setTimeout(() => {
          try { document.body.removeChild(iframe); } catch (_) { /* ignore */ }
        }, 1500);
      };

      iframe.onload = () => {
        try {
          iframe.contentWindow.focus();
          iframe.contentWindow.print();
          resolve({ success: true, failureReason: null });
        } catch (err) {
          resolve({ success: false, failureReason: err.message });
        } finally {
          cleanup();
        }
      };

      iframe.srcdoc = buildTicketHtml(ticket);
    } catch (err) {
      resolve({ success: false, failureReason: err.message });
    }
  });
}

export function openDisplay() {
  window.open("/display", "_blank");
}

export function openCounter() {
  window.open("/counter", "_blank");
}
