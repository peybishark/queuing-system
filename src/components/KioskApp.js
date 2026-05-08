"use client";

import { useEffect, useState } from "react";
import {
  createTicket,
  getClientInfo,
  initFirebase,
  listenServices,
  resolvePairingCode,
  SERVICES,
} from "../lib/firebaseClient";
import { printTicket } from "../lib/queueApp";

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

function priorityLabel(type) {
  if (type === "SC") return "Senior Citizen";
  if (type === "PWD") return "PWD";
  if (type === "PG") return "Pregnant";
  return "";
}

export default function KioskApp() {
  const [orgName, setOrgName] = useState("");
  const [clientId, setClientId] = useState("default");
  const [device, setDevice] = useState(null);
  const [allServices, setAllServices] = useState(SERVICES);
  const [step, setStep] = useState("start");
  const [selectedService, setSelectedService] = useState(null);
  const [priorityType, setPriorityType] = useState(null);
  const [lastTicket, setLastTicket] = useState(null);
  const [now, setNow] = useState(null);
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [message, setMessage] = useState("");
  const [setupError, setSetupError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe;
    const params = new URLSearchParams(window.location.search);
    let pairCode = params.get("pair");
    if (!pairCode) {
      try { pairCode = window.localStorage.getItem("queue_kiosk_pair") || null; } catch (_) { pairCode = null; }
    }
    let clientFromUrl = params.get("client");
    if (!clientFromUrl && !pairCode) {
      try { clientFromUrl = window.localStorage.getItem("queue_kiosk_client") || null; } catch (_) { clientFromUrl = null; }
    }

    async function boot() {
      const paired = pairCode ? await resolvePairingCode(pairCode) : null;
      if (paired) {
        try { window.localStorage.setItem("queue_kiosk_pair", paired.code); } catch (_) {}
      } else if (pairCode && params.get("pair")) {
        try { window.localStorage.removeItem("queue_kiosk_pair"); } catch (_) {}
      }
      if (!paired && clientFromUrl) {
        try { window.localStorage.setItem("queue_kiosk_client", clientFromUrl); } catch (_) {}
      }
      if (params.has("pair") || params.has("client")) {
        window.history.replaceState({}, "", window.location.pathname);
      }
      const nextClientId = paired?.clientId || clientFromUrl || "default";
      if (!cancelled) {
        setClientId(nextClientId);
        setDevice(paired);
      }
      const { appConfig } = await initFirebase(nextClientId);
      if (cancelled) return;
      const clientInfo = await getClientInfo(nextClientId).catch(() => null);
      if (cancelled) return;
      setOrgName(clientInfo?.name || paired?.clientName || appConfig.orgName || "");
      unsubscribe = listenServices(nextClientId, setAllServices);
    }

    boot().catch((err) => {
      if (!cancelled) setSetupError(err.message);
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const allowedServiceIds = Array.isArray(device?.serviceIds) ? device.serviceIds : [];
  const services = allowedServiceIds.length
    ? allServices.filter((service) => allowedServiceIds.includes(service.id))
    : allServices;

  useEffect(() => {
    if (step !== "start") return undefined;
    setNow(new Date());
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
    setConsent(false);
    setMessage("");
    setStep("details");
  }

  async function submitTicket() {
    setSubmitting(true);
    setMessage("");

    try {
      const ticket = await createTicket({
        clientId,
        serviceId: selectedService.id,
        customerName,
        phone,
        priorityType,
      });

      let printResult = { success: true, failureReason: null };
      if (device?.autoPrint !== false) {
        try {
          printResult = await printTicket(ticket);
        } catch (printErr) {
          printResult = { success: false, failureReason: printErr.message };
        }
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
    setConsent(false);
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
          <button className="btn btn-back" onClick={() => setStep("start")}>
            <span className="back-icon" aria-hidden="true">←</span>
            <span>Back</span>
          </button>
          <div className="brand">
            <span className="brand-dot" />
            <span>Queuing System{orgName ? <span className="brand-sub"> · {orgName}</span> : null}</span>
          </div>
        </div>
        <div className="kiosk-services">
          <h1 className="kiosk-heading">Select a service</h1>
          <p className="kiosk-sub">Tap any service to begin your transaction.</p>
          <div className="service-grid">
            {services.map((service) => (
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
          <button className="btn btn-back" onClick={() => setStep("services")}>
            <span className="back-icon" aria-hidden="true">←</span>
            <span>Back</span>
          </button>
          <div className="brand">
            <span className="brand-dot" />
            <span>Queuing System{orgName ? <span className="brand-sub"> · {orgName}</span> : null}</span>
          </div>
        </div>
        <div className="form-wrap">
          <div className="panel">
            <div className="ticket-preview">
              <div className="ticket-number ticket-number--service">{selectedService.name}</div>
              <div className="ticket-preview-hint">Your queue number is generated when you tap Fall in Line.</div>
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
                type="tel"
                placeholder="09xxxxxxxxx"
                autoComplete="off"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={11}
                value={phone}
                onChange={(event) => setPhone(event.target.value.replace(/\D/g, ""))}
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
              <button
                className={`priority-option ${priorityType === "PG" ? "active" : ""}`}
                onClick={() => setPriorityType("PG")}
              >
                Pregnant
              </button>
            </div>
            {(customerName.trim() || phone.trim()) ? (
              <label className="consent-row">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                />
                <span className="consent-text">
                  I consent to the collection and processing of my personal information in compliance with the
                  <strong> Data Privacy Act of 2012 (RA 10173)</strong>, for queue management purposes only.
                </span>
              </label>
            ) : null}
            <button
              className="tap-button full"
              disabled={submitting || ((customerName.trim() || phone.trim()) && !consent)}
              onClick={submitTicket}
            >
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
            <div className="done-label">Your queue number</div>
            <div className="done-number">{lastTicket.queueNumber}</div>
            <div className="done-service">{lastTicket.serviceName}</div>
            {lastTicket.priorityType ? (
              <div className="done-priority">
                {priorityLabel(lastTicket.priorityType)} - Priority Lane
              </div>
            ) : null}
            <p className="done-hint">Please wait for your number to be called.</p>
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
          <span>Queuing System</span>
        </div>
        <div className="kiosk-clock" suppressHydrationWarning>
          <div className="kiosk-time tabular">{now ? formatStartTime(now) : "--:--"}</div>
          <div className="kiosk-date">{now ? formatStartDate(now) : ""}</div>
        </div>
      </header>

      <div className="kiosk-center">
        <div className="kiosk-greeting">Mabuhay!</div>
        <div className="kiosk-greeting-sub">Welcome / Maligayang Pagdating</div>
        <button className="tap-button start-only breathing" onClick={() => setStep("services")}>
          <span>Touch to Start</span>
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
