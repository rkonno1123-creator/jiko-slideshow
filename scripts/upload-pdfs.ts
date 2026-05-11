// ============================================================
// PDF → Firebase Storage アップロードスクリプト
//
// 使い方:
//   npx tsx scripts/upload-pdfs.ts
//
// やること:
//   - accidents コレクションの全ドキュメントを取得
//   - 各 id（例: "20260105-01"）に対応する PDF をフォルダから探す
//   - {id}.pdf として Storage にアップロード
//   - 公開 URL を accidents/{id}.pdfUrl に書き戻す
// ============================================================

import * as admin from "firebase-admin";
import * as fs from "fs";
import * as path from "path";

// ------------------------------------------------------------
// 設定: PDF が置いてある元フォルダ
// ------------------------------------------------------------
const PDF_SOURCE_DIR =
  "C:\\Users\\20240819-053\\.ClaudforDesktop\\20260420_事故情報";

// ------------------------------------------------------------
// Firebase Admin SDK 初期化
// ------------------------------------------------------------
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

// ------------------------------------------------------------
// ヘルパー: id から該当 PDF ファイルを探す
//   例: id="20260105-01" → "S20260105-01_*.pdf" にマッチするものを返す
// ------------------------------------------------------------
function findPdfFile(id: string): string | null {
  const files = fs.readdirSync(PDF_SOURCE_DIR);

  // 例: "20260408-" のような末尾ハイフン id の場合は素直に処理
  const cleanId = id.replace(/-$/, "");

  // id を ハイフン区切り と アンダースコア区切り の両パターンで探す
  // 例: "20260316-01" と "20260316_01" の両方を試す
  const idVariants = [cleanId, cleanId.replace(/-/g, "_")];

  for (const idVariant of idVariants) {
    // パターン1: S{id}_ で始まる
    const pattern1 = files.find(
      (f) => f.startsWith(`S${idVariant}_`) && f.endsWith(".pdf")
    );
    if (pattern1) return pattern1;

    // パターン2: 縦_S{id}_ で始まる
    const pattern2 = files.find(
      (f) => f.startsWith(`縦_S${idVariant}_`) && f.endsWith(".pdf")
    );
    if (pattern2) return pattern2;
  }

  return null;
}

// ------------------------------------------------------------
// メイン処理
// ------------------------------------------------------------
async function main() {
  console.log("📂 accidents コレクション取得中...");
  const snapshot = await db.collection("accidents").get();
  console.log(`📂 ${snapshot.size} 件のドキュメントを処理します\n`);

  let success = 0;
  let notFound = 0;
  let failed = 0;
  const notFoundList: string[] = [];

  for (const doc of snapshot.docs) {
    const id = doc.id;

    try {
      // PDF ファイルを探す
      const sourceFileName = findPdfFile(id);

      if (!sourceFileName) {
        console.log(`⚠️  ${id}: PDF が見つからない`);
        notFound++;
        notFoundList.push(id);
        continue;
      }

      const sourcePath = path.join(PDF_SOURCE_DIR, sourceFileName);
      const destFileName = `pdfs/${id}.pdf`;

      // Storage にアップロード（非公開・認証必須）
      await bucket.upload(sourcePath, {
        destination: destFileName,
        metadata: {
          contentType: "application/pdf",
        },
      });

      // アクセスにはクライアント側で Firebase SDK 経由で認証付きで取得させるので、
      // pdfUrl には Storage パスを保存する（公開 URL は生成しない）
      const storagePath = destFileName;

      // Firestore に Storage パスを書き戻し
      await doc.ref.update({
        pdfUrl: "", // 公開 URL は使わないため空
        pdfStoragePath: storagePath, // Storage パス（クライアントで getDownloadURL するため）
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      success++;
      console.log(`✅ [${success}] ${id}: ${sourceFileName} → ${destFileName}`);
    } catch (err) {
      failed++;
      console.error(`❌ ${id}: エラー`, err);
    }
  }

  console.log("\n========================================");
  console.log(`✅ アップロード成功: ${success} 件`);
  console.log(`⚠️  PDF が見つからない: ${notFound} 件`);
  console.log(`❌ エラー: ${failed} 件`);
  if (notFoundList.length > 0) {
    console.log("\n見つからなかった id 一覧:");
    notFoundList.forEach((id) => console.log(`  - ${id}`));
  }
  console.log("========================================");

  process.exit(0);
}

main().catch((err) => {
  console.error("致命的エラー:", err);
  process.exit(1);
});
