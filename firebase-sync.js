import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  sendEmailVerification,
  sendPasswordResetEmail,
  reload,
  getIdToken,
  useDeviceLanguage
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  doc,
  getDoc,
  getDocs,
  getDocsFromServer,
  query,
  where,
  setDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyC0MucPcwZaY7_5aMMeujglpSNeAUbHWMo",
  authDomain: "mealplanner-ee3c9.firebaseapp.com",
  projectId: "mealplanner-ee3c9",
  storageBucket: "mealplanner-ee3c9.firebasestorage.app",
  messagingSenderId: "232122983354",
  appId: "1:232122983354:web:2d804a8ca06cd71f33f383"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
let db;
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
  });
} catch (error) {
  console.warn("Firestore persistent cache could not be enabled:", error);
  db = getFirestore(app);
}

const INSTALLATION_KEY = "mealPlannerFirebaseInstallationId";
const installationId = localStorage.getItem(INSTALLATION_KEY) || `install_${crypto?.randomUUID?.() || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`}`;
localStorage.setItem(INSTALLATION_KEY, installationId);

let currentUser = null;
let connectedHouseholdId = null;
let foundHousehold = null;
let currentMeta = null;
let unsubscribeSnapshots = null;
let unsubscribeMeta = null;
let pushTimer = null;
let pushInFlight = false;
let pushAgain = false;

const adapter = () => window.MealPlannerCloudAdapter;
const cleanEmail = value => String(value || "").trim().toLowerCase();
const unique = values => Array.from(new Set(values.map(cleanEmail).filter(Boolean)));

// Firestore does not allow an array to contain another array directly. Meal
// Planner's household payload legitimately contains nested arrays (for example
// split-meal member assignments), so encode every array as a small map before
// writing it to Firestore. Maps may nest freely, and the top-level household
// object remains a normal map so the existing security rule can still inspect
// payload.household.id.
const ARRAY_MARKER = "__mealPlannerArrayV1";

function encodeFirestoreValue(value) {
  if (Array.isArray(value)) {
    const items = {};
    value.forEach((entry, index) => {
      items[String(index)] = encodeFirestoreValue(entry);
    });
    return { [ARRAY_MARKER]: true, length: value.length, items };
  }
  if (value && typeof value === "object") {
    const output = {};
    Object.entries(value).forEach(([key, entry]) => {
      if (entry !== undefined) output[key] = encodeFirestoreValue(entry);
    });
    return output;
  }
  return value;
}

function decodeFirestoreValue(value) {
  if (!value || typeof value !== "object") return value;
  if (!Array.isArray(value) && value[ARRAY_MARKER] === true && value.items && typeof value.items === "object") {
    const length = Number.isFinite(Number(value.length)) ? Number(value.length) : Object.keys(value.items).length;
    return Array.from({ length }, (_, index) => decodeFirestoreValue(value.items[String(index)]));
  }
  if (Array.isArray(value)) return value.map(decodeFirestoreValue);
  const output = {};
  Object.entries(value).forEach(([key, entry]) => {
    output[key] = decodeFirestoreValue(entry);
  });
  return output;
}

function setStatus(next) {
  adapter()?.setStatus?.(next);
}

function friendlyError(error) {
  const code = String(error?.code || "");
  const messages = {
    "auth/invalid-credential": "That email/password combination wasn’t recognised.",
    "auth/invalid-email": "That email address doesn’t look valid.",
    "auth/email-already-in-use": "There is already a Meal Planner account using that email. Try signing in instead.",
    "auth/weak-password": "Choose a password with at least 6 characters.",
    "auth/too-many-requests": "Firebase has temporarily limited sign-in attempts. Try again shortly.",
    "auth/network-request-failed": "Firebase couldn’t be reached. Your local Meal Planner data still works offline.",
    "permission-denied": "Firebase denied that request. Check that the Firestore household security rules have been published."
  };
  return messages[code] || error?.message || "Firebase couldn’t complete that action.";
}

function verified(user = currentUser) {
  return !!user?.emailVerified;
}

function stopWatchers() {
  if (unsubscribeSnapshots) unsubscribeSnapshots();
  if (unsubscribeMeta) unsubscribeMeta();
  unsubscribeSnapshots = null;
  unsubscribeMeta = null;
  connectedHouseholdId = null;
  currentMeta = null;
}

function invitationEmails() {
  return unique([currentUser?.email, ...(adapter()?.getInviteEmails?.() || [])]);
}

async function discoverHouseholds() {
  if (!currentUser || !verified()) return;
  const email = cleanEmail(currentUser.email);
  const households = query(collection(db, "households"), where("allowedEmails", "array-contains", email));
  const snapshot = await getDocs(households);
  const matches = snapshot.docs.map(entry => ({ id: entry.id, ...entry.data() }));
  const preferred = adapter()?.getCloudHouseholdId?.();
  foundHousehold = matches.find(match => match.id === preferred) || matches[0] || null;

  if (foundHousehold) {
    setStatus({
      phase: "inviteFound",
      email,
      householdName: foundHousehold.name || "Shared household",
      foundHouseholdId: foundHousehold.id,
      detail: `A shared household is available for ${email}.`
    });
  } else {
    setStatus({
      phase: "signedIn",
      email,
      householdName: "",
      foundHouseholdId: null,
      detail: "Signed in. Start syncing the household stored in this copy."
    });
  }
}

async function connectHousehold(householdId, initialMeta = null) {
  stopWatchers();
  currentMeta = initialMeta;
  connectedHouseholdId = householdId;
  adapter()?.setHouseholdId?.(householdId);

  const householdRef = doc(db, "households", householdId);
  unsubscribeMeta = onSnapshot(householdRef, { includeMetadataChanges: true }, snapshot => {
    if (!snapshot.exists()) return;
    currentMeta = { id: snapshot.id, ...snapshot.data() };
    const cached = snapshot.metadata.fromCache;
    setStatus({
      phase: cached && !navigator.onLine ? "offline" : "connected",
      email: cleanEmail(currentUser?.email),
      householdName: currentMeta.name || adapter()?.getHouseholdName?.() || "Household",
      foundHouseholdId: householdId,
      detail: cached && !navigator.onLine ? "Offline — changes are saved locally and will sync when connected." : "Household is syncing automatically."
    });
  }, error => {
    console.error("Household listener failed:", error);
    setStatus({ phase: "error", email: cleanEmail(currentUser?.email), detail: friendlyError(error) });
  });

  const snapshotsRef = collection(db, "households", householdId, "snapshots");
  unsubscribeSnapshots = onSnapshot(snapshotsRef, { includeMetadataChanges: true }, snapshot => {
    let changed = false;
    snapshot.docs.forEach(entry => {
      const payload = decodeFirestoreValue(entry.data()?.payload);
      if (!payload?.household?.id) return;
      try {
        if (adapter()?.mergePayload?.(payload)) changed = true;
      } catch (error) {
        console.warn("Ignored invalid cloud household snapshot:", error);
      }
    });
    if (changed) schedulePush(450);
    const pending = snapshot.metadata.hasPendingWrites;
    const cached = snapshot.metadata.fromCache;
    setStatus({
      phase: !navigator.onLine ? "offline" : (pending ? "syncing" : "connected"),
      email: cleanEmail(currentUser?.email),
      householdName: currentMeta?.name || adapter()?.getHouseholdName?.() || "Household",
      foundHouseholdId: householdId,
      detail: !navigator.onLine
        ? "Offline — changes are saved locally and will sync when connected."
        : pending ? "Saving household changes…" : cached ? "Using the local cloud cache while checking for updates…" : "Up to date across connected copies."
    });
  }, error => {
    console.error("Snapshot listener failed:", error);
    setStatus({ phase: "error", email: cleanEmail(currentUser?.email), detail: friendlyError(error) });
  });
}

async function syncMetaFromLocal() {
  if (!connectedHouseholdId || !currentUser || !verified()) return;
  const ownerEmail = cleanEmail(currentMeta?.ownerEmail || currentUser.email);
  const allowedEmails = unique([ownerEmail, ...invitationEmails()]);
  await updateDoc(doc(db, "households", connectedHouseholdId), {
    name: adapter()?.getHouseholdName?.() || currentMeta?.name || "Our household",
    allowedEmails,
    updatedAt: serverTimestamp()
  });
}

async function pushNow() {
  if (!connectedHouseholdId || !currentUser || !verified()) return;
  if (pushInFlight) {
    pushAgain = true;
    return;
  }
  pushInFlight = true;
  clearTimeout(pushTimer);
  pushTimer = null;
  try {
    setStatus({
      phase: navigator.onLine ? "syncing" : "offline",
      email: cleanEmail(currentUser.email),
      detail: navigator.onLine ? "Saving household changes…" : "Offline — your changes are queued on this device."
    });
    try {
      await syncMetaFromLocal();
    } catch (error) {
      // If we're offline, Firestore may queue the snapshot but the metadata update can fail early.
      if (navigator.onLine) throw error;
    }
    const payload = adapter()?.getPayload?.();
    if (!payload?.household?.id) return;
    await setDoc(doc(db, "households", connectedHouseholdId, "snapshots", installationId), {
      uid: currentUser.uid,
      email: cleanEmail(currentUser.email),
      installationId,
      clientUpdatedAt: new Date().toISOString(),
      updatedAt: serverTimestamp(),
      payload: encodeFirestoreValue(payload)
    }, { merge: true });
    setStatus({
      phase: navigator.onLine ? "connected" : "offline",
      email: cleanEmail(currentUser.email),
      householdName: adapter()?.getHouseholdName?.() || "Household",
      detail: navigator.onLine ? "Up to date across connected copies." : "Offline — changes are queued and will sync automatically."
    });
  } catch (error) {
    console.error("Cloud sync failed:", error);
    setStatus({ phase: navigator.onLine ? "error" : "offline", email: cleanEmail(currentUser?.email), detail: friendlyError(error) });
  } finally {
    pushInFlight = false;
    if (pushAgain) {
      pushAgain = false;
      schedulePush(250);
    }
  }
}

function schedulePush(delay = 850) {
  if (!connectedHouseholdId || !currentUser || !verified()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushNow, delay);
}


let resumeRefreshPromise = null;
let lastResumeRefreshAt = 0;

async function pullLatestFromServer() {
  if (!connectedHouseholdId || !currentUser || !verified() || !navigator.onLine) return;
  const householdId = connectedHouseholdId;
  const snapshot = await getDocsFromServer(collection(db, "households", householdId, "snapshots"));
  let changed = false;
  snapshot.docs.forEach(entry => {
    const payload = decodeFirestoreValue(entry.data()?.payload);
    if (!payload?.household?.id || payload.household.id !== householdId) return;
    try {
      if (adapter()?.mergePayload?.(payload)) changed = true;
    } catch (error) {
      console.warn("Ignored invalid cloud household snapshot during foreground refresh:", error);
    }
  });
  if (changed) schedulePush(180);
  setStatus({
    phase: "connected",
    email: cleanEmail(currentUser?.email),
    householdName: currentMeta?.name || adapter()?.getHouseholdName?.() || "Household",
    foundHouseholdId: householdId,
    detail: "Up to date across connected copies."
  });
}

async function refreshAfterResume() {
  if (!connectedHouseholdId || !currentUser || !verified() || !navigator.onLine) return;
  const now = Date.now();
  if (resumeRefreshPromise || now - lastResumeRefreshAt < 900) return resumeRefreshPromise;
  lastResumeRefreshAt = now;
  resumeRefreshPromise = (async () => {
    try {
      // iOS can suspend a background Safari tab/Home Screen PWA before the
      // normal debounce fires. Push this installation first, then explicitly
      // fetch the newest household snapshots from the server instead of waiting
      // for Firestore's realtime listener to wake naturally.
      await pushNow();
      await pullLatestFromServer();
    } catch (error) {
      console.warn("Foreground household refresh failed:", error);
      setStatus({
        phase: navigator.onLine ? "error" : "offline",
        email: cleanEmail(currentUser?.email),
        detail: friendlyError(error)
      });
    } finally {
      resumeRefreshPromise = null;
    }
  })();
  return resumeRefreshPromise;
}

async function startHousehold() {
  if (!currentUser || !verified()) throw new Error("Verify your email before starting cloud sync.");
  const householdId = adapter()?.getHouseholdId?.();
  if (!householdId) throw new Error("Meal Planner could not identify this household.");
  adapter()?.assignSignedInMember?.(currentUser.email);
  const email = cleanEmail(currentUser.email);
  const householdRef = doc(db, "households", householdId);

  // Do not pre-read this document before the first create. The production
  // security rules intentionally deny reads of households the user is not yet
  // a member of, and a brand-new household has no document to prove membership
  // against. The write itself is protected by the create/update rules.
  const allowedEmails = unique([email, ...(adapter()?.getInviteEmails?.() || [])]);
  await setDoc(householdRef, {
    name: adapter()?.getHouseholdName?.() || "Our household",
    ownerUid: currentUser.uid,
    ownerEmail: email,
    allowedEmails,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  currentMeta = { id: householdId, name: adapter()?.getHouseholdName?.(), ownerUid: currentUser.uid, ownerEmail: email, allowedEmails };
  adapter()?.setHouseholdId?.(householdId);
  await connectHousehold(householdId, currentMeta);
  await pushNow();
}

async function joinFoundHousehold() {
  if (!currentUser || !verified() || !foundHousehold?.id) throw new Error("No shared household is waiting for this account.");
  const householdId = foundHousehold.id;
  const householdMeta = { ...foundHousehold };
  const householdName = foundHousehold.name || "Shared household";
  const email = cleanEmail(currentUser.email);

  setStatus({
    phase: "joining",
    email,
    householdName,
    foundHouseholdId: householdId,
    detail: "Downloading the shared household…"
  });

  // Joining must use a confirmed server snapshot. A brand-new Home Screen copy
  // can have an empty persistent Firestore cache even though discovery already
  // found the parent household. Reading explicitly from the server avoids an
  // empty/stale local collection making the join appear to do nothing.
  let snapshot;
  try {
    snapshot = await getDocsFromServer(collection(db, "households", householdId, "snapshots"));
  } catch (error) {
    setStatus({
      phase: "inviteFound",
      email,
      householdName,
      foundHouseholdId: householdId,
      detail: !navigator.onLine
        ? "You’re offline. Reconnect, then join the household again."
        : `Could not download the household: ${friendlyError(error)}`
    });
    throw error;
  }

  const payloads = snapshot.docs
    .map(entry => decodeFirestoreValue(entry.data()?.payload))
    .filter(payload => payload?.household?.id === householdId);
  if (!payloads.length) {
    setStatus({ phase: "inviteFound", email, householdName, foundHouseholdId: householdId, detail: "The household is available but its first cloud snapshot has not arrived yet." });
    throw new Error("The shared household exists but has not uploaded its first data snapshot yet. Open the original copy and tap Sync now.");
  }

  adapter()?.adoptPayloads?.(payloads, householdId, currentUser.email);
  adapter()?.assignSignedInMember?.(currentUser.email);
  foundHousehold = null;

  await connectHousehold(householdId, { ...householdMeta, id: householdId, name: householdName });

  // Give the UI an immediate connected state rather than waiting for the first
  // realtime listener callback. The listener will then refine sync/offline state.
  setStatus({
    phase: "connected",
    email,
    householdName,
    foundHouseholdId: householdId,
    detail: "Shared household downloaded. Finishing sync…"
  });
  await pushNow();
}

async function handleSignedInUser(user) {
  currentUser = user;
  const email = cleanEmail(user.email);
  if (!verified(user)) {
    stopWatchers();
    setStatus({ phase: "verify", email, detail: "Check your email for Firebase’s verification message, then tap “I’ve verified my email”." });
    return;
  }

  adapter()?.assignSignedInMember?.(email);
  const preferred = adapter()?.getCloudHouseholdId?.();
  if (preferred) {
    try {
      const householdSnap = await getDoc(doc(db, "households", preferred));
      if (householdSnap.exists()) {
        currentMeta = { id: householdSnap.id, ...householdSnap.data() };
        await connectHousehold(preferred, currentMeta);
        schedulePush(300);
        return;
      }
    } catch (error) {
      console.warn("Saved household could not be reopened; looking for an invitation instead:", error);
      adapter()?.setHouseholdId?.(null);
    }
  }
  await discoverHouseholds();
}

async function createAccount(email, password) {
  const credential = await createUserWithEmailAndPassword(auth, cleanEmail(email), password);
  await sendEmailVerification(credential.user);
  currentUser = credential.user;
  setStatus({
    phase: "verify",
    email: cleanEmail(credential.user.email),
    detail: "Account created. Check your email for Firebase’s verification message, then return here."
  });
}

async function signIn(email, password) {
  const credential = await signInWithEmailAndPassword(auth, cleanEmail(email), password);
  await handleSignedInUser(credential.user);
}

async function refreshVerification() {
  if (!auth.currentUser) return;
  await reload(auth.currentUser);
  await getIdToken(auth.currentUser, true);
  if (!auth.currentUser.emailVerified) {
    setStatus({ phase: "verify", email: cleanEmail(auth.currentUser.email), detail: "That email is not verified yet. Open Firebase’s verification email, then try again." });
    return;
  }
  await handleSignedInUser(auth.currentUser);
}

async function resetPassword(email) {
  await sendPasswordResetEmail(auth, cleanEmail(email));
}

async function signOut() {
  stopWatchers();
  foundHousehold = null;
  await firebaseSignOut(auth);
  setStatus({ phase: "signedOut", email: "", householdName: "", foundHouseholdId: null, detail: "Local data is still available. Sign in to sync across devices." });
}

window.MealPlannerFirebase = {
  createAccount,
  signIn,
  signOut,
  resetPassword,
  refreshVerification,
  startHousehold,
  joinFoundHousehold,
  syncNow: pushNow,
  friendlyError
};

window.addEventListener("mealplanner:localchange", event => {
  if (event.detail?.immediate) pushNow();
  else schedulePush();
});
window.addEventListener("online", () => {
  if (connectedHouseholdId) refreshAfterResume();
});
window.addEventListener("offline", () => {
  if (connectedHouseholdId) setStatus({ phase: "offline", email: cleanEmail(currentUser?.email), detail: "Offline — changes are saved locally and will sync when connected." });
});

// iOS suspends background Safari tabs and installed PWAs. When this copy comes
// back to the foreground, force an immediate push + server refresh so changes
// made in another copy appear promptly instead of waiting for the listener to
// reconnect on its own.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refreshAfterResume();
});
window.addEventListener("pageshow", () => refreshAfterResume());
window.addEventListener("focus", () => refreshAfterResume());

useDeviceLanguage(auth);
onAuthStateChanged(auth, async user => {
  try {
    if (!user) {
      currentUser = null;
      stopWatchers();
      setStatus({ phase: "signedOut", email: "", householdName: "", foundHouseholdId: null, detail: "Sign in to keep Safari, Home Screen copies and household app users in sync." });
      return;
    }
    await handleSignedInUser(user);
  } catch (error) {
    console.error("Firebase sign-in state setup failed:", error);
    setStatus({ phase: "error", email: cleanEmail(user?.email), detail: friendlyError(error) });
  }
});
