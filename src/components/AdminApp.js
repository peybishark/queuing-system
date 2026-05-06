"use client";

import { useEffect, useState } from "react";
import {
  addService,
  initFirebase,
  listenCounters,
  listenServices,
  listenSession,
  listenWaitingTickets,
  removeService,
  seedDefaultServices,
  signOutUser,
  updateService,
} from "../lib/firebaseClient";

export default function AdminApp() {
  const [profile, setProfile] = useState(null);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [services, setServices] = useState([]);
  const [counters, setCounters] = useState([]);
  const [waiting, setWaiting] = useState([]);
  const [name, setName] = useState("");
  const [prefix, setPrefix] = useState("");
  const [icon, setIcon] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const allowed = profile?.active && (profile.role === "admin" || profile.role === "superadmin");

  useEffect(() => {
    let unsubscribers = [];
    let cancelled = false;

    initFirebase()
      .then(() => listenSession(({ profile }) => {
        setProfile(profile);
        setAuthLoaded(true);
      }))
      .then((unsubscribeSession) => {
        if (unsubscribeSession) unsubscribers.push(unsubscribeSession);
        if (cancelled) return;
        unsubscribers.push(
          listenServices(setServices),
          listenCounters(setCounters),
          listenWaitingTickets(setWaiting)
        );
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
      unsubscribers.forEach((unsubscribe) => unsubscribe?.());
    };
  }, []);

  async function handleAddService(event) {
    event.preventDefault();
    setMessage("");
    setError("");
    try {
      const service = await addService({ name, prefix, icon });
      setName("");
      setPrefix("");
      setIcon("");
      setMessage(`Added ${service.name}.`);
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggleService(service) {
    try {
      await updateService(service.id, { active: service.active === false });
      setMessage(`${service.name} ${service.active === false ? "enabled" : "disabled"}.`);
      setError("");
    } catch (err) {
      setError(err.message);
      setMessage("");
    }
  }

  async function handleRemoveService(service) {
    if (!confirm(`Remove ${service.name}?`)) return;
    try {
      await removeService(service.id);
      setMessage(`${service.name} removed.`);
      setError("");
    } catch (err) {
      setError(err.message);
      setMessage("");
    }
  }

  async function handleSeedDefaults() {
    try {
      await seedDefaultServices();
      setMessage("Default services are ready.");
      setError("");
    } catch (err) {
      setError(err.message);
      setMessage("");
    }
  }

  if (authLoaded && !allowed) {
    return (
      <main className="page">
        <div className="notice error">Admin access required.</div>
        <a className="btn" href="/login">Go to Login</a>
      </main>
    );
  }

  const servingCount = counters.filter((counter) => counter.currentTicketId).length;
  const pairedCount = counters.filter((counter) => counter.paired).length;

  return (
    <main className="page">
      <div className="topbar">
        <div className="brand">
          <span className="brand-dot" />
          <span>Admin Dashboard</span>
        </div>
        <div className="actions">
          {profile?.role === "superadmin" ? <a className="btn" href="/superadmin">Superadmin</a> : null}
          <a className="btn" href="/counter">Counters</a>
          <a className="btn" href="/display">Display</a>
          <button className="btn" onClick={() => signOutUser()}>Sign Out</button>
        </div>
      </div>

      {message ? <div className="notice">{message}</div> : null}
      {error ? <div className="notice error">{error}</div> : null}

      <div className="stats-bar">
        <div className="stat">
          <div className="stat-label">Services</div>
          <div className="stat-value tabular">{services.length}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Waiting</div>
          <div className="stat-value tabular">{waiting.length}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Counters</div>
          <div className="stat-value tabular">{servingCount}<span className="stat-divider">/</span>{counters.length}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Paired</div>
          <div className="stat-value tabular">{pairedCount}</div>
        </div>
      </div>

      <div className="counter-control-grid">
        <form className="control-card" onSubmit={handleAddService}>
          <div className="control-header">
            <h2 className="control-title">Add Service</h2>
          </div>
          <div className="field">
            <label htmlFor="serviceName">Service Name</label>
            <input id="serviceName" value={name} onChange={(event) => setName(event.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="servicePrefix">Prefix</label>
            <input id="servicePrefix" maxLength={4} value={prefix} onChange={(event) => setPrefix(event.target.value.toUpperCase())} required />
          </div>
          <div className="field">
            <label htmlFor="serviceIcon">Short Label</label>
            <input id="serviceIcon" maxLength={4} value={icon} onChange={(event) => setIcon(event.target.value.toUpperCase())} placeholder="BP" />
          </div>
          <button className="btn primary">Add Service</button>
          <button className="btn" type="button" onClick={handleSeedDefaults}>Seed Defaults</button>
        </form>

        {services.map((service) => (
          <div className={`control-card ${service.active === false ? "" : "active"}`} key={service.id}>
            <div className="control-header">
              <h2 className="control-title">{service.name}</h2>
              <span className={`control-status ${service.active === false ? "idle" : "serving"}`}>
                {service.active === false ? "Inactive" : "Active"}
              </span>
            </div>
            <div className="control-current">
              <div className="control-number tabular">{service.prefix}</div>
              <div className="control-name">{service.icon || service.prefix}</div>
            </div>
            <div className="control-row">
              <button className="btn" onClick={() => toggleService(service)}>
                {service.active === false ? "Enable" : "Disable"}
              </button>
              <button className="btn ghost-danger" onClick={() => handleRemoveService(service)}>Remove</button>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
