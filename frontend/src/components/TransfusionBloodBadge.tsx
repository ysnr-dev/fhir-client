import { bloodTypeLabel } from "../fhir/transfusionOrderHelpers";

// オーダーに載っている血液型の読み取り専用表示。カード・詳細パネル・部門一覧で
// 同じ見た目にするためにここへ出す。
//
// ABO の色は入力フォームのチップと同じ日赤の製剤ラベル区分色。文字を読まなくても
// 型が掴めることに意味があるので、色は明暗テーマで共通にしている。

export function TransfusionBloodBadge({ abo, rhd }: { abo: string; rhd: string }) {
  const label = bloodTypeLabel(abo, rhd);
  if (!label) return null;

  // ABO が無く RhD だけのオーダーもありうるので、色は ABO があるときだけ付ける。
  const className = abo
    ? `transfusion-blood-badge transfusion-blood-badge--${abo.toLowerCase()}`
    : "transfusion-blood-badge";

  return <span className={className}>{label}</span>;
}
