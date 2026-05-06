"use client";

import { useEffect, useState } from "react";
import { getCurrentSession, initFirebase, signIn } from "../lib/firebaseClient";

export default function LoginApp() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    initFirebase()
      .then(getCurrentSession)
      .then(({ profile }) => {
        if (profile?.active) routeByRole(profile.role);
      })
      .catch(() => null);
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const cred = await signIn(email, password);
      const { profile } = await getCurrentSession(cred.user.uid);
      if (!profile?.active) throw new Error("This account is inactive or has no role profile.");
      routeByRole(profile.role);
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
          <a className="btn" href="/setup">Setup Superadmin</a>
        </div>
      </div>
      <div className="form-wrap">
        <form className="panel" onSubmit={handleSubmit}>
          <div className="ticket-preview">
            <div className="ticket-preview-label">Staff Login</div>
            <div className="ticket-preview-name">Sign in as admin or superadmin.</div>
          </div>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          </div>
          <button className="tap-button full" disabled={loading}>
            {loading ? "Signing in..." : "Sign In"}
          </button>
          {error ? <div className="notice error">{error}</div> : null}
        </form>
      </div>
    </main>
  );
}

function routeByRole(role) {
  window.location.href = role === "superadmin" ? "/superadmin" : "/admin";
}
