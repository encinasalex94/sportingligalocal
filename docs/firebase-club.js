// ---------------------------------------------------------------------
// Sporting de Maderasa — Convocatoria y Valoraciones (Firebase Firestore + Auth)
// ---------------------------------------------------------------------
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, collection, collectionGroup, doc, getDoc, getDocs, setDoc,
  deleteDoc, query,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCm3juynuzyIh1GhZD-5Wr_PDK5zqzKtvU",
  authDomain: "sportingaranjuez.firebaseapp.com",
  projectId: "sportingaranjuez",
  storageBucket: "sportingaranjuez.firebasestorage.app",
  messagingSenderId: "686602599169",
  appId: "1:686602599169:web:6f7140cbb02a32f8ff3900",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

// ---- sesión ---------------------------------------------------
export function signInWithGoogle() {
  return signInWithPopup(auth, provider);
}
export function signOutUser() {
  return signOut(auth);
}
export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}
export function currentUser() {
  return auth.currentUser;
}

function matchIdFor(season, round) {
  return `${season}_J${round}`;
}

// ---- roster (lista pública de nombres) ---------------------------------
let rosterCache = null;
export async function getRoster() {
  if (rosterCache) return rosterCache;
  const snap = await getDocs(collection(db, 'roster'));
  const list = [];
  snap.forEach((d) => list.push({ id: d.id, name: d.data().name }));
  list.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  rosterCache = list;
  return list;
}

// ---- vínculo cuenta Google <-> jugador ---------------------------------
export async function getMyLink() {
  const user = auth.currentUser;
  if (!user) return null;
  const snap = await getDoc(doc(db, 'links', user.uid));
  return snap.exists() ? snap.data() : null; // { playerId }
}

export async function createLink(playerId) {
  const user = auth.currentUser;
  if (!user) throw new Error('Debes iniciar sesión primero');
  await setDoc(doc(db, 'links', user.uid), { playerId, linkedAt: Date.now() });
}

export async function getMyAdminStatus() {
  const link = await getMyLink();
  if (!link) return false;
  try {
    const snap = await getDoc(doc(db, 'players', link.playerId));
    return snap.exists() && !!snap.data().admin;
  } catch (err) {
    return false;
  }
}

// ---- convocatoria ---------------------------------------------------
export async function getSignups(season, round) {
  const matchId = matchIdFor(season, round);
  const snap = await getDocs(collection(db, 'matches', matchId, 'signups'));
  const result = {};
  snap.forEach((d) => { result[d.id] = d.data(); });
  return result;
}

export async function setSignup(season, round, targetPlayerId, signedUp) {
  const myLink = await getMyLink();
  if (!myLink) throw new Error('Debes identificarte primero');
  const admin = await getMyAdminStatus();
  if (myLink.playerId !== targetPlayerId && !admin) throw new Error('No autorizado');

  const matchId = matchIdFor(season, round);
  const ref = doc(db, 'matches', matchId, 'signups', targetPlayerId);
  if (signedUp) {
    await setDoc(ref, { signedUp: true, updatedAt: Date.now(), confirmedBy: myLink.playerId });
  } else {
    await deleteDoc(ref);
  }
}

// ---- votos ---------------------------------------------------
export async function getVotes(season, round) {
  const matchId = matchIdFor(season, round);
  const snap = await getDocs(collection(db, 'matches', matchId, 'votes'));
  const result = [];
  snap.forEach((d) => result.push({ id: d.id, ...d.data() }));
  return result;
}

export async function submitVote(season, round, ratedId, rating) {
  const myLink = await getMyLink();
  if (!myLink) throw new Error('Debes identificarte primero');
  if (rating < 0 || rating > 10) throw new Error('La nota debe estar entre 0 y 10');
  const matchId = matchIdFor(season, round);
  const voteId = `${myLink.playerId}_${ratedId}`;
  await setDoc(doc(db, 'matches', matchId, 'votes', voteId), {
    voterId: myLink.playerId, ratedId, rating: Math.round(rating * 100) / 100, updatedAt: Date.now(),
  });
}

// ---- ranking de un partido concreto (para saber el MVP de la jornada) --
export async function getRankingForMatch(season, round) {
  const votes = await getVotes(season, round);
  const byPlayer = new Map();
  for (const v of votes) {
    if (!v.ratedId || typeof v.rating !== 'number') continue;
    if (!byPlayer.has(v.ratedId)) byPlayer.set(v.ratedId, { total: 0, count: 0 });
    const entry = byPlayer.get(v.ratedId);
    entry.total += v.rating;
    entry.count += 1;
  }

  const roster = await getRoster();
  const nameById = new Map(roster.map((p) => [p.id, p.name]));

  const ranking = Array.from(byPlayer.entries()).map(([playerId, { total, count }]) => ({
    playerId,
    name: nameById.get(playerId) || playerId,
    average: Math.round((total / count) * 100) / 100,
    votes: count,
  }));

  ranking.sort((a, b) => b.average - a.average || b.votes - a.votes);
  return ranking;
}

// ---- ranking de valoraciones (media de todas las votaciones recibidas) --
export async function getRankingValoraciones() {
  const snap = await getDocs(query(collectionGroup(db, 'votes')));
  const byPlayer = new Map();
  snap.forEach((d) => {
    const { ratedId, rating } = d.data();
    if (!ratedId || typeof rating !== 'number') return;
    if (!byPlayer.has(ratedId)) byPlayer.set(ratedId, { total: 0, count: 0 });
    const entry = byPlayer.get(ratedId);
    entry.total += rating;
    entry.count += 1;
  });

  const roster = await getRoster();
  const nameById = new Map(roster.map((p) => [p.id, p.name]));

  const ranking = Array.from(byPlayer.entries()).map(([playerId, { total, count }]) => ({
    playerId,
    name: nameById.get(playerId) || playerId,
    average: Math.round((total / count) * 100) / 100,
    votes: count,
  }));

  ranking.sort((a, b) => b.average - a.average || b.votes - a.votes);
  return ranking;
}

// ---- actas de partido (requieren sesión iniciada, lo comprueban las reglas) --
export async function getActaById(codActa) {
  const snap = await getDoc(doc(db, 'actas', String(codActa)));
  return snap.exists() ? snap.data() : null;
}

// ---- goleadores (requieren sesión iniciada) ---------------------------------
export async function getScorers() {
  const snap = await getDoc(doc(db, 'scorers', 'current'));
  return snap.exists() ? snap.data() : { topScorers: [], ownTeamScorers: [] };
}

export { matchIdFor };
