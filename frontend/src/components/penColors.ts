// 描き込みモーダル(SchemaPaintModal)の色の選択肢。モーダル本体は fabric.js を抱えて
// 遅延読み込みしているので、呼び出し側が色を渡すための定義はこちらに置く
// (本体から import すると fabric まで先に読み込まれる)。

export interface PenColor {
  code: string;
  label: string;
}

// RichTextEditor の文字色と同じパレット(アプリ内で装飾色を統一する)。線画の台紙向け。
export const PEN_COLORS: readonly PenColor[] = [
  { code: "#1f1f1f", label: "黒" },
  { code: "#d32f2f", label: "赤" },
  { code: "#1565c0", label: "青" },
  { code: "#2e7d32", label: "緑" },
];

/** 暗い画像(CT・MR・単純写真)の上で見える色。黒・青は背景に沈む。 */
export const DARK_IMAGE_PEN_COLORS: readonly PenColor[] = [
  { code: "#ffd600", label: "黄" },
  { code: "#ff1744", label: "赤" },
  { code: "#00e5ff", label: "水色" },
  { code: "#ffffff", label: "白" },
];
