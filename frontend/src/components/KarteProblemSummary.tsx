import {
  narrativePlainText,
  sectionTitle,
  stripSchemaImageNotes,
} from "../fhir/clinicalNoteHelpers";
import { problemLabel, summarizeCondition } from "../fhir/conditionHelpers";
import { itemProblem, type KarteDayGroup } from "../fhir/karteTimeline";

// 「関連する記録のみ表示」で絞り込んでいるときに、タイムラインの上に出す見出し。
// POMR のプロブレムリストは「今このプロブレムがどうなっているか」を持たないので、
// 発症日・転帰と、直近の記録の評価・計画(A/P)をここで補う。

interface KarteProblemSummaryProps {
  /** 絞り込み対象のプロブレム。削除済みの id を指す URL では undefined。 */
  condition: fhir4.Condition | undefined;
  /** プロブレムの取得中か。取得前の undefined を「削除済み」と誤って出さないために要る。 */
  loading: boolean;
  /** 絞り込み済みのタイムライン。A/P の抜粋をここから引く。 */
  groups: KarteDayGroup[];
  /** まだ読み込んでいない古いデータが残っているか。抜粋が空のときの文言に使う。 */
  hasMore: boolean;
  onClear: () => void;
}

// 評価と計画(A/P)。まとめて 1 セクションに書く形と、評価(A)・治療計画(P)を
// 分ける形の両方がある。
const COMBINED_CODE = "51847-2";
const ASSESSMENT_CODE = "51848-0";
const PLAN_CODE = "18776-5";

function sectionText(note: fhir4.Composition, code: string): string {
  const section = note.section?.find((s) => s.code?.coding?.some((c) => c.code === code));
  return narrativePlainText(stripSchemaImageNotes(section?.text?.div));
}

// 記録 1 件から A/P の平文を作る。A と P が分かれている場合は見出しを添えて繋ぐ。
function noteAssessment(note: fhir4.Composition): string {
  const combined = sectionText(note, COMBINED_CODE);
  if (combined) return combined;
  return [ASSESSMENT_CODE, PLAN_CODE]
    .map((code) => ({ title: sectionTitle(code), body: sectionText(note, code) }))
    .filter((section) => section.body)
    .map((section) => `${section.title} ${section.body}`)
    .join(" / ");
}

// 読み込み済みの中で最も新しい「A/P を持つ」診療記録。直近の記録が S/O だけの
// こともあるので、見つかるまで遡る。
function latestAssessment(groups: KarteDayGroup[]): { day: string; text: string } | null {
  for (const group of groups) {
    for (const item of group.items) {
      if (item.kind !== "note") continue;
      const text = noteAssessment(item.note);
      if (text) return { day: item.day, text };
    }
  }
  return null;
}

export function KarteProblemSummary({
  condition,
  loading,
  groups,
  hasMore,
  onClear,
}: KarteProblemSummaryProps) {
  const clearButton = (
    <button type="button" className="karte-problem-summary__clear" onClick={onClear}>
      絞り込みを解除
    </button>
  );

  // 削除済みのプロブレムを指す URL でも、記録側には保存時の表示名が残っている。
  // 取得中はまだ「無い」とは言えないので、読み込み中として出す。
  if (!condition) {
    const saved = groups.flatMap((group) => group.items).map(itemProblem).find(Boolean);
    return (
      <section className="karte-problem-summary">
        <div className="karte-problem-summary__head">
          <h3 className="karte-problem-summary__title">
            {loading
              ? "読み込み中..."
              : saved?.display
                ? `${saved.display} (削除済み)`
                : "削除されたプロブレム"}
          </h3>
          {clearButton}
        </div>
      </section>
    );
  }

  const summary = summarizeCondition(condition);
  const assessment = latestAssessment(groups);
  const period = summary.startDate
    ? `${summary.startDate} 〜 ${summary.endDate}`
    : summary.endDate && `〜 ${summary.endDate}`;

  return (
    <section className="karte-problem-summary">
      <div className="karte-problem-summary__head">
        <h3 className="karte-problem-summary__title">{problemLabel(condition)}</h3>
        {summary.outcomeDisplay && (
          <span className="karte-problem-summary__outcome">{summary.outcomeDisplay}</span>
        )}
        {period && <span className="karte-problem-summary__dates">{period}</span>}
        {clearButton}
      </div>
      {assessment ? (
        <p className="karte-problem-summary__assessment">
          <span className="karte-problem-summary__assessment-day">{assessment.day}</span>
          {assessment.text}
        </p>
      ) : (
        hasMore && <p className="karte-problem-summary__assessment">読み込み中...</p>
      )}
    </section>
  );
}
