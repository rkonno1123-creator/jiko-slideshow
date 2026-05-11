// ============================================================
// PDF → PNG 変換 & Storage アップロードスクリプト
//
// 使い方:
//   npx tsx scripts/pdf-to-png.ts
//
// やること:
//   - accidents コレクションの各ドキュメントを取得
//   - 横A4 のものだけ対象（縦は今フェーズではスキップ）
//   - 対応する PDF をローカルから読み、全ページを PNG 化
//   - PNG を Storage の images/{id}/{page}.png にアップロード
//   - Firestore の imageStoragePaths に配列で保存
// ============================================================

import * as admin from "firebase-admin";
import * as fs from "fs";
import * as path from "path";
import { pdfToPng } from "pdf-to-png-converter";

const PDF_SOURCE_DIR =
  "C:\\Users\\20240819-053\\.ClaudforDesktop\\20260420_事故情報";

// Firebase Admin SDK 初期化
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
// ------------------------------------------------------------
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

// ------------------------------------------------------------
// メイン
// ------------------------------------------------------------
async function main() {
  console.log("📂 accidents コレクション取得中...");

  // 横A4 のみ対象
  const snapshot = await db
    .collection("accidents")
    .where("orientation", "==", "横")
    .get();

  console.log(`📂 ${snapshot.size} 件の横A4 PDF を処理します\n`);

  let success = 0;
  let notFound = 0;
  let failed = 0;

  for (const doc of snapshot.docs) {
    const id = doc.id;

    try {
      const sourceFileName = findPdfFile(id);

      if (!sourceFileName) {
        console.log(`⚠️  ${id}: PDF が見つからない`);
        notFound++;
        continue;
      }

      const sourcePath = path.join(PDF_SOURCE_DIR, sourceFileName);

      // PDF を全ページ PNG 化（メモリ上で処理）
      const pngPages = await pdfToPng(sourcePath, {
        viewportScale: 2.0, // 解像度: 標準の2倍（タブレット表示で綺麗）
      });

      const imageStoragePaths: string[] = [];

      // 各ページを Storage にアップロード
      for (let i = 0; i < pngPages.length; i++) {
        const pageNo = i + 1;
        const destPath = `images/${id}/${pageNo}.png`;

        const file = bucket.file(destPath);
        await file.save(pngPages[i].content, {
          metadata: {
            contentType: "image/png",
          },
        });

        imageStoragePaths.push(destPath);
      }

      // Firestore に書き戻し
      await doc.ref.update({
        imageStoragePaths,
        imagePageCount: pngPages.length,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      success++;
      console.log(
        `✅ [${success}] ${id}: ${pngPages.length} ページ変換 → アップロード完了`
      );
    } catch (err) {
      failed++;
      console.error(`❌ ${id}: エラー`, err);
    }
  }

  console.log("\n========================================");
  console.log(`✅ 成功: ${success} 件`);
  console.log(`⚠️  PDF 見つからない: ${notFound} 件`);
  console.log(`❌ 失敗: ${failed} 件`);
  console.log("========================================");

  process.exit(0);
}

main().catch((err) => {
  console.error("致命的エラー:", err);
  process.exit(1);
});
