"use client";

import { useEffect, useRef, useState } from "react";
import {
  addAdminToClient,
  addCounter,
  addService,
  adminLogin,
  completeCounter,
  computeAnalytics,
  createPairingCode,
  deleteAdmin,
  deletePairing,
  deleteService,
  getTicketsInRange,
  initFirebase,
  listAdmins,
  listenActivityLogs,
  listenAllServices,
  listenAllTickets,
  listenCountersForClient,
  listenPairings,
  reenableService,
  removeCounter,
  logAuthEvent,
  removeService,
  setAdminActive,
  setPairingActive,
  superAdminLogin,
  updateAdminCredentials,
  updateClient,
  updateCounterLabel,
  updateCounterServices,
  updatePairingServices,
  updateService,
} from "../lib/firebaseClient";

export default function AdminApp() {
  const [session, setSession] = useState(null);
  const [activePage, setActivePage] = useState("overview");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [login, setLogin] = useState({ email: "", password: "" });
  const [services, setServices] = useState([]);
  const [counters, setCounters] = useState([]);
  const [pairings, setPairings] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [activityLogs, setActivityLogs] = useState([]);
  const [serviceForm, setServiceForm] = useState({ name: "", prefix: "" });
  const [counterForm, setCounterForm] = useState({ label: "" });
  const [pairForm, setPairForm] = useState({ type: "kiosk", counterNo: "1", label: "", autoPrint: true, silentPrinter: false, serviceIds: [] });
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loadingDone, setLoadingDone] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Auto-dismiss notices after 3s, errors after 5s
  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(""), 3000);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    if (!error) return undefined;
    const t = setTimeout(() => setError(""), 5000);
    return () => clearTimeout(t);
  }, [error]);

  useEffect(() => {
    initFirebase().catch((err) => setError(err.message));
    const saved = window.localStorage.getItem("queue_admin");
    if (saved) setSession(JSON.parse(saved));
    setSidebarCollapsed(window.localStorage.getItem("queue_admin_sidebar") === "collapsed");
  }, []);

  useEffect(() => {
    if (!session) {
      setLoadingDone(false);
      return undefined;
    }
    setLoadingDone(false);
    const timer = setTimeout(() => setLoadingDone(true), 1200);
    return () => clearTimeout(timer);
  }, [session]);

  useEffect(() => {
    if (!session?.clientId) return undefined;
    let unsubscribers = [];
    initFirebase(session.clientId)
      .then(() => {
        unsubscribers = [
          listenAllServices(session.clientId, setServices),
          listenCountersForClient(session.clientId, setCounters),
          listenPairings(session.clientId, setPairings),
          listenAllTickets(session.clientId, setTickets),
          listenActivityLogs(session.clientId, setActivityLogs, 200),
        ];
      })
      .catch((err) => setError(err.message));
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe?.());
  }, [session]);

  async function handleLogin(event) {
    event.preventDefault();
    setError("");
    try {
      const nextSession = await adminLogin(login.email, login.password);
      // Log login event (fire-and-forget)
      logAuthEvent(nextSession.clientId, "login", nextSession);
      if (nextSession.role === "staff") {
        // Counter staff — redirect to /counter, preserving any ?counter=N param.
        const urlParams = new URLSearchParams(window.location.search);
        const counterNo = urlParams.get("counter");
        window.localStorage.setItem("queue_staff", JSON.stringify(nextSession));
        window.location.href = counterNo ? `/counter?counter=${counterNo}` : "/counter";
        return;
      }
      window.localStorage.setItem("queue_admin", JSON.stringify(nextSession));
      setSession(nextSession);
    } catch (err) {
      try {
        const superSession = await superAdminLogin(login.email, login.password);
        window.localStorage.setItem("queue_superadmin", JSON.stringify(superSession));
        window.location.href = "/superadmin";
      } catch (_) {
        setError(err.message);
      }
    }
  }

  async function handleAddService(event) {
    event.preventDefault();
    setNotice("");
    setError("");
    try {
      await addService(session.clientId, serviceForm, session);
      setServiceForm({ name: "", prefix: "" });
      setNotice("Service added.");
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleAddCounter(event) {
    event.preventDefault();
    setNotice("");
    setError("");
    try {
      const result = await addCounter(counterForm.label, session.clientId, [], session);
      setCounterForm({ label: "" });
      setNotice(`Counter ${result.counterNo} added.`);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleRenameCounter(counter, newLabel) {
    setError("");
    try {
      await updateCounterLabel(session.clientId, counter.counterNo, newLabel, session);
      setNotice(`Counter renamed to ${newLabel}.`);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleRemoveCounter(counter) {
    setNotice("");
    setError("");
    const counterLabel = counter.label || `Counter ${counter.counterNo}`;
    const warning = counter.currentTicketId
      ? `${counterLabel} is currently serving ${counter.currentQueueNumber || "a ticket"}. Removing it will cancel that session.\n\nProceed?`
      : `Remove ${counterLabel}? This cannot be undone.`;
    if (!confirm(warning)) return;
    try {
      // If counter has an active ticket, complete it first to release the ticket cleanly
      if (counter.currentTicketId) {
        await completeCounter(counter.counterNo, session.clientId).catch(() => {});
      }
      await removeCounter(counter.counterNo, session.clientId, session);
      setNotice(`${counterLabel} removed.`);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleToggleCounterService(counter, serviceId) {
    const current = Array.isArray(counter.serviceIds) ? counter.serviceIds : [];
    const next = current.includes(serviceId) ? current.filter((id) => id !== serviceId) : [...current, serviceId];
    try {
      await updateCounterServices(session.clientId, counter.counterNo, next);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleCreatePair(event) {
    event.preventDefault();
    setNotice("");
    setError("");
    try {
      const code = await createPairingCode(session.clientId, pairForm, session);
      setNotice(`Pairing code created: ${code}`);
      setPairForm((prev) => ({ ...prev, label: "", serviceIds: [] }));
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleTogglePairingService(pair, serviceId) {
    const current = Array.isArray(pair.serviceIds) ? pair.serviceIds : [];
    const next = current.includes(serviceId) ? current.filter((id) => id !== serviceId) : [...current, serviceId];
    try {
      await updatePairingServices(pair.code, next, session);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleSetPairingServices(pair, serviceIds) {
    try {
      await updatePairingServices(pair.code, Array.isArray(serviceIds) ? serviceIds : [], session);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleTogglePairingActive(pair) {
    const next = pair.active === false ? true : false;
    try {
      await setPairingActive(pair.code, next, session);
      setNotice(`Pairing ${pair.code} ${next ? "re-enabled" : "disabled"}.`);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDeletePairing(pair) {
    if (!confirm(`Delete pairing code ${pair.code}? The bound device will be unpaired and need a new code.`)) return;
    try {
      await deletePairing(pair.code, session);
      setNotice(`Pairing ${pair.code} deleted.`);
    } catch (err) {
      setError(err.message);
    }
  }

  function logout() {
    try { if (session) logAuthEvent(session.clientId, "logout", session); } catch (_) {}
    window.localStorage.removeItem("queue_admin");
    setSession(null);
  }

  function toggleSidebar() {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    window.localStorage.setItem("queue_admin_sidebar", next ? "collapsed" : "expanded");
  }

  if (!session) {
    return (
      <main className="page auth-page">
        <form className="auth-panel" onSubmit={handleLogin}>
          <h1 className="auth-title">Queue Account Login</h1>
          <input placeholder="Email" value={login.email} onChange={(e) => setLogin({ ...login, email: e.target.value })} />
          <div className="password-field">
            <input
              placeholder="Password"
              type={showPassword ? "text" : "password"}
              value={login.password}
              onChange={(e) => setLogin({ ...login, password: e.target.value })}
            />
            <button
              type="button"
              className="password-toggle"
              aria-label={showPassword ? "Hide password" : "Show password"}
              onClick={() => setShowPassword((value) => !value)}
            >
              {showPassword ? (
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>
          <button className="btn primary full-width">Login</button>
          {error ? <div className="notice error">{error}</div> : null}
        </form>
      </main>
    );
  }

  if (!loadingDone) {
    return (
      <main className="page auth-page">
        <div className="auth-panel">
          <div className="auth-kicker">Admin</div>
          <div className="loading-spinner" aria-hidden="true" />
          <h1 className="auth-title">Opening dashboard…</h1>
          <p className="auth-sub">Please wait while we set things up.</p>
        </div>
      </main>
    );
  }

  return (
    <main className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="app-sidebar">
        <div className="sidebar-brand">
          <span className="brand-dot" />
          <span className="sidebar-abbrev">{getInitials(session.clientName)}</span>
          <div>
            <strong>{session.clientName}</strong>
            <span>Admin portal</span>
          </div>
          <button className="sidebar-toggle" onClick={toggleSidebar} title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}>
            <span className="hamburger-lines" />
          </button>
        </div>
        <nav className="sidebar-nav">
          {[
            ["overview", "Overview", iconOverview()],
            ["activity", "Activity", iconActivity()],
            ["setup", "Setup", iconServices()],
            ["staff", "Staff", iconStaff()],
            ["pairing", "Pairing", iconPairing()],
            ["launch", "Launch", iconLaunch()],
            ["branding", "Branding", iconBranding()],
            ["settings", "Settings", iconSettings()],
          ].map(([id, label, icon]) => (
            <button className={`sidebar-link ${activePage === id ? "active" : ""}`} key={id} onClick={() => setActivePage(id)} title={label}>
              <span className="sidebar-icon">{icon}</span><span className="sidebar-label">{label}</span>
            </button>
          ))}
        </nav>
        <button className="sidebar-logout" onClick={logout} title="Logout"><span className="sidebar-icon">{iconLogout()}</span><span className="sidebar-label">Logout</span></button>
      </aside>

      <section className="app-main">
        <header className="app-header">
          <div>
            <h1>{getAdminTitle(activePage)}</h1>
            <p>{session.clientId}</p>
          </div>
        </header>

        <Toast message={notice} type="success" onClose={() => setNotice("")} />
        <Toast message={error} type="error" onClose={() => setError("")} />

        {activePage === "overview" ? (
          <div className="overview-wrap">
            <div className="setup-metrics">
              <section className="metric-card metric-compact"><span>Services</span><strong>{services.length}</strong></section>
              <section className="metric-card metric-compact"><span>Counters</span><strong>{counters.length}</strong></section>
              <section className="metric-card metric-compact"><span>Pairing Codes</span><strong>{pairings.length}</strong></section>
            </div>
            <AnalyticsPanel tickets={tickets} clientId={session.clientId} />
            <section className="panel">
              <h2 className="panel-title">Routing Summary</h2>
              <CounterRoutingList counters={counters.slice(0, 4)} services={services.filter((s) => s.active !== false)} onToggle={handleToggleCounterService} />
            </section>
          </div>
        ) : null}

        {activePage === "activity" ? (
          <ActivityLogPanel logs={activityLogs} />
        ) : null}

        {activePage === "setup" ? (
          <div className="overview-wrap">
            <section className="panel">
              <h2 className="panel-title">Services</h2>
              <p className="panel-sub">Services that appear sa Kiosk. Each has a queue prefix (e.g., BP for Business Permit).</p>
              <form className="inline-form" onSubmit={handleAddService}>
                <input placeholder="Service name" value={serviceForm.name} onChange={(e) => setServiceForm({ ...serviceForm, name: e.target.value })} />
                <input placeholder="Prefix e.g. BP" value={serviceForm.prefix} onChange={(e) => setServiceForm({ ...serviceForm, prefix: e.target.value })} />
                <button className="btn primary">Add</button>
              </form>
              <div className="svc-grid">
                {services.map((service) => (
                  <ServiceRow
                    key={service.docId || service.id}
                    service={service}
                    onSave={async (updates) => {
                      try {
                        await updateService(session.clientId, service.id, updates, session);
                        setNotice("Service updated.");
                        setError("");
                      } catch (err) { setError(err.message); }
                    }}
                    onDisable={async () => {
                      if (!confirm(`Disable "${service.name}"? Customers will no longer see this service sa kiosk. You can re-enable later.`)) return;
                      try {
                        await removeService(session.clientId, service.id, session);
                        setNotice(`${service.name} disabled.`);
                        setError("");
                      } catch (err) { setError(err.message); }
                    }}
                    onReenable={async () => {
                      try {
                        await reenableService(session.clientId, service.id, session);
                        setNotice(`${service.name} re-enabled.`);
                        setError("");
                      } catch (err) { setError(err.message); }
                    }}
                    onDelete={async () => {
                      if (!confirm(`PERMANENTLY DELETE "${service.name}"? This cannot be undone. All historical tickets keep their service name reference.`)) return;
                      try {
                        await deleteService(session.clientId, service.id, session);
                        setNotice(`${service.name} deleted.`);
                        setError("");
                      } catch (err) { setError(err.message); }
                    }}
                  />
                ))}
              </div>
            </section>

            <section className="panel">
              <h2 className="panel-title">Counters & Routing</h2>
              <p className="panel-sub">Counters operate sa Counter Control. Click counter label to rename. Use chips below para i-route specific services to specific counters.</p>
              <form className="inline-form" onSubmit={handleAddCounter}>
                <input placeholder="Counter label" value={counterForm.label} onChange={(e) => setCounterForm({ label: e.target.value })} />
                <button className="btn primary">Add Counter</button>
              </form>
              <CounterRoutingList counters={counters} services={services.filter((s) => s.active !== false)} onToggle={handleToggleCounterService} onRemove={handleRemoveCounter} onRename={handleRenameCounter} />
            </section>
          </div>
        ) : null}

        {activePage === "staff" ? (
          <StaffPanel
            clientId={session.clientId}
            onNotice={(m) => { setNotice(m); setError(""); }}
            onError={(m) => { setError(m); setNotice(""); }}
          />
        ) : null}

        {activePage === "pairing" ? (
          <div className="overview-wrap">
            <section className="panel">
              <h2 className="panel-title">Generate Pairing Code</h2>
              <p className="panel-sub">Create a code, then open the pair URL on the kiosk or counter device to bind it.</p>
              <PairingForm
                pairForm={pairForm}
                setPairForm={setPairForm}
                counters={counters}
                services={services.filter((s) => s.active !== false)}
                onSubmit={handleCreatePair}
              />
            </section>
            <section className="panel">
              <div className="panel-head">
                <h2 className="panel-title">Active Pairings</h2>
                <span className="panel-meta">{pairings.length} {pairings.length === 1 ? "code" : "codes"}</span>
              </div>
              <PairingList
                pairings={pairings}
                services={services.filter((s) => s.active !== false)}
                onToggleService={handleTogglePairingService}
                onSetServices={handleSetPairingServices}
                onToggleActive={handleTogglePairingActive}
                onDelete={handleDeletePairing}
              />
            </section>
          </div>
        ) : null}


        {activePage === "launch" ? (
          <section className="panel">
            <h2 className="panel-title">Launch Screens</h2>
            <p className="panel-sub">Open the kiosk, counter, or display window in a new tab.</p>
            <div className="launch-grid">
              <a className="launch-card kiosk" href={`/kiosk?client=${session.clientId}`} target="_blank" rel="noreferrer">
                <div className="launch-card-label">Customer-facing</div>
                <div className="launch-card-title">Open Kiosk</div>
                <div className="launch-card-hint">Take new tickets, fall in line</div>
                <div className="launch-card-arrow">→</div>
              </a>
              <a className="launch-card counter" href={`/counter?client=${session.clientId}`} target="_blank" rel="noreferrer">
                <div className="launch-card-label">Staff control</div>
                <div className="launch-card-title">Open Counter</div>
                <div className="launch-card-hint">Recall, complete, manage queue</div>
                <div className="launch-card-arrow">→</div>
              </a>
              <a className="launch-card display" href={`/display?client=${session.clientId}`} target="_blank" rel="noreferrer">
                <div className="launch-card-label">Public monitor</div>
                <div className="launch-card-title">Open Display</div>
                <div className="launch-card-hint">Live queue board for the lobby</div>
                <div className="launch-card-arrow">→</div>
              </a>
            </div>
          </section>
        ) : null}

        {activePage === "branding" ? (
          <BrandingPanel
            session={session}
            onSave={async (updates) => {
              try {
                await updateClient(session.clientId, updates, session);
                setNotice("Branding updated.");
              } catch (err) { setError(err.message); }
            }}
          />
        ) : null}

        {activePage === "settings" ? (
          <AdminSettings
            session={session}
            onUpdated={(updated) => {
              const next = { ...session, ...updated };
              setSession(next);
              window.localStorage.setItem("queue_admin", JSON.stringify(next));
              setNotice("Credentials updated successfully.");
            }}
            onError={setError}
          />
        ) : null}
      </section>
    </main>
  );
}

// Sidebar icons (Lucide-style stroke icons)
const SVG_PROPS = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true };

function iconOverview() {
  return (
    <svg {...SVG_PROPS}>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  );
}
function iconActivity() {
  return (
    <svg {...SVG_PROPS}>
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}
function iconServices() {
  return (
    <svg {...SVG_PROPS}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}
function iconCounters() {
  return (
    <svg {...SVG_PROPS}>
      <path d="M3 21V8l9-5 9 5v13" />
      <path d="M9 21v-9h6v9" />
    </svg>
  );
}
function iconPairing() {
  return (
    <svg {...SVG_PROPS}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}
function iconLaunch() {
  return (
    <svg {...SVG_PROPS}>
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
      <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
      <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
      <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
    </svg>
  );
}
function iconBranding() {
  return (
    <svg {...SVG_PROPS}>
      <circle cx="13.5" cy="6.5" r="2.5" />
      <circle cx="17.5" cy="10.5" r="2.5" />
      <circle cx="8.5" cy="7.5" r="2.5" />
      <circle cx="6.5" cy="12.5" r="2.5" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
    </svg>
  );
}
function iconSettings() {
  return (
    <svg {...SVG_PROPS}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function Toast({ message, type, onClose }) {
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

function iconStaff() {
  return (
    <svg {...SVG_PROPS}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function iconLogout() {
  return (
    <svg {...SVG_PROPS}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

function getInitials(value) {
  return String(value || "A")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "A";
}

function getAdminTitle(activePage) {
  const titles = {
    overview: "Overview",
    activity: "Activity Log",
    setup: "Services & Counters",
    staff: "Counter Staff",
    pairing: "Pairing Codes",
    launch: "Launch Screens",
    branding: "Branding",
    settings: "Settings",
  };
  return titles[activePage] || "Admin";
}

function BrandingPanel({ session, onSave }) {
  const [logo, setLogo] = useState(null);
  const [originalLogo, setOriginalLogo] = useState(null);
  const [themeColor, setThemeColor] = useState("#134E4A");
  const [originalColor, setOriginalColor] = useState("#134E4A");
  const [orgName, setOrgName] = useState(session.clientName || "Your LGU");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    import("../lib/firebaseClient").then(({ getClientInfo }) => {
      getClientInfo(session.clientId).then((info) => {
        if (cancelled) return;
        const initialLogo = info?.logo || null;
        const initialColor = info?.themeColor || "#134E4A";
        setLogo(initialLogo);
        setOriginalLogo(initialLogo);
        setThemeColor(initialColor);
        setOriginalColor(initialColor);
        setOrgName(info?.name || session.clientName || "Your LGU");
        setLoading(false);
      }).catch(() => setLoading(false));
    });
    return () => { cancelled = true; };
  }, [session.clientId, session.clientName]);

  function readFile(file) {
    if (!file) return;
    if (!/^image\/(png|jpe?g|svg\+xml|webp)$/.test(file.type)) {
      alert("Please choose a PNG, JPG, SVG, or WebP image.");
      return;
    }
    if (file.size > 300 * 1024) {
      alert("Logo file too large. Please use an image under 300KB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setLogo(reader.result);
    reader.readAsDataURL(file);
  }

  function handleDrop(event) {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files?.[0];
    readFile(file);
  }

  function handleSelect(event) {
    readFile(event.target.files?.[0]);
    event.target.value = "";
  }

  function abbrev(name) {
    if (!name) return "Q";
    const words = name.trim().split(/\s+/).filter(Boolean);
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
  }

  const isDirty = logo !== originalLogo || themeColor !== originalColor;

  async function handleSave() {
    setSaving(true);
    try {
      await onSave({ logo, themeColor });
      setOriginalLogo(logo);
      setOriginalColor(themeColor);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setLogo(originalLogo);
    setThemeColor(originalColor);
  }

  if (loading) {
    return (
      <section className="panel">
        <div className="list-empty-light">Loading branding…</div>
      </section>
    );
  }

  const COLOR_PRESETS = [
    { value: "#134E4A", name: "Forest Teal" },
    { value: "#0E7490", name: "Ocean" },
    { value: "#0369A1", name: "Sky" },
    { value: "#1E40AF", name: "Royal Blue" },
    { value: "#7C3AED", name: "Violet" },
    { value: "#BE185D", name: "Magenta" },
    { value: "#9F1239", name: "Crimson" },
    { value: "#B45309", name: "Amber" },
    { value: "#15803D", name: "Forest" },
    { value: "#1E293B", name: "Slate" },
  ];

  return (
    <div className="branding-wrap">
      <section className="panel branding-panel">
        <div className="panel-head">
          <div>
            <h2 className="panel-title">Branding</h2>
            <p className="panel-sub">Customize your LGU's logo and accent color across kiosk, display, and tickets.</p>
          </div>
          {isDirty ? <span className="branding-pill pending">Unsaved changes</span> : savedFlash ? <span className="branding-pill saved">✓ Saved</span> : null}
        </div>

        <div className="branding-layout">
          {/* LOGO */}
          <div className="branding-card">
            <div className="branding-card-head">
              <span className="branding-card-num">1</span>
              <div>
                <h3 className="branding-card-title">Logo</h3>
                <p className="branding-card-hint">PNG with transparent background works best. Max 300KB.</p>
              </div>
            </div>
            <div
              className={`logo-dropzone ${dragOver ? "drag-over" : ""} ${logo ? "has-logo" : ""}`}
              style={{ background: logo ? "#fff" : `linear-gradient(135deg, ${themeColor}, ${themeColor}cc)` }}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
            >
              {logo ? (
                <img src={logo} alt="logo preview" />
              ) : (
                <div className="logo-dropzone-empty">
                  <div className="logo-dropzone-icon">+</div>
                  <div className="logo-dropzone-text">
                    <strong>Drop logo here</strong>
                    <span>or click to browse</span>
                  </div>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/svg+xml,image/webp"
                onChange={handleSelect}
                style={{ display: "none" }}
              />
            </div>
            <div className="logo-actions">
              <button type="button" className="mini-action" onClick={() => fileInputRef.current?.click()}>
                {logo ? "Replace" : "Browse"}
              </button>
              {logo ? <button type="button" className="mini-cancel" onClick={() => setLogo(null)}>Remove</button> : null}
            </div>
          </div>

          {/* COLOR */}
          <div className="branding-card">
            <div className="branding-card-head">
              <span className="branding-card-num">2</span>
              <div>
                <h3 className="branding-card-title">Accent Color</h3>
                <p className="branding-card-hint">Used on display headers, brand pills, and ticket accents.</p>
              </div>
            </div>
            <div className="color-pickers">
              <input
                type="color"
                value={themeColor}
                onChange={(e) => setThemeColor(e.target.value)}
                className="color-swatch"
                aria-label="Pick custom color"
              />
              <input
                type="text"
                value={themeColor.toUpperCase()}
                onChange={(e) => setThemeColor(e.target.value)}
                placeholder="#134E4A"
                className="color-text"
                maxLength={7}
              />
            </div>
            <div className="color-presets-grid">
              {COLOR_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  className={`color-preset-card ${themeColor.toLowerCase() === preset.value.toLowerCase() ? "active" : ""}`}
                  onClick={() => setThemeColor(preset.value)}
                  title={preset.name}
                >
                  <span className="color-preset-swatch" style={{ background: preset.value }} />
                  <span className="color-preset-name">{preset.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* PREVIEW */}
          <div className="branding-card branding-preview">
            <div className="branding-card-head">
              <span className="branding-card-num">3</span>
              <div>
                <h3 className="branding-card-title">Live Preview</h3>
                <p className="branding-card-hint">How your branding looks in different surfaces.</p>
              </div>
            </div>

            {/* Display header preview */}
            <div className="preview-block">
              <span className="preview-label">Display Monitor</span>
              <div className="preview-display-header">
                <div className="preview-logo" style={{ background: logo ? "#fff" : `linear-gradient(135deg, ${themeColor}, ${themeColor}cc)` }}>
                  {logo ? <img src={logo} alt="" /> : <span style={{ color: "#fff" }}>{abbrev(orgName)}</span>}
                </div>
                <div>
                  <div className="preview-display-title">Queuing System</div>
                  <div className="preview-display-meta">
                    <span className="preview-live-pill">● LIVE</span>
                    <span style={{ opacity: 0.5 }}>/</span>
                    <span>Queue Display · {orgName}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Brand pill preview */}
            <div className="preview-block">
              <span className="preview-label">Kiosk Header</span>
              <div className="preview-kiosk-pill">
                <span className="preview-dot" style={{ background: themeColor }} />
                <span>Queuing System · {orgName}</span>
              </div>
            </div>

            {/* Ticket preview */}
            <div className="preview-block">
              <span className="preview-label">Ticket</span>
              <div className="preview-ticket">
                <div className="preview-ticket-bar" style={{ background: themeColor }} />
                <div className="preview-ticket-inner">
                  {logo ? (
                    <img src={logo} alt="" className="preview-ticket-logo" />
                  ) : (
                    <strong style={{ color: themeColor, fontSize: 13 }}>{orgName.toUpperCase()}</strong>
                  )}
                  <div style={{ borderTop: "1px dashed #ccc", margin: "8px 0" }} />
                  <div style={{ fontSize: 12, color: "#555" }}>Business Permit</div>
                  <div style={{ fontSize: 32, fontWeight: 800, color: themeColor, margin: "6px 0" }}>BP-001</div>
                  <div style={{ fontSize: 10, color: "#888" }}>Please wait for your number to be called.</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="branding-footer">
          <button type="button" className="btn" onClick={handleReset} disabled={!isDirty || saving}>Reset</button>
          <button type="button" className="btn primary" onClick={handleSave} disabled={!isDirty || saving}>
            {saving ? "Saving…" : "Save Branding"}
          </button>
        </div>
      </section>
    </div>
  );
}

function ActivityLogPanel({ logs }) {
  const labels = {
    "service.added": "Added service",
    "service.updated": "Updated service",
    "service.disabled": "Disabled service",
    "service.reenabled": "Re-enabled service",
    "service.deleted": "Deleted service",
    "counter.added": "Added counter",
    "counter.removed": "Removed counter",
    "counter.renamed": "Renamed counter",
    "counter.paused": "Counter on break",
    "counter.resumed": "Counter resumed",
    "client.updated": "Updated branding",
    "pairing.created": "Created pairing code",
    "pairing.deleted": "Deleted pairing code",
    "pairing.disabled": "Disabled pairing code",
    "pairing.reenabled": "Re-enabled pairing code",
    "pairing.services_updated": "Updated kiosk services",
    "auth.login": "Logged in",
    "auth.logout": "Logged out",
  };
  function fmtTime(ts) {
    const ms = ts?.toMillis?.() || (ts?.seconds ? ts.seconds * 1000 : 0);
    if (!ms) return "—";
    return new Date(ms).toLocaleString();
  }
  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">Activity Log</h2>
        <span className="panel-meta">{logs.length} recent</span>
      </div>
      <p className="panel-sub">Audit trail of admin and counter staff actions including login/logout. Useful for compliance and troubleshooting.</p>
      {logs.length === 0 ? (
        <div className="list-empty-light">No activity yet.</div>
      ) : (
        <div className="activity-list">
          {logs.map((log) => {
            const isAuth = log.action.startsWith("auth.");
            return (
              <div className={`activity-item ${isAuth ? "is-auth" : ""}`} key={log.id}>
                <div className="activity-head">
                  <span className="activity-action">{labels[log.action] || log.action}</span>
                  <span className="activity-time">{fmtTime(log.timestamp)}</span>
                </div>
                {log.actor ? (
                  <div className="activity-actor">
                    <span className={`status-pill ${log.actor.role === "staff" ? "role-staff" : "role-admin"}`}>
                      {log.actor.role === "staff" ? "Staff" : "Admin"}
                    </span>
                    <strong>{log.actor.name || log.actor.email}</strong>
                    {log.actor.email && log.actor.email !== log.actor.name ? (
                      <span style={{ color: "var(--color-muted)", fontSize: 11 }}>{log.actor.email}</span>
                    ) : null}
                  </div>
                ) : null}
                {log.details && Object.keys(log.details).length > 0 ? (
                  <div className="activity-details">
                    {Object.entries(log.details).map(([k, v]) => (
                      <span className="activity-tag" key={k}><span>{k}:</span> {String(typeof v === "object" ? JSON.stringify(v) : v)}</span>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function StaffPanel({ clientId, onNotice, onError }) {
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ email: "", password: "", name: "" });

  async function refresh() {
    try {
      const all = await listAdmins();
      setStaff(all.filter((u) => u.clientId === clientId && u.role === "staff"));
    } catch (err) {
      onError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [clientId]);

  async function handleAdd(event) {
    event.preventDefault();
    try {
      if (!addForm.email || !addForm.password) throw new Error("Email and password are required.");
      await addAdminToClient(clientId, { ...addForm, role: "staff" });
      onNotice(`Added counter staff ${addForm.email}.`);
      setAddForm({ email: "", password: "", name: "" });
      setShowAdd(false);
      await refresh();
    } catch (err) {
      onError(err.message);
    }
  }

  async function handleResetPassword(member) {
    const password = prompt(`New password for ${member.email}:`);
    if (!password) return;
    try {
      await updateAdminCredentials(member.email, { password });
      onNotice(`Password reset for ${member.email}.`);
    } catch (err) {
      onError(err.message);
    }
  }

  async function handleToggleActive(member) {
    const next = member.active === false ? true : false;
    try {
      await setAdminActive(member.email, next);
      onNotice(`${member.email} ${next ? "reactivated" : "deactivated"}.`);
      await refresh();
    } catch (err) {
      onError(err.message);
    }
  }

  async function handleDelete(member) {
    if (!confirm(`Delete counter staff ${member.email}? This cannot be undone.`)) return;
    try {
      await deleteAdmin(member.email);
      onNotice(`Deleted ${member.email}.`);
      await refresh();
    } catch (err) {
      onError(err.message);
    }
  }

  return (
    <div className="overview-wrap">
      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Counter Staff</h2>
          <button className="btn primary" onClick={() => setShowAdd((v) => !v)}>
            {showAdd ? "Close" : "+ Add Staff"}
          </button>
        </div>
        <p className="panel-sub">Create staff accounts for counter operators. Staff log in directly to Counter Control. Use multiple accounts for shift rotations.</p>

        {showAdd ? (
          <form className="admin-form create-client-form" onSubmit={handleAdd} style={{ marginTop: 14 }}>
            <label className="form-field">
              <span className="form-label">Full name</span>
              <input value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} placeholder="e.g. Maria Cruz" />
            </label>
            <label className="form-field">
              <span className="form-label">Email</span>
              <input value={addForm.email} onChange={(e) => setAddForm({ ...addForm, email: e.target.value })} placeholder="staff@example.com" />
            </label>
            <label className="form-field">
              <span className="form-label">Temporary password</span>
              <input type="password" value={addForm.password} onChange={(e) => setAddForm({ ...addForm, password: e.target.value })} placeholder="At least 6 characters" />
            </label>
            <div className="form-actions">
              <button className="btn primary" type="submit">Add Counter Staff</button>
            </div>
          </form>
        ) : null}

        {loading ? (
          <div className="list-empty-light">Loading…</div>
        ) : staff.length === 0 ? (
          <div className="list-empty-light">No counter staff yet. Tap "+ Add Staff" to create the first account.</div>
        ) : (
          <div className="simple-list" style={{ marginTop: 14 }}>
            {staff.map((member) => (
              <div className="simple-item" key={member.email}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <strong>{member.name || member.email}</strong>
                    <span className={`status-pill ${member.active === false ? "suspended" : "active"}`}>
                      {member.active === false ? "Inactive" : "Active"}
                    </span>
                  </div>
                  <span style={{ display: "block", color: "var(--color-muted)", fontSize: 12, marginTop: 2 }}>
                    {member.email}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap" }}>
                  <button className="mini-action" onClick={() => handleResetPassword(member)}>Reset Password</button>
                  <button className={member.active === false ? "mini-action" : "mini-cancel"} onClick={() => handleToggleActive(member)}>
                    {member.active === false ? "Reactivate" : "Deactivate"}
                  </button>
                  <button className="mini-danger" onClick={() => handleDelete(member)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function AdminSettings({ session, onUpdated, onError }) {
  const [email, setEmail] = useState(session.email || "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [localNotice, setLocalNotice] = useState("");

  async function handleSave(event) {
    event.preventDefault();
    setLocalNotice("");
    setSaving(true);
    try {
      const updates = {};
      if (email && email !== session.email) updates.email = email;
      if (password) updates.password = password;
      if (Object.keys(updates).length === 0) {
        setLocalNotice("No changes to save.");
        setSaving(false);
        return;
      }
      const result = await updateAdminCredentials(session.email, updates);
      setPassword("");
      onUpdated({ email: result.email });
    } catch (err) {
      onError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel">
      <h2 className="panel-title">My Credentials</h2>
      <p className="panel-sub">Update the email and password used to log in to this admin dashboard.</p>
      <form className="admin-form settings-form" onSubmit={handleSave}>
        <label className="form-field">
          <span className="form-label">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@example.com"
            autoComplete="username"
          />
        </label>
        <label className="form-field">
          <span className="form-label">New password <span style={{ color: "var(--color-subtle)", fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>(leave blank to keep current)</span></span>
          <div className="password-field">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
            />
            <button
              type="button"
              className="password-toggle"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? (
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>
        </label>
        {localNotice ? <div className="notice">{localNotice}</div> : null}
        <div className="form-actions">
          <button className="btn primary" disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
        </div>
      </form>
    </section>
  );
}

function AnalyticsPanel({ tickets, clientId }) {
  const [range, setRange] = useState("today");
  const [rangeTickets, setRangeTickets] = useState(null);
  const [loading, setLoading] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFilters, setExportFilters] = useState({
    statuses: { waiting: true, serving: true, completed: true, cancelled: true },
    priorities: { regular: true, PWD: true, SC: true, PG: true },
    services: {}, // empty = include all
    fromDate: "",
    toDate: "",
  });

  function fmtDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  useEffect(() => {
    if (range === "today") {
      setRangeTickets(null);
      return;
    }
    setLoading(true);
    const today = new Date();
    let from = new Date(today);
    if (range === "7days") from.setDate(today.getDate() - 6);
    else if (range === "30days") from.setDate(today.getDate() - 29);
    else if (range === "month") from = new Date(today.getFullYear(), today.getMonth(), 1);
    getTicketsInRange(clientId, fmtDate(from), fmtDate(today))
      .then(setRangeTickets)
      .catch(() => setRangeTickets([]))
      .finally(() => setLoading(false));
  }, [range, clientId]);

  const data = range === "today" ? tickets : rangeTickets || [];
  const stats = computeAnalytics(data);

  // Build service options from current data
  const serviceOptions = Array.from(
    new Map(data.map((t) => [t.serviceId || t.prefix || "?", { id: t.serviceId || t.prefix, name: t.serviceName || "Unknown", prefix: t.prefix }])).values()
  );

  // Filtered export data
  function applyFilters(rows) {
    return rows.filter((t) => {
      // status
      if (!exportFilters.statuses[t.status]) return false;
      // priority
      const pkey = t.priorityType || "regular";
      if (!exportFilters.priorities[pkey]) return false;
      // service (empty selection means include all)
      const serviceKeys = Object.keys(exportFilters.services).filter((k) => exportFilters.services[k]);
      if (serviceKeys.length > 0) {
        const tKey = t.serviceId || t.prefix;
        if (!serviceKeys.includes(tKey)) return false;
      }
      // custom date range (overrides if set)
      if (exportFilters.fromDate && (t.serviceDate || "") < exportFilters.fromDate) return false;
      if (exportFilters.toDate && (t.serviceDate || "") > exportFilters.toDate) return false;
      return true;
    });
  }

  const filteredData = applyFilters(data);

  function exportCsv() {
    const header = ["Date", "Queue Number", "Service", "Customer", "Phone", "Priority", "Status", "Created", "Called", "Completed", "Wait (sec)", "Service (sec)", "Counter"];
    const rows = filteredData.map((t) => {
      const createdMs = t.createdAt?.toMillis?.() || (t.createdAt?.seconds ? t.createdAt.seconds * 1000 : 0);
      const calledMs = t.calledAt?.toMillis?.() || (t.calledAt?.seconds ? t.calledAt.seconds * 1000 : 0);
      const completedMs = t.completedAt?.toMillis?.() || (t.completedAt?.seconds ? t.completedAt.seconds * 1000 : 0);
      const waitSec = createdMs && calledMs ? Math.round((calledMs - createdMs) / 1000) : "";
      const serviceSec = calledMs && completedMs ? Math.round((completedMs - calledMs) / 1000) : "";
      return [
        t.serviceDate || "",
        t.queueNumber || "",
        t.serviceName || "",
        t.customerName || "",
        t.phone || "",
        t.priorityType || "Regular",
        t.status || "",
        createdMs ? new Date(createdMs).toISOString() : "",
        calledMs ? new Date(calledMs).toISOString() : "",
        completedMs ? new Date(completedMs).toISOString() : "",
        waitSec,
        serviceSec,
        t.counterNo || "",
      ];
    });
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => {
        const s = String(cell ?? "");
        return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(","))
      .join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `queue-tickets-${range}-${fmtDate(new Date())}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function toggleStatus(key) {
    setExportFilters((p) => ({ ...p, statuses: { ...p.statuses, [key]: !p.statuses[key] } }));
  }
  function togglePriority(key) {
    setExportFilters((p) => ({ ...p, priorities: { ...p.priorities, [key]: !p.priorities[key] } }));
  }
  function toggleService(key) {
    setExportFilters((p) => ({ ...p, services: { ...p.services, [key]: !p.services[key] } }));
  }
  function selectAllServices(value) {
    const next = {};
    serviceOptions.forEach((s) => { next[s.id] = value; });
    setExportFilters((p) => ({ ...p, services: next }));
  }

  function formatMs(ms) {
    if (!ms) return "—";
    const totalSec = Math.round(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    if (min < 1) return `${sec}s`;
    return `${min}m ${sec}s`;
  }

  function formatHour(h) {
    if (h === null || h === undefined) return "—";
    const ampm = h >= 12 ? "PM" : "AM";
    const hour = h % 12 || 12;
    return `${hour} ${ampm}`;
  }

  function shortHour(h) {
    if (h === 0) return "12A";
    if (h === 12) return "12P";
    if (h < 12) return `${h}A`;
    return `${h - 12}P`;
  }

  const maxHourCount = Math.max(...stats.byHour, 1);
  const sortedServices = Object.entries(stats.byService).sort((a, b) => b[1] - a[1]);
  const maxServiceCount = sortedServices[0]?.[1] || 1;

  // Smart hour range — show business hours (6AM-8PM) plus any activity outside.
  const activeHours = stats.byHour.map((c, h) => (c > 0 ? h : -1)).filter((h) => h >= 0);
  const minActive = activeHours.length ? Math.min(...activeHours) : 6;
  const maxActive = activeHours.length ? Math.max(...activeHours) : 20;
  const startHour = Math.min(6, minActive);
  const endHour = Math.max(20, maxActive);
  const visibleHours = [];
  for (let h = startHour; h <= endHour; h += 1) visibleHours.push(h);

  return (
    <div className="analytics-wrap">
      <div className="analytics-toolbar">
        <div className="range-tabs">
          {[
            ["today", "Today"],
            ["7days", "Last 7 days"],
            ["30days", "Last 30 days"],
            ["month", "This month"],
          ].map(([id, label]) => (
            <button
              key={id}
              className={`range-tab ${range === id ? "active" : ""}`}
              onClick={() => setRange(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <button className="btn" onClick={() => setExportOpen((v) => !v)} disabled={data.length === 0 || loading}>
          {exportOpen ? "✕ Close filters" : "⚙ Export options"}
        </button>
      </div>

      {exportOpen ? (
        <section className="panel export-panel">
          <div className="panel-head">
            <h2 className="panel-title">Export Filters</h2>
            <span className="panel-meta">{filteredData.length} of {data.length} tickets</span>
          </div>
          <p className="panel-sub">Refine which tickets are included in the CSV export.</p>

          <div className="export-grid">
            <div className="export-section">
              <div className="form-label">Status</div>
              <div className="filter-chips">
                {["waiting", "serving", "completed", "cancelled"].map((s) => (
                  <button
                    type="button"
                    key={s}
                    className={`filter-chip ${exportFilters.statuses[s] ? "active" : ""}`}
                    onClick={() => toggleStatus(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div className="export-section">
              <div className="form-label">Priority Lane</div>
              <div className="filter-chips">
                {[["regular", "Regular"], ["PWD", "PWD"], ["SC", "Senior"], ["PG", "Pregnant"]].map(([key, label]) => (
                  <button
                    type="button"
                    key={key}
                    className={`filter-chip ${exportFilters.priorities[key] ? "active" : ""}`}
                    onClick={() => togglePriority(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="export-section export-services">
              <div className="form-label">
                Services
                <span className="filter-toolbar">
                  <button type="button" className="mini-action" onClick={() => selectAllServices(true)}>All</button>
                  <button type="button" className="mini-cancel" onClick={() => selectAllServices(false)}>None</button>
                </span>
              </div>
              <div className="filter-chips">
                {serviceOptions.length === 0 ? (
                  <span style={{ fontSize: 12, color: "var(--color-muted)" }}>No services in this range</span>
                ) : serviceOptions.map((s) => {
                  const checked = exportFilters.services[s.id];
                  return (
                    <button
                      type="button"
                      key={s.id}
                      className={`filter-chip ${checked ? "active" : ""}`}
                      onClick={() => toggleService(s.id)}
                      title={s.name}
                    >
                      {s.prefix} · {s.name}
                    </button>
                  );
                })}
              </div>
              <p className="form-hint">Leave all unselected to include every service.</p>
            </div>

            <div className="export-section">
              <div className="form-label">Custom Date Range <span style={{ color: "var(--color-subtle)", fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>(optional, overrides quick range)</span></div>
              <div className="date-range-row">
                <input
                  type="date"
                  value={exportFilters.fromDate}
                  onChange={(e) => setExportFilters((p) => ({ ...p, fromDate: e.target.value }))}
                  className="form-date"
                />
                <span className="date-range-sep">→</span>
                <input
                  type="date"
                  value={exportFilters.toDate}
                  onChange={(e) => setExportFilters((p) => ({ ...p, toDate: e.target.value }))}
                  className="form-date"
                />
                {(exportFilters.fromDate || exportFilters.toDate) ? (
                  <button type="button" className="mini-cancel" onClick={() => setExportFilters((p) => ({ ...p, fromDate: "", toDate: "" }))}>Clear</button>
                ) : null}
              </div>
            </div>
          </div>

          <div className="form-actions" style={{ justifyContent: "flex-end", marginTop: 18 }}>
            <button className="btn primary" onClick={exportCsv} disabled={filteredData.length === 0}>
              ↓ Download CSV ({filteredData.length})
            </button>
          </div>
        </section>
      ) : null}
      {loading ? <div className="list-empty-light">Loading…</div> : null}
      <div className="admin-dashboard">
        <section className="metric-card">
          <span>{range === "today" ? "Total Today" : "Total Tickets"}</span>
          <strong>{stats.total}</strong>
        </section>
        <section className="metric-card">
          <span>Completed</span>
          <strong>{stats.byStatus.completed || 0}</strong>
        </section>
        <section className="metric-card">
          <span>In Queue</span>
          <strong>{(stats.byStatus.waiting || 0) + (stats.byStatus.serving || 0)}</strong>
        </section>
        <section className="metric-card">
          <span>Cancelled / No-show</span>
          <strong>{stats.byStatus.cancelled || 0}</strong>
        </section>
        <section className="metric-card">
          <span>Avg Wait Time</span>
          <strong>{formatMs(stats.averageWaitMs)}</strong>
        </section>
        <section className="metric-card">
          <span>Avg Service Time</span>
          <strong>{formatMs(stats.averageServiceMs)}</strong>
        </section>
        <section className="metric-card">
          <span>Peak Hour</span>
          <strong>{stats.peakHour ? `${formatHour(stats.peakHour.hour)} (${stats.peakHour.count})` : "—"}</strong>
        </section>
        <section className="metric-card">
          <span>Priority Tickets</span>
          <strong>{(stats.byPriority.PWD || 0) + (stats.byPriority.SC || 0) + (stats.byPriority.PG || 0)}</strong>
        </section>
      </div>

      <section className="panel">
        <h2 className="panel-title">Tickets per Service</h2>
        {sortedServices.length === 0 ? (
          <div className="list-empty-light">No tickets yet today.</div>
        ) : (
          <div className="bar-list">
            {sortedServices.map(([name, count]) => (
              <div className="bar-row" key={name}>
                <div className="bar-label">{name}</div>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${(count / maxServiceCount) * 100}%` }} />
                </div>
                <div className="bar-value tabular">{count}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Hourly Distribution</h2>
          <span className="panel-meta">{shortHour(startHour)} – {shortHour(endHour)}</span>
        </div>
        <div className="hour-chart" style={{ "--hour-cols": visibleHours.length }}>
          {visibleHours.map((hour) => {
            const count = stats.byHour[hour] || 0;
            const heightPct = count > 0 ? Math.max((count / maxHourCount) * 100, 6) : 0;
            return (
              <div className={`hour-cell ${count > 0 ? "has-data" : ""}`} key={hour} title={`${formatHour(hour)} · ${count} tickets`}>
                <div className="hour-bar-wrap">
                  <div className="hour-bar" style={{ height: `${heightPct}%` }}>
                    {count > 0 ? <span className="hour-count tabular">{count}</span> : null}
                  </div>
                </div>
                <div className="hour-label tabular">{shortHour(hour)}</div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <h2 className="panel-title">Priority Lane Breakdown</h2>
        <div className="priority-stats">
          <div className="priority-stat">
            <span>Regular</span>
            <strong className="tabular">{stats.byPriority.regular || 0}</strong>
          </div>
          <div className="priority-stat priority-stat-pwd">
            <span>PWD</span>
            <strong className="tabular">{stats.byPriority.PWD || 0}</strong>
          </div>
          <div className="priority-stat priority-stat-sc">
            <span>Senior Citizen</span>
            <strong className="tabular">{stats.byPriority.SC || 0}</strong>
          </div>
          <div className="priority-stat priority-stat-pg">
            <span>Pregnant</span>
            <strong className="tabular">{stats.byPriority.PG || 0}</strong>
          </div>
        </div>
      </section>
    </div>
  );
}

function ServiceRow({ service, onSave, onDisable, onReenable, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(service.name);
  const [prefix, setPrefix] = useState(service.prefix);
  const isDisabled = service.active === false;

  useEffect(() => {
    setName(service.name);
    setPrefix(service.prefix);
  }, [service.name, service.prefix]);

  async function save() {
    if (!name.trim() || !prefix.trim()) return;
    if (name === service.name && prefix === service.prefix) {
      setEditing(false);
      return;
    }
    await onSave({ name, prefix });
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="svc-row editing">
        <div className="svc-row-edit">
          <label className="svc-edit-field">
            <span className="svc-edit-label">Prefix</span>
            <input
              className="svc-edit-prefix"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value.toUpperCase().slice(0, 4))}
              placeholder="BP"
              autoFocus
            />
          </label>
          <label className="svc-edit-field grow">
            <span className="svc-edit-label">Service name</span>
            <input
              className="svc-edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Service name"
              onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
            />
          </label>
        </div>
        <div className="svc-row-actions">
          <button className="mini-cancel" onClick={() => setEditing(false)}>Cancel</button>
          <button className="mini-action" onClick={save}>Save</button>
        </div>
      </div>
    );
  }

  return (
    <div className={`svc-row ${isDisabled ? "is-disabled" : ""}`}>
      <div className="svc-row-info">
        <span className="svc-row-tag">{service.prefix}</span>
        <div className="svc-row-text">
          <div className="svc-row-kicker">
            {isDisabled ? <span className="status-pill suspended">Disabled</span> : <span className="status-pill active">Active</span>}
          </div>
          <span className="svc-row-name">{service.name}</span>
        </div>
      </div>
      <div className="svc-row-actions">
        {isDisabled ? (
          <>
            <button className="mini-action" onClick={onReenable}>Re-enable</button>
            <button className="mini-danger" onClick={onDelete}>Delete</button>
          </>
        ) : (
          <>
            <button className="mini-action" onClick={() => setEditing(true)}>Edit</button>
            <button className="mini-cancel" onClick={onDisable}>Disable</button>
            <button className="mini-danger" onClick={onDelete}>Delete</button>
          </>
        )}
      </div>
    </div>
  );
}

function CounterLabel({ counter, onRename }) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(counter.label || `Counter ${counter.counterNo}`);

  useEffect(() => {
    setLabel(counter.label || `Counter ${counter.counterNo}`);
  }, [counter.label, counter.counterNo]);

  async function save() {
    if (label.trim() && label !== counter.label && onRename) {
      await onRename(counter, label);
    }
    setEditing(false);
  }

  if (!onRename) {
    return (
      <div>
        <strong>{counter.label || `Counter ${counter.counterNo}`}</strong>
        <span>{counter.serviceIds?.length ? "Assigned services only" : "All services"}</span>
      </div>
    );
  }

  if (editing) {
    return (
      <div className="counter-label-edit">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
          autoFocus
        />
      </div>
    );
  }

  return (
    <div className="counter-label-display" onClick={() => setEditing(true)}>
      <strong>{counter.label || `Counter ${counter.counterNo}`} <span className="edit-hint">(click to rename)</span></strong>
      <span>{counter.serviceIds?.length ? "Assigned services only" : "All services"}</span>
    </div>
  );
}

function CounterRoutingList({ counters, services, onToggle, onRemove, onRename }) {
  return (
    <div className="routing-list">
      {counters.length ? counters.map((counter) => (
        <div className="routing-item" key={counter.id}>
          <CounterLabel counter={counter} onRename={onRename} />
          <div className="chip-row">
            {services.map((service) => (
              <button
                className={`chip ${counter.serviceIds?.includes(service.id) ? "active" : ""}`}
                key={service.id}
                onClick={() => onToggle(counter, service.id)}
                data-tooltip={service.name}
                aria-label={service.name}
              >
                {service.prefix}
              </button>
            ))}
          </div>
          {onRemove ? (
            <button
              className="mini-danger"
              title={counter.currentTicketId ? "Will cancel the active session" : "Remove counter"}
              onClick={() => onRemove(counter)}
            >
              Remove
            </button>
          ) : null}
        </div>
      )) : <div className="list-empty-light">No counters yet</div>}
    </div>
  );
}

function PairingForm({ pairForm, setPairForm, counters, services = [], onSubmit, printerOnly = false }) {
  const typeOptions = [
    { value: "kiosk", label: "Kiosk" },
    { value: "counter", label: "Counter" },
    { value: "display", label: "Display Monitor" },
  ];
  const counterOptions = counters.map((c) => ({
    value: String(c.counterNo),
    label: c.label || `Counter ${c.counterNo}`,
  }));
  const selectedIds = Array.isArray(pairForm.serviceIds) ? pairForm.serviceIds : [];
  function toggleServiceId(id) {
    const next = selectedIds.includes(id) ? selectedIds.filter((s) => s !== id) : [...selectedIds, id];
    setPairForm({ ...pairForm, serviceIds: next });
  }
  function setAllServices(value) {
    setPairForm({ ...pairForm, serviceIds: value ? services.map((s) => s.id) : [] });
  }
  const isKiosk = pairForm.type === "kiosk";
  return (
    <form className="admin-form pairing-form" onSubmit={onSubmit}>
      {!printerOnly ? (
        <>
          <div className="pairing-form-grid">
            <label className="form-field">
              <span className="form-label">Device type</span>
              <CustomSelect
                value={pairForm.type}
                options={typeOptions}
                onChange={(v) => setPairForm({ ...pairForm, type: v })}
              />
            </label>
            {pairForm.type === "counter" ? (
              <label className="form-field">
                <span className="form-label">Counter</span>
                <CustomSelect
                  value={String(pairForm.counterNo)}
                  options={counterOptions}
                  onChange={(v) => setPairForm({ ...pairForm, counterNo: v })}
                />
              </label>
            ) : null}
            <label className="form-field" style={{ flex: 1 }}>
              <span className="form-label">Device label <span className="opt">(optional)</span></span>
              <input
                placeholder={
                  pairForm.type === "kiosk" ? "e.g. Lobby Kiosk" :
                  pairForm.type === "display" ? "e.g. Lobby Monitor" :
                  "e.g. Window 1"
                }
                value={pairForm.label}
                onChange={(e) => setPairForm({ ...pairForm, label: e.target.value })}
              />
            </label>
          </div>

          {isKiosk && services.length ? (
            <div className="pairing-services">
              <div className="pairing-services-head">
                <div className="pairing-services-label">
                  <span>Services to show</span>
                  <span className="opt">
                    {selectedIds.length ? `${selectedIds.length} of ${services.length} selected` : "none selected → showing all"}
                  </span>
                </div>
                <div className="pairing-services-actions">
                  <button type="button" className="mini-action" onClick={() => setAllServices(true)}>Select all</button>
                  <button type="button" className="mini-cancel" onClick={() => setAllServices(false)}>Clear</button>
                </div>
              </div>
              <div className="chip-row">
                {services.map((service) => (
                  <button
                    type="button"
                    className={`chip ${selectedIds.includes(service.id) ? "active" : ""}`}
                    key={service.id}
                    onClick={() => toggleServiceId(service.id)}
                    data-tooltip={service.name}
                    aria-label={service.name}
                  >
                    {service.prefix}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </>
      ) : null}
      <div className="pairing-form-actions">
        <button className="btn primary">{printerOnly ? "Generate Printer Pairing Code" : "Generate Pairing Code"}</button>
      </div>
    </form>
  );
}

function CustomSelect({ value, options, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const current = options.find((opt) => opt.value === value) || options[0];

  useEffect(() => {
    if (!open) return undefined;
    function handleClickOutside(event) {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    }
    function handleEscape(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  function handleSelect(optionValue) {
    onChange(optionValue);
    setOpen(false);
  }

  return (
    <div className={`custom-select ${open ? "open" : ""}`} ref={ref}>
      <button
        type="button"
        className="custom-select-trigger"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{current?.label || ""}</span>
        <svg className="custom-select-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open ? (
        <ul className="custom-select-menu" role="listbox">
          {options.map((opt) => (
            <li
              key={opt.value}
              role="option"
              aria-selected={opt.value === value}
              className={`custom-select-option ${opt.value === value ? "selected" : ""}`}
              onClick={() => handleSelect(opt.value)}
            >
              {opt.label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function PairingList({ pairings, services = [], onToggleService, onSetServices, onToggleActive, onDelete }) {
  if (!pairings.length) {
    return (
      <div className="pairing-empty">
        <div className="pairing-empty-icon" aria-hidden="true">⌁</div>
        <div className="pairing-empty-title">No pairing codes yet</div>
        <div className="pairing-empty-sub">Generate one above and open it on your kiosk or counter device.</div>
      </div>
    );
  }
  return (
    <div className="pairing-grid">
      {pairings.map((pair) => (
        <PairingCard
          key={pair.id}
          pair={pair}
          services={services}
          onToggleService={onToggleService}
          onSetServices={onSetServices}
          onToggleActive={onToggleActive}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

function PairingCard({ pair, services, onToggleService, onSetServices, onToggleActive, onDelete }) {
  const [copied, setCopied] = useState(false);
  const isKiosk = pair.type === "kiosk";
  const isDisplay = pair.type === "display";
  const assigned = Array.isArray(pair.serviceIds) ? pair.serviceIds : [];
  const isActive = pair.active !== false;
  const defaultLabel = isKiosk
    ? "Kiosk Device"
    : isDisplay
    ? "Display Monitor"
    : `Counter ${pair.counterNo || ""} Device`.trim();
  const deviceLabel = (pair.label && String(pair.label).trim()) || defaultLabel;
  const typeClass = isKiosk ? "is-kiosk" : isDisplay ? "is-display" : "is-counter";

  function setAll(value) {
    if (!onSetServices) return;
    onSetServices(pair, value ? services.map((s) => s.id) : []);
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(pair.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (_) {
      /* clipboard blocked */
    }
  }

  return (
    <div className={`pairing-card ${typeClass} ${!isActive ? "is-inactive" : ""}`}>
      <div className="pairing-card-head">
        <div className="pairing-card-type">
          {pair.type}{pair.counterNo ? ` · Counter ${pair.counterNo}` : ""}
        </div>
        <div className="pairing-card-head-right">
          <span className={`status-pill ${isActive ? "active" : "suspended"}`}>
            {isActive ? "Active" : "Inactive"}
          </span>
          {onToggleActive ? (
            <button
              type="button"
              className="icon-btn"
              data-tooltip={isActive ? "Disable" : "Re-enable"}
              aria-label={isActive ? "Disable pairing" : "Re-enable pairing"}
              onClick={() => onToggleActive(pair)}
            >
              {isActive ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <line x1="5.6" y1="5.6" x2="18.4" y2="18.4" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </button>
          ) : null}
          {onDelete ? (
            <button
              type="button"
              className="icon-btn icon-btn-danger"
              data-tooltip="Delete"
              aria-label="Delete pairing"
              onClick={() => onDelete(pair)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1.5 14a2 2 0 0 1-2 1.8h-7a2 2 0 0 1-2-1.8L5 6" />
                <path d="M10 11v6" />
                <path d="M14 11v6" />
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
              </svg>
            </button>
          ) : null}
        </div>
      </div>
      <div className="pairing-card-label" title={deviceLabel}>{deviceLabel}</div>
      <button
        type="button"
        className="pairing-card-code tabular"
        onClick={copyCode}
        title={copied ? "Copied!" : "Click to copy"}
      >
        <span>{pair.code}</span>
        <span className="pairing-copy-hint">{copied ? "Copied ✓" : "Copy"}</span>
      </button>

      {isKiosk && services.length && onToggleService ? (
        <div className="pairing-card-services">
          <div className="pairing-services-head">
            <div className="pairing-services-label">
              <span>Services</span>
              <span className="meta">
                {assigned.length ? `${assigned.length} of ${services.length}` : "showing all"}
              </span>
            </div>
            <div className="pairing-services-actions">
              <button type="button" className="mini-action" onClick={() => setAll(true)}>All</button>
              <button type="button" className="mini-cancel" onClick={() => setAll(false)}>Clear</button>
            </div>
          </div>
          <div className="chip-row">
            {services.map((service) => (
              <button
                type="button"
                className={`chip ${assigned.includes(service.id) ? "active" : ""}`}
                key={service.id}
                onClick={() => onToggleService(pair, service.id)}
                data-tooltip={service.name}
                aria-label={service.name}
              >
                {service.prefix}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <a
        className="btn primary pairing-card-btn"
        href={`/${pair.type}?pair=${pair.code}`}
        target="_blank"
        rel="noreferrer"
      >
        Open Device
      </a>
    </div>
  );
}
