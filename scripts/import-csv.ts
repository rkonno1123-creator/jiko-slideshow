// ============================================================
// CSV → Firestore インポートスクリプト
//
// 使い方:
//   npx tsx scripts/import-csv.ts
//
// やること:
//   - PDF分類リスト_2026.csv を読む
//   - 各行を accidents コレクションに登録する
//   - pdfUrl は空文字で登録（PDF アップロードは別スクリプト）
// ============================================================

import * as admin from "firebase-admin";
import { parse } from "csv-parse/sync";
import * as fs from "fs";
import * as path from "path";

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
});

const db = admin.firestore();

// ------------------------------------------------------------
// CSV 読み込み
// ------------------------------------------------------------
const csvPath = path.join(__dirname, "PDF分類リスト_2026.csv");
const csvContent = fs.readFileSync(csvPath, "utf-8");

// BOM 除去（Excel 保存の CSV には先頭に \uFEFF がつくため）
const cleaned = csvContent.replace(/^\uFEFF/, "");

const rows: Record<string, string>[] = parse(cleaned, {
  columns: true,
  skip_empty_lines: true,
});

console.log(`📄 CSV 読み込み完了: ${rows.length} 件`);

// ------------------------------------------------------------
// メイン処理
// ------------------------------------------------------------
async function main() {
  let success = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      // ファイル名から PDF 識別子を作る（例: S20260105-01_xxx.pdf → 20260105-01.pdf）
      const shortFileName = `${row.id}.pdf`;

      const accident = {
        // 基本情報
        title: extractTitle(row.filename),
        date: row.date,
        pdfUrl: "", // 後でアップロードスクリプトで埋める
        pdfFileName: shortFileName,
        originalFileName: row.filename, // 元のファイル名も残す（参考用）

        // 分類
        type: row.type_actual || row.type_guess || "未分類",
        category: row.category || "未分類",
        severity: row.severity || "不明",
        industry: row.industry || "",
        koujiShubetsu: row.kouji_shubetsu || "",

        // 配信制御
        // 既存データはすべて approved 扱いにする（一括投入のため）
        status: "approved" as const,
        importance: "normal" as const,
        assignedSite: "all" as const, // 全現場対象

        // メタデータ
        createdBy: "system_import", // 一括投入のため特殊値
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        approvedBy: "system_import",
        approvedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),

        // 補足情報（参考メタ）
        nexcoNo: row.nexco_no || "",
        orientation: row.orientation || "",
        pages: parseInt(row.pages) || 1,
      };

      // ドキュメント ID を CSV の id と揃える（例: "20260105-01"）
      await db.collection("accidents").doc(row.id).set(accident);
      success++;
      console.log(`✅ [${success}/${rows.length}] ${row.id}: ${accident.title}`);
    } catch (err) {
      failed++;
      console.error(`❌ ${row.id}: エラー`, err);
    }
  }

  console.log("\n========================================");
  console.log(`✅ 成功: ${success} 件`);
  console.log(`❌ 失敗: ${failed} 件`);
  console.log("========================================");

  process.exit(0);
}

// ------------------------------------------------------------
// ヘルパー: ファイル名からタイトルを抽出
// 例: "S20260105-01_追越車線規制設置の際に作業員が2ｔトラック荷台から転落_腰打撲_軽傷_.pdf"
//   → "追越車線規制設置の際に作業員が2ｔトラック荷台から転落"
// ------------------------------------------------------------
function extractTitle(filename: string): string {
  // 拡張子を除去
  const noExt = filename.replace(/\.pdf$/i, "");
  // 先頭の "S20260105-01_" を除去
  const noPrefix = noExt.replace(/^S?\d{8}-?\d*_/, "");
  // 末尾の _軽傷_ 等を除去（最初の _ より前を取る）
  const title = noPrefix.split("_")[0];
  return title || filename;
}

// 実行
main().catch((err) => {
  console.error("致命的エラー:", err);
  process.exit(1);
});
