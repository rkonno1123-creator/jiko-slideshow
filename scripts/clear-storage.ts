// ============================================================
// Storage 上の pdfs/ 配下を全削除するスクリプト
//
// 使い方:
//   npx tsx scripts/clear-storage.ts
//
// やること:
//   - Storage の pdfs/ プレフィックスのオブジェクトを全削除
//   - accidents コレクションの pdfUrl を空文字に戻す
// ============================================================

import * as admin from "firebase-admin";
import * as fs from "fs";
import * as path from "path";

const serviceAccountPath = path.join(
  __dirname,
  "..",
  "firebase-admin-key.json"
);
const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf-8"));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: "jiko-slideshow.firebasestorage.app",
});

const db = admin.firestore();
const bucket = admin.storage().bucket();

async function main() {
  console.log("🗑️  Storage の pdfs/ 配下を削除中...");

  const [files] = await bucket.getFiles({ prefix: "pdfs/" });
  console.log(`📂 ${files.length} 件のファイルが見つかりました`);

  let deleted = 0;
  for (const file of files) {
    await file.delete();
    deleted++;
    console.log(`🗑️  [${deleted}/${files.length}] ${file.name} 削除`);
  }

  console.log(`\n✅ Storage から ${deleted} 件削除完了`);

  // Firestore の pdfUrl も空にしておく
  console.log("\n🧹 accidents の pdfUrl をクリア中...");
  const snapshot = await db.collection("accidents").get();
  let cleared = 0;
  for (const doc of snapshot.docs) {
    await doc.ref.update({
      pdfUrl: "",
      pdfStoragePath: admin.firestore.FieldValue.delete(),
    });
    cleared++;
  }
  console.log(`✅ ${cleared} 件の pdfUrl をクリア完了`);

  process.exit(0);
}

main().catch((err) => {
  console.error("致命的エラー:", err);
  process.exit(1);
});
