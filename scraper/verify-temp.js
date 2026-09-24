const admin = require('firebase-admin');
const fs = require('fs');

async function main() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  const serviceAccount = JSON.parse(raw);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const db = admin.firestore();

  const codActas = ['13701', '13702', '13703', '13704', '13705', '13706'];
  const result = {};
  for (const id of codActas) {
    const snap = await db.collection('actas').doc(id).get();
    result[id] = {
      exists: snap.exists,
      season: snap.exists ? snap.data().season : null,
      competition: snap.exists ? snap.data().competition : null,
      hasGoals: snap.exists ? !!(snap.data().goals) : null,
    };
  }
  fs.writeFileSync('scraper/verify-result.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
