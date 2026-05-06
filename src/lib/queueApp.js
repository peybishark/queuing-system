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
  try {
    const popup = window.open("", "_blank", "width=340,height=560");
    if (!popup) {
      return { success: false, failureReason: "Popup blocked. Allow popups to print." };
    }

    popup.document.open();
    popup.document.write(buildTicketHtml(ticket));
    popup.document.close();
    popup.focus();

    setTimeout(() => {
      try {
        popup.print();
      } catch (_) {
        // The caller receives success for the opened ticket preview.
      }
      setTimeout(() => {
        try {
          popup.close();
        } catch (_) {}
      }, 800);
    }, 250);

    return { success: true, failureReason: null };
  } catch (err) {
    return { success: false, failureReason: err.message };
  }
}

export function openDisplay() {
  window.open("/display", "_blank");
}

export function openCounter() {
  window.open("/counter", "_blank");
}
