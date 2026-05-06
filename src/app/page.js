import Link from "next/link";

export default function HomePage() {
  return (
    <main className="page">
      <div className="topbar">
        <div className="brand">
          <span className="brand-dot" />
          <span>LGU Queuing System</span>
        </div>
      </div>
      <div className="kiosk-services">
        <h1 className="kiosk-heading">Queue System</h1>
        <p className="kiosk-sub">Open one of the queue screens.</p>
        <div className="service-grid">
          <Link className="service-card" href="/kiosk">
            <div className="service-icon">K</div>
            <div className="service-title">Kiosk</div>
            <div className="service-prefix">Customer entry</div>
          </Link>
          <Link className="service-card" href="/display">
            <div className="service-icon">D</div>
            <div className="service-title">Display Monitor</div>
            <div className="service-prefix">Now serving board</div>
          </Link>
          <Link className="service-card" href="/counter">
            <div className="service-icon">C</div>
            <div className="service-title">Counter Control</div>
            <div className="service-prefix">Staff controls</div>
          </Link>
        </div>
      </div>
    </main>
  );
}
