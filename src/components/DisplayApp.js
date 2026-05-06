"use client";

import { useEffect, useState } from "react";
import {
  initFirebase,
  listenCompletedTickets,
  listenCounters,
  listenWaitingTickets,
} from "../lib/firebaseClient";

function formatTime(d) {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatDate(d) {
  return d.toLocaleDateString("en-PH", { weekday: "long", month: "long", day: "numeric" });
}

export default function DisplayApp() {
  const [orgName, setOrgName] = useState("LGU Queuing System");
  const [counters, setCounters] = useState([]);
  const [waiting, setWaiting] = useState([]);
  const [completed, setCompleted] = useState([]);
  const [now, setNow] = useState(() => new Date());
  const [setupError, setSetupError] = useState("");

  useEffect(() => {
    let unsubscribers = [];
    let cancelled = false;

    initFirebase()
      .then(({ appConfig }) => {
        if (cancelled) return;
        setOrgName(appConfig.orgName || "LGU Queuing System");
        unsubscribers = [
          listenCounters(setCounters),
          listenWaitingTickets(setWaiting),
          listenCompletedTickets(setCompleted),
        ];
      })
      .catch((err) => {
        if (!cancelled) setSetupError(err.message);
      });

    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
      unsubscribers.forEach((unsubscribe) => unsubscribe?.());
    };
  }, []);

  if (setupError) {
    return (
      <div className="display-page">
        <div className="notice error">Firebase setup error: {setupError}</div>
      </div>
    );
  }

  const sorted = [...counters].sort((a, b) => Number(a.counterNo) - Number(b.counterNo));
  const total = sorted.length;
  const servingCount = sorted.filter((counter) => counter.currentTicketId).length;

  return (
    <main className="display-page">
      <header className="display-header">
        <div className="display-brand">
          <div className="display-logo">{orgName.charAt(0)}</div>
          <div>
            <h1 className="display-title">{orgName}</h1>
            <div className="display-meta">
              <span className="live-pill"><span className="live-dot" />LIVE</span>
              <span className="display-meta-sep">/</span>
              <span>Queue Display</span>
            </div>
          </div>
        </div>
        <div className="display-clock">
          <div className="display-time tabular">{formatTime(now)}</div>
          <div className="display-date">{formatDate(now)}</div>
        </div>
      </header>

      <div className="display-layout">
        <section className="display-main">
          <div className="display-section-head">
            <span className="section-tag">Now Serving</span>
            <span className="section-count tabular">{servingCount} of {total}</span>
          </div>
          {total === 0 ? (
            <div className="display-empty">
              <div className="display-empty-icon">+</div>
              <div className="display-empty-text">No counters configured yet.<br />Set up counters from Counter Control.</div>
            </div>
          ) : (
            <div className="counter-grid">
              {sorted.map((counter) => <CounterCard counter={counter} key={counter.id} />)}
            </div>
          )}
        </section>

        <aside className="side-panel">
          <div className="list-box">
            <div className="display-section-head">
              <span className="list-title">Next in Queue</span>
              <span className="section-count tabular">{waiting.length}</span>
            </div>
            <div className="list-items">
              {waiting.length ? waiting.slice(0, 7).map((ticket) => (
                <QueueItem ticket={ticket} key={ticket.id} />
              )) : <div className="list-empty">No waiting tickets</div>}
            </div>
          </div>
          <div className="list-box done">
            <div className="display-section-head">
              <span className="list-title">Recently Completed</span>
              <span className="section-count tabular">{completed.length}</span>
            </div>
            <div className="list-items">
              {completed.length ? completed.slice(0, 5).map((ticket) => (
                <QueueItem ticket={ticket} key={ticket.id} />
              )) : <div className="list-empty">No completed tickets yet</div>}
            </div>
          </div>
        </aside>
      </div>

      <footer className="display-footer">
        <span>{orgName}</span>
        <span className="display-footer-sep">/</span>
        <span>Please wait for your number to be called</span>
      </footer>
    </main>
  );
}

function CounterCard({ counter }) {
  const hasCurrent = Boolean(counter.currentQueueNumber);

  return (
    <div className={`counter-card ${hasCurrent ? "active" : ""}`}>
      <div className="counter-card-head">
        <span className="counter-label">{counter.label || `Counter ${counter.counterNo}`}</span>
        <span className={`counter-state-dot ${hasCurrent ? "on" : ""}`} />
      </div>
      <div className="counter-card-body">
        {hasCurrent ? (
          <>
            <div className="current-number tabular">
              {counter.currentQueueNumber}
              {counter.currentPriorityType ? (
                <span className="priority-pill">{counter.currentPriorityType}</span>
              ) : null}
            </div>
            <div className="current-name truncate">{counter.currentCustomerName || "Walk-in customer"}</div>
          </>
        ) : (
          <div className="current-empty tabular">---</div>
        )}
      </div>
      <div className="counter-card-foot">
        {hasCurrent ? (
          <span className="current-service truncate">{counter.currentServiceName || ""}</span>
        ) : (
          <span className="current-empty-sub">Available</span>
        )}
      </div>
    </div>
  );
}

function QueueItem({ ticket }) {
  return (
    <div className="queue-item">
      <div className="queue-item-main">
        <div className="queue-num tabular">
          {ticket.queueNumber}
          {ticket.priorityType ? <span className="priority-pill">{ticket.priorityType}</span> : null}
        </div>
        <div className="queue-name truncate">{ticket.customerName || "Walk-in"}</div>
      </div>
      <div className="queue-meta truncate">{ticket.serviceName || ""}</div>
    </div>
  );
}
