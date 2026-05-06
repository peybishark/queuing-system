import { initializeApp, getApps } from "firebase/app";
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
let appConfig;

export const SERVICES = [
  { id: "business_permit", name: "Business Permit", prefix: "BP", icon: "BP" },
  { id: "working_permit", name: "Working Permit", prefix: "WP", icon: "WP" },
  { id: "pwd_senior_id", name: "PWD / Senior Citizen ID", prefix: "ID", icon: "ID" },
  { id: "civil_registry", name: "Civil Registry Documents", prefix: "CR", icon: "CR" },
  { id: "treasury", name: "Treasury / Payment", prefix: "TR", icon: "TR" },
  { id: "assessor", name: "Assessor", prefix: "AS", icon: "AS" },
];

export async function initFirebase() {
  if (db) return { db, appConfig };
  appConfig = await getConfig();
  if (!appConfig.firebase?.apiKey) {
    throw new Error("Firebase config is missing. Check FIREBASE_* values in .env.");
  }
  app = getApps()[0] || initializeApp(appConfig.firebase);
  db = getFirestore(app);
  await ensureCounters();
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

async function ensureCounters() {
  const { db } = await initFirebaseNoEnsure();
  const snap = await getDocs(collection(db, "queueCounters"));
  if (!snap.empty) return;

  await setDoc(doc(db, "queueCounters", "1"), {
    counterNo: 1,
    label: "Counter 1",
    currentTicketId: null,
    currentQueueNumber: null,
    currentCustomerName: null,
    currentServiceName: null,
    currentPriorityType: null,
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

export async function createTicket({ serviceId, customerName, phone, priorityType }) {
  const { db, appConfig } = await initFirebase();
  const service = getServiceById(serviceId);
  if (!service) throw new Error("Invalid service selected.");

  const serviceDate = getTodayKey();
  const sequenceId = `${serviceDate}_${service.prefix}`;
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
    const ticketRef = doc(db, "queueTickets", `${serviceDate}_${queueNumber}`);
    const cleanName = String(customerName || "").trim();
    const cleanPhone = String(phone || "").trim();
    const cleanPriority = priorityType === "SC" || priorityType === "PWD" ? priorityType : null;

    const ticket = {
      id: ticketRef.id,
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

export function listenServingTickets(callback) {
  const q = query(
    collection(db, "queueTickets"),
    where("serviceDate", "==", getTodayKey()),
    where("status", "==", "serving"),
    orderBy("counterNo", "asc")
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

export async function callNext(counterNo) {
  const { db } = await initFirebase();
  const counterRef = doc(db, "queueCounters", String(counterNo));

  return runTransaction(db, async (tx) => {
    const counterSnap = await tx.get(counterRef);
    const currentTicketId = counterSnap.exists() ? counterSnap.data().currentTicketId : null;
    if (currentTicketId) {
      throw new Error(`Counter ${counterNo} still has an active ticket. Complete it first.`);
    }

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
      calledAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    tx.set(
      counterRef,
      {
        counterNo,
        label: `Counter ${counterNo}`,
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

export async function addCounter(label) {
  const { db } = await initFirebase();
  const snap = await getDocs(collection(db, "queueCounters"));
  const maxNo = snap.docs.reduce((max, d) => {
    const n = Number(d.data().counterNo) || 0;
    return n > max ? n : max;
  }, 0);
  const counterNo = maxNo + 1;
  const cleanLabel = (label && label.trim()) || `Counter ${counterNo}`;

  await setDoc(doc(db, "queueCounters", String(counterNo)), {
    counterNo,
    label: cleanLabel,
    currentTicketId: null,
    currentQueueNumber: null,
    currentCustomerName: null,
    currentServiceName: null,
    currentPriorityType: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return { counterNo, label: cleanLabel };
}

export async function removeCounter(counterNo) {
  const { db } = await initFirebase();
  const counterRef = doc(db, "queueCounters", String(counterNo));
  const snap = await getDoc(counterRef);
  if (!snap.exists()) return;
  if (snap.data().currentTicketId) {
    throw new Error(`Counter ${counterNo} has an active ticket. Complete it first.`);
  }
  await deleteDoc(counterRef);
}

export async function resetTodayQueue() {
  const { db } = await initFirebase();
  const ticketsQuery = query(collection(db, "queueTickets"), where("serviceDate", "==", getTodayKey()));
  const ticketsSnap = await getDocs(ticketsQuery);
  await Promise.all(
    ticketsSnap.docs.map((d) =>
      updateDoc(d.ref, {
        status: "cancelled",
        updatedAt: serverTimestamp(),
      })
    )
  );

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
