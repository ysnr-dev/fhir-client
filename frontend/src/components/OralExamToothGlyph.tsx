import type { ToothDef } from "../fhir/oralExamHelpers";

interface OralExamToothGlyphProps {
  tooth: ToothDef;
  /** 塗る歯面(TP-13〜TP-17)。 */
  surfaces: Set<string>;
  /** 欠損(喪失)を斜線で表す。 */
  crossed: boolean;
}

// 中央が切端・咬合面、周囲の台形が 4 面。頬側(唇側)は口腔の外側、近心は正中の側に置く
// (上顎は上が頬側、下顎は下が頬側。患者の右側の歯は右が近心)。
const OUTER = { top: "2,2 22,2 16,8 8,8", bottom: "2,22 22,22 16,16 8,16", left: "2,2 8,8 8,16 2,22", right: "22,2 16,8 16,16 22,22" };

export function OralExamToothGlyph({ tooth, surfaces, crossed }: OralExamToothGlyphProps) {
  const buccal = tooth.upper ? "top" : "bottom";
  const lingual = tooth.upper ? "bottom" : "top";
  const mesial = tooth.right ? "right" : "left";
  const distal = tooth.right ? "left" : "right";
  const faces: { item: string; points: string }[] = [
    { item: "TP-14", points: OUTER[buccal] },
    { item: "TP-15", points: OUTER[lingual] },
    { item: "TP-16", points: OUTER[mesial] },
    { item: "TP-17", points: OUTER[distal] },
  ];

  return (
    <svg className="oral-exam__glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {faces.map((face) => (
        <polygon
          key={face.item}
          points={face.points}
          className={surfaces.has(face.item) ? "oral-exam__face is-filled" : "oral-exam__face"}
        />
      ))}
      <rect
        x="8"
        y="8"
        width="8"
        height="8"
        className={surfaces.has("TP-13") ? "oral-exam__face is-filled" : "oral-exam__face"}
      />
      {crossed && <path d="M3 3 L21 21 M21 3 L3 21" className="oral-exam__cross" />}
    </svg>
  );
}
