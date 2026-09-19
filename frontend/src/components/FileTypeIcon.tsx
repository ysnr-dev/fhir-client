import { fileIconKindOf, type PatientFileIconKind } from "../fhir/patientFileHelpers";

// サムネイルを描けないファイルの見出しアイコン。MIME の種類ごとに形を変えて、
// 一覧を目で流したときに書類・表・スライドの別が分かるようにする。
// 線画なのは他のアイコン(パスの操作・カテゴリの削除)と同じ。

// 書類系に共通の用紙(右上を折ったページ)。
const PAGE = "M5.5 2.5h7l4 4v15h-11z";
const PAGE_FOLD = "M12.5 2.5v4h4";

const ICON_PATHS: Record<PatientFileIconKind, string> = {
  // 中身を描けなかった画像。額の中の山と日。
  image: "M3.5 5.5h17v13h-17zM3.5 15l4.5-4 4 3.5 3.5-3 5 4.5M8 9.5h.01",
  // PDF: ページの下に帯。
  pdf: `${PAGE}${PAGE_FOLD}M8 15.5h8v4h-8z`,
  // 文書: ページに文字行。
  document: `${PAGE}${PAGE_FOLD}M8 11h6M8 14.5h6M8 18h4`,
  // 表: 格子。
  spreadsheet: "M3.5 4.5h17v15h-17zM3.5 9.5h17M3.5 14.5h17M9.5 4.5v15M15.5 4.5v15",
  // スライド: 台に載った画面。
  presentation: "M3.5 4.5h17v11h-17zM12 15.5v4M8.5 21l3.5-1.5 3.5 1.5",
  // テキスト: 用紙を持たず行だけ。
  text: "M4.5 5.5h15M4.5 10h15M4.5 14.5h15M4.5 19h9",
  // 書庫: 留め具の付いた箱。
  archive: "M3.5 4.5h17v5h-17zM5 9.5v10h14v-10M10.5 13h3",
  // 音声: 音符。
  audio: "M9.5 18V5.5l9-2V16M9.5 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0M18.5 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0",
  // 動画: 画面と再生の三角。
  video: "M3.5 5.5h17v13h-17zM10 9.5l5 2.5-5 2.5z",
  // その他: ページだけ。
  other: `${PAGE}${PAGE_FOLD}`,
};

export function FileTypeIcon({ contentType }: { contentType: string }) {
  const kind = fileIconKindOf(contentType);
  return (
    <svg viewBox="0 0 24 24" width="36" height="36" aria-hidden="true" focusable="false">
      <path
        d={ICON_PATHS[kind]}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
