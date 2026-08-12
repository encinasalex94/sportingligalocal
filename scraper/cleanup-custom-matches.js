/**
 * Limpieza única de la pretemporada: borra todos los documentos de
 * `customMatches`, junto con su `matchMeta` y las subcolecciones
 * `signups`/`votes` de `matches/{id}` asociadas.
 *
 * Uso: FIREBASE_SERVICE_ACCOUNT=... node scraper/cleanup-custom-matches.js
 */
const admin = require('firebase-admin');

function log(...args) {
  console.log('[cleanup]', ...args);
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
  const serviceAccount = JSON.parse(raw);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const db = admin.firestore();

  const customMatchesSnap = await db.collection('customMatches').get();
  log(`Encontrados ${customMatchesSnap.size} amistosos de pretemporada.`);

  let deletedSignups = 0;
  let deletedVotes = 0;
  let deletedMeta = 0;
  let deletedMatches = 0;

  for (const doc of customMatchesSnap.docs) {
    const id = doc.id;

    deletedSignups += await deleteCollection(db, db.collection('matches').doc(id).collection('signups'));
    deletedVotes += await deleteCollection(db, db.collection('matches').doc(id).collection('votes'));

    const metaRef = db.collection('matchMeta').doc(id);
    const metaDoc = await metaRef.get();
    if (metaDoc.exists) {
      await metaRef.delete();
      deletedMeta++;
    }

    await doc.ref.delete();
    deletedMatches++;
    log(`  -> borrado ${id}`);
  }

  log(`Terminado. Amistosos borrados: ${deletedMatches}, convocatorias: ${deletedSignups}, votos: ${deletedVotes}, hora-partido: ${deletedMeta}.`);
}

main().catch((err) => {
  console.error('[cleanup] ERROR:', err.message);
  process.exit(1);
});
