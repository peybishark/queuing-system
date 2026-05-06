import "./queueAppShim.js";
import { initFirebase, listenCounters, listenWaitingTickets, listenCompletedTickets } from "./firebaseClient.js";

const app = document.getElementById("app");
let orgName = "LGU Queuing System";
let counters = [];
let waiting = [];
let completed = [];

initFirebase().then(({ appConfig }) => {
  orgName = appConfig.orgName || orgName;
  listenCounters((rows) => { counters = rows; render(); });
  listenWaitingTickets((rows) => { waiting = rows; render(); });
  listenCompletedTickets((rows) => { completed = rows; render(); });
  setInterval(render, 1000);
}).catch((err) => {
  app.innerHTML = `<div class="display-page"><div class="notice error">Firebase setup error: ${err.message}</div></div>`;
});

function formatTime(d) {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}
function formatDate(d) {
  return d.toLocaleDateString("en-PH", { weekday: "long", month: "long", day: "numeric" });
}

function render() {
  const now = new Date();
  const sorted = [...counters].sort((a, b) => Number(a.counterNo) - Number(b.counterNo));
  const total = sorted.length;
  const servingCount = sorted.filter((c) => c.currentTicketId).length;

  app.innerHTML = `
    <main class="display-page">
      <header class="display-header">
        <div class="display-brand">
          <div class="display-logo">${orgName.charAt(0)}</div>
          <div>
            <h1 class="display-title">${escape(orgName)}</h1>
            <div class="display-meta">
              <span class="live-pill"><span class="live-dot"></span>LIVE</span>
              <span class="display-meta-sep">·</span>
              <span>Queue Display</span>
            </div>
          </div>
        </div>
        <div class="display-clock">
          <div class="display-time tabular">${formatTime(now)}</div>
          <div class="display-date">${formatDate(now)}</div>
        </div>
      </header>

      <div class="display-layout">
        <section class="display-main">
          <div class="display-section-head">
            <span class="section-tag">Now Serving</span>
            <span class="section-count tabular">${servingCount} of ${total}</span>
          </div>
          ${total === 0 ? `
            <div class="display-empty">
              <div class="display-empty-icon">⊕</div>
              <div class="display-empty-text">No counters configured yet.<br/>Set up counters from Counter Control.</div>
            </div>
          ` : `
            <div class="counter-grid">
              ${sorted.map(counterCard).join("")}
            </div>
          `}
        </section>

        <aside class="side-panel">
          <div class="list-box">
            <div class="display-section-head">
              <span class="list-title">Next in Queue</span>
              <span class="section-count tabular">${waiting.length}</span>
            </div>
            <div class="list-items">
              ${waiting.length
                ? waiting.slice(0, 7).map(queueItem).join("")
                : `<div class="list-empty">No waiting tickets</div>`}
            </div>
          </div>
          <div class="list-box done">
            <div class="display-section-head">
              <span class="list-title">Recently Completed</span>
              <span class="section-count tabular">${completed.length}</span>
            </div>
            <div class="list-items">
              ${completed.length
                ? completed.slice(0, 5).map(queueItem).join("")
                : `<div class="list-empty">No completed tickets yet</div>`}
            </div>
          </div>
        </aside>
      </div>

      <footer class="display-footer">
        <span>${escape(orgName)}</span>
        <span class="display-footer-sep">·</span>
        <span>Please wait for your number to be called</span>
      </footer>
    </main>
  `;
}

function counterCard(c) {
  const hasCurrent = Boolean(c.currentQueueNumber);
  return `
    <div class="counter-card ${hasCurrent ? "active" : ""}">
      <div class="counter-card-head">
        <span class="counter-label">${escape(c.label || `Counter ${c.counterNo}`)}</span>
        <span class="counter-state-dot ${hasCurrent ? "on" : ""}"></span>
      </div>
      <div class="counter-card-body">
        ${hasCurrent ? `
          <div class="current-number tabular">
            ${escape(c.currentQueueNumber)}
            ${c.currentPriorityType ? `<span class="priority-pill">${escape(c.currentPriorityType)}</span>` : ""}
          </div>
          <div class="current-name truncate">${escape(c.currentCustomerName) || "Walk-in customer"}</div>
        ` : `
          <div class="current-empty tabular">———</div>
        `}
      </div>
      <div class="counter-card-foot">
        ${hasCurrent
          ? `<span class="current-service truncate">${escape(c.currentServiceName) || ""}</span>`
          : `<span class="current-empty-sub">Available</span>`}
      </div>
    </div>
  `;
}

function queueItem(t) {
  return `
    <div class="queue-item">
      <div class="queue-item-main">
        <div class="queue-num tabular">
          ${escape(t.queueNumber)}
          ${t.priorityType ? `<span class="priority-pill">${escape(t.priorityType)}</span>` : ""}
        </div>
        <div class="queue-name truncate">${escape(t.customerName) || "Walk-in"}</div>
      </div>
      <div class="queue-meta truncate">${escape(t.serviceName) || ""}</div>
    </div>
  `;
}

function escape(value) {
  if (value == null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
