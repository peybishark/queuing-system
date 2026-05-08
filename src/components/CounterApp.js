"use client";

import { useEffect, useState } from "react";
import {
  callNext,
  completeCounter,
  getClientInfo,
  holdCounter,
  initFirebase,
  listenCountersForClient,
  listenWaitingTicketsForClient,
  logAuthEvent,
  pauseCounter,
  recallCounter,
  resolvePairingCode,
  resetTodayQueue,
  resumeCounter,
  sweepQueueTimeouts,
} from "../lib/firebaseClient";
import { openDisplay } from "../lib/queueApp";

export default function CounterApp() {
  const [orgName, setOrgName] = useState("");
  const [clientId, setClientId] = useState("default");
  const [device, setDevice] = useState(null);
  const [staff, setStaff] = useState(null);
  const [counters, setCounters] = useState([]);
  const [waiting, setWaiting] = useState([]);
  const [nowMs, setNowMs] = useState(Date.now());
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!message) return undefined;
    const t = setTimeout(() => setMessage(""), 3000);
    return () => clearTimeout(t);
  }, [message]);
  useEffect(() => {
    if (!error) return undefined;
    const t = setTimeout(() => setError(""), 5000);
    return () => clearTimeout(t);
  }, [error]);
  const [setupError, setSetupError] = useState("");

  useEffect(() => {
    let unsubscribers = [];
    let sweepTimer;
    let clockTimer;
    let cancelled = false;

    const params = new URLSearchParams(window.location.search);
    let pairCode = params.get("pair");
    if (!pairCode) {
      try { pairCode = window.localStorage.getItem("queue_counter_pair") || null; } catch (_) { pairCode = null; }
    }
    let clientFromUrl = params.get("client");
    if (!clientFromUrl && !pairCode) {
      try { clientFromUrl = window.localStorage.getItem("queue_counter_client") || null; } catch (_) { clientFromUrl = null; }
    }
    const counterFromUrl = params.get("counter");
    let staffSession = null;
    try {
      const raw = window.localStorage.getItem("queue_staff");
      if (raw) staffSession = JSON.parse(raw);
    } catch (_) { staffSession = null; }

    // If no pairing code AND no staff session, force login
    if (!pairCode && !staffSession) {
      const redirect = counterFromUrl ? `/?counter=${counterFromUrl}` : "/";
      window.location.replace(redirect);
      return () => {};
    }

    async function boot() {
      const paired = pairCode ? await resolvePairingCode(pairCode) : null;
      if (paired) {
        try { window.localStorage.setItem("queue_counter_pair", paired.code); } catch (_) {}
      } else if (pairCode && params.get("pair")) {
        try { window.localStorage.removeItem("queue_counter_pair"); } catch (_) {}
      }
      if (!paired && clientFromUrl) {
        try { window.localStorage.setItem("queue_counter_client", clientFromUrl); } catch (_) {}
      }
      if (params.has("pair") || params.has("client") || params.has("counter")) {
        window.history.replaceState({}, "", window.location.pathname);
      }
      const nextClientId = paired?.clientId || staffSession?.clientId || clientFromUrl || "default";
      const effectiveDevice = paired || (counterFromUrl ? { counterNo: Number(counterFromUrl), autoPrint: true } : null);
      if (!cancelled) {
        setClientId(nextClientId);
        setDevice(effectiveDevice);
        setStaff(staffSession);
      }
      const { appConfig } = await initFirebase(nextClientId);
      if (cancelled) return;
      const clientInfo = await getClientInfo(nextClientId).catch(() => null);
      if (cancelled) return;
      setOrgName(clientInfo?.name || appConfig.orgName || "");
      await sweepQueueTimeouts(nextClientId);
      unsubscribers = [listenCountersForClient(nextClientId, setCounters), listenWaitingTicketsForClient(nextClientId, setWaiting)];
      sweepTimer = setInterval(() => sweepQueueTimeouts(nextClientId).catch(() => {}), 3000);
      clockTimer = setInterval(() => setNowMs(Date.now()), 1000);
    }

    boot().catch((err) => {
      if (!cancelled) setSetupError(err.message);
    });

    return () => {
      cancelled = true;
      clearInterval(sweepTimer);
      clearInterval(clockTimer);
      unsubscribers.forEach((unsubscribe) => unsubscribe?.());
    };
  }, []);

  function setNotice(nextMessage, nextError = "") {
    setMessage(nextMessage);
    setError(nextError);
  }

  async function handleStaffLogout() {
    if (!confirm("Logout from this counter?")) return;
    try {
      if (staff) await logAuthEvent(clientId, "logout", staff);
    } catch (_) {}
    try { window.localStorage.removeItem("queue_staff"); } catch (_) {}
    window.location.replace("/");
  }

  // Auto-call next ticket whenever a counter is idle (and not paused) and
  // there are waiting tickets. Firestore transaction in callNext handles race
  // conditions across clients.
  const idleKey = counters
    .filter((counter) => !counter.currentTicketId && !counter.paused)
    .map((counter) => counter.counterNo)
    .sort((a, b) => Number(a) - Number(b))
    .join(",");

  useEffect(() => {
    if (!clientId || !idleKey || waiting.length === 0) return;
    counters
      .filter((counter) => !counter.currentTicketId)
      .filter((counter) => !counter.paused)
      .filter((counter) => !device?.counterNo || Number(counter.counterNo) === Number(device.counterNo))
      .forEach((counter) => {
        callNext(counter.counterNo, clientId).catch(() => {});
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idleKey, waiting.length, clientId]);

  async function handleResetQueue() {
    if (!confirm("Cancel all today's tickets? This cannot be undone.")) return;
    try {
      await resetTodayQueue(clientId);
      setNotice("Today's queue was cancelled.");
    } catch (err) {
      setNotice("", err.message);
    }
  }

  async function handleComplete(counterNo) {
    try {
      await completeCounter(counterNo, clientId);
      const nextTicket = await callNext(counterNo, clientId).catch(() => null);
      if (nextTicket) {
        setNotice(`Counter ${counterNo} completed. Now serving ${nextTicket.queueNumber}.`);
      } else {
        setNotice(`Counter ${counterNo} completed.`);
      }
    } catch (err) {
      setNotice("", err.message);
    }
  }

  async function handleRecall(counterNo) {
    try {
      await recallCounter(counterNo, clientId);
      setNotice(`Recalled Counter ${counterNo}. Announcement playing, 10-second timer follows.`);
    } catch (err) {
      setNotice("", err.message);
    }
  }

  async function handleHold(counterNo) {
    try {
      await holdCounter(counterNo, clientId);
      setNotice(`Counter ${counterNo} on hold. Auto-cancel paused.`);
    } catch (err) {
      setNotice("", err.message);
    }
  }

  async function handleTogglePause(counter) {
    try {
      if (counter.paused) {
        await resumeCounter(counter.counterNo, clientId, staff);
        setNotice(`${counter.label || `Counter ${counter.counterNo}`} resumed.`);
      } else {
        await pauseCounter(counter.counterNo, clientId, staff);
        setNotice(`${counter.label || `Counter ${counter.counterNo}`} on break.`);
      }
    } catch (err) {
      setNotice("", err.message);
    }
  }

  if (setupError) {
    return (
      <div className="page">
        <div className="notice error">Firebase setup error: {setupError}</div>
      </div>
    );
  }

  const sorted = [...counters]
    .filter((counter) => !device?.counterNo || Number(counter.counterNo) === Number(device.counterNo))
    .sort((a, b) => Number(a.counterNo) - Number(b.counterNo));
  const total = sorted.length;
  const servingCount = sorted.filter((counter) => counter.currentTicketId).length;
  const priorityCount = waiting.filter((ticket) => ticket.priorityType).length;

  return (
    <main className="page">
      <div className="topbar">
        <div className="brand">
          <span className="brand-dot" />
          <span>
            Queuing System
            <span className="brand-sub"> / Counter Control{orgName ? ` · ${orgName}` : ""}{staff?.name ? ` · ${staff.name}` : ""}</span>
          </span>
        </div>
        <div className="actions">
          <button className="btn" onClick={openDisplay}>Open Display</button>
          {!device && !staff ? <button className="btn danger" onClick={handleResetQueue}>Cancel Today</button> : null}
          {staff ? <button className="btn" onClick={handleStaffLogout}>Logout</button> : null}
        </div>
      </div>

      <CaToast message={message} type="success" onClose={() => setMessage("")} />
      <CaToast message={error} type="error" onClose={() => setError("")} />

      <div className="stats-bar">
        <div className="stat">
          <div className="stat-label">Waiting</div>
          <div className="stat-value tabular">{waiting.length}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Priority</div>
          <div className="stat-value tabular">{priorityCount}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Now Serving</div>
          <div className="stat-value tabular">{servingCount}<span className="stat-divider">/</span>{total}</div>
        </div>
      </div>

      {total === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">i</div>
          <h2 className="empty-title">No counters yet</h2>
          <p className="empty-text">Counters are managed from the admin page.</p>
        </div>
      ) : (
        <section className="counter-control-grid">
          {sorted.map((counter) => (
            <ControlCard
              counter={counter}
              key={counter.id}
              onComplete={handleComplete}
              onRecall={handleRecall}
              onHold={handleHold}
              onTogglePause={handleTogglePause}
              nowMs={nowMs}
            />
          ))}
        </section>
      )}
    </main>
  );
}

function CaToast({ message, type, onClose }) {
  if (!message) return null;
  const titles = { success: "Success", error: "Error", info: "Info" };
  const icons = { success: "✓", error: "!", info: "i" };
  return (
    <div className="toast-stack">
      <div className={`toast ${type}`} role="alert">
        <span className="toast-icon">{icons[type]}</span>
        <div className="toast-body">
          <div className="toast-title">{titles[type]}</div>
          <div className="toast-message">{message}</div>
        </div>
        <button className="toast-close" onClick={onClose} aria-label="Dismiss">×</button>
        <div className="toast-progress" />
      </div>
    </div>
  );
}

function ControlCard({ counter, onComplete, onRecall, onHold, onTogglePause, nowMs }) {
  const hasCurrent = Boolean(counter.currentTicketId);
  const hasRecall = hasCurrent && Boolean(counter.recallAt);
  const hasDeadline = hasCurrent && Boolean(counter.responseDeadlineAt);
  const isAnnouncing = hasRecall && !hasDeadline;
  const isPaused = Boolean(counter.paused);
  const secondsLeft = hasDeadline ? getSecondsLeft(counter.responseDeadlineAt, nowMs) : null;

  return (
    <div className={`control-card ${hasCurrent ? "active" : ""} ${isPaused ? "paused" : ""}`}>
      <div className="control-header">
        <h2 className="control-title">{counter.label || `Counter ${counter.counterNo}`}</h2>
        <span className={`control-status ${isPaused ? "paused" : hasCurrent ? "serving" : "idle"}`}>
          {isPaused ? "On break" : hasCurrent ? "Serving" : "Idle"}
        </span>
      </div>
      <div className="control-current">
        {isPaused ? (
          <>
            <div className="control-number control-number-empty">☕ On break</div>
            <div className="control-name-empty">No tickets will be assigned until resumed</div>
          </>
        ) : hasCurrent ? (
          <>
            <div className="control-number tabular">
              {counter.currentQueueNumber}
              {counter.currentPriorityType ? (
                <span className="priority-pill">{counter.currentPriorityType}</span>
              ) : null}
            </div>
            <div className="control-name">{counter.currentCustomerName || "Walk-in"}</div>
            <div className="control-service">{counter.currentServiceName || ""}</div>
            {isAnnouncing ? (
              <div className="control-timer announcing">Announcing… please wait</div>
            ) : null}
            {hasDeadline ? (
              <div className={`control-timer ${secondsLeft <= 3 ? "urgent" : ""}`}>
                Auto-cancel in {secondsLeft}s
              </div>
            ) : null}
            {(isAnnouncing || hasDeadline) && onHold ? (
              <button className="btn btn-hold" onClick={() => onHold(counter.counterNo)}>
                ⏸ Hold (pause auto-cancel)
              </button>
            ) : null}
          </>
        ) : (
          <>
            <div className="control-number control-number-empty">Waiting for next…</div>
            <div className="control-name-empty">Auto-assigns when a ticket is in queue</div>
          </>
        )}
      </div>
      <div className="stack">
        <div className="control-row">
          <button className="btn" disabled={!hasCurrent || isPaused} onClick={() => onRecall(counter.counterNo)}>
            Recall
          </button>
          <button className="btn success" disabled={!hasCurrent || isPaused} onClick={() => onComplete(counter.counterNo)}>
            Complete
          </button>
        </div>
        {onTogglePause ? (
          <button className={`btn ${isPaused ? "primary" : "ghost-warn"}`} onClick={() => onTogglePause(counter)} disabled={hasCurrent && !isPaused}>
            {isPaused ? "▶ Resume Counter" : "⏸ Take a Break"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function getSecondsLeft(deadline, nowMs) {
  if (!deadline) return 0;
  const millis = typeof deadline.toMillis === "function" ? deadline.toMillis() : deadline.seconds ? deadline.seconds * 1000 : Number(deadline) || 0;
  return Math.max(0, Math.ceil((millis - nowMs) / 1000));
}
