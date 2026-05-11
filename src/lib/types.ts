// ============================================================
// Firestore スキーマ TypeScript 型定義
// 設計思想:
//   - 役割別権限（viewer / contributor / site_manager / admin）
//   - 承認フロー（pending → approved → archived）
//   - 本社 priority 配信は全現場強制
//   - パッケージ = 工事の初期設定（複数 PDF のテンプレート）
// ============================================================

import type { Timestamp } from "firebase/firestore";

// ------------------------------------------------------------
// 共通: ロール定義
// ------------------------------------------------------------
export type UserRole =
  | "viewer"        // 閲覧のみ
  | "contributor"   // PDF 投稿可（自分の投稿のみ編集可）
  | "site_manager"  // 現場の表示設定変更可
  | "admin";        // 全権限

// ------------------------------------------------------------
// 共通: 投稿ステータス
// ------------------------------------------------------------
export type AccidentStatus =
  | "pending"   // 確認待ち（contributor 登録直後）
  | "approved"  // 公開済み（admin 承認後）
  | "archived"; // アーカイブ（非表示）

// ------------------------------------------------------------
// 共通: 重要度
// ------------------------------------------------------------
export type Importance =
  | "normal"    // 通常
  | "priority"; // 本社 priority（全現場強制配信）

// ------------------------------------------------------------
// 共通: 配信スコープ
// ------------------------------------------------------------
// "all" = 全現場対象 / site ID = その現場のみ
export type AssignedSite = "all" | string;

// ============================================================
// accidents コレクション
// PDF 単体（事故情報・お知らせ・本社 priority など全部）
// ============================================================
export interface Accident {
  id: string;                  // Firestore ドキュメント ID
  title: string;               // タイトル（例: "下横構の指挟み事故"）
  date: string;                // 事故発生日（YYYY-MM-DD）
  pdfUrl: string;              // Storage の PDF URL
  pdfFileName: string;         // ファイル名（例: "20260303-01.pdf"）

  // 分類（admin が補完・確定する）
  type: string;                // NEXCO 型分類（例: "墜落・転落"）
  category: string;            // カテゴリ（例: "事故速報" / "事務連絡"）
  severity: string;            // 重大度（例: "軽傷" / "重傷" / "死亡"）
  industry?: string;           // 業種
  koujiShubetsu?: string;      // 工事種別

  // 配信制御
  status: AccidentStatus;      // 公開ステータス
  importance: Importance;      // 通常 or 本社 priority
  assignedSite: AssignedSite;  // 配信対象現場
  publishStart?: Timestamp;    // 公開開始日（任意）
  publishEnd?: Timestamp;      // 公開終了日（任意）

  // メタデータ
  createdBy: string;           // 投稿者 userId
  createdAt: Timestamp;
  approvedBy?: string;         // 承認者 userId
  approvedAt?: Timestamp;
  updatedAt: Timestamp;

  // 補足情報
  description?: string;        // 説明文
  tags?: string[];             // タグ（季節・キーワード等）
}

// ============================================================
// packages コレクション
// パッケージ = 工事の初期設定（複数 PDF のテンプレート）
// ============================================================
export interface Package {
  id: string;
  name: string;                // 例: "直近3ヶ月の事故情報"
  description?: string;

  // パッケージのルール
  // rule.type === "filter": フィルタ条件で動的に PDF を集める
  // rule.type === "manual": 個別 PDF を手動で指定
  rule: PackageRule;

  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type PackageRule =
  | {
      type: "filter";
      // フィルタ条件（例: 直近 3 ヶ月 / 特定カテゴリ / etc.）
      periodMonths?: number;    // 直近 N ヶ月
      categories?: string[];    // 対象カテゴリ
      types?: string[];         // 対象型分類
      severities?: string[];    // 対象重大度
    }
  | {
      type: "manual";
      accidentIds: string[];    // 手動指定の PDF 一覧
    };

// ============================================================
// site_configs コレクション
// 現場別の表示設定（採用パッケージ・個別 PDF・表示モード）
// ============================================================
export interface SiteConfig {
  id: string;                  // 現場 ID（例: "sakogawa"）
  adoptedPackages: string[];   // 採用済みパッケージ ID 一覧
  individualPdfs: string[];    // 個別追加 PDF（accidentId 一覧）
  displayMode: DisplayMode;    // 表示モード
  updatedAt: Timestamp;
  updatedBy: string;
}

export type DisplayMode =
  | "all"          // 採用パッケージ + 個別 PDF を全部表示
  | "recent3"      // 直近 3 ヶ月のみ
  | "by_category"; // カテゴリ別表示

// ============================================================
// users コレクション
// ユーザー情報・ロール
// ============================================================
export interface User {
  id: string;                  // Firebase Auth UID
  email: string;
  displayName: string;
  role: UserRole;
  assignedSite?: string;       // site_manager の場合の担当現場
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ============================================================
// sites コレクション
// 現場マスタ
// ============================================================
export interface Site {
  id: string;                  // 例: "sakogawa"
  name: string;                // 例: "迫川現場"
  description?: string;
  active: boolean;             // 運用中 / 停止
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
