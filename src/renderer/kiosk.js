import "./queueAppShim.js";
import { initFirebase, SERVICES, createTicket } from "./firebaseClient.js";

const app = document.getElementById("app");
let orgName = "LGU Queuing System";
let step = "start";
let selectedService = null;
let priorityType = null;
let lastTicket = null;
let startClockInterval = null;

function formatStartTime(d) {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}
function formatStartDate(d) {
  return d.toLocaleDateString("en-PH", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}
function clearStartClock() {
  if (startClockInterval) { clearInterval(startClockInterval); startClockInterval = null; }
}

initFirebase().then(({ appConfig }) => {
  orgName = appConfig.orgName || orgName;
  render();
}).catch((err) => {
  app.innerHTML = `<div class="page"><div class="notice error">Firebase setup error: ${err.message}</div></div>`;
});

function render() {
  if (step !== "start") clearStartClock();
  if (step === "start") return renderStart();
  if (step === "services") return renderServices();
  if (step === "details") return renderDetails();
  if (step === "done") return renderDone();
}

function renderStart() {
  const now = new Date();
  app.innerHTML = `
    <section class="kiosk-start">
      <div class="kiosk-bg" aria-hidden="true"></div>
      <div class="kiosk-overlay" aria-hidden="true"></div>

      <header class="kiosk-top">
        <div class="kiosk-brand-mark">
          <span class="brand-dot"></span>
          <span>${orgName}</span>
        </div>
        <div class="kiosk-clock">
          <div class="kiosk-time tabular" id="startClock">${formatStartTime(now)}</div>
          <div class="kiosk-date" id="startDate">${formatStartDate(now)}</div>
        </div>
      </header>

      <div class="kiosk-center">
        <div class="kiosk-greeting">Mabuhay!</div>
        <div class="kiosk-greeting-sub">Welcome · Maligayang Pagdating</div>
        <button class="tap-button start-only breathing" id="startBtn">
          <span class="start-arrow">→</span>
          <span>TAP TO START</span>
        </button>
        <div class="kiosk-greeting-hint">I-tap ang button upang magsimula</div>
      </div>

      <footer class="kiosk-bottom">
        <span class="hours-dot"></span>
        Open Monday – Friday · 8:00 AM – 5:00 PM
      </footer>
    </section>
  `;
  document.getElementById("startBtn").onclick = () => { clearStartClock(); step = "services"; render(); };

  clearStartClock();
  startClockInterval = setInterval(() => {
    const clock = document.getElementById("startClock");
    const date = document.getElementById("startDate");
    if (!clock || !date) { clearStartClock(); return; }
    const n = new Date();
    clock.textContent = formatStartTime(n);
    date.textContent = formatStartDate(n);
  }, 1000);
}

function renderServices() {
  app.innerHTML = `
    <main class="page">
      <div class="topbar">
        <div class="brand">
          <span class="brand-dot"></span>
          <span>${orgName}</span>
        </div>
        <div class="actions">
          <button class="btn" id="backBtn">← Back</button>
          <button class="btn" id="displayBtn">Display</button>
          <button class="btn" id="counterBtn">Counter</button>
        </div>
      </div>
      <div class="kiosk-services">
        <h1 class="kiosk-heading">Select a service</h1>
        <p class="kiosk-sub">Tap any service to begin your transaction.</p>
        <div class="service-grid">
          ${SERVICES.map((s) => `
            <button class="service-card" data-service="${s.id}">
              <div class="service-icon">${s.icon}</div>
              <div class="service-title">${s.name}</div>
              <div class="service-prefix">Queue · ${s.prefix}</div>
            </button>
          `).join("")}
        </div>
      </div>
    </main>
  `;
  document.getElementById("backBtn").onclick = () => { step = "start"; render(); };
  document.getElementById("displayBtn").onclick = () => window.queueApp.openDisplay();
  document.getElementById("counterBtn").onclick = () => window.queueApp.openCounter();
  document.querySelectorAll("[data-service]").forEach((btn) => {
    btn.onclick = () => {
      selectedService = SERVICES.find((s) => s.id === btn.dataset.service);
      priorityType = null;
      step = "details";
      render();
    };
  });
}

function renderDetails() {
  app.innerHTML = `
    <main class="page">
      <div class="topbar">
        <div class="brand">
          <span class="brand-dot"></span>
          <span>${orgName}</span>
        </div>
        <button class="btn" id="backBtn">← Services</button>
      </div>
      <div class="form-wrap">
        <div class="panel">
          <div class="ticket-preview">
            <div class="ticket-preview-label">Your queue number</div>
            <div class="ticket-number">${selectedService.prefix}-—</div>
            <div class="ticket-preview-name">${selectedService.name}</div>
            <div class="ticket-preview-hint">Number is generated when you tap Fall in Line.</div>
          </div>
          <div class="field">
            <label>Name <span class="opt">(optional)</span></label>
            <input id="nameInput" placeholder="Enter your name" autocomplete="off" />
          </div>
          <div class="field">
            <label>Phone Number <span class="opt">(optional)</span></label>
            <input id="phoneInput" placeholder="Enter phone number" autocomplete="off" inputmode="tel" />
          </div>
          <div class="section-label">Priority Lane</div>
          <div class="priority-row">
            <button class="priority-option ${priorityType === null ? "active" : ""}" data-priority="">Regular</button>
            <button class="priority-option ${priorityType === "PWD" ? "active" : ""}" data-priority="PWD">PWD</button>
            <button class="priority-option ${priorityType === "SC" ? "active" : ""}" data-priority="SC">Senior</button>
          </div>
          <button class="tap-button full" id="submitBtn">Fall in Line</button>
          <div id="msg"></div>
        </div>
      </div>
    </main>
  `;
  document.getElementById("backBtn").onclick = () => { step = "services"; render(); };
  document.querySelectorAll("[data-priority]").forEach((btn) => {
    btn.onclick = () => {
      priorityType = btn.dataset.priority || null;
      renderDetails();
    };
  });
  document.getElementById("submitBtn").onclick = submitTicket;
}

async function submitTicket() {
  const submitBtn = document.getElementById("submitBtn");
  const msg = document.getElementById("msg");
  submitBtn.disabled = true;
  submitBtn.textContent = "Please wait…";
  msg.innerHTML = "";

  try {
    const ticket = await createTicket({
      serviceId: selectedService.id,
      customerName: document.getElementById("nameInput").value,
      phone: document.getElementById("phoneInput").value,
      priorityType,
    });
    lastTicket = ticket;

    let printResult = { success: true };
    try {
      printResult = await window.queueApp.printTicket(ticket);
    } catch (printErr) {
      printResult = { success: false, failureReason: printErr.message };
    }
    lastTicket = { ...ticket, printSuccess: printResult.success !== false, printError: printResult.failureReason || null };

    step = "done";
    render();
  } catch (err) {
    msg.innerHTML = `<div class="notice error">${err.message}</div>`;
    submitBtn.disabled = false;
    submitBtn.textContent = "Fall in Line";
  }
}

function renderDone() {
  app.innerHTML = `
    <main class="page">
      <div class="done-wrap">
        <div class="done-card">
          <div class="done-icon">✓</div>
          <div class="done-label">Your queue number</div>
          <div class="done-number">${lastTicket.queueNumber}</div>
          <div class="done-service">${lastTicket.serviceName}</div>
          ${lastTicket.priorityType ? `<div class="done-priority">${lastTicket.priorityType === "SC" ? "Senior Citizen" : "PWD"} · Priority Lane</div>` : ""}
          <p class="done-hint">${lastTicket.printSuccess === false
            ? "Take a screenshot or note your number — printing was not available."
            : "Your ticket is printing. Please wait for your number to be called."}</p>
          <button class="tap-button full" id="newBtn">New Transaction</button>
        </div>
      </div>
    </main>
  `;
  document.getElementById("newBtn").onclick = resetFlow;
  setTimeout(() => { if (step === "done") resetFlow(); }, 10000);
}

function resetFlow() {
  step = "start";
  selectedService = null;
  priorityType = null;
  lastTicket = null;
  render();
}
