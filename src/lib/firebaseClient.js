import { initializeApp, getApps, deleteApp } from "firebase/app";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  createUserWithEmailAndPassword,
  updateProfile,
} from "firebase/auth";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  setDoc,
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
let auth;
let appConfig;

export const DEFAULT_SERVICES = [
  { id: "business_permit", name: "Business Permit", prefix: "BP", icon: "BP", active: true },
  { id: "working_permit", name: "Working Permit", prefix: "WP", icon: "WP", active: true },
  { id: "pwd_senior_id", name: "PWD / Senior Citizen ID", prefix: "ID", icon: "ID", active: true },
  { id: "civil_registry", name: "Civil Registry Documents", prefix: "CR", icon: "CR", active: true },
  { id: "treasury", name: "Treasury / Payment", prefix: "TR", icon: "TR", active: true },
  { id: "assessor", name: "Assessor", prefix: "AS", icon: "AS", active: true },
];

export const SERVICES = DEFAULT_SERVICES;

export async function initFirebase() {
  if (db && auth) return { app, db, auth, appConfig };
  appConfig = await getConfig();
  if (!appConfig.firebase?.apiKey) {
    throw new Error("Firebase config is missing. Check FIREBASE_* values in .env.");
  }
  app = getApps()[0] || initializeApp(appConfig.firebase);
  db = getFirestore(app);
  auth = getAuth(app);
  return { app, db, auth, appConfig };
}

export async function signIn(email, password) {
  const { auth } = await initFirebase();
  return signInWithEmailAndPassword(auth, email, password);
}

export async function signOutUser() {
  const { auth } = await initFirebase();
  await signOut(auth);
}

export async function getUserProfile(uid) {
  const { db } = await initFirebase();
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function getCurrentSession() {
  const { auth } = await initFirebase();
  const user = auth.currentUser;
  if (!user) return { user: null, profile: null };
  return { user, profile: await getUserProfile(user.uid) };
}

export async function listenSession(callback) {
  const { auth } = await initFirebase();
  return onAuthStateChanged(auth, async (user) => {
    callback({ user, profile: user ? await getUserProfile(user.uid) : null });
  });
}

export async function createInitialSuperadmin({ name, email, password }) {
  const { auth, db } = await initFirebase();
  const existing = await getDocs(query(collection(db, "users"), where("role", "==", "superadmin"), limit(1)));
  if (!existing.empty) throw new Error("A superadmin already exists. Sign in instead.");

  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(cred.user, { displayName: name });
  await setDoc(doc(db, "users", cred.user.uid), {
    uid: cred.user.uid,
    name,
    email,
    role: "superadmin",
    active: true,
    createdBy: "setup",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return cred.user;
}

export async function createAdminAccount({ name, email, password }) {
  const { db, appConfig } = await initFirebase();
  const { user, profile } = await getCurrentSession();
  requireRole(profile, ["superadmin"]);

  const secondary = initializeApp(appConfig.firebase, `create-admin-${Date.now()}`);
  try {
    const secondaryAuth = getAuth(secondary);
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    await updateProfile(cred.user, { displayName: name });
    await setDoc(doc(db, "users", cred.user.uid), {
      uid: cred.user.uid,
      name,
      email,
      role: "admin",
      active: true,
      createdBy: user.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return cred.user;
  } finally {
    await deleteApp(secondary).catch(() => null);
  }
}

export async function setAdminActive(uid, active) {
  const { db } = await initFirebase();
  const { profile } = await getCurrentSession();
  requireRole(profile, ["superadmin"]);
  await updateDoc(doc(db, "users", uid), {
    active: Boolean(active),
    updatedAt: serverTimestamp(),
  });
}

export function listenAdmins(callback) {
  const q = query(collection(db, "users"), where("role", "==", "admin"), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

function requireRole(profile, roles) {
  if (!profile?.active) throw new Error("Your account is inactive.");
  if (!roles.includes(profile.role)) throw new Error("You do not have permission for this action.");
}

export function getTodayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function listenServices(callback, options = {}) {
  const { activeOnly = false } = options;
  const q = query(collection(db, "services"), orderBy("name", "asc"));
  return onSnapshot(q, (snap) => {
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    callback(activeOnly ? rows.filter((row) => row.active !== false) : rows);
  });
}

export async function seedDefaultServices() {
  const { db } = await initFirebase();
  const { profile } = await getCurrentSession();
  requireRole(profile, ["admin", "superadmin"]);
  await Promise.all(
    DEFAULT_SERVICES.map((service) =>
      setDoc(
        doc(db, "services", service.id),
        {
          ...service,
          active: true,
          updatedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        },
        { merge: true }
      )
    )
  );
}

export async function addService({ name, prefix, icon }) {
  const { db } = await initFirebase();
  const { user, profile } = await getCurrentSession();
  requireRole(profile, ["admin", "superadmin"]);

  const cleanName = String(name || "").trim();
  const cleanPrefix = String(prefix || "").trim().toUpperCase();
  if (!cleanName) throw new Error("Service name is required.");
  if (!/^[A-Z0-9]{1,4}$/.test(cleanPrefix)) throw new Error("Prefix must be 1 to 4 letters or numbers.");

  const id = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || cleanPrefix.toLowerCase();
  await setDoc(
    doc(db, "services", id),
    {
      name: cleanName,
      prefix: cleanPrefix,
      icon: String(icon || cleanPrefix).trim() || cleanPrefix,
      active: true,
      createdBy: user.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  return { id, name: cleanName, prefix: cleanPrefix };
}

export async function updateService(serviceId, updates) {
  const { db } = await initFirebase();
  const { profile } = await getCurrentSession();
  requireRole(profile, ["admin", "superadmin"]);
  await updateDoc(doc(db, "services", serviceId), {
    ...updates,
    updatedAt: serverTimestamp(),
  });
}

export async function removeService(serviceId) {
  const { db } = await initFirebase();
  const { profile } = await getCurrentSession();
  requireRole(profile, ["admin", "superadmin"]);
  await deleteDoc(doc(db, "services", serviceId));
}

async function getServiceById(serviceId) {
  const { db } = await initFirebase();
  const snap = await getDoc(doc(db, "services", serviceId));
  if (snap.exists()) return { id: snap.id, ...snap.data() };
  return DEFAULT_SERVICES.find((service) => service.id === serviceId) || null;
}

export async function createTicket({ serviceId, customerName, phone, priorityType }) {
  const { db, appConfig } = await initFirebase();
  const service = await getServiceById(serviceId);
  if (!service || service.active === false) throw new Error("Invalid service selected.");

  const serviceDate = getTodayKey();
  const sequenceId = `${serviceDate}_${service.prefix}`;
  const sequenceRef = doc(db, "queueSequences", sequenceId);

  return runTransaction(db, async (tx) => {
    const sequenceSnap = await tx.get(sequenceRef);
    const current = sequenceSnap.exists() ? Number(sequenceSnap.data().lastNumber || 0) : 0;
    const next = current + 1;

    tx.set(sequenceRef, { serviceDate, prefix: service.prefix, lastNumber: next, updatedAt: serverTimestamp() }, { merge: true });

    const queueNumber = `${service.prefix}-${String(next).padStart(3, "0")}`;
    const ticketRef = doc(db, "queueTickets", `${serviceDate}_${queueNumber}`);
    const cleanPriority = priorityType === "SC" || priorityType === "PWD" ? priorityType : null;
    const ticket = {
      id: ticketRef.id,
      serviceDate,
      serviceId: service.id,
      serviceName: service.name,
      prefix: service.prefix,
      queueNumber,
      customerName: String(customerName || "").trim() || null,
      phone: String(phone || "").trim() || null,
      priorityType: cleanPriority,
      priorityRank: cleanPriority ? 0 : 1,
      status: "waiting",
      counterNo: null,
      counterId: null,
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
  const q = query(
    collection(db, "queueTickets"),
    where("serviceDate", "==", getTodayKey()),
    where("status", "==", "waiting"),
    orderBy("priorityRank", "asc"),
    orderBy("createdAt", "asc"),
    limit(15)
  );
  return onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

export function listenCompletedTickets(callback) {
  const q = query(
    collection(db, "queueTickets"),
    where("serviceDate", "==", getTodayKey()),
    where("status", "==", "completed"),
    orderBy("completedAt", "desc"),
    limit(8)
  );
  return onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

export function listenCounters(callback) {
  const q = query(collection(db, "queueCounters"), orderBy("counterNo", "asc"));
  return onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

export function listenCounter(counterNo, callback) {
  return onSnapshot(doc(db, "queueCounters", String(counterNo)), (snap) => {
    callback(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  });
}

function makePairingCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function addCounter(label) {
  const { db } = await initFirebase();
  const { user, profile } = await getCurrentSession();
  requireRole(profile, ["admin", "superadmin"]);

  const snap = await getDocs(collection(db, "queueCounters"));
  const maxNo = snap.docs.reduce((max, d) => Math.max(max, Number(d.data().counterNo) || 0), 0);
  const counterNo = maxNo + 1;
  const cleanLabel = (label && label.trim()) || `Counter ${counterNo}`;
  const pairingCode = makePairingCode();

  await setDoc(doc(db, "queueCounters", String(counterNo)), {
    counterNo,
    label: cleanLabel,
    pairingCode,
    paired: false,
    pairedAt: null,
    pairedDeviceId: null,
    active: true,
    currentTicketId: null,
    currentQueueNumber: null,
    currentCustomerName: null,
    currentServiceName: null,
    currentPriorityType: null,
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return { counterNo, label: cleanLabel, pairingCode };
}

export async function pairCounter(pairingCode) {
  const { db } = await initFirebase();
  const cleanCode = String(pairingCode || "").trim();
  if (!/^\d{6}$/.test(cleanCode)) throw new Error("Enter the 6-digit pairing code.");

  const snap = await getDocs(query(collection(db, "queueCounters"), where("pairingCode", "==", cleanCode), limit(1)));
  if (snap.empty) throw new Error("Invalid pairing code.");

  const counterDoc = snap.docs[0];
  const counter = { id: counterDoc.id, ...counterDoc.data() };
  if (counter.active === false) throw new Error("This counter is inactive.");

  const deviceId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  localStorage.setItem("pairedCounterNo", String(counter.counterNo));
  localStorage.setItem("pairedCounterDeviceId", deviceId);

  await updateDoc(counterDoc.ref, {
    paired: true,
    pairedAt: serverTimestamp(),
    pairedDeviceId: deviceId,
    updatedAt: serverTimestamp(),
  });

  return { ...counter, pairedDeviceId: deviceId };
}

export function getPairedCounterNo() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("pairedCounterNo");
}

export function clearPairedCounter() {
  localStorage.removeItem("pairedCounterNo");
  localStorage.removeItem("pairedCounterDeviceId");
}

export async function callNext(counterNo) {
  const { db } = await initFirebase();
  const counterRef = doc(db, "queueCounters", String(counterNo));

  return runTransaction(db, async (tx) => {
    const counterSnap = await tx.get(counterRef);
    const currentTicketId = counterSnap.exists() ? counterSnap.data().currentTicketId : null;
    if (currentTicketId) throw new Error(`Counter ${counterNo} still has an active ticket. Complete it first.`);

    const waitingQuery = query(
      collection(db, "queueTickets"),
      where("serviceDate", "==", getTodayKey()),
      where("status", "==", "waiting"),
      orderBy("priorityRank", "asc"),
      orderBy("createdAt", "asc"),
      limit(1)
    );
    const waitingSnap = await getDocs(waitingQuery);
    if (waitingSnap.empty) return null;

    const ticketDoc = waitingSnap.docs[0];
    const ticket = { id: ticketDoc.id, ...ticketDoc.data() };
    tx.update(ticketDoc.ref, {
      status: "serving",
      counterNo,
      counterId: String(counterNo),
      calledAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    tx.set(
      counterRef,
      {
        counterNo,
        currentTicketId: ticketDoc.id,
        currentQueueNumber: ticket.queueNumber,
        currentCustomerName: ticket.customerName || null,
        currentServiceName: ticket.serviceName,
        currentPriorityType: ticket.priorityType || null,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    return { ...ticket, counterNo };
  });
}

export async function completeCounter(counterNo) {
  const { db } = await initFirebase();
  const counterRef = doc(db, "queueCounters", String(counterNo));

  await runTransaction(db, async (tx) => {
    const counterSnap = await tx.get(counterRef);
    if (!counterSnap.exists()) return;
    const counter = counterSnap.data();
    if (!counter.currentTicketId) return;

    tx.update(doc(db, "queueTickets", counter.currentTicketId), {
      status: "completed",
      completedAt: serverTimestamp(),
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
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  });
}

export async function recallCounter(counterNo) {
  const { db } = await initFirebase();
  await updateDoc(doc(db, "queueCounters", String(counterNo)), {
    updatedAt: serverTimestamp(),
    recallAt: serverTimestamp(),
  });
}

export async function removeCounter(counterNo) {
  const { db } = await initFirebase();
  const { profile } = await getCurrentSession();
  requireRole(profile, ["admin", "superadmin"]);
  const counterRef = doc(db, "queueCounters", String(counterNo));
  const snap = await getDoc(counterRef);
  if (!snap.exists()) return;
  if (snap.data().currentTicketId) throw new Error(`Counter ${counterNo} has an active ticket. Complete it first.`);
  await deleteDoc(counterRef);
}

export async function resetTodayQueue() {
  const { db } = await initFirebase();
  const { profile } = await getCurrentSession();
  requireRole(profile, ["admin", "superadmin"]);

  const ticketsQuery = query(collection(db, "queueTickets"), where("serviceDate", "==", getTodayKey()));
  const ticketsSnap = await getDocs(ticketsQuery);
  await Promise.all(ticketsSnap.docs.map((d) => updateDoc(d.ref, { status: "cancelled", updatedAt: serverTimestamp() })));

  const countersSnap = await getDocs(collection(db, "queueCounters"));
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
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      )
    )
  );
}
