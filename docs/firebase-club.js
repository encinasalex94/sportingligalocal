// ---------------------------------------------------------------------
// Sporting de Maderasa — Convocatoria y Valoraciones (Firebase Firestore + Auth)
// La identidad de cada jugador se decide por su email (lista controlada
// por el club en la colección 'playerEmails'), NO por autoselección — así
// nadie puede iniciar sesión y elegir "ser" otro jugador.
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

const SESSION_LENGTH_MS = 24 * 60 * 60 * 1000; // 24h para votar tras el inicio del partido

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

// ---- identidad por email (sin autoselección) ---------------------------------
// La lista de qué email corresponde a qué jugador la gestiona el club
// directamente en Firestore (colección 'playerEmails'), no la web.
export async function getMyPlayerId() {
  const user = auth.currentUser;
  if (!user || !user.email) return null;
  try {
    const snap = await getDoc(doc(db, 'playersEmails', user.email.toLowerCase()));
    return snap.exists() ? snap.data().playerId : null;
  } catch (err) {
    return null; // email no autorizado: las reglas bloquean la lectura
  }
}

export async function getMyAdminStatus() {
  const playerId = await getMyPlayerId();
  if (!playerId) return false;
  try {
    const snap = await getDoc(doc(db, 'players', playerId));
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
  const myPlayerId = await getMyPlayerId();
  if (!myPlayerId) throw new Error('Tu cuenta no está autorizada todavía');
  const admin = await getMyAdminStatus();
  if (myPlayerId !== targetPlayerId && !admin) throw new Error('No autorizado');

  const matchId = matchIdFor(season, round);
  const ref = doc(db, 'matches', matchId, 'signups', targetPlayerId);
  if (signedUp) {
    await setDoc(ref, { signedUp: true, updatedAt: Date.now(), confirmedBy: myPlayerId });
  } else {
    await deleteDoc(ref);
  }
}

// ---- hora del partido / ventana de votación (24h) ---------------------------------
export async function getMatchMeta(season, round) {
  const matchId = matchIdFor(season, round);
  const snap = await getDoc(doc(db, 'matchMeta', matchId));
  return snap.exists() ? snap.data() : null;
}

export async function isVotingOpen(season, round) {
  const meta = await getMatchMeta(season, round);
  if (!meta || !meta.kickoffAt) return true; // sin dato, no bloqueamos por precaución de UX
  const kickoffMs = meta.kickoffAt.toMillis ? meta.kickoffAt.toMillis() : meta.kickoffAt.seconds * 1000;
  return Date.now() < kickoffMs + SESSION_LENGTH_MS;
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
  const myPlayerId = await getMyPlayerId();
  if (!myPlayerId) throw new Error('Tu cuenta no está autorizada todavía');
  if (rating < 0 || rating > 10) throw new Error('La nota debe estar entre 0 y 10');

  const open = await isVotingOpen(season, round);
  if (!open) throw new Error('La votación de este partido ya está cerrada (pasadas 24h desde el inicio)');

  const matchId = matchIdFor(season, round);
  const voteId = `${myPlayerId}_${ratedId}`;
  await setDoc(doc(db, 'matches', matchId, 'votes', voteId), {
    voterId: myPlayerId, ratedId, rating: Math.round(rating * 100) / 100, updatedAt: Date.now(),
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

// ---- partidos de pretemporada / amistosos (solo admin los crea) ------------
// Viven aparte de la temporada real (que viene de FFMadrid), para poder
// probar la convocatoria en verano sin mezclarlo con datos oficiales.
export async function getUpcomingCustomMatches() {
  const snap = await getDocs(collection(db, 'customMatches'));
  const list = [];
  snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
  list.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  return list;
}

// Mismo dato, sin filtrar por fecha — para mostrar en el Calendario tanto
// los amistosos ya jugados como los que quedan por jugar.
export const getAllCustomMatches = getUpcomingCustomMatches;

export async function addCustomMatch({ opponent, date, time, isHome }) {
  const myPlayerId = await getMyPlayerId();
  const admin = await getMyAdminStatus();
  if (!admin) throw new Error('Solo un delegado puede añadir partidos');

  const [d, mo, y] = date.split('-').map(Number);
  let hh = 0, mm = 0;
  if (time) {
    const parts = time.split(':').map(Number);
    hh = parts[0] || 0;
    mm = parts[1] || 0;
  }
  const kickoffDate = new Date(y, mo - 1, d, hh, mm);
  const timestamp = kickoffDate.getTime();

  const season = 'pretemporada';
  const round = `PT-${timestamp}`;
  const id = matchIdFor(season, round);

  await setDoc(doc(db, 'customMatches', id), {
    season, round, opponent, date, time: time || null, isHome: !!isHome,
    timestamp, createdBy: myPlayerId, createdAt: Date.now(),
    played: false, homeGoals: null, awayGoals: null,
  });

  // Necesario para poder votar en este partido más adelante (la regla de
  // Firestore compara la hora real del partido para cerrar la votación
  // pasadas 24h, igual que con los partidos de Liga).
  await setDoc(doc(db, 'matchMeta', id), { round, date, time: time || null, kickoffAt: kickoffDate });

  return { season, round };
}

export async function setCustomMatchResult(season, round, homeGoals, awayGoals, goals = [], cards = []) {
  const admin = await getMyAdminStatus();
  if (!admin) throw new Error('Solo un delegado puede rellenar el resultado');
  const id = matchIdFor(season, round);
  await setDoc(doc(db, 'customMatches', id), {
    played: true, homeGoals: Number(homeGoals), awayGoals: Number(awayGoals),
    goals, cards,
  }, { merge: true });
}

export async function deleteCustomMatch(season, round) {
  const admin = await getMyAdminStatus();
  if (!admin) throw new Error('Solo un delegado puede borrar partidos');
  const id = matchIdFor(season, round);
  await deleteDoc(doc(db, 'customMatches', id));
}

export { matchIdFor };
