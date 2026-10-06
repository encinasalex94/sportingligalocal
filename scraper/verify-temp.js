const admin = require('firebase-admin');
const fs = require('fs');

async function main() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  const serviceAccount = JSON.parse(raw);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const db = admin.firestore();

  const matchId = '2026-2027_J3';
  const result = {};

  const metaSnap = await db.collection('matchMeta').doc(matchId).get();
  result.matchMeta = metaSnap.exists ? metaSnap.data() : null;

  const votesSnap = await db.collection('matches').doc(matchId).collection('votes').get();
  result.votesCount = votesSnap.size;
  result.votes = votesSnap.docs.map((d) => d.data());

  const attSnap = await db.collection('attendance').doc(matchId).get();
  result.attendance = attSnap.exists ? attSnap.data() : null;

  fs.writeFileSync('scraper/verify-result.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
