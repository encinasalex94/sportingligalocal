/**
 * Borra un único amistoso de pretemporada (identificado por el nombre del
 * rival), junto con su matchMeta y las subcolecciones signups/votes.
 *
 * Uso: FIREBASE_SERVICE_ACCOUNT=... OPPONENT_MATCH="Betis" node scraper/cleanup-one-match.js
 */
const admin = require('firebase-admin');

function log(...args) {
  console.log('[cleanup-one]', ...args);
}

async function deleteCollection(db, collectionRef) {
  const snap = await collectionRef.get();
  if (snap.empty) return 0;
  const batch = db.batch();
  snap.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
  return snap.size;
}

async function main() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('Falta FIREBASE_SERVICE_ACCOUNT');
  const needle = (process.env.OPPONENT_MATCH || '').toLowerCase();
  if (!needle) throw new Error('Falta OPPONENT_MATCH');

  const serviceAccount = JSON.parse(raw);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const db = admin.firestore();

  const snap = await db.collection('customMatches').get();
  const matches = snap.docs.filter((d) => (d.data().opponent || '').toLowerCase().includes(needle));

  log(`Encontrados ${matches.length} amistoso(s) con rival que contiene "${needle}".`);

  for (const doc of matches) {
    const id = doc.id;
    log(`Borrando ${id} (vs ${doc.data().opponent})...`);
    await deleteCollection(db, db.collection('matches').doc(id).collection('signups'));
    await deleteCollection(db, db.collection('matches').doc(id).collection('votes'));
    await db.collection('matchMeta').doc(id).delete().catch(() => {});
    await doc.ref.delete();
    log(`  -> borrado ${id}`);
  }

  log('Terminado.');
}

main().catch((err) => {
  console.error('[cleanup-one] ERROR:', err.message);
  process.exit(1);
});
