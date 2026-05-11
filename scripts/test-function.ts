// ============================================================
// Cloud Functions 動作テストスクリプト
//
// 使い方:
//   npx tsx scripts/test-function.ts
//
// やること:
//   - accidents から1件取得
//   - Storage 上の PDF を一旦削除
//   - 同じPDFを再アップロード（これでFunctionsが発火するはず）
//   - 数秒待って Firestore の imageStoragePaths が更新されたか確認
// ============================================================

import * as admin from "firebase-admin";
import * as fs from "fs";
import * as path from "path";

const PDF_SOURCE_DIR =
  "C:\\Users\\20240819-053\\.ClaudforDesktop\\20260420_事故情報";

// テスト対象 ID（横A4で1件選ぶ）
const TEST_ID = "20260105-01";

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

function findPdfFile(id: string): string | null {
  const files = fs.readdirSync(PDF_SOURCE_DIR);
  const cleanId = id.replace(/-$/, "");
  const idVariants = [cleanId, cleanId.replace(/-/g, "_")];

  for (const idVariant of idVariants) {
    const pattern1 = files.find(
      (f) => f.startsWith(`S${idVariant}_`) && f.endsWith(".pdf")
    );
    if (pattern1) return pattern1;

    const pattern2 = files.find(
      (f) => f.startsWith(`縦_S${idVariant}_`) && f.endsWith(".pdf")
    );
    if (pattern2) return pattern2;
  }

  return null;
}

async function main() {
  console.log(`🧪 テスト対象: ${TEST_ID}\n`);

  // 1. 現在の状態確認
  const docBefore = await db.collection("accidents").doc(TEST_ID).get();
  const dataBefore = docBefore.data();
  console.log("📊 変換前の状態:");
  console.log(`   imageStoragePaths: ${JSON.stringify(dataBefore?.imageStoragePaths || "なし")}`);
  console.log(`   imagePageCount: ${dataBefore?.imagePageCount || "なし"}\n`);

  // 2. Storage 上の PDF を削除
  const pdfPath = `pdfs/${TEST_ID}.pdf`;
  console.log(`🗑️  Storage の ${pdfPath} を削除中...`);
  try {
    await bucket.file(pdfPath).delete();
    console.log("✅ 削除完了\n");
  } catch (err) {
    console.log("⚠️  削除失敗（既に存在しない？）:", (err as Error).message);
  }

  // 3. 元 PDF を探して再アップロード
  const sourceFileName = findPdfFile(TEST_ID);
  if (!sourceFileName) {
    console.error(`❌ ${TEST_ID} の元 PDF が見つかりません`);
    process.exit(1);
  }

  const sourcePath = path.join(PDF_SOURCE_DIR, sourceFileName);
  console.log(`📤 ${sourceFileName} を ${pdfPath} に再アップロード中...`);
  await bucket.upload(sourcePath, {
    destination: pdfPath,
    metadata: { contentType: "application/pdf" },
  });
  console.log("✅ アップロード完了\n");

  console.log("⏳ Cloud Functions の処理を待っています（最大2分）...");
  console.log("   別の PowerShell で以下を実行するとログがリアルタイムで見えます:");
  console.log(`   firebase functions:log --only convertPdfToPng\n`);

  // 4. 30秒ごとに Firestore をチェック（最大2分）
  for (let i = 0; i < 4; i++) {
    await new Promise((resolve) => setTimeout(resolve, 30000));

    const docAfter = await db.collection("accidents").doc(TEST_ID).get();
    const dataAfter = docAfter.data();

    console.log(`[${(i + 1) * 30}秒経過]`);
    console.log(`   imageStoragePaths: ${JSON.stringify(dataAfter?.imageStoragePaths || "まだなし")}`);

    if (dataAfter?.imageStoragePaths && dataAfter.imageStoragePaths.length > 0) {
      console.log("\n🎉 Cloud Functions による PNG 変換成功!");
      console.log(`   生成された PNG: ${dataAfter.imageStoragePaths.length} ページ`);
      console.log(`   imageStoragePaths: ${JSON.stringify(dataAfter.imageStoragePaths)}`);
      process.exit(0);
    }
  }

  console.log("\n⚠️  2分経過してもFirestoreが更新されませんでした");
  console.log("   firebase functions:log でログを確認してください");
  process.exit(1);
}

main().catch((err) => {
  console.error("致命的エラー:", err);
  process.exit(1);
});
