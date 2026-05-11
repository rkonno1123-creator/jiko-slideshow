// ============================================================
// 事故情報スライドショー Cloud Functions
//
// PDF が Storage の pdfs/ にアップロードされたら自動で:
//   1. PDF を全ページ PNG 化
//   2. images/{id}/{pageNo}.png として Storage に保存
//   3. Firestore の対応ドキュメントに imageStoragePaths を更新
//
// PDF→PNG 変換は Ghostscript を child_process で呼ぶ方式。
// Cloud Functions 環境には Ghostscript がプリインストール済み。
// ============================================================

import { setGlobalOptions } from "firebase-functions";
import { onObjectFinalized } from "firebase-functions/v2/storage";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// child_process.exec を Promise 化
const execAsync = promisify(exec);

// グローバル設定
setGlobalOptions({
  maxInstances: 10,
  region: "us-east1", // Storage バケットと同じリージョンに揃える必要がある
});

// Firebase Admin 初期化
admin.initializeApp();

// ============================================================
// Storage トリガー関数
// pdfs/{id}.pdf がアップロードされたら自動実行
// ============================================================
export const convertPdfToPng = onObjectFinalized(
  {
    bucket: "jiko-slideshow.firebasestorage.app",
    timeoutSeconds: 540, // 9分タイムアウト
    memory: "1GiB",
  },
  async (event) => {
    const filePath = event.data.name; // 例: "pdfs/20260105-01.pdf"
    const contentType = event.data.contentType;

    logger.info(`📥 ファイル到着: ${filePath} (${contentType})`);

    // pdfs/ 以外は処理しない
    if (!filePath.startsWith("pdfs/")) {
      logger.info("⏭️  pdfs/ 配下じゃないのでスキップ");
      return;
    }

    // PDF 以外は処理しない
    if (contentType !== "application/pdf") {
      logger.info(`⏭️  PDF じゃないのでスキップ (${contentType})`);
      return;
    }

    // ファイル名から id を抽出 (例: "pdfs/20260105-01.pdf" → "20260105-01")
    const fileName = path.basename(filePath, ".pdf");
    const id = fileName;
    logger.info(`🆔 ID: ${id}`);

    const bucket = admin.storage().bucket();

    // テンポラリディレクトリ準備
    const tmpDir = os.tmpdir();
    const localPdfPath = path.join(tmpDir, `${id}.pdf`);
    const localPngDir = path.join(tmpDir, id);

    try {
      // ----------------------------------------
      // 1. PDF をローカルにダウンロード
      // ----------------------------------------
      logger.info(`📥 PDF ダウンロード中...`);
      await bucket.file(filePath).download({ destination: localPdfPath });

      // ----------------------------------------
      // 2. Ghostscript で全ページ PNG 化
      //    出力: {tmpDir}/{id}/page-1.png, page-2.png, ...
      // ----------------------------------------
      fs.mkdirSync(localPngDir, { recursive: true });

      const outputPattern = path.join(localPngDir, "page-%d.png");
      const gsCommand = [
        "gs",
        "-dNOPAUSE",
        "-dBATCH",
        "-dQUIET",
        "-sDEVICE=png16m",
        "-r150", // 解像度 150dpi（タブレット表示で十分な品質）
        `-sOutputFile="${outputPattern}"`,
        `"${localPdfPath}"`,
      ].join(" ");

      logger.info(`🔧 Ghostscript 実行: ${gsCommand}`);
      await execAsync(gsCommand);

      // ----------------------------------------
      // 3. 生成された PNG を Storage にアップロード
      // ----------------------------------------
      const pngFiles = fs
        .readdirSync(localPngDir)
        .filter((f) => f.endsWith(".png"))
        .sort((a, b) => {
          // page-1.png, page-2.png, ... の数字で並べ替え
          const numA = parseInt(a.match(/\d+/)?.[0] || "0");
          const numB = parseInt(b.match(/\d+/)?.[0] || "0");
          return numA - numB;
        });

      logger.info(`📤 ${pngFiles.length} ページ アップロード中...`);
      const imageStoragePaths: string[] = [];

      for (let i = 0; i < pngFiles.length; i++) {
        const pageNo = i + 1;
        const localFilePath = path.join(localPngDir, pngFiles[i]);
        const destPath = `images/${id}/${pageNo}.png`;

        await bucket.upload(localFilePath, {
          destination: destPath,
          metadata: {
            contentType: "image/png",
          },
        });

        imageStoragePaths.push(destPath);
      }

      // ----------------------------------------
      // 4. Firestore に書き戻し
      // ----------------------------------------
      const db = admin.firestore();
      const docRef = db.collection("accidents").doc(id);

      // ドキュメントが存在するか確認
      const docSnap = await docRef.get();
      if (!docSnap.exists) {
        logger.warn(
          `⚠️  accidents/${id} が存在しないので作成: ` +
            `この PDF は手動アップロードかも`
        );
        // ドキュメントがない場合は作成しない（メタ情報が必要なので別途登録すべき）
      } else {
        await docRef.update({
          imageStoragePaths,
          imagePageCount: pngFiles.length,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        logger.info(
          `✅ accidents/${id} 更新完了: ${pngFiles.length} ページ`
        );
      }

      // ----------------------------------------
      // 5. クリーンアップ
      // ----------------------------------------
      fs.unlinkSync(localPdfPath);
      fs.rmSync(localPngDir, { recursive: true });

      logger.info(`✨ ${id} 処理完了`);
    } catch (err) {
      logger.error(`❌ ${id} エラー:`, err);
      // クリーンアップ（失敗時も）
      try {
        if (fs.existsSync(localPdfPath)) fs.unlinkSync(localPdfPath);
        if (fs.existsSync(localPngDir))
          fs.rmSync(localPngDir, { recursive: true });
      } catch (cleanupErr) {
        logger.error("クリーンアップ失敗:", cleanupErr);
      }
      throw err;
    }
  }
);
