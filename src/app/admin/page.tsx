"use client";

// ============================================================
// 管理画面 /admin
// 事故一覧を型分類・カテゴリ・重大度・工事種別で絞り込み、
// チェックした事故を「現場の表示セット」として site_configs に保存する。
//
// 設計メモ:
//   - 権限チェックは今は無し（ログインしていれば全機能が使える＝当面こんのさん専用）。
//     将来は users.role を見て出し分ける（types.ts の UserRole 参照）。
//   - 保存先は site_configs/{現場ID}。individualPdfs に accidentId 配列を入れる。
//   - 動的フィルタ(Package)は今回使わず、手で選んだ静的セットにする
//     （中身を人が完全にコントロールできる方が今のニーズに合う）。
// ============================================================

import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/lib/AuthContext";
import { db } from "@/lib/firebase";
import {
  collection,
  getDocs,
  query,
  where,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";

// ------------------------------------------------------------
// 型
// ------------------------------------------------------------
type Accident = {
  id: string;
  title: string;
  date: string;
  type: string;
  category: string;
  severity: string;
  koujiShubetsu?: string;
  orientation?: string;
};

// 現場マスタ（今は迫のみ。将来 sites コレクションから読む）
const SITES = [{ id: "sako", name: "迫川橋" }];

// 絞り込みの「すべて」を表す空値
const ALL = "";

// 自社資料と判定する category（スライド画面 page.tsx の isSelfMade と同じ定義）。
// 自社が作った資料だけを自社扱いにする。
// ※「通達」は発注者・官公庁発が多いので自社から外す（発注者資料扱い）。
const SELF_MADE_CATEGORIES = ["熱中症対策", "方針", "死亡事故"];
function isSelfMade(a: { category: string }): boolean {
  return SELF_MADE_CATEGORIES.includes(a.category);
}

export default function AdminPage() {
  const { user, loading: authLoading, logout } = useAuth();

  const [accidents, setAccidents] = useState<Accident[]>([]);
  const [loading, setLoading] = useState(true);
  const [siteId, setSiteId] = useState(SITES[0].id);

  // 選択中の事故ID（この現場で表示するセット）
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // 絞り込み・並べ替え
  const [fOrigin, setFOrigin] = useState(ALL); // 資料区分: ""=すべて / "self"=自社 / "client"=発注者
  const [fType, setFType] = useState(ALL);
  const [fCat, setFCat] = useState(ALL);
  const [fSev, setFSev] = useState(ALL);
  const [fKouji, setFKouji] = useState(ALL);
  const [fKw, setFKw] = useState("");
  const [sortKey, setSortKey] = useState<keyof Accident>("date");
  const [sortAsc, setSortAsc] = useState(false);

  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");

  // ----------------------------
  // accidents を全件取得（縦横問わず approved）
  // ----------------------------
  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      try {
        const q = query(
          collection(db, "accidents"),
          where("status", "==", "approved")
        );
        const snap = await getDocs(q);
        const items: Accident[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            title: data.title || "(無題)",
            date: data.date || "",
            type: data.type || "未分類",
            category: data.category || "",
            severity: data.severity || "",
            koujiShubetsu: data.koujiShubetsu || "",
            orientation: data.orientation || "",
          };
        });
        setAccidents(items);
      } catch (e) {
        console.error("事故一覧の取得に失敗", e);
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, []);

  // ----------------------------
  // 選択中の現場の保存済みセットを読む
  // ----------------------------
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const ref = doc(db, "site_configs", siteId);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const data = snap.data();
          const ids: string[] = Array.isArray(data.individualPdfs)
            ? data.individualPdfs
            : [];
          setSelected(new Set(ids));
        } else {
          setSelected(new Set());
        }
      } catch (e) {
        console.error("現場設定の読み込みに失敗", e);
        setSelected(new Set());
      }
    };
    loadConfig();
  }, [siteId]);

  // ----------------------------
  // 絞り込みの選択肢（実データから生成）
  // ----------------------------
  const options = useMemo(() => {
    const uniq = (arr: (string | undefined)[]) =>
      [...new Set(arr.filter((v): v is string => !!v))].sort();
    return {
      types: uniq(accidents.map((a) => a.type)),
      cats: uniq(accidents.map((a) => a.category)),
      sevs: uniq(accidents.map((a) => a.severity)),
      koujis: uniq(accidents.map((a) => a.koujiShubetsu)),
    };
  }, [accidents]);

  // ----------------------------
  // 絞り込み＋並べ替え後の一覧
  // ----------------------------
  const filtered = useMemo(() => {
    const rows = accidents.filter((a) => {
      if (fOrigin === "self" && !isSelfMade(a)) return false;
      if (fOrigin === "client" && isSelfMade(a)) return false;
      if (fType && a.type !== fType) return false;
      if (fCat && a.category !== fCat) return false;
      if (fSev && a.severity !== fSev) return false;
      if (fKouji && a.koujiShubetsu !== fKouji) return false;
      if (fKw && !a.title.includes(fKw)) return false;
      return true;
    });
    rows.sort((a, b) => {
      const x = (a[sortKey] || "") as string;
      const y = (b[sortKey] || "") as string;
      if (x < y) return sortAsc ? -1 : 1;
      if (x > y) return sortAsc ? 1 : -1;
      return 0;
    });
    return rows;
  }, [accidents, fOrigin, fType, fCat, fSev, fKouji, fKw, sortKey, sortAsc]);

  // ----------------------------
  // 操作
  // ----------------------------
  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllShown = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      filtered.forEach((a) => next.add(a.id));
      return next;
    });
  };

  const unselectAllShown = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      filtered.forEach((a) => next.delete(a.id));
      return next;
    });
  };

  const clearFilters = () => {
    setFOrigin(ALL);
    setFType(ALL);
    setFCat(ALL);
    setFSev(ALL);
    setFKouji(ALL);
    setFKw("");
  };

  const setSort = (key: keyof Accident) => {
    if (sortKey === key) setSortAsc((v) => !v);
    else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  // ----------------------------
  // 保存
  // ----------------------------
  const save = async () => {
    setSaving(true);
    setSavedMsg("");
    try {
      const ref = doc(db, "site_configs", siteId);
      await setDoc(
        ref,
        {
          id: siteId,
          individualPdfs: Array.from(selected),
          adoptedPackages: [],
          displayMode: "all",
          updatedAt: serverTimestamp(),
          updatedBy: user?.email || "unknown",
        },
        { merge: true }
      );
      const siteName = SITES.find((s) => s.id === siteId)?.name || siteId;
      setSavedMsg(`${siteName}の表示セットを保存しました（${selected.size}件）`);
    } catch (e) {
      console.error("保存に失敗", e);
      setSavedMsg("保存に失敗しました。時間をおいて再度お試しください。");
    } finally {
      setSaving(false);
    }
  };

  // ----------------------------
  // 認証
  // ----------------------------
  if (authLoading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">読み込み中...</p>
      </main>
    );
  }
  if (!user) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow p-6 max-w-md text-center">
          <h1 className="text-lg font-bold mb-2">管理画面</h1>
          <p className="text-sm text-gray-600 mb-4">
            ログインが必要です。トップページからログインしてください。
          </p>
          <a href="/" className="text-blue-600 underline text-sm">
            トップページへ
          </a>
        </div>
      </main>
    );
  }

  const SortArrow = ({ k }: { k: keyof Accident }) =>
    sortKey === k ? (
      <span className="text-blue-600">{sortAsc ? " ▲" : " ▼"}</span>
    ) : null;

  // ----------------------------
  // 画面
  // ----------------------------
  return (
    <div className="min-h-screen bg-gray-50">
      {/* ヘッダー */}
      <header className="bg-white border-b px-4 py-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="font-bold text-lg">事故情報スライドショー｜管理画面</h1>
          <p className="text-xs text-gray-500">{user.email}</p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/"
            className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1 rounded text-sm"
          >
            スライド表示へ
          </a>
          <button
            onClick={logout}
            className="bg-gray-500 hover:bg-gray-600 text-white px-3 py-1 rounded text-sm"
          >
            ログアウト
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-4 pb-28">
        {/* 現場選択 */}
        <section className="bg-white rounded-lg border p-4 mb-4">
          <label className="block text-xs text-gray-500 mb-1">現場</label>
          <select
            value={siteId}
            onChange={(e) => setSiteId(e.target.value)}
            className="border rounded px-2 py-1.5 text-sm"
          >
            {SITES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-400 mt-1">
            選択中の現場で「どの事故スライドを流すか」を設定します。
          </p>
        </section>

        {/* 絞り込み */}
        <section className="bg-white rounded-lg border p-4 mb-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">
            絞り込み・並べ替え
          </h2>
          <div className="flex flex-wrap gap-3 items-end">
            <Field label="資料区分">
              <select
                value={fOrigin}
                onChange={(e) => setFOrigin(e.target.value)}
                className="border rounded px-2 py-1.5 text-sm min-w-[130px]"
              >
                <option value={ALL}>すべて</option>
                <option value="self">自社資料のみ</option>
                <option value="client">発注者資料のみ</option>
              </select>
            </Field>
            <Field label="型分類">
              <select
                value={fType}
                onChange={(e) => setFType(e.target.value)}
                className="border rounded px-2 py-1.5 text-sm min-w-[140px]"
              >
                <option value={ALL}>すべて</option>
                {options.types.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="カテゴリ">
              <select
                value={fCat}
                onChange={(e) => setFCat(e.target.value)}
                className="border rounded px-2 py-1.5 text-sm min-w-[120px]"
              >
                <option value={ALL}>すべて</option>
                {options.cats.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="重大度">
              <select
                value={fSev}
                onChange={(e) => setFSev(e.target.value)}
                className="border rounded px-2 py-1.5 text-sm min-w-[100px]"
              >
                <option value={ALL}>すべて</option>
                {options.sevs.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            {/* 工事種別はデータに値があるときだけ選択肢が出る（今は空でも箱は置く） */}
            <Field label="工事種別">
              <select
                value={fKouji}
                onChange={(e) => setFKouji(e.target.value)}
                className="border rounded px-2 py-1.5 text-sm min-w-[120px]"
              >
                <option value={ALL}>すべて</option>
                {options.koujis.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="キーワード（タイトル）">
              <input
                type="text"
                value={fKw}
                onChange={(e) => setFKw(e.target.value)}
                placeholder="例：足場 / 塗装"
                className="border rounded px-2 py-1.5 text-sm min-w-[160px]"
              />
            </Field>
            <button
              onClick={clearFilters}
              className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded text-sm"
            >
              条件クリア
            </button>
          </div>
        </section>

        {/* 一覧 */}
        <section className="bg-white rounded-lg border p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-gray-700">
              事故一覧{" "}
              <span className="font-normal text-gray-400">
                （{filtered.length}件表示）
              </span>
            </h2>
            <div className="flex gap-2">
              <button
                onClick={selectAllShown}
                className="text-xs border rounded px-2 py-1 hover:bg-gray-50"
              >
                表示中をすべて選択
              </button>
              <button
                onClick={unselectAllShown}
                className="text-xs border rounded px-2 py-1 hover:bg-gray-50"
              >
                表示中の選択を解除
              </button>
            </div>
          </div>

          {loading ? (
            <p className="text-gray-500 text-sm py-8 text-center">
              読み込み中...
            </p>
          ) : filtered.length === 0 ? (
            <p className="text-gray-400 text-sm py-8 text-center">
              条件に合う事故がありません
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 border-b">
                    <th className="w-9 py-2"></th>
                    <th className="text-left py-2 px-1 whitespace-nowrap">区分</th>
                    <th
                      className="text-left py-2 px-1 cursor-pointer hover:text-blue-600 whitespace-nowrap"
                      onClick={() => setSort("date")}
                    >
                      受信日
                      <SortArrow k="date" />
                    </th>
                    <th
                      className="text-left py-2 px-1 cursor-pointer hover:text-blue-600 whitespace-nowrap"
                      onClick={() => setSort("type")}
                    >
                      型分類
                      <SortArrow k="type" />
                    </th>
                    <th
                      className="text-left py-2 px-1 cursor-pointer hover:text-blue-600 whitespace-nowrap"
                      onClick={() => setSort("category")}
                    >
                      カテゴリ
                      <SortArrow k="category" />
                    </th>
                    <th
                      className="text-left py-2 px-1 cursor-pointer hover:text-blue-600 whitespace-nowrap"
                      onClick={() => setSort("severity")}
                    >
                      重大度
                      <SortArrow k="severity" />
                    </th>
                    <th
                      className="text-left py-2 px-1 cursor-pointer hover:text-blue-600"
                      onClick={() => setSort("title")}
                    >
                      タイトル
                      <SortArrow k="title" />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((a) => {
                    const checked = selected.has(a.id);
                    return (
                      <tr
                        key={a.id}
                        className={`border-b last:border-0 ${
                          checked ? "bg-blue-50" : ""
                        }`}
                      >
                        <td className="py-2 text-center">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggle(a.id)}
                            className="w-4 h-4 cursor-pointer"
                          />
                        </td>
                        <td className="py-2 px-1 whitespace-nowrap">
                          {isSelfMade(a) ? (
                            <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded text-xs">
                              自社
                            </span>
                          ) : (
                            <span className="bg-amber-50 text-amber-700 px-2 py-0.5 rounded text-xs">
                              発注者
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-1 whitespace-nowrap text-gray-600">
                          {a.date}
                        </td>
                        <td className="py-2 px-1 whitespace-nowrap">
                          <span className="bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded text-xs">
                            {a.type}
                          </span>
                        </td>
                        <td className="py-2 px-1 whitespace-nowrap text-gray-600">
                          {a.category}
                        </td>
                        <td className="py-2 px-1 whitespace-nowrap text-gray-600">
                          {a.severity}
                        </td>
                        <td className="py-2 px-1">{a.title}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      {/* 保存バー（下部固定） */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t px-4 py-3 flex items-center justify-between">
        <div className="text-sm text-gray-700">
          この現場で表示する事故：
          <b className="text-blue-600 text-base ml-1">{selected.size}</b> 件
          {savedMsg && (
            <span className="ml-3 text-green-600 text-xs">{savedMsg}</span>
          )}
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white px-5 py-2 rounded text-sm font-semibold"
        >
          {saving ? "保存中..." : "この内容で保存"}
        </button>
      </div>
    </div>
  );
}

// 絞り込みフィールドの共通ラッパ
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      {children}
    </div>
  );
}
