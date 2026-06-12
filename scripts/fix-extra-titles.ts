// 既存3件のタイトル手修正  npx tsx scripts/fix-extra-titles.ts
// 塗装以外で、タイトル抽出が壊れていた3件を正しいタイトルに上書きする。
import * as admin from "firebase-admin";
import * as fs from "fs";
import * as path from "path";

const serviceAccount = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "firebase-admin-key.json"), "utf-8")
);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// id → 正しいタイトル（直接指定）
const FIXES: [string, string][] = [
  ["20260521-", "舗装補修工事の事故概要及び再発防止について（続報）"],
  ["20260316-02", "【類似事故】高所作業車を用いた高架下作業における「はさまれ・巻き込まれ」事故"],
  ["20260316-01", "【事務連絡】高所作業車を用いた高架下作業等事故の防止対策の更なる徹底について（注意喚起）"],
];

async function main() {
  let ok = 0, miss = 0;
  for (const [id, title] of FIXES) {
    const ref = db.collection("accidents").doc(id);
    const snap = await ref.get();
    if (!snap.exists) { console.warn(`⚠ 未登録スキップ: ${id}`); miss++; continue; }
    await ref.update({ title, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    console.log(`✅ ${id} → 「${title}」`);
    ok++;
  }
  console.log(`\n完了: 更新 ${ok} 件 / スキップ ${miss} 件`);
  process.exit(0);
}
main().catch((e) => { console.error("失敗:", e); process.exit(1); });
