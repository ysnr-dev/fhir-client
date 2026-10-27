// 初期値変数「口腔診査」の組み立て。対象は患者の最新の口腔診査(口腔状態スナップショット。
// fhir/oralExamHelpers.ts)で、歯科疾患管理料の管理計画書など、口腔内の状況を写す様式で使う。
import {
  checkupSymbol,
  countTeeth,
  isSupernumerary,
  MOUTH_SECTIONS,
  recordsOfTooth,
  sortTeeth,
  toothAbbreviations,
  toothCategory,
  toothLabel,
  type OralExamSnapshot,
} from "./oralExamHelpers";
import { drawOralExamChartImage } from "./oralExamChartImage";

/** 歯ごとの行(%oralTeeth)。式は %oralTeeth.where(tooth = '右上8').symbol のように歯の名前で引く。 */
export interface PopulateToothRow {
  /** 歯の名前(右上8・左下A など)。 */
  tooth: string;
  /** 歯種コード(MEDIS 標準歯式 4 桁)。 */
  code: string;
  /** 歯の基本状態(TD-2)。 */
  basic: string;
  /** 歯科健診記号(／ C ○ △ (△) シ サ CO ×)。 */
  symbol: string;
  /** 内容の略号(C2・FMC など)を「・」でつないだもの。 */
  abbr: string;
}

/** 初期値式が参照する元データ(api/queries/populate.ts が読む)。式が口腔診査の変数を使うときだけ揃う。 */
export interface OralExamPopulateSources {
  /** 最新の診査。無ければ undefined。 */
  snapshot?: OralExamSnapshot;
}

/** 元データを読む必要がある変数名(% なし)。 */
export const ORAL_EXAM_POPULATE_VARIABLES = [
  "oralExamDate",
  "oralPresentTeeth",
  "oralCariesTeeth",
  "oralTreatedTeeth",
  "oralMissingTeeth",
  "oralCariesTeethList",
  "oralExamSummary",
  "oralExamNote",
  "oralTeeth",
  "oralExamChart",
] as const;

/** 記録のある歯を 1 行ずつ(歯ごとに最初の併存グループの基本状態。過剰歯は含めない)。 */
export function oralTeethRows(snapshot: OralExamSnapshot): PopulateToothRow[] {
  const seen = new Set<string>();
  const rows: PopulateToothRow[] = [];
  for (const tooth of sortTeeth(snapshot.teeth)) {
    if (seen.has(tooth.toothCode) || isSupernumerary(tooth.toothCode)) continue;
    seen.add(tooth.toothCode);
    rows.push({
      tooth: toothLabel(tooth.toothCode),
      code: tooth.toothCode,
      basic: tooth.basic,
      symbol: checkupSymbol(tooth.basic),
      abbr: toothAbbreviations(recordsOfTooth(snapshot.teeth, tooth.toothCode)).join("・"),
    });
  }
  return rows;
}

/** 未処置歯(基本状態が未処置歯)の歯の名前。歯ごとに最初の併存グループで見て、過剰歯は数えない。 */
export function cariesToothLabels(snapshot: OralExamSnapshot): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const tooth of sortTeeth(snapshot.teeth)) {
    if (seen.has(tooth.toothCode) || isSupernumerary(tooth.toothCode)) continue;
    seen.add(tooth.toothCode);
    if (toothCategory(tooth.basic) === "caries") labels.push(toothLabel(tooth.toothCode));
  }
  return labels;
}

/** 所見・特記事項(SK-3)の自由記載を 1 行ずつ。 */
export function oralExamNotes(snapshot: OralExamSnapshot): string[] {
  const items = MOUTH_SECTIONS.find((section) => section.record === "SK")?.items.filter((d) => d.text) ?? [];
  return snapshot.mouth
    .filter((entry) => entry.record === "SK")
    .flatMap((entry) => items.map((d) => entry.texts[d.item]?.trim() ?? ""))
    .filter(Boolean);
}

/** 初期値式の環境に足す「口腔診査」の変数。診査が無いときも変数名は必ず置く。 */
export function oralExamPopulateValues(
  sources: OralExamPopulateSources | undefined,
): Record<string, string | number | PopulateToothRow[] | undefined> {
  const snapshot = sources?.snapshot;
  if (!snapshot) {
    return {
      oralExamDate: "",
      oralPresentTeeth: undefined,
      oralCariesTeeth: undefined,
      oralTreatedTeeth: undefined,
      oralMissingTeeth: undefined,
      oralCariesTeethList: "",
      oralExamSummary: "",
      oralExamNote: "",
      oralTeeth: [],
      oralExamChart: "",
    };
  }
  const counts = countTeeth(snapshot.teeth);
  return {
    oralExamDate: snapshot.examDate,
    oralPresentTeeth: counts.present,
    oralCariesTeeth: counts.caries,
    oralTreatedTeeth: counts.treated,
    oralMissingTeeth: counts.missing,
    oralCariesTeethList: cariesToothLabels(snapshot).join("、"),
    oralExamSummary: `現在歯${counts.present}本(未処置歯${counts.caries}本・処置歯${counts.treated}本)、喪失歯${counts.missing}本`,
    oralExamNote: oralExamNotes(snapshot).join("\n"),
    oralTeeth: oralTeethRows(snapshot),
    oralExamChart: drawOralExamChartImage(snapshot.teeth, snapshot.examDate),
  };
}
