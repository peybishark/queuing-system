import { NextResponse } from "next/server";
import { initializeApp, getApps } from "firebase/app";
import {
  getFirestore,
  collection,
  query,
  where,
  getDocs,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";

export const dynamic = "force-dynamic";

let _db = null;
function getDb() {
  if (_db) return _db;
  const config = {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID,
  };
  const app = getApps()[0] || initializeApp(config);
  _db = getFirestore(app);
  return _db;
}

function getTodayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function timestampMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  return Number(value) || 0;
}

function normalizePhone(phone) {
  const raw = String(phone || "").replace(/\D/g, "");
  if (!raw) return null;
  // PH number normalization. Semaphore accepts 09XX or 639XX.
  if (raw.startsWith("63")) return raw;
  if (raw.startsWith("09") && raw.length === 11) return raw;
  if (raw.startsWith("9") && raw.length === 10) return `0${raw}`;
  return raw;
}

function buildMessage({ queueNumber, serviceName, position, orgName }) {
  const lines = [
    `Hi! Malapit ka na tawagin sa pila.`,
    `Queue #: ${queueNumber}${serviceName ? ` (${serviceName})` : ""}`,
    position === 1
      ? `Ikaw na ang susunod — pumunta na sa counter.`
      : `Mga ${position} pa lang sa harap mo. Stay nearby.`,
  ];
  if (orgName) lines.push(`- ${orgName}`);
  return lines.join("\n");
}

async function sendSemaphoreSms(phone, message) {
  const apiKey = process.env.SEMAPHORE_API_KEY;
  if (!apiKey) throw new Error("SEMAPHORE_API_KEY is not configured.");
  const sender = process.env.SEMAPHORE_SENDER_NAME || "SEMAPHORE";
  const body = new URLSearchParams({
    apikey: apiKey,
    number: phone,
    message,
    sendername: sender,
  });
  const res = await fetch("https://api.semaphore.co/api/v4/messages", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Semaphore ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json().catch(() => null);
}

export async function POST(req) {
  try {
    const payload = await req.json().catch(() => ({}));
    const clientId = String(payload.clientId || "").trim();
    if (!clientId) {
      return NextResponse.json({ error: "clientId required" }, { status: 400 });
    }
    const threshold = Math.max(1, Number(process.env.NEAR_NOTIFY_THRESHOLD) || 3);

    const db = getDb();
    const snap = await getDocs(
      query(
        collection(db, "queueTickets"),
        where("clientId", "==", clientId),
        where("serviceDate", "==", getTodayKey()),
        where("status", "==", "waiting")
      )
    );
    const sorted = snap.docs
      .map((d) => ({ id: d.id, ref: d.ref, ...d.data() }))
      .filter((t) => !t.expiresAt || timestampMillis(t.expiresAt) > Date.now())
      .sort(
        (a, b) =>
          Number(a.priorityRank ?? 1) - Number(b.priorityRank ?? 1) ||
          timestampMillis(a.createdAt) - timestampMillis(b.createdAt)
      );

    const orgName = payload.orgName || "";
    const results = { sent: 0, skipped: 0, errors: [] };
    const limit = Math.min(sorted.length, threshold);

    for (let i = 0; i < limit; i += 1) {
      const ticket = sorted[i];
      const position = i + 1;
      const phone = normalizePhone(ticket.phone);
      if (!phone) { results.skipped += 1; continue; }
      if (ticket.nearNotifiedAt) { results.skipped += 1; continue; }

      let claimed = false;
      try {
        await runTransaction(db, async (tx) => {
          const fresh = await tx.get(ticket.ref);
          if (!fresh.exists()) return;
          const data = fresh.data();
          if (data.nearNotifiedAt) return;
          if (data.status !== "waiting") return;
          tx.update(ticket.ref, {
            nearNotifiedAt: serverTimestamp(),
            nearNotifiedPosition: position,
            updatedAt: serverTimestamp(),
          });
          claimed = true;
        });
      } catch (err) {
        results.errors.push({ id: ticket.id, error: err.message });
        continue;
      }
      if (!claimed) { results.skipped += 1; continue; }

      const message = buildMessage({
        queueNumber: ticket.queueNumber,
        serviceName: ticket.serviceName,
        position,
        orgName,
      });
      try {
        await sendSemaphoreSms(phone, message);
        results.sent += 1;
      } catch (err) {
        results.errors.push({ id: ticket.id, error: err.message });
      }
    }

    return NextResponse.json(results);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
