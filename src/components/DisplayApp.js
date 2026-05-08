"use client";

import { useEffect, useRef, useState } from "react";
import {
  getClientInfo,
  initFirebase,
  listenCountersForClient,
  listenWaitingTicketsForClient,
  resolvePairingCode,
  sweepQueueTimeouts,
} from "../lib/firebaseClient";

function formatTime(d) {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatDate(d) {
  return d.toLocaleDateString("en-PH", { weekday: "long", month: "long", day: "numeric" });
}

function abbreviateName(name) {
  if (!name) return "";
  const cleaned = String(name).trim();
  if (!cleaned) return "";
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function spellTicket(queueNumber) {
  if (!queueNumber) return "";
  const [prefix, number] = String(queueNumber).split("-");
  // Periods after each letter force TTS to read them as letters.
  const spelledPrefix = (prefix || "").split("").map((c) => `${c}.`).join(" ");
  return `${spelledPrefix} ${number || ""}`.trim();
}

function spellTicketFilipino(queueNumber) {
  if (!queueNumber) return "";
  const [prefix, number] = String(queueNumber).split("-");
  // Use periods between letters to force TTS to read each one as a letter
  // (e.g., "B.P." → "Bee Pee", not the word "bi pi"). Numbers stay as-is so
  // they read as digits.
  const spelledPrefix = (prefix || "").split("").map((c) => `${c}.`).join(" ");
  return `${spelledPrefix} ${number || ""}`.trim();
}

function getTimestampKey(value) {
  if (!value) return "";
  if (typeof value.toMillis === "function") return String(value.toMillis());
  if (value.seconds) return String(value.seconds);
  return String(value);
}

export default function DisplayApp() {
  const [orgName, setOrgName] = useState("");
  const [logo, setLogo] = useState(null);
  const [themeColor, setThemeColor] = useState(null);
  const [counters, setCounters] = useState([]);
  const [waiting, setWaiting] = useState([]);
  const [now, setNow] = useState(null);
  const [setupError, setSetupError] = useState("");
  const [audioReady, setAudioReady] = useState(false);

  const audioCtxRef = useRef(null);
  const prevCountersRef = useRef(new Map());
  const announcedRef = useRef(false);

  useEffect(() => {
    let unsubscribers = [];
    let sweepTimer;
    let cancelled = false;

    const params = new URLSearchParams(window.location.search);
    let pairCode = params.get("pair");
    if (!pairCode) {
      try { pairCode = window.localStorage.getItem("queue_display_pair") || null; } catch (_) { pairCode = null; }
    }
    let clientFromUrl = params.get("client");
    if (!clientFromUrl && !pairCode) {
      try { clientFromUrl = window.localStorage.getItem("queue_display_client") || null; } catch (_) { clientFromUrl = null; }
    }

    async function boot() {
      const paired = pairCode ? await resolvePairingCode(pairCode) : null;
      if (paired) {
        try { window.localStorage.setItem("queue_display_pair", paired.code); } catch (_) {}
      } else if (pairCode && params.get("pair")) {
        try { window.localStorage.removeItem("queue_display_pair"); } catch (_) {}
      }
      if (!paired && clientFromUrl) {
        try { window.localStorage.setItem("queue_display_client", clientFromUrl); } catch (_) {}
      }
      if (params.has("pair") || params.has("client")) {
        window.history.replaceState({}, "", window.location.pathname);
      }
      const clientId = paired?.clientId || clientFromUrl || "default";
      const { appConfig } = await initFirebase(clientId);
      if (cancelled) return;
      // Prefer client doc name (set by superadmin) > pairing client name > env fallback
      const clientInfo = await getClientInfo(clientId).catch(() => null);
      if (cancelled) return;
      setOrgName(clientInfo?.name || paired?.clientName || appConfig.orgName || "");
      setLogo(clientInfo?.logo || null);
      setThemeColor(clientInfo?.themeColor || null);
      await sweepQueueTimeouts(clientId);
      unsubscribers = [
        listenCountersForClient(clientId, setCounters),
        listenWaitingTicketsForClient(clientId, setWaiting),
      ];
      sweepTimer = setInterval(() => sweepQueueTimeouts(clientId).catch(() => {}), 3000);
    }

    boot().catch((err) => {
      if (!cancelled) setSetupError(err.message);
    });

    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
      clearInterval(sweepTimer);
      unsubscribers.forEach((unsubscribe) => unsubscribe?.());
    };
  }, []);

  // Detect counter changes — announce on call/recall
  useEffect(() => {
    const prev = prevCountersRef.current;
    const next = new Map();
    const events = [];

    counters.forEach((counter) => {
      const key = String(counter.counterNo);
      const snapshot = {
        currentTicketId: counter.currentTicketId || null,
        currentQueueNumber: counter.currentQueueNumber || null,
        recallKey: getTimestampKey(counter.recallAt),
        deadlineKey: getTimestampKey(counter.responseDeadlineAt),
        label: counter.label || `Counter ${counter.counterNo}`,
        counterNo: Number(counter.counterNo),
      };
      next.set(key, snapshot);

      const previous = prev.get(key);
      if (!previous) return; // first observation; skip announcement

      // Newly assigned ticket
      if (
        snapshot.currentTicketId &&
        snapshot.currentTicketId !== previous.currentTicketId
      ) {
        events.push({
          type: "call",
          label: snapshot.label,
          counterNo: snapshot.counterNo,
          queueNumber: snapshot.currentQueueNumber,
        });
        return;
      }

      // Recall pressed (recallAt newly set on same ticket)
      if (
        snapshot.currentTicketId &&
        snapshot.currentTicketId === previous.currentTicketId &&
        snapshot.recallKey &&
        snapshot.recallKey !== previous.recallKey
      ) {
        events.push({
          type: "recall",
          label: snapshot.label,
          counterNo: snapshot.counterNo,
          queueNumber: snapshot.currentQueueNumber,
        });
      }
    });

    prevCountersRef.current = next;

    // First render — set baseline only, no announcements
    if (!announcedRef.current) {
      announcedRef.current = true;
      return;
    }

    if (!audioReady) return;
    events.forEach((event) => announce(event));
  }, [counters, audioReady]);

  function announce({ type, label, counterNo, queueNumber }) {
    playChime(audioCtxRef.current, type);
    speak(type, label, counterNo, queueNumber);
  }

  function enableAudio() {
    if (typeof window === "undefined") return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx && !audioCtxRef.current) audioCtxRef.current = new Ctx();
      if (audioCtxRef.current?.state === "suspended") audioCtxRef.current.resume();
      // Trigger speech synthesis init (some browsers require user gesture)
      if (window.speechSynthesis) {
        // Trigger voice list load — Chromium async-loads voices on first call.
        window.speechSynthesis.getVoices();
        if (typeof window.speechSynthesis.onvoiceschanged !== "undefined") {
          window.speechSynthesis.onvoiceschanged = () => {
            window.speechSynthesis.getVoices();
          };
        }
        const u = new SpeechSynthesisUtterance("");
        u.volume = 0;
        window.speechSynthesis.speak(u);
      }
      setAudioReady(true);
    } catch (_) {
      setAudioReady(true);
    }
  }

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

  const themeStyle = themeColor ? { "--brand-accent": themeColor } : undefined;
  return (
    <main className="display-page" style={themeStyle}>
      {!audioReady ? (
        <button className="audio-enable" onClick={enableAudio}>
          <span className="audio-enable-icon">♪</span>
          <span>Tap to enable announcements</span>
        </button>
      ) : null}
      <header className="display-header">
        <div className="display-brand">
          <div className="display-logo" style={logo ? { padding: 0, background: "#fff" } : undefined}>
            {logo ? <img src={logo} alt="logo" style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : (abbreviateName(orgName) || "Q")}
          </div>
          <div className="display-brand-text">
            <h1 className="display-title">{orgName || "Queuing System"}</h1>
            <div className="display-meta">
              <span className="live-pill"><span className="live-dot" />LIVE</span>
              <span className="display-meta-text">Queue Display</span>
            </div>
          </div>
        </div>
        <div className="display-clock" suppressHydrationWarning>
          <div className="display-time tabular">{now ? formatTime(now) : "--:--"}</div>
          <div className="display-date">{now ? formatDate(now) : ""}</div>
        </div>
      </header>

      <div className="display-layout">
        <section className="display-main">
          <div className="display-section-head">
            <span className="section-tag">Now Serving</span>
            <span className="section-count tabular">{servingCount}/{total}</span>
          </div>
          {total === 0 ? (
            <div className="display-empty">
              <div className="display-empty-icon">+</div>
              <div className="display-empty-text">No counters configured yet.<br />Set up counters from Counter Control.</div>
            </div>
          ) : (
            <div className="counter-grid" data-count={Math.min(total, 6)}>
              {sorted.map((counter) => <CounterCard counter={counter} now={now} key={counter.id} />)}
            </div>
          )}
        </section>

        <section className="display-queue-row">
          <div className="display-section-head">
            <span className="list-title">Next in Queue</span>
            <span className="section-count tabular">{waiting.length}</span>
          </div>
          <div className="display-queue-list">
            {waiting.length ? waiting.map((ticket) => (
              <QueueItem ticket={ticket} key={ticket.id} />
            )) : <div className="list-empty">No waiting tickets</div>}
          </div>
        </section>
      </div>

      <footer className="display-footer">
        <span>Please wait for your number to be called</span>
      </footer>
    </main>
  );
}

function CounterCard({ counter, now }) {
  const hasCurrent = Boolean(counter.currentQueueNumber);
  const hasRecall = hasCurrent && Boolean(counter.recallAt);
  const hasDeadline = hasCurrent && Boolean(counter.responseDeadlineAt);
  const isPaused = Boolean(counter.paused);
  const secondsLeft = hasDeadline ? deadlineSecondsLeft(counter.responseDeadlineAt, now) : null;
  const isUrgent = hasDeadline && secondsLeft <= 3;
  const showRecallBanner = hasRecall || hasDeadline;
  const counterLabel = counter.label || `Counter ${counter.counterNo}`;

  return (
    <div className={`counter-card ${hasCurrent ? "active" : ""} ${showRecallBanner ? "recalling" : ""} ${isPaused ? "paused" : ""}`}>
      <div className="counter-card-head">
        <span className="counter-label">{counterLabel}</span>
        <span className={`counter-state-dot ${isPaused ? "paused" : hasCurrent ? "on" : ""}`} />
      </div>
      <div className="counter-card-body">
        {isPaused ? (
          <>
            <div className="current-empty tabular">☕</div>
            <div className="current-empty-sub">On Break</div>
          </>
        ) : hasCurrent ? (
          <>
            <div className="current-number tabular">
              {counter.currentQueueNumber}
              {counter.currentPriorityType ? (
                <span className="priority-pill">{counter.currentPriorityType}</span>
              ) : null}
            </div>
            <div className="current-name truncate">{counter.currentCustomerName || "Walk-in customer"}</div>
            {showRecallBanner ? (
              <div className={`recall-banner ${isUrgent ? "urgent" : ""}`}>
                <div className="recall-line">FINAL CALL · PUMUNTA NA PO</div>
                <div className="recall-sub">
                  Please proceed to {counterLabel}
                  {hasDeadline ? <> · <span className="tabular">{secondsLeft}s</span></> : null}
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <div className="current-empty tabular">---</div>
        )}
      </div>
      <div className="counter-card-foot">
        {isPaused ? (
          <span className="current-empty-sub">Will resume soon</span>
        ) : hasCurrent ? (
          <span className="current-service truncate">{counter.currentServiceName || ""}</span>
        ) : (
          <span className="current-empty-sub">Available</span>
        )}
      </div>
    </div>
  );
}

function playChime(ctx, type) {
  if (!ctx) return;
  try {
    if (ctx.state === "suspended") ctx.resume();
    const start = ctx.currentTime;
    const tones = type === "recall"
      ? [{ f: 880, t: 0.0 }, { f: 660, t: 0.15 }, { f: 880, t: 0.3 }]
      : [{ f: 523, t: 0.0 }, { f: 659, t: 0.15 }, { f: 784, t: 0.3 }];
    tones.forEach(({ f, t }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = f;
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0.001, start + t);
      gain.gain.exponentialRampToValueAtTime(0.35, start + t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + t + 0.45);
      osc.start(start + t);
      osc.stop(start + t + 0.5);
    });
  } catch (_) { /* ignore */ }
}

const TAGALOG_COUNTER_NAMES = {
  1: "Unang Counter",
  2: "Pangalawang Counter",
  3: "Pangatlong Counter",
  4: "Pang-apat na Counter",
  5: "Panlimang Counter",
  6: "Pang-anim na Counter",
  7: "Pampitong Counter",
  8: "Pangwalong Counter",
  9: "Pansiyam na Counter",
  10: "Pansampung Counter",
};

function tagalogCounterName(counterNo, fallbackLabel) {
  if (TAGALOG_COUNTER_NAMES[counterNo]) return TAGALOG_COUNTER_NAMES[counterNo];
  if (counterNo > 0) return `Ika-${counterNo} na Counter`;
  return fallbackLabel || "Counter";
}

function pickVoice(langPrefixes) {
  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices() || [];
  for (const prefix of langPrefixes) {
    const found = voices.find((voice) => voice.lang && voice.lang.toLowerCase().startsWith(prefix.toLowerCase()));
    if (found) return found;
  }
  return null;
}

function speak(type, counterLabel, counterNo, queueNumber) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  try {
    window.speechSynthesis.cancel();
    const spelledEn = spellTicket(queueNumber);
    const spelledFil = spellTicketFilipino(queueNumber);
    const englishCounter = counterLabel || "the counter";
    const filipinoCounter = tagalogCounterName(counterNo, counterLabel);

    // Comma pauses produce more natural Tagalog cadence; periods give a stronger stop.
    const englishText = type === "recall"
      ? `Final call. Number, ${spelledEn}, please proceed to ${englishCounter}.`
      : `Now serving, number ${spelledEn}, at ${englishCounter}.`;

    const filipinoText = type === "recall"
      ? `Huling tawag po. Numero, ${spelledFil}. Pakipuntahan po ang ${filipinoCounter}.`
      : `Pumunta po, ang numero ${spelledFil}, sa ${filipinoCounter}.`;

    const englishVoice = pickVoice(["en-PH", "en-US", "en-GB", "en"]);
    const filipinoVoice = pickVoice(["fil-PH", "tl-PH", "fil", "tl"]);
    // If no Filipino voice is installed, the en-PH voice is the closest match
    // for Tagalog cadence (it understands Filipino vowels).
    const filFallbackVoice = filipinoVoice || pickVoice(["en-PH", "en-AU", "en-GB", "en-US", "en"]);

    const en = new SpeechSynthesisUtterance(englishText);
    en.lang = englishVoice?.lang || "en-US";
    if (englishVoice) en.voice = englishVoice;
    en.rate = 0.92;
    en.pitch = 1;

    const fil = new SpeechSynthesisUtterance(filipinoText);
    fil.lang = filipinoVoice?.lang || "fil-PH";
    if (filFallbackVoice) fil.voice = filFallbackVoice;
    // Slower rate for Tagalog when falling back to an English voice — easier
    // for listeners to parse the Tagalog syllables.
    fil.rate = filipinoVoice ? 0.9 : 0.78;
    fil.pitch = 1;

    window.speechSynthesis.speak(en);
    window.speechSynthesis.speak(fil);
  } catch (_) { /* ignore */ }
}

function deadlineSecondsLeft(deadline, now) {
  if (!deadline || !now) return 0;
  const millis = typeof deadline.toMillis === "function"
    ? deadline.toMillis()
    : deadline.seconds ? deadline.seconds * 1000
    : Number(deadline) || 0;
  return Math.max(0, Math.ceil((millis - now.getTime()) / 1000));
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
