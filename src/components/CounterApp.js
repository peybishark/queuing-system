"use client";

import { useEffect, useState } from "react";
import {
  addCounter,
  callNext,
  completeCounter,
  initFirebase,
  listenCounters,
  listenWaitingTickets,
  recallCounter,
  removeCounter,
  resetTodayQueue,
} from "../lib/firebaseClient";
import { openDisplay } from "../lib/queueApp";

export default function CounterApp() {
  const [orgName, setOrgName] = useState("LGU Queuing System");
  const [counters, setCounters] = useState([]);
  const [waiting, setWaiting] = useState([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [setupError, setSetupError] = useState("");

  useEffect(() => {
    let unsubscribers = [];
    let cancelled = false;

    initFirebase()
      .then(({ appConfig }) => {
        if (cancelled) return;
        setOrgName(appConfig.orgName || "LGU Queuing System");
        unsubscribers = [listenCounters(setCounters), listenWaitingTickets(setWaiting)];
      })
      .catch((err) => {
        if (!cancelled) setSetupError(err.message);
      });

    return () => {
      cancelled = true;
      unsubscribers.forEach((unsubscribe) => unsubscribe?.());
    };
  }, []);

  function setNotice(nextMessage, nextError = "") {
    setMessage(nextMessage);
    setError(nextError);
  }

  async function handleAddCounter() {
    try {
      const result = await addCounter();
      setNotice(`Created Counter ${result.counterNo}.`);
    } catch (err) {
      setNotice("", err.message);
    }
  }

  async function handleRemove(counterNo) {
    if (!confirm(`Remove Counter ${counterNo}?`)) return;
    try {
      await removeCounter(counterNo);
      setNotice(`Counter ${counterNo} removed.`);
    } catch (err) {
      setNotice("", err.message);
    }
  }

  async function handleResetQueue() {
    if (!confirm("Cancel all today's tickets? This cannot be undone.")) return;
    try {
      await resetTodayQueue();
      setNotice("Today's queue was cancelled.");
    } catch (err) {
      setNotice("", err.message);
    }
  }

  async function handleCall(counterNo) {
    try {
      const ticket = await callNext(counterNo);
      setNotice(ticket ? `Called ${ticket.queueNumber} to Counter ${counterNo}.` : "No waiting tickets.");
    } catch (err) {
      setNotice("", err.message);
    }
  }

  async function handleComplete(counterNo) {
    try {
      await completeCounter(counterNo);
      setNotice(`Counter ${counterNo} completed.`);
    } catch (err) {
      setNotice("", err.message);
    }
  }

  async function handleRecall(counterNo) {
    try {
      await recallCounter(counterNo);
      setNotice(`Recalled Counter ${counterNo}.`);
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

  const sorted = [...counters].sort((a, b) => Number(a.counterNo) - Number(b.counterNo));
  const total = sorted.length;
  const servingCount = sorted.filter((counter) => counter.currentTicketId).length;
  const priorityCount = waiting.filter((ticket) => ticket.priorityType).length;

  return (
    <main className="page">
      <div className="topbar">
        <div className="brand">
          <span className="brand-dot" />
          <span>{orgName}<span className="brand-sub"> / Counter Control</span></span>
        </div>
        <div className="actions">
          <button className="btn primary" onClick={handleAddCounter}>+ Add Counter</button>
          <button className="btn" onClick={openDisplay}>Open Display</button>
          <button className="btn danger" onClick={handleResetQueue}>Cancel Today</button>
        </div>
      </div>

      {message ? <div className="notice">{message}</div> : null}
      {error ? <div className="notice error">{error}</div> : null}

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
          <div className="empty-icon">+</div>
          <h2 className="empty-title">No counters yet</h2>
          <p className="empty-text">Tap Add Counter above to create your first counter.</p>
        </div>
      ) : (
        <section className="counter-control-grid">
          {sorted.map((counter) => (
            <ControlCard
              counter={counter}
              key={counter.id}
              onCall={handleCall}
              onComplete={handleComplete}
              onRecall={handleRecall}
              onRemove={handleRemove}
            />
          ))}
        </section>
      )}
    </main>
  );
}

function ControlCard({ counter, onCall, onComplete, onRecall, onRemove }) {
  const hasCurrent = Boolean(counter.currentTicketId);

  return (
    <div className={`control-card ${hasCurrent ? "active" : ""}`}>
      <div className="control-header">
        <h2 className="control-title">{counter.label || `Counter ${counter.counterNo}`}</h2>
        <span className={`control-status ${hasCurrent ? "serving" : "idle"}`}>
          {hasCurrent ? "Serving" : "Idle"}
        </span>
      </div>
      <div className="control-current">
        {hasCurrent ? (
          <>
            <div className="control-number tabular">
              {counter.currentQueueNumber}
              {counter.currentPriorityType ? (
                <span className="priority-pill">{counter.currentPriorityType}</span>
              ) : null}
            </div>
            <div className="control-name">{counter.currentCustomerName || "Walk-in"}</div>
            <div className="control-service">{counter.currentServiceName || ""}</div>
          </>
        ) : (
          <>
            <div className="control-number control-number-empty">No active ticket</div>
            <div className="control-name-empty">Ready to call next</div>
          </>
        )}
      </div>
      <div className="stack">
        <button className="btn primary" disabled={hasCurrent} onClick={() => onCall(counter.counterNo)}>
          Call Next
        </button>
        <div className="control-row">
          <button className="btn" disabled={!hasCurrent} onClick={() => onRecall(counter.counterNo)}>
            Recall
          </button>
          <button className="btn success" disabled={!hasCurrent} onClick={() => onComplete(counter.counterNo)}>
            Complete
          </button>
        </div>
        <button className="btn ghost-danger" disabled={hasCurrent} onClick={() => onRemove(counter.counterNo)}>
          Remove
        </button>
      </div>
    </div>
  );
}
