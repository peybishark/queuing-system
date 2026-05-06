"use client";

import { useEffect, useState } from "react";
import {
  createAdminAccount,
  initFirebase,
  listenAdmins,
  listenSession,
  setAdminActive,
  signOutUser,
} from "../lib/firebaseClient";

export default function SuperAdminApp() {
  const [profile, setProfile] = useState(null);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [admins, setAdmins] = useState([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const allowed = profile?.active && profile.role === "superadmin";

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
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
      unsubscribers.forEach((unsubscribe) => unsubscribe?.());
    };
  }, []);

  useEffect(() => {
    if (!allowed) return undefined;
    return listenAdmins(setAdmins);
  }, [allowed]);

  async function handleCreateAdmin(event) {
    event.preventDefault();
    setMessage("");
    setError("");
    try {
      await createAdminAccount({ name, email, password });
      setName("");
      setEmail("");
      setPassword("");
      setMessage("Admin account created.");
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggleAdmin(admin) {
    try {
      await setAdminActive(admin.id, admin.active === false);
      setMessage(`${admin.name || admin.email} ${admin.active === false ? "enabled" : "disabled"}.`);
      setError("");
    } catch (err) {
      setError(err.message);
      setMessage("");
    }
  }

  if (authLoaded && !allowed) {
    return (
      <main className="page">
        <div className="notice error">Superadmin access required.</div>
        <a className="btn" href="/login">Go to Login</a>
      </main>
    );
  }

  return (
    <main className="page">
      <div className="topbar">
        <div className="brand">
          <span className="brand-dot" />
          <span>Superadmin Dashboard</span>
        </div>
        <div className="actions">
          <a className="btn" href="/admin">Admin</a>
          <a className="btn" href="/counter">Counters</a>
          <button className="btn" onClick={() => signOutUser()}>Sign Out</button>
        </div>
      </div>

      {message ? <div className="notice">{message}</div> : null}
      {error ? <div className="notice error">{error}</div> : null}

      <div className="counter-control-grid">
        <form className="control-card" onSubmit={handleCreateAdmin}>
          <div className="control-header">
            <h2 className="control-title">Create Admin</h2>
          </div>
          <div className="field">
            <label htmlFor="name">Name</label>
            <input id="name" value={name} onChange={(event) => setName(event.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="password">Temporary Password</label>
            <input id="password" type="password" minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} required />
          </div>
          <button className="btn primary">Create Admin</button>
        </form>

        {admins.map((admin) => (
          <div className={`control-card ${admin.active === false ? "" : "active"}`} key={admin.id}>
            <div className="control-header">
              <h2 className="control-title">{admin.name || admin.email}</h2>
              <span className={`control-status ${admin.active === false ? "idle" : "serving"}`}>
                {admin.active === false ? "Inactive" : "Active"}
              </span>
            </div>
            <div className="control-current">
              <div className="control-name">{admin.email}</div>
              <div className="control-service">Role: admin</div>
            </div>
            <button className="btn" onClick={() => toggleAdmin(admin)}>
              {admin.active === false ? "Enable" : "Disable"}
            </button>
          </div>
        ))}
      </div>
    </main>
  );
}
