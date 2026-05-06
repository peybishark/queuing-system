"use client";

import { useEffect, useState } from "react";
import { createTicket, initFirebase, SERVICES } from "../lib/firebaseClient";
import { openCounter, openDisplay, printTicket } from "../lib/queueApp";

function formatStartTime(d) {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatStartDate(d) {
  return d.toLocaleDateString("en-PH", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default function KioskApp() {
  const [orgName, setOrgName] = useState("LGU Queuing System");
  const [step, setStep] = useState("start");
  const [selectedService, setSelectedService] = useState(null);
  const [priorityType, setPriorityType] = useState(null);
  const [lastTicket, setLastTicket] = useState(null);
  const [now, setNow] = useState(() => new Date());
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [setupError, setSetupError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    initFirebase()
      .then(({ appConfig }) => {
        if (!cancelled) setOrgName(appConfig.orgName || "LGU Queuing System");
      })
      .catch((err) => {
        if (!cancelled) setSetupError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (step !== "start") return undefined;
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, [step]);

  useEffect(() => {
    if (step !== "done") return undefined;
    const timer = setTimeout(resetFlow, 10000);
    return () => clearTimeout(timer);
  }, [step]);

  function selectService(service) {
    setSelectedService(service);
    setPriorityType(null);
    setCustomerName("");
    setPhone("");
    setMessage("");
    setStep("details");
  }

  async function submitTicket() {
    setSubmitting(true);
    setMessage("");

    try {
      const ticket = await createTicket({
        serviceId: selectedService.id,
        customerName,
        phone,
        priorityType,
      });

      let printResult = { success: true, failureReason: null };
      try {
        printResult = await printTicket(ticket);
      } catch (printErr) {
        printResult = { success: false, failureReason: printErr.message };
      }

      setLastTicket({
        ...ticket,
        printSuccess: printResult.success !== false,
        printError: printResult.failureReason || null,
      });
      setStep("done");
    } catch (err) {
      setMessage(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  function resetFlow() {
    setStep("start");
    setSelectedService(null);
    setPriorityType(null);
    setLastTicket(null);
    setCustomerName("");
    setPhone("");
    setMessage("");
  }

  if (setupError) {
    return (
      <div className="page">
        <div className="notice error">Firebase setup error: {setupError}</div>
      </div>
    );
  }

  if (step === "services") {
    return (
      <main className="page">
        <div className="topbar">
          <div className="brand">
            <span className="brand-dot" />
            <span>{orgName}</span>
          </div>
          <div className="actions">
            <button className="btn" onClick={() => setStep("start")}>Back</button>
            <button className="btn" onClick={openDisplay}>Display</button>
            <button className="btn" onClick={openCounter}>Counter</button>
          </div>
        </div>
        <div className="kiosk-services">
          <h1 className="kiosk-heading">Select a service</h1>
          <p className="kiosk-sub">Tap any service to begin your transaction.</p>
          <div className="service-grid">
            {SERVICES.map((service) => (
              <button
                className="service-card"
                key={service.id}
                onClick={() => selectService(service)}
              >
                <div className="service-icon">{service.icon}</div>
                <div className="service-title">{service.name}</div>
                <div className="service-prefix">Queue - {service.prefix}</div>
              </button>
            ))}
          </div>
        </div>
      </main>
    );
  }

  if (step === "details" && selectedService) {
    return (
      <main className="page">
        <div className="topbar">
          <div className="brand">
            <span className="brand-dot" />
            <span>{orgName}</span>
          </div>
          <button className="btn" onClick={() => setStep("services")}>Services</button>
        </div>
        <div className="form-wrap">
          <div className="panel">
            <div className="ticket-preview">
              <div className="ticket-preview-label">Your queue number</div>
              <div className="ticket-number">{selectedService.prefix}---</div>
              <div className="ticket-preview-name">{selectedService.name}</div>
              <div className="ticket-preview-hint">Number is generated when you tap Fall in Line.</div>
            </div>
            <div className="field">
              <label htmlFor="nameInput">Name <span className="opt">(optional)</span></label>
              <input
                id="nameInput"
                placeholder="Enter your name"
                autoComplete="off"
                value={customerName}
                onChange={(event) => setCustomerName(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="phoneInput">Phone Number <span className="opt">(optional)</span></label>
              <input
                id="phoneInput"
                placeholder="Enter phone number"
                autoComplete="off"
                inputMode="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
            </div>
            <div className="section-label">Priority Lane</div>
            <div className="priority-row">
              <button
                className={`priority-option ${priorityType === null ? "active" : ""}`}
                onClick={() => setPriorityType(null)}
              >
                Regular
              </button>
              <button
                className={`priority-option ${priorityType === "PWD" ? "active" : ""}`}
                onClick={() => setPriorityType("PWD")}
              >
                PWD
              </button>
              <button
                className={`priority-option ${priorityType === "SC" ? "active" : ""}`}
                onClick={() => setPriorityType("SC")}
              >
                Senior
              </button>
            </div>
            <button className="tap-button full" disabled={submitting} onClick={submitTicket}>
              {submitting ? "Please wait..." : "Fall in Line"}
            </button>
            {message ? <div className="notice error">{message}</div> : null}
          </div>
        </div>
      </main>
    );
  }

  if (step === "done" && lastTicket) {
    return (
      <main className="page">
        <div className="done-wrap">
          <div className="done-card">
            <div className="done-icon">OK</div>
            <div className="done-label">Your queue number</div>
            <div className="done-number">{lastTicket.queueNumber}</div>
            <div className="done-service">{lastTicket.serviceName}</div>
            {lastTicket.priorityType ? (
              <div className="done-priority">
                {lastTicket.priorityType === "SC" ? "Senior Citizen" : "PWD"} - Priority Lane
              </div>
            ) : null}
            <p className="done-hint">
              {lastTicket.printSuccess === false
                ? "Take a screenshot or note your number. Printing was not available."
                : "Your ticket is printing. Please wait for your number to be called."}
            </p>
            <button className="tap-button full" onClick={resetFlow}>New Transaction</button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <section className="kiosk-start">
      <div className="kiosk-bg" aria-hidden="true" />
      <div className="kiosk-overlay" aria-hidden="true" />

      <header className="kiosk-top">
        <div className="kiosk-brand-mark">
          <span className="brand-dot" />
          <span>{orgName}</span>
        </div>
        <div className="kiosk-clock">
          <div className="kiosk-time tabular">{formatStartTime(now)}</div>
          <div className="kiosk-date">{formatStartDate(now)}</div>
        </div>
      </header>

      <div className="kiosk-center">
        <div className="kiosk-greeting">Mabuhay!</div>
        <div className="kiosk-greeting-sub">Welcome / Maligayang Pagdating</div>
        <button className="tap-button start-only breathing" onClick={() => setStep("services")}>
          <span className="start-arrow">Start</span>
          <span>Tap to Start</span>
        </button>
        <div className="kiosk-greeting-hint">I-tap ang button upang magsimula</div>
      </div>

      <footer className="kiosk-bottom">
        <span className="hours-dot" />
        Open Monday - Friday / 8:00 AM - 5:00 PM
      </footer>
    </section>
  );
}
