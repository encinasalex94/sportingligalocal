// ---------------------------------------------------------------------
// Sporting de Maderasa — Convocatoria y Valoraciones (Firebase Firestore)
// ---------------------------------------------------------------------
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
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

// ---- utilidades -------------------------------------------------------
async function sha256(text) {
  const enc = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
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

// ---- verificación de PIN ------------------------------------------------
// Comparación en el propio cliente (no hay Cloud Functions en el plan
// gratuito de Firebase). No es a prueba de balas, pero es una barrera
// razonable para un vestuario de amigos: nadie puede "listar" todos los
// PIN de golpe, solo consultar el de un jugador concreto una vez que ya
// sabe su nombre.
async function getPlayerRecord(playerId) {
  const snap = await getDoc(doc(db, 'players', playerId));
  if (!snap.exists()) return null;
  return snap.data(); // { pinHash, admin? }
}

export async function verifyPin(playerId, pin) {
  const record = await getPlayerRecord(playerId);
  if (!record) return false;
  const hash = await sha256(pin + '|' + playerId);
  return hash === record.pinHash;
}

export async function verifyVoter(voterId, pin) {
  const record = await getPlayerRecord(voterId);
  if (!record) return { ok: false, isAdmin: false };
  const hash = await sha256(pin + '|' + voterId);
  return { ok: hash === record.pinHash, isAdmin: !!record.admin };
}

// ---- convocatoria ---------------------------------------------------
export async function getSignups(season, round) {
  const matchId = matchIdFor(season, round);
  const snap = await getDocs(collection(db, 'matches', matchId, 'signups'));
  const result = {};
  snap.forEach((d) => { result[d.id] = d.data(); });
  return result;
}

export async function setSignup(season, round, targetPlayerId, voterId, pin, signedUp) {
  const { ok, isAdmin } = await verifyVoter(voterId, pin);
  if (!ok) throw new Error('PIN incorrecto');
  if (voterId !== targetPlayerId && !isAdmin) throw new Error('No autorizado');
  const matchId = matchIdFor(season, round);
  const ref = doc(db, 'matches', matchId, 'signups', targetPlayerId);
  if (signedUp) {
    await setDoc(ref, { signedUp: true, updatedAt: Date.now(), confirmedBy: voterId });
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

export async function submitVote(season, round, voterId, voterPin, ratedId, rating) {
  const ok = await verifyPin(voterId, voterPin);
  if (!ok) throw new Error('PIN incorrecto');
  if (rating < 0 || rating > 10) throw new Error('La nota debe estar entre 0 y 10');
  const matchId = matchIdFor(season, round);
  const voteId = `${voterId}_${ratedId}`;
  await setDoc(doc(db, 'matches', matchId, 'votes', voteId), {
    voterId, ratedId, rating: Math.round(rating * 100) / 100, updatedAt: Date.now(),
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

export { matchIdFor };
