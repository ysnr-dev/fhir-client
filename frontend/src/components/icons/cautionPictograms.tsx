import type { ReactNode } from "react";

/**
 * 患者帯に出す「診療上の注意」のピクトグラム。
 *
 * 図柄はライブラリを使わず、他の画面と同じ手書きのインライン SVG
 * (16px / viewBox 0 0 16 16 / stroke=currentColor)で持つ。色は使う側が
 * 区分ごとに CSS で与えるので、ここでは 1 色の線画だけを描く。
 *
 * このキー一覧が正で、注意区分マスタの選択肢もここから作る。backend にも
 * 同じ一覧を検証用に持っている(Master::PatientCaution::PICTOGRAMS)ので、
 * 図柄を増やすときは両方に足す。
 */
export const CAUTION_PICTOGRAM_KEYS = [
  "fall",
  "wheelchair",
  "hearing",
  "vision",
  "cognition",
  "implant",
  "contrast",
  "anticoagulant",
  "dnar",
  "no-transfusion",
  "violence",
  "elopement",
  "unpaid",
  "privacy",
  "alert",
  // 感染症(陽性)。注意区分マスタでは選ばせず、患者帯が感染症の区画から
  // 直接使う(注意とは別の情報なので、区分として登録させると二重管理になる)。
  "infection",
  // アレルギー。感染症と同じく注意区分マスタでは選ばせず、患者帯が
  // AllergyIntolerance から直接使う。薬剤とそれ以外で図柄を分ける
  // (薬剤禁忌は処方・注射で真っ先に確かめるもので、食物アレルギーとは
  // 見るべき場面が違うため)。
  "allergy-medication",
  "allergy-other",
] as const;

export type CautionPictogramKey = (typeof CAUTION_PICTOGRAM_KEYS)[number];

/** マスタ画面の選択肢に出す図柄の説明(注意そのものの名前ではなく、絵の内容)。 */
export const CAUTION_PICTOGRAM_LABELS: Record<CautionPictogramKey, string> = {
  fall: "転倒する人",
  wheelchair: "車椅子",
  hearing: "耳に斜線",
  vision: "目に斜線",
  cognition: "頭部に渦",
  implant: "磁石に禁止記号",
  contrast: "点滴に感嘆符",
  anticoagulant: "血液の滴に時計",
  dnar: "心電図波形に斜線",
  "no-transfusion": "輸血バッグに禁止記号",
  violence: "手のひら",
  elopement: "開いたドアと人",
  unpaid: "硬貨に感嘆符",
  privacy: "鍵",
  alert: "三角の感嘆符",
  infection: "バイオハザード",
  "allergy-medication": "カプセルに禁止記号",
  "allergy-other": "皿に禁止記号",
};

// 線画の共通属性。塗りは持たず、太さは他の画面のアイコンと揃える。
const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

// 禁止記号(丸に斜線)。輸血拒否・体内金属など「してはいけない」に重ねる。
const banCircle = (
  <>
    <circle cx="11" cy="11" r="4" {...STROKE} />
    <path d="M8.2 13.8 13.8 8.2" {...STROKE} />
  </>
);

const SHAPES: Record<CautionPictogramKey, ReactNode> = {
  // 転倒する人。頭・傾いた体幹・投げ出した手足・床の線。
  fall: (
    <>
      <circle cx="5" cy="3.4" r="1.6" {...STROKE} />
      <path d="M4 6.2 8.2 9M8.2 9l3 1M4 6.2 2.6 9.6M8.2 9l-1.4 3" {...STROKE} />
      <path d="M1.5 14h13" {...STROKE} />
    </>
  ),
  // 車椅子。座る人・背もたれ・大車輪・フットレスト。
  wheelchair: (
    <>
      <circle cx="6.4" cy="2.6" r="1.4" {...STROKE} />
      <path d="M5.6 5.2v4h4" {...STROKE} />
      <circle cx="7" cy="11.4" r="3.4" {...STROKE} />
      <path d="M10.4 9.2 12.6 13h1.6" {...STROKE} />
    </>
  ),
  // 耳に斜線(聴覚障害)。
  hearing: (
    <>
      <path d="M5.4 6.2a2.8 2.8 0 1 1 5.2 1.4c-.7 1.2-1.9 1.6-1.9 3.1a1.7 1.7 0 0 1-3 1" {...STROKE} />
      <path d="M2.5 13.5 13.5 2.5" {...STROKE} />
    </>
  ),
  // 目に斜線(視覚障害)。
  vision: (
    <>
      <path d="M1.6 8s2.4-3.8 6.4-3.8S14.4 8 14.4 8s-2.4 3.8-6.4 3.8S1.6 8 1.6 8Z" {...STROKE} />
      <circle cx="8" cy="8" r="1.7" {...STROKE} />
      <path d="M2.5 13.5 13.5 2.5" {...STROKE} />
    </>
  ),
  // 頭部の輪郭に渦(認知症・せん妄)。
  cognition: (
    <>
      <path d="M12.6 8.6a4.8 4.8 0 1 0-7.5 4v2.1" {...STROKE} />
      <path d="M12.6 8.6h1.4M5.1 14.7h5" {...STROKE} />
      <path d="M9.4 6.2a1.5 1.5 0 1 0-1.7 1.9 1.5 1.5 0 0 1-1.6 2" {...STROKE} />
    </>
  ),
  // 磁石に禁止記号(体内金属・ペースメーカー。MRI 禁忌)。
  implant: (
    <>
      <path d="M2.4 9.6V6a3.6 3.6 0 0 1 7.2 0v3.6" {...STROKE} />
      <path d="M2.4 9.6h2.6M7 9.6h2.6" {...STROKE} />
      {banCircle}
    </>
  ),
  // 点滴バッグに感嘆符(造影剤注意)。
  contrast: (
    <>
      <path d="M4.2 1.8h5.2v6.4a2.6 2.6 0 0 1-5.2 0Z" {...STROKE} />
      <path d="M6.8 10.8v3.4" {...STROKE} />
      <path d="M12.4 5v3.6" {...STROKE} />
      <circle cx="12.4" cy="10.8" r=".7" fill="currentColor" stroke="none" />
    </>
  ),
  // 血液の滴に時計(抗凝固薬内服。止まりにくい)。
  anticoagulant: (
    <>
      <path d="M6 1.8s3.4 3.8 3.4 6a3.4 3.4 0 0 1-6.8 0c0-2.2 3.4-6 3.4-6Z" {...STROKE} />
      <circle cx="12" cy="11.4" r="3.1" {...STROKE} />
      <path d="M12 9.6v1.8l1.3.9" {...STROKE} />
    </>
  ),
  // 心電図波形に斜線(DNAR)。
  dnar: (
    <>
      <path d="M1.6 9h2.6l1.4-3.4L7.8 12l1.6-4.2 1 1.2h3.9" {...STROKE} />
      <path d="M2.5 13.5 13.5 2.5" {...STROKE} />
    </>
  ),
  // 輸血バッグに禁止記号(輸血拒否)。
  "no-transfusion": (
    <>
      <path d="M2.6 2.2h5.6v6.2a2.8 2.8 0 0 1-5.6 0Z" {...STROKE} />
      <path d="M2.6 5.2h5.6" {...STROKE} />
      {banCircle}
    </>
  ),
  // 開いた手のひら(暴力・粗暴歴)。
  violence: (
    <>
      <path d="M4.4 8.6V4.2a1 1 0 0 1 2 0v3M6.4 7V3a1 1 0 0 1 2 0v4M8.4 7V3.6a1 1 0 0 1 2 0V7" {...STROKE} />
      <path d="M10.4 7V5.4a1 1 0 0 1 2 0v4.2a4.4 4.4 0 0 1-4.4 4.4c-2 0-3-1-3.6-2.2L2.8 9.4a1.1 1.1 0 0 1 1.6-1.4Z" {...STROKE} />
    </>
  ),
  // 開いたドアと出ていく人(離院リスク)。
  elopement: (
    <>
      <path d="M2.2 1.8h6.2v12.4H2.2Z" {...STROKE} />
      <circle cx="6.2" cy="8" r=".7" fill="currentColor" stroke="none" />
      <path d="M10.4 8h4M12.6 6l2 2-2 2" {...STROKE} />
    </>
  ),
  // 硬貨に感嘆符(未収金)。
  unpaid: (
    <>
      <circle cx="6.6" cy="8" r="5" {...STROKE} />
      <path d="M6.6 5.2v3.4" {...STROKE} />
      <circle cx="6.6" cy="10.6" r=".7" fill="currentColor" stroke="none" />
      <path d="M11.4 3.4a5 5 0 0 1 0 9.2" {...STROKE} />
    </>
  ),
  // 鍵(要配慮・個人情報制限)。
  privacy: (
    <>
      <rect x="3" y="7" width="10" height="7.2" rx="1.2" {...STROKE} />
      <path d="M5.4 7V4.8a2.6 2.6 0 0 1 5.2 0V7" {...STROKE} />
      <circle cx="8" cy="10.6" r=".9" {...STROKE} />
    </>
  ),
  // バイオハザード。中心の輪と 3 つの弧で、標準の記号に寄せた形。
  infection: (
    <>
      <circle cx="8" cy="8" r="1.7" {...STROKE} />
      <path d="M6.6 6.6A4.6 4.6 0 0 1 5.1 2.2" {...STROKE} />
      <path d="M9.4 6.6a4.6 4.6 0 0 0 1.5-4.4" {...STROKE} />
      <path d="M6.8 9.4a4.6 4.6 0 0 1-3.9 2.3" {...STROKE} />
      <path d="M9.2 9.4a4.6 4.6 0 0 0 3.9 2.3" {...STROKE} />
      <path d="M8 9.7v4.5" {...STROKE} />
      <circle cx="8" cy="8" r="6.4" {...STROKE} />
    </>
  ),
  // カプセルに禁止記号(薬剤アレルギー・薬剤禁忌)。斜めに置いて、
  // 皿(allergy-other)の丸い輪郭と見分けやすくする。
  "allergy-medication": (
    <>
      <rect
        x="0.4"
        y="4.2"
        width="10.4"
        height="4.6"
        rx="2.3"
        transform="rotate(-35 5.6 6.5)"
        {...STROKE}
      />
      <path d="M4 8.2 7.2 4.8" transform="rotate(-35 5.6 6.5)" {...STROKE} />
      {banCircle}
    </>
  ),
  // 皿の上の食べ物に禁止記号(薬剤以外のアレルギー。食物・環境など)。
  // 食物アレルギーが最も多く、絵として一目で分かるので皿にした。
  "allergy-other": (
    <>
      <circle cx="6.4" cy="5.6" r="2" {...STROKE} />
      <path d="M1.4 9.2h10" {...STROKE} />
      <path d="M2.6 9.2a3.8 3.8 0 0 0 7.6 0" {...STROKE} />
      {banCircle}
    </>
  ),
  // 三角の感嘆符(汎用。区分に合う図柄が無いときの既定)。
  alert: (
    <>
      <path d="M8 1.8 15 13.8H1Z" {...STROKE} />
      <path d="M8 6.2v3.4" {...STROKE} />
      <circle cx="8" cy="11.8" r=".75" fill="currentColor" stroke="none" />
    </>
  ),
};

/**
 * 注意区分マスタの選択肢に出す図柄。感染症とアレルギーは注意とは別の情報
 * (それぞれの区画・タブで管理する)なので、区分として登録できないよう外してある。
 */
const NON_MASTER_KEYS: readonly CautionPictogramKey[] = [
  "infection",
  "allergy-medication",
  "allergy-other",
];

export const CAUTION_MASTER_PICTOGRAM_KEYS = CAUTION_PICTOGRAM_KEYS.filter(
  (key) => !NON_MASTER_KEYS.includes(key),
);

export function isCautionPictogramKey(value: string | null | undefined): value is CautionPictogramKey {
  return CAUTION_PICTOGRAM_KEYS.includes(value as CautionPictogramKey);
}

interface CautionPictogramProps {
  /** マスタの pictogram。未知のキーは汎用の三角(alert)で描く。 */
  pictogram: string | null | undefined;
  size?: number;
}

/**
 * ピクトグラム 1 個。色は継承した文字色になるので、区分ごとの色は
 * 呼び出し側のクラスで与える。ラベルは包む要素が title / aria-label で持つ
 * (アイコン自体は装飾として読み飛ばさせる)。
 */
export function CautionPictogram({ pictogram, size = 16 }: CautionPictogramProps) {
  const key: CautionPictogramKey = isCautionPictogramKey(pictogram) ? pictogram : "alert";

  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" focusable="false">
      {SHAPES[key]}
    </svg>
  );
}
