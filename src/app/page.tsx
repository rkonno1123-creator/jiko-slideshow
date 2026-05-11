"use client";

import { useState, useEffect } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth, db, storage } from "@/lib/firebase";
import { useAuth } from "@/lib/AuthContext";
import { collection, getDocs, query, where, orderBy } from "firebase/firestore";
import { ref, getDownloadURL } from "firebase/storage";

// ------------------------------------------------------------
// 型定義（types.ts と一致させる）
// ------------------------------------------------------------
type Accident = {
  id: string;
  title: string;
  date: string;
  type: string;
  category: string;
  severity: string;
  orientation?: string;
  pdfStoragePath?: string;
  pdfDownloadUrl?: string; // クライアントで getDownloadURL した結果を入れる
};

// 表示モード
type DisplayMode = "all" | "recent3" | "by_category";

// ============================================================
// メインページ
// ============================================================
export default function HomePage() {
  const { user, loading, logout } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  // ----------------------------
  // ログイン処理
  // ----------------------------
  const handleLogin = async () => {
    setError("");
    setLoginLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (e) {
      setError(
        "ログインに失敗しました: " +
          ((e as { code?: string; message: string }).code ||
            (e as Error).message)
      );
    } finally {
      setLoginLoading(false);
    }
  };

  // ----------------------------
  // 読み込み中
  // ----------------------------
  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">読み込み中...</p>
      </main>
    );
  }

  // ----------------------------
  // 未ログイン → ログイン画面
  // ----------------------------
  if (!user) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4 bg-gray-50">
        <div className="w-full max-w-md bg-white rounded-lg shadow p-6">
          <h1 className="text-2xl font-bold mb-2">事故情報スライドショー</h1>
          <p className="text-sm text-gray-500 mb-6">
            リバーランズエンジニアリング
          </p>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">
                メールアドレス
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full border rounded px-3 py-2"
                placeholder="example@company.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                パスワード
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full border rounded px-3 py-2"
                placeholder="••••••"
              />
            </div>
            {error && (
              <div className="text-red-600 text-sm bg-red-50 p-2 rounded">
                {error}
              </div>
            )}
            <button
              onClick={handleLogin}
              disabled={loginLoading || !email || !password}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white py-2 rounded"
            >
              {loginLoading ? "ログイン中..." : "ログイン"}
            </button>
          </div>
        </div>
      </main>
    );
  }

  // ----------------------------
  // ログイン済み → スライドショー
  // ----------------------------
  return <SlideShow userEmail={user.email || ""} onLogout={logout} />;
}

// ============================================================
// スライドショーコンポーネント
// ============================================================
function SlideShow({
  userEmail,
  onLogout,
}: {
  userEmail: string;
  onLogout: () => Promise<void>;
}) {
  const [accidents, setAccidents] = useState<Accident[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [displayMode, setDisplayMode] = useState<DisplayMode>("recent3");
  const [loading, setLoading] = useState(true);

  // ----------------------------
  // Firestore からデータ取得
  // ----------------------------
  useEffect(() => {
    const fetchAccidents = async () => {
      setLoading(true);
      try {
        // approved かつ 横A4 のみ取得
        const q = query(
          collection(db, "accidents"),
          where("status", "==", "approved"),
          where("orientation", "==", "横"),
          orderBy("date", "desc")
        );
        const snapshot = await getDocs(q);
        const items: Accident[] = [];

        for (const docSnap of snapshot.docs) {
          const data = docSnap.data();

          // PDF の DownloadURL を取得（認証付き）
          let downloadUrl = "";
          if (data.pdfStoragePath) {
            try {
              const storageRef = ref(storage, data.pdfStoragePath);
              downloadUrl = await getDownloadURL(storageRef);
            } catch (e) {
              console.error(
                `PDF URL 取得失敗: ${data.pdfStoragePath}`,
                e
              );
            }
          }

          items.push({
            id: docSnap.id,
            title: data.title,
            date: data.date,
            type: data.type,
            category: data.category,
            severity: data.severity,
            orientation: data.orientation,
            pdfStoragePath: data.pdfStoragePath,
            pdfDownloadUrl: downloadUrl,
          });
        }

        setAccidents(items);
        setCurrentIndex(0);
      } catch (e) {
        console.error("データ取得失敗", e);
      } finally {
        setLoading(false);
      }
    };

    fetchAccidents();
  }, []);

  // ----------------------------
  // 表示モードによるフィルタ
  // ----------------------------
  const filteredAccidents = (() => {
    if (displayMode === "all") return accidents;

    if (displayMode === "recent3") {
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
      return accidents.filter((a) => new Date(a.date) >= threeMonthsAgo);
    }

    if (displayMode === "by_category") {
      // カテゴリ別: 事故速報のみ
      return accidents.filter((a) => a.category === "事故速報");
    }

    return accidents;
  })();

  // currentIndex が範囲外になったらリセット
  useEffect(() => {
    if (currentIndex >= filteredAccidents.length && filteredAccidents.length > 0) {
      setCurrentIndex(0);
    }
  }, [filteredAccidents, currentIndex]);

  const current = filteredAccidents[currentIndex];

  // ----------------------------
  // 自動送り(15秒ごと)
  // ----------------------------
  useEffect(() => {
    if (filteredAccidents.length === 0) return;
    const timer = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % filteredAccidents.length);
    }, 15000);
    return () => clearInterval(timer);
  }, [filteredAccidents.length]);

  // ----------------------------
  // 手動操作
  // ----------------------------
  const goNext = () =>
    setCurrentIndex((prev) => (prev + 1) % filteredAccidents.length);
  const goPrev = () =>
    setCurrentIndex(
      (prev) =>
        (prev - 1 + filteredAccidents.length) % filteredAccidents.length
    );

  // ----------------------------
  // 表示
  // ----------------------------
  return (
    <div className="min-h-screen flex flex-col">
      {/* ヘッダー */}
      <header className="bg-white border-b px-4 py-3 flex items-center justify-between">
        <div>
          <h1 className="font-bold text-lg">事故情報スライドショー</h1>
          <p className="text-xs text-gray-500">{userEmail}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* 表示モード切替 */}
          <select
            value={displayMode}
            onChange={(e) => {
              setDisplayMode(e.target.value as DisplayMode);
              setCurrentIndex(0);
            }}
            className="border rounded px-2 py-1 text-sm"
          >
            <option value="recent3">直近3ヶ月</option>
            <option value="all">全件</option>
            <option value="by_category">事故速報のみ</option>
          </select>
          <button
            onClick={onLogout}
            className="bg-gray-500 hover:bg-gray-600 text-white px-3 py-1 rounded text-sm"
          >
            ログアウト
          </button>
        </div>
      </header>

      {/* メイン */}
      <main className="flex-1 flex flex-col items-center justify-center p-4">
        {loading ? (
          <p className="text-gray-500">読み込み中...</p>
        ) : filteredAccidents.length === 0 ? (
          <p className="text-gray-500">表示するスライドがありません</p>
        ) : current ? (
          <>
            {/* PDF 表示 */}
            <div className="w-full max-w-5xl bg-white shadow-lg rounded mb-4">
              {current.pdfDownloadUrl ? (
                <iframe
                  src={current.pdfDownloadUrl}
                  className="w-full"
                  style={{ height: "70vh" }}
                  title={current.title}
                />
              ) : (
                <div className="p-8 text-center text-gray-500">
                  PDF を読み込めません
                </div>
              )}
            </div>

            {/* 情報 */}
            <div className="text-center mb-2">
              <p className="text-sm text-gray-600">
                {current.date} | {current.category} | {current.type} |{" "}
                {current.severity}
              </p>
              <p className="font-bold">{current.title}</p>
            </div>

            {/* 操作 */}
            <div className="flex items-center gap-4">
              <button
                onClick={goPrev}
                className="bg-gray-200 hover:bg-gray-300 px-4 py-2 rounded"
              >
                ← 前
              </button>
              <span className="text-sm text-gray-600">
                {currentIndex + 1} / {filteredAccidents.length}
              </span>
              <button
                onClick={goNext}
                className="bg-gray-200 hover:bg-gray-300 px-4 py-2 rounded"
              >
                次 →
              </button>
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
}
