"use client";

// ============================================================
// 認証コンテキスト
// アプリ全体で「今ログインしているユーザー」の情報を共有する
// ============================================================

import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
import { onAuthStateChanged, User, signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";

type AuthContextType = {
  user: User | null;    // 現在ログインしているユーザー（null = 未ログイン）
  loading: boolean;     // 認証状態の判定中フラグ
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  logout: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Firebase の認証状態を監視
    // ログイン/ログアウトが起きるたびに呼ばれる
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const logout = async () => {
    await signOut(auth);
  };

  return (
    <AuthContext.Provider value={{ user, loading, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

// 各コンポーネントから useAuth() で取り出せる
export function useAuth() {
  return useContext(AuthContext);
}
