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

// El nombre real del club en Liga (en Copa aparece "SPORTING ARANJUEZ", que
// es OTRO club distinto, no lo incluimos aquí para no confundirlos).
const OWN_TEAM_NAME = 'SPORTING DE MADERASA - BAR JUANJO';
function isOwn(name) {
  return (name || '').toUpperCase().includes(OWN_TEAM_NAME);
}

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

// ---- asistencia (quién fue de verdad al partido, solo delegados la marcan) --
export async function getAttendance(season, round) {
  const matchId = matchIdFor(season, round);
  const snap = await getDoc(doc(db, 'attendance', matchId));
  return snap.exists() ? (snap.data().playerIds || []) : null; // null = todavía no se ha marcado
}

export async function setAttendance(season, round, playerIds) {
  const admin = await getMyAdminStatus();
  if (!admin) throw new Error('Solo un delegado puede marcar la asistencia');
  const matchId = matchIdFor(season, round);
  await setDoc(doc(db, 'attendance', matchId), { playerIds, updatedAt: Date.now() });
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

// ---- estadísticas de la plantilla (asistencia + goles + asistencias de
// gol + valoración media), calculadas a partir de lo que ya se recoge en
// el resto de la web — nada de mantener un Excel aparte. ---------------------
export async function getPlayerSeasonStats(season, jornadasDisputadas) {
  const roster = await getRoster();
  const stats = new Map(roster.map((p) => [p.id, {
    id: p.id, name: p.name, partidosJugados: 0, goles: 0, asistencias: 0,
    sumaValoracion: 0, numVotosRecibidos: 0,
  }]));

  // Asistencia (quién fue de verdad), de todos los partidos de esta temporada.
  const attendanceSnap = await getDocs(collection(db, 'attendance'));
  attendanceSnap.forEach((docSnap) => {
    if (!docSnap.id.startsWith(`${season}_J`)) return;
    (docSnap.data().playerIds || []).forEach((pid) => {
      if (stats.has(pid)) stats.get(pid).partidosJugados += 1;
    });
  });

  // Goles y asistencias de gol, desde las actas de Liga de esta temporada.
  const actasSnap = await getDocs(collection(db, 'actas'));
  const byName = new Map(roster.map((p) => [p.name, p.id]));
  actasSnap.forEach((docSnap) => {
    const acta = docSnap.data();
    if (acta.season !== season || acta.competition !== 'liga') return;
    (acta.goals || []).forEach((g) => {
      if (g.ownGoal) return;
      const scorerId = byName.get(g.scorer);
      if (scorerId) stats.get(scorerId).goles += 1;
      if (g.assist) {
        const assistId = byName.get(g.assist);
        if (assistId) stats.get(assistId).asistencias += 1;
      }
    });
  });

  // Valoraciones recibidas, de todos los partidos de esta temporada.
  const votesSnap = await getDocs(query(collectionGroup(db, 'votes')));
  votesSnap.forEach((docSnap) => {
    const matchId = docSnap.ref.parent.parent.id;
    if (!matchId.startsWith(`${season}_J`)) return;
    const { ratedId, rating } = docSnap.data();
    if (stats.has(ratedId) && typeof rating === 'number') {
      const s = stats.get(ratedId);
      s.sumaValoracion += rating;
      s.numVotosRecibidos += 1;
    }
  });

  return Array.from(stats.values()).map((s) => ({
    ...s,
    jornadasDisputadas,
    porcentajePartidos: jornadasDisputadas ? Math.round((s.partidosJugados / jornadasDisputadas) * 1000) / 10 : 0,
    golesPorPartido: s.partidosJugados ? Math.round((s.goles / s.partidosJugados) * 100) / 100 : 0,
    asistenciasPorPartido: s.partidosJugados ? Math.round((s.asistencias / s.partidosJugados) * 100) / 100 : 0,
    valoracionMedia: s.numVotosRecibidos ? Math.round((s.sumaValoracion / s.numVotosRecibidos) * 100) / 100 : null,
  })).sort((a, b) => b.goles - a.goles || b.partidosJugados - a.partidosJugados);
}

// ---- actas de partido (requieren sesión iniciada, lo comprueban las reglas) --
export async function getActaById(codActa) {
  const snap = await getDoc(doc(db, 'actas', String(codActa)));
  return snap.exists() ? snap.data() : null;
}

export async function updateActa(codActa, { goals, homeCards, awayCards }) {
  const admin = await getMyAdminStatus();
  if (!admin) throw new Error('Solo un delegado puede editar el acta');
  const ref = doc(db, 'actas', String(codActa));
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Ficha no encontrada');
  const current = snap.data();
  await setDoc(ref, {
    goals,
    home: { ...(current.home || {}), cards: homeCards },
    away: { ...(current.away || {}), cards: awayCards },
  }, { merge: true });

  // Los goleadores (Sporting y del grupo) se guardan aparte para que se
  // puedan ver sin tener que recorrer todas las actas en cada visita — al
  // editar un acta a mano, los recalculamos aquí mismo para que no se
  // queden desactualizados hasta la próxima vez que corra el scraper.
  await recomputeScorersFromActas();
}

function isPlayerInTeamSide(teamSide, playerName) {
  if (!teamSide) return false;
  const all = [...(teamSide.titulares || []), ...(teamSide.suplentes || [])];
  return all.some((p) => p.name === playerName);
}

const CURRENT_LEAGUE_SEASON = '2026-2027';

async function recomputeScorersFromActas() {
  const snap = await getDocs(collection(db, 'actas'));
  const tally = new Map(); // nombre del jugador -> { player, team, goals, penalties, isOwnTeam }

  snap.forEach((docSnap) => {
    const acta = docSnap.data();
    // Los "Goleadores" son de la Liga de la temporada en curso — ni de
    // temporadas anteriores ni de la Copa (competición aparte).
    if (acta.season !== CURRENT_LEAGUE_SEASON || acta.competition !== 'liga') return;

    (acta.goals || []).forEach((g) => {
      if (g.ownGoal || !g.scorer) return;
      const scoredForHome = isPlayerInTeamSide(acta.home, g.scorer);
      const teamName = scoredForHome ? acta.homeTeam : acta.awayTeam;
      if (!tally.has(g.scorer)) {
        tally.set(g.scorer, { player: g.scorer, team: teamName, goals: 0, penalties: 0, isOwnTeam: isOwn(teamName) });
      }
      const entry = tally.get(g.scorer);
      entry.goals += 1;
      if (g.penalty) entry.penalties += 1;
    });
  });

  const all = Array.from(tally.values()).sort((a, b) => b.goals - a.goals);
  const topScorers = all.slice(0, 20);
  const ownTeamScorers = all.filter((s) => s.isOwnTeam).sort((a, b) => b.goals - a.goals);

  await setDoc(doc(db, 'scorers', 'current'), { topScorers, ownTeamScorers, updatedAt: Date.now() });
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

export async function addCustomMatch({ opponent, date, time, venue, isHome }) {
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
    season, round, opponent, date, time: time || null, venue: venue || null, isHome: !!isHome,
    timestamp, createdBy: myPlayerId, createdAt: Date.now(),
    played: false, homeGoals: null, awayGoals: null,
  });

  // Necesario para poder votar en este partido más adelante (la regla de
  // Firestore compara la hora real del partido para cerrar la votación
  // pasadas 24h, igual que con los partidos de Liga).
  await setDoc(doc(db, 'matchMeta', id), { round, date, time: time || null, kickoffAt: kickoffDate });

  return { season, round };
}

export async function updateCustomMatch(season, round, { opponent, date, time, venue, isHome }) {
  const admin = await getMyAdminStatus();
  if (!admin) throw new Error('Solo un delegado puede editar partidos');

  const id = matchIdFor(season, round);
  const [d, mo, y] = date.split('-').map(Number);
  let hh = 0, mm = 0;
  if (time) {
    const parts = time.split(':').map(Number);
    hh = parts[0] || 0;
    mm = parts[1] || 0;
  }
  const kickoffDate = new Date(y, mo - 1, d, hh, mm);

  await setDoc(doc(db, 'customMatches', id), {
    opponent, date, time: time || null, venue: venue || null, isHome: !!isHome,
    timestamp: kickoffDate.getTime(),
  }, { merge: true });

  // La hora del partido puede haber cambiado — actualizamos también
  // matchMeta, de donde sale el límite de 24h para votar.
  await setDoc(doc(db, 'matchMeta', id), { round, date, time: time || null, kickoffAt: kickoffDate }, { merge: true });
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
