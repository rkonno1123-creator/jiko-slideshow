"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth, db, storage } from "@/lib/firebase";
import { useAuth } from "@/lib/AuthContext";
import { collection, getDocs, query, where, orderBy } from "firebase/firestore";
import { ref, getDownloadURL } from "firebase/storage";

// ------------------------------------------------------------
// 型定義
// ------------------------------------------------------------
type Accident = {
  id: string;
  title: string;
  date: string;
  type: string;
  category: string;
  severity: string;
  orientation?: string;
  imageStoragePaths?: string[];
  imageDownloadUrls?: string[]; // クライアントで getDownloadURL した結果
};

type DisplayMode = "all" | "recent3" | "by_category";

// デフォルト表示秒数
const DEFAULT_INTERVAL_SECONDS = 15;

// ============================================================
// メインページ
// ============================================================
export default function HomePage() {
  const { user, loading, logout } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

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

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">読み込み中...</p>
      </main>
    );
  }

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
  const [currentPageIndex, setCurrentPageIndex] = useState(0); // 複数ページ対応
  const [displayMode, setDisplayMode] = useState<DisplayMode>("recent3");
  const [loading, setLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(true);
  const [intervalSeconds, setIntervalSeconds] = useState(
    DEFAULT_INTERVAL_SECONDS
  );
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isImageLoading, setIsImageLoading] = useState(false);
  const [lastTapped, setLastTapped] = useState<"left" | "right" | null>(null);

  // 全画面化の対象になる要素を掴むためのref
  const containerRef = useRef<HTMLDivElement>(null);

  // ----------------------------
  // localStorage から設定を読む
  // ----------------------------
  useEffect(() => {
    const savedInterval = localStorage.getItem("intervalSeconds");
    if (savedInterval) {
      setIntervalSeconds(parseInt(savedInterval));
    }
    const savedMode = localStorage.getItem("displayMode") as DisplayMode | null;
    if (savedMode) {
      setDisplayMode(savedMode);
    }
  }, []);

  // ----------------------------
  // 設定を localStorage に保存
  // ----------------------------
  const updateInterval = (sec: number) => {
    setIntervalSeconds(sec);
    localStorage.setItem("intervalSeconds", String(sec));
  };

  const updateDisplayMode = (mode: DisplayMode) => {
    setDisplayMode(mode);
    setCurrentIndex(0);
    setCurrentPageIndex(0);
    localStorage.setItem("displayMode", mode);
  };

  // ----------------------------
  // Firestore からデータ取得
  // ----------------------------
  useEffect(() => {
    const fetchAccidents = async () => {
      setLoading(true);
      try {
        const q = query(
          collection(db, "accidents"),
          where("status", "==", "approved"),
          where("orientation", "==", "横"),
          orderBy("date", "desc")
        );
        const snapshot = await getDocs(q);

        // 並列でDownloadURL取得
        const items = await Promise.all(
          snapshot.docs.map(async (docSnap) => {
            const data = docSnap.data();

            const imageDownloadUrls: string[] = [];
            if (Array.isArray(data.imageStoragePaths)) {
              const urlPromises = data.imageStoragePaths.map(
                async (storagePath: string) => {
                  try {
                    const storageRef = ref(storage, storagePath);
                    return await getDownloadURL(storageRef);
                  } catch (e) {
                    console.error(`画像URL取得失敗: ${storagePath}`, e);
                    return "";
                  }
                }
              );
              const urls = await Promise.all(urlPromises);
              imageDownloadUrls.push(...urls.filter((u) => u));
            }

            return {
              id: docSnap.id,
              title: data.title,
              date: data.date,
              type: data.type,
              category: data.category,
              severity: data.severity,
              orientation: data.orientation,
              imageStoragePaths: data.imageStoragePaths,
              imageDownloadUrls,
            } as Accident;
          })
        );

        // 画像があるものだけ表示
        setAccidents(items.filter((a) => a.imageDownloadUrls && a.imageDownloadUrls.length > 0));
        setCurrentIndex(0);
        setCurrentPageIndex(0);
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
      return accidents.filter((a) => a.category === "事故速報");
    }

    return accidents;
  })();

  // currentIndex が範囲外になったらリセット
  useEffect(() => {
    if (
      currentIndex >= filteredAccidents.length &&
      filteredAccidents.length > 0
    ) {
      setCurrentIndex(0);
      setCurrentPageIndex(0);
    }
  }, [filteredAccidents, currentIndex]);

  const current = filteredAccidents[currentIndex];
  const currentImageUrl =
    current?.imageDownloadUrls?.[currentPageIndex] || "";
  const totalPages = current?.imageDownloadUrls?.length || 1;

  // ----------------------------
  // 手動操作（useCallbackで包む = キーボード操作のuseEffectで使うため）
  // ----------------------------
  const goNext = useCallback(() => {
    if (isFullscreen) {
      setIsImageLoading(true);
      setLastTapped("right");
      setTimeout(() => setLastTapped(null), 300);
    }
    if (currentPageIndex < totalPages - 1) {
      setCurrentPageIndex((prev) => prev + 1);
    } else {
      setCurrentPageIndex(0);
      setCurrentIndex((prev) => (prev + 1) % filteredAccidents.length);
    }
  }, [currentPageIndex, totalPages, filteredAccidents.length, isFullscreen]);

  const goPrev = useCallback(() => {
    if (isFullscreen) {
      setIsImageLoading(true);
      setLastTapped("left");
      setTimeout(() => setLastTapped(null), 300);
    }
    if (currentPageIndex > 0) {
      setCurrentPageIndex((prev) => prev - 1);
    } else {
      const newIdx =
        (currentIndex - 1 + filteredAccidents.length) %
        filteredAccidents.length;
      setCurrentIndex(newIdx);
      const newTotalPages =
        filteredAccidents[newIdx]?.imageDownloadUrls?.length || 1;
      setCurrentPageIndex(newTotalPages - 1);
    }
  }, [currentPageIndex, currentIndex, filteredAccidents, isFullscreen]);

  const togglePlay = useCallback(() => {
    setIsPlaying((p) => !p);
  }, []);

  // ----------------------------
  // 自動送り
  // ----------------------------
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (!isPlaying) return;
    if (filteredAccidents.length === 0) return;

    timerRef.current = setInterval(() => {
      // 複数ページある場合: 次のページへ
      // 最終ページなら次のスライドへ
      if (currentPageIndex < totalPages - 1) {
        setCurrentPageIndex((prev) => prev + 1);
      } else {
        setCurrentPageIndex(0);
        setCurrentIndex((prev) => (prev + 1) % filteredAccidents.length);
      }
    }, intervalSeconds * 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [
    isPlaying,
    filteredAccidents.length,
    intervalSeconds,
    currentPageIndex,
    totalPages,
  ]);

  // ----------------------------
  // 全画面表示
  // ----------------------------
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().catch((err) => {
        console.error("全画面表示に失敗:", err);
      });
    } else {
      document.exitFullscreen();
    }
  }, []);

  // 全画面状態の変化を監視（Escキーで抜けた時もボタン表示を同期させるため）
  useEffect(() => {
    const handleChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleChange);
    return () => document.removeEventListener("fullscreenchange", handleChange);
  }, []);

  // ----------------------------
  // キーボード操作（← → Space F）
  // ----------------------------
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      // input/textarea にフォーカスがあるときは無効化
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT") {
        return;
      }

      if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (e.key === " ") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        toggleFullscreen();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [goNext, goPrev, togglePlay, toggleFullscreen]);

  // ----------------------------
  // 表示
  // ----------------------------
  return (
    <div ref={containerRef} className="min-h-screen flex flex-col bg-white">
      {/* ヘッダー（全画面時は非表示） */}
      {!isFullscreen && (
        <header className="bg-white border-b px-3 py-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="font-bold text-base sm:text-lg">事故情報スライドショー</h1>
            <p className="text-xs text-gray-500">{userEmail}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* 表示モード切替 */}
            <select
              value={displayMode}
              onChange={(e) => updateDisplayMode(e.target.value as DisplayMode)}
              className="border rounded px-2 py-1 text-sm"
            >
              <option value="recent3">直近3ヶ月</option>
              <option value="all">全件</option>
              <option value="by_category">事故速報のみ</option>
            </select>

            {/* 秒数切替 */}
            <select
              value={intervalSeconds}
              onChange={(e) => updateInterval(parseInt(e.target.value))}
              className="border rounded px-2 py-1 text-sm"
            >
              <option value="5">5秒</option>
              <option value="10">10秒</option>
              <option value="15">15秒</option>
              <option value="30">30秒</option>
              <option value="60">60秒</option>
            </select>

            {/* 再生/停止 */}
            <button
              onClick={togglePlay}
              className={`px-3 py-1 rounded text-sm text-white ${
                isPlaying ? "bg-orange-500 hover:bg-orange-600" : "bg-green-600 hover:bg-green-700"
              }`}
            >
              {isPlaying ? "⏸ 停止" : "▶ 再生"}
            </button>

            {/* 全画面ボタン */}
            <button
              onClick={toggleFullscreen}
              className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-sm"
              title="全画面表示 (F)"
            >
              ⛶ 全画面
            </button>

            <button
              onClick={onLogout}
              className="bg-gray-500 hover:bg-gray-600 text-white px-3 py-1 rounded text-sm"
            >
              ログアウト
            </button>
          </div>
        </header>
      )}

      {/* メイン */}
      <main className="flex-1 flex flex-col items-center justify-center p-2 sm:p-4">
        {loading ? (
          <p className="text-gray-500">読み込み中...</p>
        ) : filteredAccidents.length === 0 ? (
          <p className="text-gray-500">表示するスライドがありません</p>
        ) : current ? (
          <>
            {/* 画像表示エリア（タップ領域を3分割） */}
            <div className="w-full flex-1 flex items-center justify-center mb-2 relative select-none">
              {currentImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={currentImageUrl}
                  alt={current.title}
                  onLoad={() => setIsImageLoading(false)}
                  className={`max-w-full object-contain shadow-lg pointer-events-none transition-opacity duration-200 ${
                    isFullscreen ? "max-h-screen" : "max-h-[75vh]"
                  } ${isFullscreen && isImageLoading ? "opacity-30" : "opacity-100"}`}
                  draggable={false}
                />
              ) : (
                <div className="text-gray-500">画像を読み込めません</div>
              )}

              {/* 左タップゾーン（前のスライドへ） */}
              <button
                onClick={goPrev}
                className="absolute left-0 top-0 w-1/3 h-full flex items-center justify-start pl-2 sm:pl-4 group cursor-pointer"
                aria-label="前のスライド"
              >
                <span
                  className={`text-white text-3xl sm:text-4xl rounded-full w-12 h-12 sm:w-14 sm:h-14 flex items-center justify-center transition-all duration-200 ${
                    lastTapped === "left"
                      ? "bg-blue-500 opacity-100 scale-125"
                      : "bg-black/30 group-hover:bg-black/60 opacity-40 group-hover:opacity-90"
                  }`}
                >
                  ‹
                </span>
              </button>

              {/* 中央タップゾーン（再生/停止トグル） */}
              <button
                onClick={togglePlay}
                className="absolute left-1/3 top-0 w-1/3 h-full cursor-pointer"
                aria-label="再生/停止"
              />

              {/* 右タップゾーン（次のスライドへ） */}
              <button
                onClick={goNext}
                className="absolute right-0 top-0 w-1/3 h-full flex items-center justify-end pr-2 sm:pr-4 group cursor-pointer"
                aria-label="次のスライド"
              >
                <span
                  className={`text-white text-3xl sm:text-4xl rounded-full w-12 h-12 sm:w-14 sm:h-14 flex items-center justify-center transition-all duration-200 ${
                    lastTapped === "right"
                      ? "bg-blue-500 opacity-100 scale-125"
                      : "bg-black/30 group-hover:bg-black/60 opacity-40 group-hover:opacity-90"
                  }`}
                >
                  ›
                </span>
              </button>

              {/* 停止中オーバーレイ */}
              {!isPlaying && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="bg-black/40 rounded-full w-20 h-20 flex items-center justify-center">
                    <span className="text-white text-3xl">⏸</span>
                  </div>
                </div>
              )}
            </div>

            {/* 情報・フッター（全画面時は非表示） */}
            {!isFullscreen && (
              <>
                <div className="text-center mb-2 px-2">
                  <p className="text-xs sm:text-sm text-gray-600">
                    {current.date} | {current.category} | {current.type} |{" "}
                    {current.severity}
                  </p>
                  <p className="font-bold text-sm sm:text-base">{current.title}</p>
                </div>

                <div className="flex items-center gap-3 sm:gap-4 pb-2">
                  <button
                    onClick={goPrev}
                    className="bg-gray-200 hover:bg-gray-300 px-3 sm:px-4 py-2 rounded text-sm"
                  >
                    ← 前
                  </button>
                  <span className="text-xs sm:text-sm text-gray-600">
                    {currentIndex + 1} / {filteredAccidents.length}
                    {totalPages > 1 && (
                      <span className="ml-2 text-blue-600">
                        (ページ {currentPageIndex + 1}/{totalPages})
                      </span>
                    )}
                  </span>
                  <button
                    onClick={goNext}
                    className="bg-gray-200 hover:bg-gray-300 px-3 sm:px-4 py-2 rounded text-sm"
                  >
                    次 →
                  </button>
                </div>
              </>
            )}
          </>
        ) : null}
      </main>
    </div>
  );
}
