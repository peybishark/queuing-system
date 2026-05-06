"use client";

import { useState } from "react";
import { createInitialSuperadmin } from "../lib/firebaseClient";

export default function SetupApp() {
  const [name, setName] = useState("Super Admin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await createInitialSuperadmin({ name, email, password });
      window.location.href = "/superadmin";
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  return (
    <main className="page">
      <div className="topbar">
        <div className="brand">
          <span className="brand-dot" />
          <span>LGU Queuing System</span>
        </div>
        <div className="actions">
          <a className="btn" href="/login">Login</a>
        </div>
      </div>
      <div className="form-wrap">
        <form className="panel" onSubmit={handleSubmit}>
          <div className="ticket-preview">
            <div className="ticket-preview-label">Initial Setup</div>
            <div className="ticket-preview-name">Create the first superadmin account.</div>
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
            <label htmlFor="password">Password</label>
            <input id="password" type="password" minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} required />
          </div>
          <button className="tap-button full" disabled={loading}>
            {loading ? "Creating..." : "Create Superadmin"}
          </button>
          {error ? <div className="notice error">{error}</div> : null}
        </form>
      </div>
    </main>
  );
}
