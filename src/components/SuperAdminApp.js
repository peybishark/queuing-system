"use client";

import { useEffect, useState } from "react";
import {
  addAdminToClient,
  createClientWithAdmin,
  deleteAdmin,
  getSuperAdminConfig,
  getSystemAnalytics,
  initFirebase,
  listAdmins,
  listClients,
  setAdminActive,
  setClientStatus,
  updateAdminCredentials,
  updateClient,
  updateSuperAdminCredentials,
} from "../lib/firebaseClient";

const LOADING_MS = 1200;

export default function SuperAdminApp() {
  const [session, setSession] = useState(null);
  const [clients, setClients] = useState([]);
  const [activePage, setActivePage] = useState("overview");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [clientForm, setClientForm] = useState({ clientName: "", adminName: "", email: "", password: "" });
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);

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
  const [loadingDone, setLoadingDone] = useState(false);

  useEffect(() => {
    initFirebase().catch((err) => setError(err.message));
    const saved = window.localStorage.getItem("queue_superadmin");
    if (saved) {
      setSession(JSON.parse(saved));
    } else {
      window.location.replace("/");
    }
    setSidebarCollapsed(window.localStorage.getItem("queue_superadmin_sidebar") === "collapsed");
    setReady(true);
    const timer = setTimeout(() => setLoadingDone(true), LOADING_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!session) return;
    refreshClients();
  }, [session]);

  async function refreshClients() {
    try {
      setClients(await listClients());
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleRenameClient(client, newName) {
    setError("");
    setNotice("");
    try {
      await updateClient(client.id, { name: newName });
      setNotice(`Renamed to ${newName}.`);
      await refreshClients();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleToggleClientStatus(client) {
    const next = client.status === "suspended" ? "active" : "suspended";
    if (next === "suspended" && !confirm(`Suspend ${client.name}? Their admins will be unable to log in until you reactivate.`)) return;
    try {
      await setClientStatus(client.id, next);
      setNotice(`${client.name} ${next === "suspended" ? "suspended" : "reactivated"}.`);
      await refreshClients();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleCreateClient(event) {
    event.preventDefault();
    setNotice("");
    setError("");
    try {
      const result = await createClientWithAdmin(clientForm);
      setNotice(`Created ${clientForm.clientName}. Admin can log in at /admin with ${result.email}.`);
      setClientForm({ clientName: "", adminName: "", email: "", password: "" });
      await refreshClients();
    } catch (err) {
      setError(err.message);
    }
  }

  function logout() {
    window.localStorage.removeItem("queue_superadmin");
    window.location.replace("/");
  }

  function toggleSidebar() {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    window.localStorage.setItem("queue_superadmin_sidebar", next ? "collapsed" : "expanded");
  }

  if (!ready || !session || !loadingDone) {
    return (
      <main className="page auth-page">
        <div className="auth-panel">
          <div className="auth-kicker">Superadmin</div>
          <div className="loading-spinner" aria-hidden="true" />
          <h1 className="auth-title">Opening dashboard…</h1>
          <p className="auth-sub">Please wait while we set things up.</p>
          {error ? <div className="notice error">{error}</div> : null}
        </div>
      </main>
    );
  }

  return (
    <main className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="app-sidebar">
        <div className="sidebar-brand">
          <span className="brand-dot" />
          <span className="sidebar-abbrev">SA</span>
          <div>
            <strong>Superadmin</strong>
            <span>System owner</span>
          </div>
          <button className="sidebar-toggle" onClick={toggleSidebar} title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}>
            <span className="hamburger-lines" />
          </button>
        </div>
        <nav className="sidebar-nav">
          {[
            ["overview", "Overview", saIconOverview()],
            ["analytics", "Analytics", saIconAnalytics()],
            ["create", "Create", saIconCreate()],
            ["clients", "Clients", saIconClients()],
            ["admins", "Admins", saIconAdmins()],
            ["settings", "Settings", saIconSettings()],
          ].map(([id, label, icon]) => (
            <button className={`sidebar-link ${activePage === id ? "active" : ""}`} key={id} onClick={() => setActivePage(id)} title={label}>
              <span className="sidebar-icon">{icon}</span><span className="sidebar-label">{label}</span>
            </button>
          ))}
        </nav>
        <button className="sidebar-logout" onClick={logout} title="Logout"><span className="sidebar-icon">{saIconLogout()}</span><span className="sidebar-label">Logout</span></button>
      </aside>

      <section className="app-main">
        <header className="app-header">
          <div>
            <h1>{
              activePage === "create" ? "Create Client" :
              activePage === "clients" ? "Clients" :
              activePage === "admins" ? "Admins" :
              activePage === "analytics" ? "System Analytics" :
              activePage === "settings" ? "Settings" : "Overview"
            }</h1>
            <p>Manage client accounts and admin access.</p>
          </div>
        </header>

        <SaToast message={notice} type="success" onClose={() => setNotice("")} />
        <SaToast message={error} type="error" onClose={() => setError("")} />

        {activePage === "overview" ? (
          <div className="admin-dashboard">
            <section className="metric-card">
              <span>Total Clients</span>
              <strong>{clients.length}</strong>
            </section>
            <section className="metric-card">
              <span>Active Admin Portal</span>
              <strong>/admin</strong>
            </section>
            <section className="panel">
              <h2 className="panel-title">Recent Clients</h2>
              <ClientList clients={clients.slice(0, 5)} />
            </section>
          </div>
        ) : null}

        {activePage === "create" ? (
          <section className="panel">
            <h2 className="panel-title">Create Client Admin</h2>
            <p className="panel-sub">Provision a new LGU client and the first admin who can manage it.</p>
            <form className="admin-form create-client-form" onSubmit={handleCreateClient}>
              <label className="form-field">
                <span className="form-label">Client / Office name</span>
                <input placeholder="e.g. Quezon City Hall" value={clientForm.clientName} onChange={(e) => setClientForm({ ...clientForm, clientName: e.target.value })} />
              </label>
              <label className="form-field">
                <span className="form-label">Admin name</span>
                <input placeholder="Full name" value={clientForm.adminName} onChange={(e) => setClientForm({ ...clientForm, adminName: e.target.value })} />
              </label>
              <label className="form-field">
                <span className="form-label">Admin email</span>
                <input placeholder="admin@example.com" value={clientForm.email} onChange={(e) => setClientForm({ ...clientForm, email: e.target.value })} />
              </label>
              <label className="form-field">
                <span className="form-label">Temporary password</span>
                <input placeholder="At least 6 characters" type="password" value={clientForm.password} onChange={(e) => setClientForm({ ...clientForm, password: e.target.value })} />
              </label>
              <div className="form-actions">
                <button className="btn primary">Create Account</button>
              </div>
            </form>
          </section>
        ) : null}

        {activePage === "clients" ? (
          <section className="panel">
            <h2 className="panel-title">Clients</h2>
            <p className="panel-sub">Manage LGU clients. Suspend to temporarily block their admin access.</p>
            <ClientList clients={clients} onRename={handleRenameClient} onToggleStatus={handleToggleClientStatus} />
          </section>
        ) : null}

        {activePage === "analytics" ? (
          <SystemAnalyticsPanel onError={setError} />
        ) : null}

        {activePage === "admins" ? (
          <AdminsPanel
            clients={clients}
            onNotice={setNotice}
            onError={setError}
          />
        ) : null}

        {activePage === "settings" ? (
          <SuperAdminSettings session={session} onUpdated={(email) => {
            const next = { ...session, email };
            setSession(next);
            window.localStorage.setItem("queue_superadmin", JSON.stringify(next));
            setNotice("Superadmin credentials updated.");
          }} onError={setError} />
        ) : null}
      </section>
    </main>
  );
}

const SA_SVG_PROPS = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true };

function saIconOverview() {
  return (
    <svg {...SA_SVG_PROPS}>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  );
}
function saIconCreate() {
  return (
    <svg {...SA_SVG_PROPS}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <line x1="19" y1="8" x2="19" y2="14" />
      <line x1="22" y1="11" x2="16" y2="11" />
    </svg>
  );
}
function saIconClients() {
  return (
    <svg {...SA_SVG_PROPS}>
      <path d="M3 21V8l9-5 9 5v13" />
      <path d="M9 21v-9h6v9" />
    </svg>
  );
}
function saIconAdmins() {
  return (
    <svg {...SA_SVG_PROPS}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
function saIconAnalytics() {
  return (
    <svg {...SA_SVG_PROPS}>
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  );
}
function saIconSettings() {
  return (
    <svg {...SA_SVG_PROPS}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function saIconLogout() {
  return (
    <svg {...SA_SVG_PROPS}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

function SuperAdminSettings({ session, onUpdated, onError }) {
  const [config, setConfig] = useState(null);
  const [email, setEmail] = useState(session.email || "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [localNotice, setLocalNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    getSuperAdminConfig().then((cfg) => {
      if (cancelled) return;
      setConfig(cfg);
      setEmail(cfg.email);
    }).catch((err) => onError(err.message));
    return () => { cancelled = true; };
  }, [onError]);

  async function handleSave(event) {
    event.preventDefault();
    setLocalNotice("");
    setSaving(true);
    try {
      const updates = {};
      if (email && email !== config?.email) updates.email = email;
      if (password) updates.password = password;
      if (Object.keys(updates).length === 0) {
        setLocalNotice("No changes to save.");
        setSaving(false);
        return;
      }
      const result = await updateSuperAdminCredentials(updates);
      setConfig({ email: result.email, password: password || config.password });
      setPassword("");
      onUpdated(result.email);
    } catch (err) {
      onError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel">
      <h2 className="panel-title">Superadmin Credentials</h2>
      <p className="panel-sub">Change the email and password used to log in as superadmin. Changes apply on next login.</p>
      <form className="admin-form settings-form" onSubmit={handleSave}>
        <label className="form-field">
          <span className="form-label">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="superadmin@example.com"
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

function SaToast({ message, type, onClose }) {
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

function ClientList({ clients, onRename, onToggleStatus }) {
  return (
    <div className="simple-list">
      {clients.length ? clients.map((client) => (
        <ClientRow key={client.id} client={client} onRename={onRename} onToggleStatus={onToggleStatus} />
      )) : <div className="list-empty-light">No clients yet</div>}
    </div>
  );
}

function ClientRow({ client, onRename, onToggleStatus }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(client.name);

  useEffect(() => { setName(client.name); }, [client.name]);

  async function save() {
    if (name.trim() && name !== client.name && onRename) {
      await onRename(client, name);
    }
    setEditing(false);
  }

  const status = client.status || "active";
  const isSuspended = status === "suspended";

  if (editing) {
    return (
      <div className="simple-item editing">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
          autoFocus
          className="inline-edit-name"
        />
        <span style={{ color: "var(--color-muted)", fontSize: 12 }}>{client.id}</span>
      </div>
    );
  }

  return (
    <div className={`simple-item ${isSuspended ? "is-suspended" : ""}`}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <strong>{client.name}</strong>
          <span className={`status-pill ${isSuspended ? "suspended" : "active"}`}>
            {isSuspended ? "Suspended" : "Active"}
          </span>
        </div>
        <span style={{ display: "block", color: "var(--color-muted)", fontSize: 12, marginTop: 2 }}>{client.id}</span>
      </div>
      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
        {onToggleStatus ? (
          <button
            className={isSuspended ? "mini-action" : "mini-cancel"}
            onClick={() => onToggleStatus(client)}
          >
            {isSuspended ? "Reactivate" : "Suspend"}
          </button>
        ) : null}
        {onRename ? <button className="mini-action" onClick={() => setEditing(true)}>Rename</button> : null}
      </div>
    </div>
  );
}

function SystemAnalyticsPanel({ onError }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getSystemAnalytics()
      .then((s) => { if (!cancelled) setStats(s); })
      .catch((err) => onError(err.message))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [onError]);

  if (loading) return <section className="panel"><div className="list-empty-light">Loading analytics…</div></section>;
  if (!stats) return null;

  const maxClient = stats.perClient[0]?.total || 1;

  return (
    <div className="overview-wrap">
      <div className="setup-metrics">
        <section className="metric-card">
          <span>Active Clients</span>
          <strong>{stats.activeClients}</strong>
        </section>
        <section className="metric-card">
          <span>Suspended</span>
          <strong>{stats.suspendedClients}</strong>
        </section>
        <section className="metric-card">
          <span>Total Admins</span>
          <strong>{stats.totalAdmins}</strong>
        </section>
        <section className="metric-card">
          <span>Tickets Today</span>
          <strong>{stats.totalTicketsToday}</strong>
        </section>
        <section className="metric-card">
          <span>Completed Today</span>
          <strong>{stats.totalCompletedToday}</strong>
        </section>
        <section className="metric-card">
          <span>Completion Rate</span>
          <strong>{stats.completionRate}%</strong>
        </section>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Tickets per Client (Today)</h2>
          <span className="panel-meta">{stats.perClient.length} clients</span>
        </div>
        {stats.perClient.length === 0 ? (
          <div className="list-empty-light">No clients yet.</div>
        ) : (
          <div className="bar-list">
            {stats.perClient.map((c) => (
              <div className="bar-row" key={c.id}>
                <div className="bar-label">
                  {c.name}
                  {c.status === "suspended" ? <span className="status-pill suspended" style={{ marginLeft: 8 }}>Suspended</span> : null}
                </div>
                <div className="bar-track">
                  <div
                    className="bar-fill"
                    style={{ width: `${(c.total / maxClient) * 100}%`, opacity: c.status === "suspended" ? 0.4 : 1 }}
                  />
                </div>
                <div className="bar-value tabular">{c.total}</div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function AdminsPanel({ clients, onNotice, onError }) {
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ clientId: "", email: "", password: "", name: "" });

  async function refresh() {
    try {
      const all = await listAdmins();
      // Show admins only — counter staff are managed in the Admin dashboard
      setAdmins(all.filter((u) => u.role !== "staff"));
    } catch (err) {
      onError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function handleAdd(event) {
    event.preventDefault();
    try {
      if (!addForm.clientId) throw new Error("Pick a client.");
      await addAdminToClient(addForm.clientId, { ...addForm, role: "admin" });
      onNotice(`Added admin ${addForm.email}.`);
      setAddForm({ clientId: "", email: "", password: "", name: "" });
      setShowAdd(false);
      await refresh();
    } catch (err) {
      onError(err.message);
    }
  }

  async function handleToggleActive(admin) {
    const next = admin.active === false ? true : false;
    try {
      await setAdminActive(admin.email, next);
      onNotice(`${admin.email} ${next ? "reactivated" : "deactivated"}.`);
      await refresh();
    } catch (err) {
      onError(err.message);
    }
  }

  async function handleResetPassword(admin) {
    const password = prompt(`New password for ${admin.email}:`);
    if (!password) return;
    try {
      await updateAdminCredentials(admin.email, { password });
      onNotice(`Password reset for ${admin.email}.`);
    } catch (err) {
      onError(err.message);
    }
  }

  async function handleDelete(admin) {
    if (!confirm(`Delete admin ${admin.email}? This cannot be undone.`)) return;
    try {
      await deleteAdmin(admin.email);
      onNotice(`Deleted ${admin.email}.`);
      await refresh();
    } catch (err) {
      onError(err.message);
    }
  }

  if (loading) return <section className="panel"><div className="list-empty-light">Loading admins…</div></section>;

  // Group admins by client
  const byClient = {};
  admins.forEach((a) => {
    const key = a.clientId || "—";
    if (!byClient[key]) byClient[key] = [];
    byClient[key].push(a);
  });
  const clientsList = clients.map((c) => ({ id: c.id, name: c.name, admins: byClient[c.id] || [] }));

  return (
    <div className="overview-wrap">
      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Admin Accounts</h2>
          <button className="btn primary" onClick={() => setShowAdd((v) => !v)}>
            {showAdd ? "Close" : "+ Add Admin"}
          </button>
        </div>
        <p className="panel-sub">Manage admins across all clients. Multiple admins per client is supported.</p>

        {showAdd ? (
          <form className="admin-form create-client-form" onSubmit={handleAdd} style={{ marginTop: 14 }}>
            <label className="form-field">
              <span className="form-label">Client</span>
              <select
                value={addForm.clientId}
                onChange={(e) => setAddForm({ ...addForm, clientId: e.target.value })}
              >
                <option value="">— Select client —</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label className="form-field">
              <span className="form-label">Admin name</span>
              <input value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} placeholder="Full name" />
            </label>
            <label className="form-field">
              <span className="form-label">Email</span>
              <input value={addForm.email} onChange={(e) => setAddForm({ ...addForm, email: e.target.value })} placeholder="admin@example.com" />
            </label>
            <label className="form-field">
              <span className="form-label">Temporary password</span>
              <input type="password" value={addForm.password} onChange={(e) => setAddForm({ ...addForm, password: e.target.value })} placeholder="At least 6 characters" />
            </label>
            <div className="form-actions">
              <button className="btn primary" type="submit">Add Admin</button>
            </div>
          </form>
        ) : null}
      </section>

      {clientsList.map((client) => (
        <section className="panel" key={client.id}>
          <div className="panel-head">
            <h2 className="panel-title">{client.name}</h2>
            <span className="panel-meta">{client.admins.length} admin{client.admins.length === 1 ? "" : "s"}</span>
          </div>
          {client.admins.length === 0 ? (
            <div className="list-empty-light">No admins yet for this client.</div>
          ) : (
            <div className="simple-list">
              {client.admins.map((admin) => (
                <div className="simple-item" key={admin.email}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <strong>{admin.name || admin.email}</strong>
                      <span className={`status-pill ${admin.active === false ? "suspended" : "active"}`}>
                        {admin.active === false ? "Inactive" : "Active"}
                      </span>
                    </div>
                    <span style={{ display: "block", color: "var(--color-muted)", fontSize: 12, marginTop: 2 }}>
                      {admin.email}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap" }}>
                    <button className="mini-action" onClick={() => handleResetPassword(admin)}>Reset Password</button>
                    <button className={admin.active === false ? "mini-action" : "mini-cancel"} onClick={() => handleToggleActive(admin)}>
                      {admin.active === false ? "Reactivate" : "Deactivate"}
                    </button>
                    <button className="mini-danger" onClick={() => handleDelete(admin)}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
