/**
 * Actualiza la colección 'roster' de Firestore según la nueva lista oficial
 * de licencias: borra a los jugadores que ya no están, añade a los nuevos,
 * y mantiene explícitamente a Nicolai aunque no esté en la lista oficial.
 *
 * Uso: FIREBASE_SERVICE_ACCOUNT=... node scraper/update-roster.js
 */
const admin = require('firebase-admin');

function log(...args) {
  console.log('[update-roster]', ...args);
}

const TO_REMOVE = [
  'perez-ayllon-alejandro',
  'rodriguez-jimeno-jonatan',
  'torres-herrero-sergio',
  'gallego-plaza-alejandro',
];

const TO_ADD = [
  { id: 'lana-cadenas-alvaro', name: 'LANA CADENAS, ALVARO' },
  { id: 'perez-izquierdo-guillermo', name: 'PEREZ IZQUIERDO, GUILLERMO' },
  { id: 'silos-villanueva-joshua', name: 'SILOS VILLANUEVA, JOSHUA' },
];

async function main() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('Falta FIREBASE_SERVICE_ACCOUNT');
  const serviceAccount = JSON.parse(raw);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const db = admin.firestore();

  for (const id of TO_REMOVE) {
    await db.collection('roster').doc(id).delete();
    // También limpiamos su ficha de jugador (admin flag, etc.) si existía.
    await db.collection('players').doc(id).delete().catch(() => {});
    log(`Borrado de roster: ${id}`);
  }

  for (const p of TO_ADD) {
    await db.collection('roster').doc(p.id).set({ name: p.name });
    log(`Añadido a roster: ${p.id} (${p.name})`);
  }

  log('Terminado. Nicolai (rotari-nicolai) no se ha tocado, se mantiene.');
}

main().catch((err) => {
  console.error('[update-roster] ERROR:', err.message);
  process.exit(1);
});
