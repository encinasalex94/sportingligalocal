/**
 * Parche de un solo uso: añade los campos 'season' y 'competition' a todas
 * las actas que ya existen en Firestore (escritas antes de que estos campos
 * existieran), usando los data.json públicos para saber a qué temporada
 * pertenece cada codActa.
 *
 * Uso: FIREBASE_SERVICE_ACCOUNT=... node scraper/backfill-acta-season.js
 */
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

function log(...args) {
  console.log('[backfill-season]', ...args);
}

function collectCodActas(dataJsonPath) {
  const data = JSON.parse(fs.readFileSync(dataJsonPath, 'utf-8'));
  const codActas = new Set();
  for (const r of data.rounds || []) {
    for (const m of r.matches || []) {
      if (m.codActa) codActas.add(String(m.codActa));
    }
  }
  return { season: data.season, codActas };
}

async function main() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('Falta FIREBASE_SERVICE_ACCOUNT');
  const serviceAccount = JSON.parse(raw);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const db = admin.firestore();

  const sources = [
    { file: path.join(__dirname, '..', 'docs', 'data', 'data.json'), competition: 'liga' },
    { file: path.join(__dirname, '..', 'docs', 'data', 'season-2025-2026.json'), competition: 'liga' },
    { file: path.join(__dirname, '..', 'docs', 'data', 'copa.json'), competition: 'copa' },
  ];

  let totalPatched = 0;
  for (const src of sources) {
    if (!fs.existsSync(src.file)) {
      log(`No existe ${src.file}, se omite.`);
      continue;
    }
    const { season, codActas } = collectCodActas(src.file);
    log(`${path.basename(src.file)} -> temporada "${season}", ${codActas.size} actas`);

    for (const codActa of codActas) {
      const ref = db.collection('actas').doc(codActa);
      const snap = await ref.get();
      if (!snap.exists) continue;
      await ref.set({ season, competition: src.competition }, { merge: true });
      totalPatched++;
    }
  }

  log(`Terminado. ${totalPatched} actas etiquetadas con su temporada/competición.`);
}

main().catch((err) => {
  console.error('[backfill-season] ERROR:', err.message);
  process.exit(1);
});
