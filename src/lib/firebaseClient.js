import { initializeApp, getApps } from "firebase/app";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  runTransaction,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  getDocs,
} from "firebase/firestore";
import { getConfig } from "./queueApp";

let app;
let db;
let appConfig;

export const SERVICES = [
  { id: "business_permit", name: "Business Permit", prefix: "BP", icon: "BP" },
  { id: "working_permit", name: "Working Permit", prefix: "WP", icon: "WP" },
  { id: "pwd_senior_id", name: "PWD / Senior Citizen ID", prefix: "ID", icon: "ID" },
  { id: "civil_registry", name: "Civil Registry Documents", prefix: "CR", icon: "CR" },
  { id: "treasury", name: "Treasury / Payment", prefix: "TR", icon: "TR" },
  { id: "assessor", name: "Assessor", prefix: "AS", icon: "AS" },
  { id: "health_certificate", name: "Health Certificate", prefix: "HC", icon: "HC" },
  { id: "barangay_clearance", name: "Barangay Clearance", prefix: "BC", icon: "BC" },
];

export const DEFAULT_CLIENT_ID = "default";
const RESPONSE_WINDOW_MS = 10000;

function cleanId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 42);
}

function normalizeClientId(clientId) {
  return cleanId(clientId) || DEFAULT_CLIENT_ID;
}

function normalizeService(service) {
  return {
    id: cleanId(service.id || service.name),
    name: String(service.name || "").trim(),
    prefix: String(service.prefix || "").trim().toUpperCase().slice(0, 4),
    icon: String(service.icon || service.prefix || "").trim().toUpperCase().slice(0, 4),
  };
}

function makeCode(length = 6) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < length; i += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

function timestampMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  return Number(value) || 0;
}

function isTicketExpired(ticket, now = Date.now()) {
  return ticket.expiresAt && timestampMillis(ticket.expiresAt) <= now;
}

function sortTicketsForQueue(a, b) {
  return (
    Number(a.priorityRank ?? 1) - Number(b.priorityRank ?? 1) ||
    timestampMillis(a.createdAt) - timestampMillis(b.createdAt) ||
    String(a.queueNumber || "").localeCompare(String(b.queueNumber || ""))
  );
}

export async function initFirebase(clientId = DEFAULT_CLIENT_ID) {
  if (db) {
    await ensureClientDefaults(clientId);
    return { db, appConfig };
  }
  appConfig = await getConfig();
  if (!appConfig.firebase?.apiKey) {
    throw new Error("Firebase config is missing. Check FIREBASE_* values in .env.");
  }
  app = getApps()[0] || initializeApp(appConfig.firebase);
  db = getFirestore(app);
  await ensureClientDefaults(clientId);
  return { db, appConfig };
}

export function getTodayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function getServiceById(id) {
  return SERVICES.find((service) => service.id === id);
}

async function ensureClientDefaults(clientId = DEFAULT_CLIENT_ID) {
  await ensureServices(clientId);
  await ensureCounters(clientId);
}

async function ensureServices(clientId = DEFAULT_CLIENT_ID) {
  const normalizedClientId = normalizeClientId(clientId);
  const { db } = await initFirebaseNoEnsure();
  const snap = await getDocs(
    query(collection(db, "queueServices"), where("clientId", "==", normalizedClientId))
  );
  // Track existing service IDs (raw ID stored in the doc data)
  const existingIds = new Set(
    snap.docs.map((d) => d.data().id || d.id.replace(`${normalizedClientId}_`, ""))
  );
  const missing = SERVICES.filter((service) => !existingIds.has(service.id));
  if (missing.length === 0) return;

  await Promise.all(
    missing.map((service) => {
      const sortOrder = SERVICES.findIndex((s) => s.id === service.id) + 1;
      return setDoc(doc(db, "queueServices", `${normalizedClientId}_${service.id}`), {
        ...service,
        clientId: normalizedClientId,
        active: true,
        sortOrder,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    })
  );
}

async function ensureCounters(clientId = DEFAULT_CLIENT_ID) {
  const normalizedClientId = normalizeClientId(clientId);
  const { db } = await initFirebaseNoEnsure();
  const snap = await getDocs(
    query(collection(db, "queueCounters"), where("clientId", "==", normalizedClientId), limit(1))
  );
  if (!snap.empty) return;

  await setDoc(doc(db, "queueCounters", `${normalizedClientId}_1`), {
    clientId: normalizedClientId,
    counterNo: 1,
    label: "Counter 1",
    serviceIds: [],
    currentTicketId: null,
    currentQueueNumber: null,
    currentCustomerName: null,
    currentServiceName: null,
    currentPriorityType: null,
    responseDeadlineAt: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

async function initFirebaseNoEnsure() {
  if (db) return { db, appConfig };
  appConfig = await getConfig();
  if (!appConfig.firebase?.apiKey) {
    throw new Error("Firebase config is missing. Check FIREBASE_* values in .env.");
  }
  app = getApps()[0] || initializeApp(appConfig.firebase);
  db = getFirestore(app);
  return { db, appConfig };
}

export async function getServices(clientId = DEFAULT_CLIENT_ID) {
  const normalizedClientId = normalizeClientId(clientId);
  const { db } = await initFirebase(normalizedClientId);
  const snap = await getDocs(
    query(collection(db, "queueServices"), where("clientId", "==", normalizedClientId))
  );
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((service) => service.active !== false)
    .sort((a, b) => Number(a.sortOrder || 999) - Number(b.sortOrder || 999) || a.name.localeCompare(b.name));
}

export function listenServices(clientId, callback) {
  const normalizedClientId = normalizeClientId(clientId);
  const q = query(collection(db, "queueServices"), where("clientId", "==", normalizedClientId));
  return onSnapshot(q, (snap) =>
    callback(
      snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((service) => service.active !== false)
        .sort((a, b) => Number(a.sortOrder || 999) - Number(b.sortOrder || 999) || a.name.localeCompare(b.name))
    )
  );
}

export async function addService(clientId, service, actor = null) {
  const normalizedClientId = normalizeClientId(clientId);
  const next = normalizeService(service);
  if (typeof console !== "undefined") console.log("[addService] input:", service, "→ normalized:", next, "clientId:", normalizedClientId);
  if (!next.id || !next.name || !next.prefix) {
    throw new Error("Service name and prefix are required.");
  }
  const { db } = await initFirebase(normalizedClientId);
  const docId = `${normalizedClientId}_${next.id}`;
  await setDoc(doc(db, "queueServices", docId), {
    ...next,
    clientId: normalizedClientId,
    active: true,
    sortOrder: Date.now(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  if (typeof console !== "undefined") console.log("[addService] saved doc:", docId);
  logActivity(normalizedClientId, "service.added", { id: next.id, name: next.name, prefix: next.prefix }, actor);
  return next;
}

export async function removeService(clientId, serviceId, actor = null) {
  const normalizedClientId = normalizeClientId(clientId);
  const { db } = await initFirebase(normalizedClientId);
  await updateDoc(doc(db, "queueServices", `${normalizedClientId}_${serviceId}`), {
    active: false,
    updatedAt: serverTimestamp(),
  });
  logActivity(normalizedClientId, "service.disabled", { id: serviceId }, actor);
}

export async function reenableService(clientId, serviceId, actor = null) {
  const normalizedClientId = normalizeClientId(clientId);
  const { db } = await initFirebase(normalizedClientId);
  await updateDoc(doc(db, "queueServices", `${normalizedClientId}_${serviceId}`), {
    active: true,
    updatedAt: serverTimestamp(),
  });
  logActivity(normalizedClientId, "service.reenabled", { id: serviceId }, actor);
}

export async function deleteService(clientId, serviceId, actor = null) {
  const normalizedClientId = normalizeClientId(clientId);
  const { db } = await initFirebase(normalizedClientId);
  await deleteDoc(doc(db, "queueServices", `${normalizedClientId}_${serviceId}`));
  logActivity(normalizedClientId, "service.deleted", { id: serviceId }, actor);
}

export function listenAllServices(clientId, callback) {
  const normalizedClientId = normalizeClientId(clientId);
  let unsubscribe = null;
  let cancelled = false;

  function attach(readyDb) {
    if (cancelled) return;
    const q = query(collection(readyDb, "queueServices"), where("clientId", "==", normalizedClientId));
    unsubscribe = onSnapshot(
      q,
      (snap) => {
        // Build with Firestore doc path as docId (always unique) and dedupe
        const seen = new Set();
        const rows = [];
        snap.docs.forEach((d) => {
          const data = d.data();
          if (seen.has(d.id)) return;
          seen.add(d.id);
          rows.push({ ...data, id: data.id || d.id, docId: d.id });
        });
        rows.sort((a, b) => {
          const aActive = a.active !== false;
          const bActive = b.active !== false;
          if (aActive !== bActive) return aActive ? -1 : 1;
          return Number(a.sortOrder || 999) - Number(b.sortOrder || 999) || (a.name || "").localeCompare(b.name || "");
        });
        if (typeof console !== "undefined") console.log("[services] listener:", rows.length, "rows from", snap.docs.length, "docs");
        callback(rows);
      },
      (err) => {
        if (typeof console !== "undefined") console.warn("[services] listener error:", err?.message || err);
      }
    );
  }

  if (db) {
    attach(db);
  } else {
    initFirebaseNoEnsure().then(({ db: readyDb }) => attach(readyDb)).catch((err) => {
      if (typeof console !== "undefined") console.warn("[services] init failed:", err?.message || err);
    });
  }

  return () => {
    cancelled = true;
    if (unsubscribe) unsubscribe();
  };
}

export async function updateService(clientId, serviceId, updates, actor = null) {
  const normalizedClientId = normalizeClientId(clientId);
  const { db } = await initFirebase(normalizedClientId);
  const ref = doc(db, "queueServices", `${normalizedClientId}_${serviceId}`);
  const cleanUpdates = { updatedAt: serverTimestamp() };
  if (updates?.name) cleanUpdates.name = String(updates.name).trim();
  if (updates?.prefix) {
    const prefix = String(updates.prefix).trim().toUpperCase().slice(0, 4);
    cleanUpdates.prefix = prefix;
    cleanUpdates.icon = prefix;
  }
  await updateDoc(ref, cleanUpdates);
  logActivity(normalizedClientId, "service.updated", { id: serviceId, ...updates }, actor);
}

export async function updateCounterLabel(clientId, counterNo, label, actor = null) {
  const normalizedClientId = normalizeClientId(clientId);
  const { db } = await initFirebase(normalizedClientId);
  const cleanLabel = String(label || "").trim() || `Counter ${counterNo}`;
  await updateDoc(doc(db, "queueCounters", `${normalizedClientId}_${counterNo}`), {
    label: cleanLabel,
    updatedAt: serverTimestamp(),
  });
  logActivity(normalizedClientId, "counter.renamed", { counterNo, label: cleanLabel }, actor);
}

export async function updateClient(clientId, updates, actor = null) {
  const { db } = await initFirebaseNoEnsure();
  const cleanUpdates = { updatedAt: serverTimestamp() };
  if (updates?.name) cleanUpdates.name = String(updates.name).trim();
  if (updates?.logo !== undefined) cleanUpdates.logo = updates.logo || null;
  if (updates?.themeColor !== undefined) cleanUpdates.themeColor = updates.themeColor || null;
  await updateDoc(doc(db, "clients", clientId), cleanUpdates);
  logActivity(clientId, "client.updated", { fields: Object.keys(cleanUpdates) }, actor);
}

export async function createTicket({ clientId = DEFAULT_CLIENT_ID, serviceId, customerName, phone, priorityType }) {
  const normalizedClientId = normalizeClientId(clientId);
  const { db, appConfig } = await initFirebase(normalizedClientId);
  const services = await getServices(normalizedClientId);
  const service = services.find((item) => item.id === serviceId || item.id === `${normalizedClientId}_${serviceId}`);
  if (!service) throw new Error("Invalid service selected.");

  const serviceDate = getTodayKey();
  const sequenceId = `${normalizedClientId}_${serviceDate}_${service.prefix}`;
  const sequenceRef = doc(db, "queueSequences", sequenceId);

  return runTransaction(db, async (tx) => {
    const sequenceSnap = await tx.get(sequenceRef);
    const current = sequenceSnap.exists() ? Number(sequenceSnap.data().lastNumber || 0) : 0;
    const next = current + 1;

    tx.set(
      sequenceRef,
      {
        serviceDate,
        prefix: service.prefix,
        lastNumber: next,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    const queueNumber = `${service.prefix}-${String(next).padStart(3, "0")}`;
    const ticketRef = doc(db, "queueTickets", `${normalizedClientId}_${serviceDate}_${queueNumber}`);
    const cleanName = String(customerName || "").trim();
    const cleanPhone = String(phone || "").trim();
    const cleanPriority = ["SC", "PWD", "PG"].includes(priorityType) ? priorityType : null;

    const ticket = {
      id: ticketRef.id,
      clientId: normalizedClientId,
      serviceDate,
      serviceId: service.id,
      serviceName: service.name,
      prefix: service.prefix,
      queueNumber,
      customerName: cleanName || null,
      phone: cleanPhone || null,
      priorityType: cleanPriority,
      priorityRank: cleanPriority ? 0 : 1,
      status: "waiting",
      counterNo: null,
      calledAt: null,
      completedAt: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    tx.set(ticketRef, ticket);
    return { ...ticket, orgName: appConfig.orgName };
  });
}

export function listenWaitingTickets(callback) {
  return listenWaitingTicketsForClient(DEFAULT_CLIENT_ID, callback);
}

export function listenWaitingTicketsForClient(clientId, callback) {
  const normalizedClientId = normalizeClientId(clientId);
  const q = query(
    collection(db, "queueTickets"),
    where("clientId", "==", normalizedClientId),
    where("serviceDate", "==", getTodayKey()),
    where("status", "==", "waiting")
  );
  return onSnapshot(q, (snap) =>
    callback(
      snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((ticket) => !isTicketExpired(ticket))
        .sort(sortTicketsForQueue)
        .slice(0, 15)
    )
  );
}

export function listenServingTickets(callback) {
  return listenServingTicketsForClient(DEFAULT_CLIENT_ID, callback);
}

export function listenServingTicketsForClient(clientId, callback) {
  const normalizedClientId = normalizeClientId(clientId);
  const q = query(
    collection(db, "queueTickets"),
    where("clientId", "==", normalizedClientId),
    where("serviceDate", "==", getTodayKey()),
    where("status", "==", "serving")
  );
  return onSnapshot(q, (snap) =>
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => Number(a.counterNo) - Number(b.counterNo)))
  );
}

export function listenCompletedTickets(callback) {
  return listenCompletedTicketsForClient(DEFAULT_CLIENT_ID, callback);
}

export function listenCompletedTicketsForClient(clientId, callback) {
  const normalizedClientId = normalizeClientId(clientId);
  const q = query(
    collection(db, "queueTickets"),
    where("clientId", "==", normalizedClientId),
    where("serviceDate", "==", getTodayKey()),
    where("status", "==", "completed")
  );
  return onSnapshot(q, (snap) =>
    callback(
      snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => timestampMillis(b.completedAt) - timestampMillis(a.completedAt))
        .slice(0, 8)
    )
  );
}

export function listenCounters(callback) {
  return listenCountersForClient(DEFAULT_CLIENT_ID, callback);
}

export function listenCountersForClient(clientId, callback) {
  const normalizedClientId = normalizeClientId(clientId);
  const q = query(
    collection(db, "queueCounters"),
    where("clientId", "==", normalizedClientId)
  );
  return onSnapshot(q, (snap) =>
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => Number(a.counterNo) - Number(b.counterNo)))
  );
}

export async function callNext(counterNo, clientId = DEFAULT_CLIENT_ID) {
  const normalizedClientId = normalizeClientId(clientId);
  const { db } = await initFirebase(normalizedClientId);
  const counterRef = doc(db, "queueCounters", `${normalizedClientId}_${counterNo}`);
  await sweepQueueTimeouts(normalizedClientId);

  // Pre-flight: read counter for routing config + waiting candidates.
  const counterPreSnap = await getDoc(counterRef);
  if (!counterPreSnap.exists()) return null;
  if (counterPreSnap.data().currentTicketId) {
    throw new Error(`Counter ${counterNo} still has an active ticket. Complete it first.`);
  }
  if (counterPreSnap.data().paused) return null; // counter on break — skip
  const assignedServices = Array.isArray(counterPreSnap.data().serviceIds) ? counterPreSnap.data().serviceIds : [];

  const waitingQuery = query(
    collection(db, "queueTickets"),
    where("clientId", "==", normalizedClientId),
    where("serviceDate", "==", getTodayKey()),
    where("status", "==", "waiting")
  );
  const waitingSnap = await getDocs(waitingQuery);
  if (waitingSnap.empty) return null;

  const nowMs = Date.now();
  const candidates = waitingSnap.docs
    .filter((d) => !isTicketExpired(d.data(), nowMs))
    .filter((d) => assignedServices.length === 0 || assignedServices.includes(d.data().serviceId))
    .sort((a, b) => sortTicketsForQueue(a.data(), b.data()));

  // Try candidates one-by-one inside a transaction. Both counter and ticket
  // are tx.get'd, so concurrent claims from sibling counters retry/fail safely.
  for (const candidate of candidates) {
    try {
      const result = await runTransaction(db, async (tx) => {
        const counterSnap = await tx.get(counterRef);
        if (!counterSnap.exists()) return null;
        if (counterSnap.data().currentTicketId) return null;
        if (counterSnap.data().paused) return null;

        const ticketSnap = await tx.get(candidate.ref);
        if (!ticketSnap.exists() || ticketSnap.data().status !== "waiting") return null;

        const ticketData = ticketSnap.data();
        tx.update(candidate.ref, {
          status: "serving",
          counterNo,
          calledAt: serverTimestamp(),
          responseDeadlineAt: null,
          expiresAt: null,
          returnedAt: null,
          updatedAt: serverTimestamp(),
        });
        tx.set(
          counterRef,
          {
            clientId: normalizedClientId,
            counterNo,
            label: counterSnap.data().label || `Counter ${counterNo}`,
            serviceIds: counterSnap.data().serviceIds || [],
            currentTicketId: candidate.id,
            currentQueueNumber: ticketData.queueNumber,
            currentCustomerName: ticketData.customerName || null,
            currentServiceName: ticketData.serviceName,
            currentPriorityType: ticketData.priorityType || null,
            recallAt: null,
            responseDeadlineAt: null,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );

        return { id: candidate.id, ...ticketData, counterNo };
      });

      if (result) return result;
      // Null = ticket was claimed by sibling counter; try the next candidate.
    } catch (_) {
      // Transaction failure (retry exhausted) — try next candidate.
    }
  }

  return null;
}

export async function completeCounter(counterNo, clientId = DEFAULT_CLIENT_ID) {
  const normalizedClientId = normalizeClientId(clientId);
  const { db } = await initFirebase(normalizedClientId);
  const counterRef = doc(db, "queueCounters", `${normalizedClientId}_${counterNo}`);

  await runTransaction(db, async (tx) => {
    const counterSnap = await tx.get(counterRef);
    if (!counterSnap.exists()) return;

    const counter = counterSnap.data();
    if (!counter.currentTicketId) return;

    tx.update(doc(db, "queueTickets", counter.currentTicketId), {
      status: "completed",
      completedAt: serverTimestamp(),
      responseDeadlineAt: null,
      expiresAt: null,
      updatedAt: serverTimestamp(),
    });
    tx.set(
      counterRef,
      {
        currentTicketId: null,
        currentQueueNumber: null,
        currentCustomerName: null,
        currentServiceName: null,
        currentPriorityType: null,
        responseDeadlineAt: null,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  });
}

const RECALL_SPEECH_MS = 7000;

// ====== ACTIVITY LOG ======

export async function logActivity(clientId, action, details = {}, actor = null) {
  try {
    const normalizedClientId = normalizeClientId(clientId);
    const { db } = await initFirebaseNoEnsure();
    const payload = {
      clientId: normalizedClientId,
      action,
      details,
      timestamp: serverTimestamp(),
      day: getTodayKey(),
    };
    if (actor) {
      payload.actor = {
        name: String(actor.name || "").trim() || actor.email || "",
        email: String(actor.email || "").trim().toLowerCase(),
        role: actor.role || "admin",
      };
    }
    const ref = await addDoc(collection(db, "activityLogs"), payload);
    if (typeof console !== "undefined") console.log("[activity]", action, ref.id);
  } catch (err) {
    if (typeof console !== "undefined") console.warn("[activity] failed to write:", err?.message || err);
  }
}

export async function logAuthEvent(clientId, type, actor) {
  // type: "login" | "logout"
  return logActivity(clientId, `auth.${type}`, {}, actor);
}

export function listenActivityLogs(clientId, callback, max = 100) {
  const normalizedClientId = normalizeClientId(clientId);
  let unsubscribe = null;
  let cancelled = false;

  function attach(readyDb) {
    if (cancelled) return;
    const q = query(
      collection(readyDb, "activityLogs"),
      where("clientId", "==", normalizedClientId)
    );
    unsubscribe = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => timestampMillis(b.timestamp) - timestampMillis(a.timestamp))
          .slice(0, max);
        if (typeof console !== "undefined") console.log("[activity] listener:", rows.length, "rows");
        callback(rows);
      },
      (err) => {
        if (typeof console !== "undefined") console.warn("[activity] listener error:", err?.message || err);
      }
    );
  }

  if (db) {
    attach(db);
  } else {
    initFirebaseNoEnsure().then(({ db: readyDb }) => attach(readyDb)).catch((err) => {
      if (typeof console !== "undefined") console.warn("[activity] listener init failed:", err?.message || err);
    });
  }

  return () => {
    cancelled = true;
    if (unsubscribe) unsubscribe();
  };
}

export async function pauseCounter(counterNo, clientId = DEFAULT_CLIENT_ID, actor = null) {
  const normalizedClientId = normalizeClientId(clientId);
  const { db } = await initFirebase(normalizedClientId);
  const counterRef = doc(db, "queueCounters", `${normalizedClientId}_${counterNo}`);
  await updateDoc(counterRef, {
    paused: true,
    pausedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  logActivity(normalizedClientId, "counter.paused", { counterNo }, actor);
}

export async function resumeCounter(counterNo, clientId = DEFAULT_CLIENT_ID, actor = null) {
  const normalizedClientId = normalizeClientId(clientId);
  const { db } = await initFirebase(normalizedClientId);
  const counterRef = doc(db, "queueCounters", `${normalizedClientId}_${counterNo}`);
  await updateDoc(counterRef, {
    paused: false,
    pausedAt: null,
    updatedAt: serverTimestamp(),
  });
  logActivity(normalizedClientId, "counter.resumed", { counterNo }, actor);
}

export async function holdCounter(counterNo, clientId = DEFAULT_CLIENT_ID) {
  const normalizedClientId = normalizeClientId(clientId);
  const { db } = await initFirebase(normalizedClientId);
  const counterRef = doc(db, "queueCounters", `${normalizedClientId}_${counterNo}`);

  await runTransaction(db, async (tx) => {
    const counterSnap = await tx.get(counterRef);
    if (!counterSnap.exists()) return;
    const counter = counterSnap.data();
    if (!counter.currentTicketId) return;

    tx.update(doc(db, "queueTickets", counter.currentTicketId), {
      recallAt: null,
      responseDeadlineAt: null,
      heldAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    tx.update(counterRef, {
      recallAt: null,
      responseDeadlineAt: null,
      heldAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });
}

export async function recallCounter(counterNo, clientId = DEFAULT_CLIENT_ID) {
  const normalizedClientId = normalizeClientId(clientId);
  const { db } = await initFirebase(normalizedClientId);
  const counterRef = doc(db, "queueCounters", `${normalizedClientId}_${counterNo}`);

  // Phase 1: trigger announcement on Display, no countdown yet.
  let activeTicketId = null;
  await runTransaction(db, async (tx) => {
    const counterSnap = await tx.get(counterRef);
    if (!counterSnap.exists()) return;
    const counter = counterSnap.data();
    if (!counter.currentTicketId) return;
    activeTicketId = counter.currentTicketId;

    tx.update(doc(db, "queueTickets", counter.currentTicketId), {
      recallAt: serverTimestamp(),
      responseDeadlineAt: null,
      updatedAt: serverTimestamp(),
    });
    tx.update(counterRef, {
      recallAt: serverTimestamp(),
      responseDeadlineAt: null,
      updatedAt: serverTimestamp(),
    });
  });

  if (!activeTicketId) return;

  // Phase 2: after speech window, start the 10-second countdown.
  // Skip if Hold was pressed in between (recallAt cleared) or counter
  // completed/recalled again to a different ticket.
  setTimeout(() => {
    runTransaction(db, async (tx) => {
      const counterSnap = await tx.get(counterRef);
      if (!counterSnap.exists()) return;
      const counter = counterSnap.data();
      if (counter.currentTicketId !== activeTicketId) return;
      if (!counter.recallAt) return; // Hold pressed — abort deadline.
      const deadline = new Date(Date.now() + RESPONSE_WINDOW_MS);
      tx.update(counterRef, {
        responseDeadlineAt: deadline,
        updatedAt: serverTimestamp(),
      });
      tx.update(doc(db, "queueTickets", activeTicketId), {
        responseDeadlineAt: deadline,
        updatedAt: serverTimestamp(),
      });
    }).catch(() => { /* ignore — counter may have completed */ });
  }, RECALL_SPEECH_MS);
}

export async function sweepQueueTimeouts(clientId = DEFAULT_CLIENT_ID) {
  const normalizedClientId = normalizeClientId(clientId);
  const { db } = await initFirebase(normalizedClientId);
  const nowMs = Date.now();
  const serviceDate = getTodayKey();

  const servingSnap = await getDocs(
    query(
      collection(db, "queueTickets"),
      where("clientId", "==", normalizedClientId),
      where("serviceDate", "==", serviceDate),
      where("status", "==", "serving")
    )
  );

  await Promise.all(
    servingSnap.docs.map(async (ticketDoc) => {
      const ticket = ticketDoc.data();
      const deadlineMs = timestampMillis(ticket.responseDeadlineAt);
      if (!deadlineMs || deadlineMs > nowMs) return;

      const counterNo = ticket.counterNo;
      const counterRef = doc(db, "queueCounters", `${normalizedClientId}_${counterNo}`);
      await runTransaction(db, async (tx) => {
        const freshTicket = await tx.get(ticketDoc.ref);
        const counterSnap = counterNo ? await tx.get(counterRef) : null;
        if (!freshTicket.exists() || freshTicket.data().status !== "serving") return;

        tx.update(ticketDoc.ref, {
          status: "cancelled",
          cancelledReason: "no_show_timeout",
          cancelledAt: serverTimestamp(),
          lastCounterNo: counterNo || null,
          responseDeadlineAt: null,
          expiresAt: null,
          updatedAt: serverTimestamp(),
        });

        if (counterSnap?.exists() && counterSnap.data().currentTicketId === ticketDoc.id) {
          tx.set(
            counterRef,
            {
              currentTicketId: null,
              currentQueueNumber: null,
              currentCustomerName: null,
              currentServiceName: null,
              currentPriorityType: null,
              responseDeadlineAt: null,
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
        }
      });
    })
  );

  const waitingSnap = await getDocs(
    query(
      collection(db, "queueTickets"),
      where("clientId", "==", normalizedClientId),
      where("serviceDate", "==", serviceDate),
      where("status", "==", "waiting")
    )
  );

  await Promise.all(
    waitingSnap.docs
      .filter((ticketDoc) => isTicketExpired(ticketDoc.data(), nowMs))
      .map((ticketDoc) =>
        updateDoc(ticketDoc.ref, {
          status: "cancelled",
          cancelledReason: "no_show_timeout",
          cancelledAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      )
  );
}

export async function addCounter(label, clientId = DEFAULT_CLIENT_ID, serviceIds = [], actor = null) {
  const normalizedClientId = normalizeClientId(clientId);
  const { db } = await initFirebase(normalizedClientId);
  const snap = await getDocs(query(collection(db, "queueCounters"), where("clientId", "==", normalizedClientId)));
  const maxNo = snap.docs.reduce((max, d) => {
    const n = Number(d.data().counterNo) || 0;
    return n > max ? n : max;
  }, 0);
  const counterNo = maxNo + 1;
  const cleanLabel = (label && label.trim()) || `Counter ${counterNo}`;

  await setDoc(doc(db, "queueCounters", `${normalizedClientId}_${counterNo}`), {
    clientId: normalizedClientId,
    counterNo,
    label: cleanLabel,
    serviceIds,
    currentTicketId: null,
    currentQueueNumber: null,
    currentCustomerName: null,
    currentServiceName: null,
    currentPriorityType: null,
    responseDeadlineAt: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  logActivity(normalizedClientId, "counter.added", { counterNo, label: cleanLabel }, actor);
  return { counterNo, label: cleanLabel };
}

export async function updateCounterServices(clientId, counterNo, serviceIds) {
  const normalizedClientId = normalizeClientId(clientId);
  const { db } = await initFirebase(normalizedClientId);
  await setDoc(
    doc(db, "queueCounters", `${normalizedClientId}_${counterNo}`),
    {
      clientId: normalizedClientId,
      counterNo: Number(counterNo),
      serviceIds: Array.isArray(serviceIds) ? serviceIds : [],
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function removeCounter(counterNo, clientId = DEFAULT_CLIENT_ID, actor = null) {
  const normalizedClientId = normalizeClientId(clientId);
  const { db } = await initFirebase(normalizedClientId);
  const counterRef = doc(db, "queueCounters", `${normalizedClientId}_${counterNo}`);
  const snap = await getDoc(counterRef);
  if (!snap.exists()) return;

  // If counter still holds an active ticket, cancel it before deleting the doc
  // so the ticket is not left orphaned in "serving" state.
  const data = snap.data();
  if (data.currentTicketId) {
    await updateDoc(doc(db, "queueTickets", data.currentTicketId), {
      status: "cancelled",
      cancelledReason: "counter_removed",
      cancelledAt: serverTimestamp(),
      lastCounterNo: data.counterNo || null,
      responseDeadlineAt: null,
      updatedAt: serverTimestamp(),
    }).catch(() => { /* ticket might already be gone */ });
  }
  await deleteDoc(counterRef);
  logActivity(normalizedClientId, "counter.removed", { counterNo, label: data.label }, actor);
}

export function listenAllTickets(clientId, callback) {
  const normalizedClientId = normalizeClientId(clientId);
  const q = query(
    collection(db, "queueTickets"),
    where("clientId", "==", normalizedClientId),
    where("serviceDate", "==", getTodayKey())
  );
  return onSnapshot(q, (snap) =>
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
  );
}

export async function getTicketsInRange(clientId, fromDate, toDate) {
  const normalizedClientId = normalizeClientId(clientId);
  const { db } = await initFirebase(normalizedClientId);
  const q = query(
    collection(db, "queueTickets"),
    where("clientId", "==", normalizedClientId),
    where("serviceDate", ">=", fromDate),
    where("serviceDate", "<=", toDate)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export function computeAnalytics(tickets) {
  const total = tickets.length;
  const byStatus = { waiting: 0, serving: 0, completed: 0, cancelled: 0 };
  const byPriority = { regular: 0, PWD: 0, SC: 0, PG: 0 };
  const byService = {};
  const byHour = Array(24).fill(0);
  let totalWaitMs = 0;
  let waitSamples = 0;
  let totalServiceMs = 0;
  let serviceSamples = 0;

  tickets.forEach((ticket) => {
    byStatus[ticket.status] = (byStatus[ticket.status] || 0) + 1;
    if (ticket.priorityType) byPriority[ticket.priorityType] = (byPriority[ticket.priorityType] || 0) + 1;
    else byPriority.regular += 1;
    const key = `${ticket.prefix || "?"} ${ticket.serviceName || "Unknown"}`;
    byService[key] = (byService[key] || 0) + 1;
    const createdMs = timestampMillis(ticket.createdAt);
    const calledMs = timestampMillis(ticket.calledAt);
    const completedMs = timestampMillis(ticket.completedAt);
    if (createdMs) byHour[new Date(createdMs).getHours()] += 1;
    if (createdMs && calledMs) {
      totalWaitMs += calledMs - createdMs;
      waitSamples += 1;
    }
    if (calledMs && completedMs) {
      totalServiceMs += completedMs - calledMs;
      serviceSamples += 1;
    }
  });

  const peakHour = byHour.reduce(
    (best, count, hour) => (count > best.count ? { hour, count } : best),
    { hour: 0, count: 0 }
  );

  return {
    total,
    byStatus,
    byPriority,
    byService,
    byHour,
    averageWaitMs: waitSamples ? Math.round(totalWaitMs / waitSamples) : 0,
    averageServiceMs: serviceSamples ? Math.round(totalServiceMs / serviceSamples) : 0,
    peakHour: peakHour.count ? peakHour : null,
  };
}

export async function resetTodayQueue(clientId = DEFAULT_CLIENT_ID) {
  const normalizedClientId = normalizeClientId(clientId);
  const { db } = await initFirebase(normalizedClientId);
  const ticketsQuery = query(
    collection(db, "queueTickets"),
    where("clientId", "==", normalizedClientId),
    where("serviceDate", "==", getTodayKey())
  );
  const ticketsSnap = await getDocs(ticketsQuery);
  await Promise.all(
    ticketsSnap.docs.map((d) =>
      updateDoc(d.ref, {
        status: "cancelled",
        updatedAt: serverTimestamp(),
      })
    )
  );

  const countersSnap = await getDocs(query(collection(db, "queueCounters"), where("clientId", "==", normalizedClientId)));
  await Promise.all(
    countersSnap.docs.map((d) =>
      setDoc(
        d.ref,
        {
          currentTicketId: null,
          currentQueueNumber: null,
          currentCustomerName: null,
          currentServiceName: null,
          currentPriorityType: null,
          responseDeadlineAt: null,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      )
    )
  );
}

export async function createClientWithAdmin({ clientName, adminName, email, password }) {
  const { db } = await initFirebaseNoEnsure();
  const clientId = normalizeClientId(clientName);
  const cleanEmail = String(email || "").trim().toLowerCase();
  if (!clientId || !clientName || !cleanEmail || !password) {
    throw new Error("Client name, admin email, and password are required.");
  }

  await setDoc(doc(db, "clients", clientId), {
    id: clientId,
    name: String(clientName).trim(),
    status: "active",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await setDoc(doc(db, "adminUsers", cleanEmail), {
    email: cleanEmail,
    password: String(password),
    name: String(adminName || "Admin").trim(),
    role: "admin",
    clientId,
    clientName: String(clientName).trim(),
    active: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await ensureClientDefaults(clientId);
  return { clientId, email: cleanEmail };
}

export async function getClientInfo(clientId) {
  if (!clientId) return null;
  const normalizedClientId = normalizeClientId(clientId);
  const { db } = await initFirebaseNoEnsure();
  const snap = await getDoc(doc(db, "clients", normalizedClientId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

export async function listAdmins() {
  const { db } = await initFirebaseNoEnsure();
  const snap = await getDocs(collection(db, "adminUsers"));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function addAdminToClient(clientId, { email, password, name, role }) {
  const { db } = await initFirebaseNoEnsure();
  const cleanEmail = String(email || "").trim().toLowerCase();
  if (!cleanEmail || !password) throw new Error("Email and password are required.");
  const ref = doc(db, "adminUsers", cleanEmail);
  const existing = await getDoc(ref);
  if (existing.exists()) throw new Error("An account with that email already exists.");
  const clientSnap = await getDoc(doc(db, "clients", clientId));
  const clientName = clientSnap.exists() ? clientSnap.data().name : clientId;
  const cleanRole = role === "staff" ? "staff" : "admin";
  await setDoc(ref, {
    email: cleanEmail,
    password: String(password),
    name: String(name || (cleanRole === "staff" ? "Counter Staff" : "Admin")).trim(),
    role: cleanRole,
    clientId,
    clientName,
    active: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return { email: cleanEmail, role: cleanRole };
}

export async function setAdminActive(email, active) {
  const { db } = await initFirebaseNoEnsure();
  const cleanEmail = String(email || "").trim().toLowerCase();
  await updateDoc(doc(db, "adminUsers", cleanEmail), {
    active: Boolean(active),
    updatedAt: serverTimestamp(),
  });
}

export async function deleteAdmin(email) {
  const { db } = await initFirebaseNoEnsure();
  const cleanEmail = String(email || "").trim().toLowerCase();
  await deleteDoc(doc(db, "adminUsers", cleanEmail));
}

export async function setClientStatus(clientId, status) {
  const { db } = await initFirebaseNoEnsure();
  await updateDoc(doc(db, "clients", clientId), {
    status: status === "suspended" ? "suspended" : "active",
    updatedAt: serverTimestamp(),
  });
}

export async function getSystemAnalytics() {
  const { db } = await initFirebaseNoEnsure();
  const today = getTodayKey();
  const [clientsSnap, ticketsSnap, adminsSnap] = await Promise.all([
    getDocs(collection(db, "clients")),
    getDocs(query(collection(db, "queueTickets"), where("serviceDate", "==", today))),
    getDocs(collection(db, "adminUsers")),
  ]);
  const clients = clientsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const tickets = ticketsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const admins = adminsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const byClient = {};
  tickets.forEach((t) => {
    const key = t.clientId || "unknown";
    if (!byClient[key]) byClient[key] = { total: 0, completed: 0, cancelled: 0, waiting: 0, serving: 0 };
    byClient[key].total += 1;
    if (t.status === "completed") byClient[key].completed += 1;
    else if (t.status === "cancelled") byClient[key].cancelled += 1;
    else if (t.status === "waiting") byClient[key].waiting += 1;
    else if (t.status === "serving") byClient[key].serving += 1;
  });

  const totalTickets = tickets.length;
  const totalCompleted = tickets.filter((t) => t.status === "completed").length;
  const completionRate = totalTickets ? Math.round((totalCompleted / totalTickets) * 100) : 0;
  const activeClients = clients.filter((c) => (c.status || "active") === "active").length;
  const suspendedClients = clients.filter((c) => c.status === "suspended").length;

  return {
    totalClients: clients.length,
    activeClients,
    suspendedClients,
    totalAdmins: admins.length,
    totalTicketsToday: totalTickets,
    totalCompletedToday: totalCompleted,
    completionRate,
    perClient: clients.map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status || "active",
      ...(byClient[c.id] || { total: 0, completed: 0, cancelled: 0, waiting: 0, serving: 0 }),
    })).sort((a, b) => b.total - a.total),
  };
}

export async function updateAdminCredentials(currentEmail, updates) {
  const { db } = await initFirebaseNoEnsure();
  const cleanCurrent = String(currentEmail || "").trim().toLowerCase();
  if (!cleanCurrent) throw new Error("Current admin email is required.");

  const oldRef = doc(db, "adminUsers", cleanCurrent);
  const oldSnap = await getDoc(oldRef);
  if (!oldSnap.exists()) throw new Error("Admin user not found.");

  const data = oldSnap.data();
  const newEmail = updates?.email ? String(updates.email).trim().toLowerCase() : null;
  const newPassword = updates?.password ? String(updates.password) : null;
  const newName = updates?.name != null ? String(updates.name).trim() : null;

  if (newEmail && newEmail !== cleanCurrent) {
    // Email is the document ID, so we recreate at the new key and delete the old.
    const conflict = await getDoc(doc(db, "adminUsers", newEmail));
    if (conflict.exists()) throw new Error("Another admin already uses that email.");
    await setDoc(doc(db, "adminUsers", newEmail), {
      ...data,
      email: newEmail,
      name: newName || data.name,
      password: newPassword || data.password,
      updatedAt: serverTimestamp(),
    });
    await deleteDoc(oldRef);
    return { email: newEmail };
  }

  const patch = { updatedAt: serverTimestamp() };
  if (newPassword) patch.password = newPassword;
  if (newName) patch.name = newName;
  if (Object.keys(patch).length > 1) await updateDoc(oldRef, patch);
  return { email: cleanCurrent };
}

export async function listClients() {
  const { db } = await initFirebaseNoEnsure();
  const snap = await getDocs(collection(db, "clients"));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.name.localeCompare(b.name));
}

export async function adminLogin(email, password) {
  const { db } = await initFirebaseNoEnsure();
  const cleanEmail = String(email || "").trim().toLowerCase();
  const snap = await getDoc(doc(db, "adminUsers", cleanEmail));
  if (!snap.exists() || snap.data().password !== String(password || "")) {
    throw new Error("Invalid admin email or password.");
  }
  if (snap.data().active === false) {
    throw new Error("This admin account has been deactivated. Contact your system owner.");
  }
  const user = { id: snap.id, ...snap.data() };
  // Check client status — block login if client is suspended
  const clientSnap = await getDoc(doc(db, "clients", user.clientId));
  if (clientSnap.exists() && clientSnap.data().status === "suspended") {
    throw new Error("This client has been suspended. Please contact the system owner.");
  }
  await ensureClientDefaults(user.clientId);
  return user;
}

export async function getSuperAdminConfig() {
  const { db, appConfig } = await initFirebaseNoEnsure();
  const ref = doc(db, "systemConfig", "superadmin");
  const snap = await getDoc(ref);
  if (snap.exists()) {
    const data = snap.data();
    return { email: data.email, password: data.password };
  }
  // Fallback to env-derived values, and seed Firestore on first read so future
  // edits land in the database.
  const fallbackEmail = appConfig.superAdmin?.email || "superadmin@local.test";
  const fallbackPassword = appConfig.superAdmin?.password || "superadmin123";
  await setDoc(ref, {
    email: fallbackEmail,
    password: fallbackPassword,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return { email: fallbackEmail, password: fallbackPassword };
}

export async function updateSuperAdminCredentials(updates) {
  const { db } = await initFirebaseNoEnsure();
  const ref = doc(db, "systemConfig", "superadmin");
  const current = await getSuperAdminConfig();
  const nextEmail = updates?.email != null ? String(updates.email).trim().toLowerCase() : current.email;
  const nextPassword = updates?.password ? String(updates.password) : current.password;
  if (!nextEmail) throw new Error("Email is required.");
  if (!nextPassword) throw new Error("Password is required.");
  await setDoc(ref, {
    email: nextEmail,
    password: nextPassword,
    updatedAt: serverTimestamp(),
  }, { merge: true });
  return { email: nextEmail };
}

export async function superAdminLogin(email, password) {
  const { appConfig } = await initFirebaseNoEnsure();
  const config = await getSuperAdminConfig().catch(() => null);
  const expectedEmail = (config?.email || appConfig.superAdmin?.email || "superadmin@local.test").toLowerCase();
  const expectedPassword = config?.password || appConfig.superAdmin?.password || "superadmin123";
  if (String(email || "").trim().toLowerCase() !== expectedEmail || String(password || "") !== expectedPassword) {
    throw new Error("Invalid superadmin login.");
  }
  return { email: expectedEmail, role: "superadmin" };
}

export async function createPairingCode(clientId, device, actor = null) {
  const normalizedClientId = normalizeClientId(clientId);
  const { db } = await initFirebase(normalizedClientId);
  const code = makeCode();
  const type = ["counter", "display"].includes(device.type) ? device.type : "kiosk";
  const typeLabels = { kiosk: "Kiosk", counter: "Counter", display: "Display" };
  const cleanLabel = String(device.label || `${typeLabels[type]} Device`).trim();
  await setDoc(doc(db, "devicePairings", code), {
    code,
    clientId: normalizedClientId,
    type,
    counterNo: type === "counter" ? Number(device.counterNo || 1) : null,
    label: cleanLabel,
    autoPrint: device.autoPrint !== false,
    silentPrinter: Boolean(device.silentPrinter),
    serviceIds: type === "kiosk" && Array.isArray(device.serviceIds) ? device.serviceIds : [],
    active: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  logActivity(normalizedClientId, "pairing.created", {
    code,
    type,
    label: cleanLabel,
    counterNo: type === "counter" ? Number(device.counterNo || 1) : null,
  }, actor);
  return code;
}

export async function updatePairingServices(code, serviceIds, actor = null) {
  const { db } = await initFirebaseNoEnsure();
  const cleanCode = String(code || "").trim().toUpperCase();
  if (!cleanCode) throw new Error("Pairing code is required.");
  const ref = doc(db, "devicePairings", cleanCode);
  const before = await getDoc(ref);
  const cleanIds = Array.isArray(serviceIds) ? serviceIds : [];
  await updateDoc(ref, {
    serviceIds: cleanIds,
    updatedAt: serverTimestamp(),
  });
  if (before.exists()) {
    const data = before.data();
    logActivity(data.clientId, "pairing.services_updated", {
      code: cleanCode,
      label: data.label,
      type: data.type,
      count: cleanIds.length,
    }, actor);
  }
}

export async function setPairingActive(code, active, actor = null) {
  const { db } = await initFirebaseNoEnsure();
  const cleanCode = String(code || "").trim().toUpperCase();
  if (!cleanCode) throw new Error("Pairing code is required.");
  const ref = doc(db, "devicePairings", cleanCode);
  const before = await getDoc(ref);
  await updateDoc(ref, {
    active: Boolean(active),
    updatedAt: serverTimestamp(),
  });
  if (before.exists()) {
    const data = before.data();
    logActivity(data.clientId, active ? "pairing.reenabled" : "pairing.disabled", {
      code: cleanCode,
      label: data.label,
      type: data.type,
    }, actor);
  }
}

export async function deletePairing(code, actor = null) {
  const { db } = await initFirebaseNoEnsure();
  const cleanCode = String(code || "").trim().toUpperCase();
  if (!cleanCode) throw new Error("Pairing code is required.");
  const ref = doc(db, "devicePairings", cleanCode);
  const before = await getDoc(ref);
  await deleteDoc(ref);
  if (before.exists()) {
    const data = before.data();
    logActivity(data.clientId, "pairing.deleted", {
      code: cleanCode,
      label: data.label,
      type: data.type,
    }, actor);
  }
}

export function listenPairings(clientId, callback) {
  const normalizedClientId = normalizeClientId(clientId);
  const q = query(collection(db, "devicePairings"), where("clientId", "==", normalizedClientId));
  return onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

export async function resolvePairingCode(code) {
  const { db } = await initFirebaseNoEnsure();
  const cleanCode = String(code || "").trim().toUpperCase();
  if (!cleanCode) return null;
  const snap = await getDoc(doc(db, "devicePairings", cleanCode));
  if (!snap.exists() || snap.data().active === false) return null;
  await ensureClientDefaults(snap.data().clientId);
  return { id: snap.id, ...snap.data() };
}
