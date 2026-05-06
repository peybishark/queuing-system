import "./queueAppShim.js";
import {
  initFirebase,
  listenCounters,
  listenWaitingTickets,
  callNext,
  completeCounter,
  recallCounter,
  resetTodayQueue,
  addCounter,
  removeCounter,
} from "./firebaseClient.js";

const app = document.getElementById("app");
let orgName = "LGU Queuing System";
let counters = [];
let waiting = [];
let message = "";
let error = "";

initFirebase().then(({ appConfig }) => {
  orgName = appConfig.orgName || orgName;
  listenCounters((rows) => { counters = rows; render(); });
  listenWaitingTickets((rows) => { waiting = rows; render(); });
}).catch((err) => {
  app.innerHTML = `<div class="page"><div class="notice error">Firebase setup error: ${err.message}</div></div>`;
});

function render() {
  const sorted = [...counters].sort((a, b) => Number(a.counterNo) - Number(b.counterNo));
  const total = sorted.length;
  const servingCount = sorted.filter((c) => c.currentTicketId).length;
  const priorityCount = waiting.filter((t) => t.priorityType).length;

  app.innerHTML = `
    <main class="page">
      <div class="topbar">
        <div class="brand">
          <span class="brand-dot"></span>
          <span>${escape(orgName)}<span class="brand-sub">· Counter Control</span></span>
        </div>
        <div class="actions">
          <button class="btn primary" id="addCounterBtn">+ Add Counter</button>
          <button class="btn" id="openDisplay">Open Display</button>
          <button class="btn danger" id="resetBtn">Cancel Today</button>
        </div>
      </div>

      ${message ? `<div class="notice">${escape(message)}</div>` : ""}
      ${error ? `<div class="notice error">${escape(error)}</div>` : ""}

      <div class="stats-bar">
        <div class="stat">
          <div class="stat-label">Waiting</div>
          <div class="stat-value tabular">${waiting.length}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Priority</div>
          <div class="stat-value tabular">${priorityCount}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Now Serving</div>
          <div class="stat-value tabular">${servingCount}<span class="stat-divider">/</span>${total}</div>
        </div>
      </div>

      ${total === 0 ? `
        <div class="empty-state">
          <div class="empty-icon">⊕</div>
          <h2 class="empty-title">No counters yet</h2>
          <p class="empty-text">Tap “Add Counter” above to create your first counter.</p>
        </div>
      ` : `
        <section class="counter-control-grid">
          ${sorted.map(controlCard).join("")}
        </section>
      `}
    </main>
  `;

  document.getElementById("addCounterBtn").onclick = handleAddCounter;
  document.getElementById("openDisplay").onclick = () => window.queueApp.openDisplay();
  document.getElementById("resetBtn").onclick = handleResetQueue;

  sorted.forEach((c) => {
    document.getElementById(`call-${c.counterNo}`).onclick = () => handleCall(c.counterNo);
    document.getElementById(`complete-${c.counterNo}`).onclick = () => handleComplete(c.counterNo);
    document.getElementById(`recall-${c.counterNo}`).onclick = () => handleRecall(c.counterNo);
    const removeBtn = document.getElementById(`remove-${c.counterNo}`);
    if (removeBtn) removeBtn.onclick = () => handleRemove(c.counterNo);
  });
}

function controlCard(c) {
  const hasCurrent = Boolean(c.currentTicketId);
  return `
    <div class="control-card ${hasCurrent ? "active" : ""}">
      <div class="control-header">
        <h2 class="control-title">${escape(c.label || `Counter ${c.counterNo}`)}</h2>
        <span class="control-status ${hasCurrent ? "serving" : "idle"}">${hasCurrent ? "Serving" : "Idle"}</span>
      </div>
      <div class="control-current">
        ${hasCurrent ? `
          <div class="control-number tabular">
            ${escape(c.currentQueueNumber)}
            ${c.currentPriorityType ? `<span class="priority-pill">${escape(c.currentPriorityType)}</span>` : ""}
          </div>
          <div class="control-name">${escape(c.currentCustomerName) || "Walk-in"}</div>
          <div class="control-service">${escape(c.currentServiceName) || ""}</div>
        ` : `
          <div class="control-number control-number-empty">No active ticket</div>
          <div class="control-name-empty">Ready to call next</div>
        `}
      </div>
      <div class="stack">
        <button class="btn primary" id="call-${c.counterNo}" ${hasCurrent ? "disabled" : ""}>Call Next</button>
        <div class="control-row">
          <button class="btn" id="recall-${c.counterNo}" ${!hasCurrent ? "disabled" : ""}>Recall</button>
          <button class="btn success" id="complete-${c.counterNo}" ${!hasCurrent ? "disabled" : ""}>Complete</button>
        </div>
        <button class="btn ghost-danger" id="remove-${c.counterNo}" ${hasCurrent ? "disabled" : ""}>Remove</button>
      </div>
    </div>
  `;
}

async function handleAddCounter() {
  try {
    const result = await addCounter();
    message = `Created Counter ${result.counterNo}.`;
    error = "";
  } catch (err) {
    error = err.message;
    message = "";
  }
  render();
}

async function handleRemove(counterNo) {
  if (!confirm(`Remove Counter ${counterNo}?`)) return;
  try {
    await removeCounter(counterNo);
    message = `Counter ${counterNo} removed.`;
    error = "";
  } catch (err) {
    error = err.message;
    message = "";
  }
  render();
}

async function handleResetQueue() {
  if (!confirm("Cancel all today's tickets? This cannot be undone.")) return;
  await resetTodayQueue();
  message = "Today's queue was cancelled.";
  error = "";
  render();
}

async function handleCall(counterNo) {
  try {
    const ticket = await callNext(counterNo);
    message = ticket ? `Called ${ticket.queueNumber} to Counter ${counterNo}.` : "No waiting tickets.";
    error = "";
  } catch (err) {
    error = err.message;
    message = "";
  }
  render();
}

async function handleComplete(counterNo) {
  try {
    await completeCounter(counterNo);
    message = `Counter ${counterNo} completed.`;
    error = "";
  } catch (err) {
    error = err.message;
    message = "";
  }
  render();
}

async function handleRecall(counterNo) {
  try {
    await recallCounter(counterNo);
    message = `Recalled Counter ${counterNo}.`;
    error = "";
  } catch (err) {
    error = err.message;
    message = "";
  }
  render();
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
