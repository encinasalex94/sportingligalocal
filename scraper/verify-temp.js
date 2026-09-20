const admin = require('firebase-admin');
const fs = require('fs');

async function main() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  const serviceAccount = JSON.parse(raw);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const db = admin.firestore();

  const ref = db.collection('actas').doc('13703');
  const snap = await ref.get();
  const result = {
    exists: snap.exists,
    season: snap.exists ? snap.data().season : null,
    competition: snap.exists ? snap.data().competition : null,
  };

  const scorersSnap = await db.collection('scorers').doc('current').get();
  result.scorersUpdatedAt = scorersSnap.exists ? scorersSnap.data().updatedAt : null;
  result.ownTeamScorersCount = scorersSnap.exists ? (scorersSnap.data().ownTeamScorers || []).length : 0;

  fs.writeFileSync('scraper/verify-result.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
