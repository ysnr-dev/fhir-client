import type { ReactNode } from "react";
import type { KartePrintHistory } from "../api/queries";
import { clinicalNoteAttestation } from "../fhir/clinicalNoteHelpers";
import {
  karteDayHeadingLabel,
  karteItemKey,
  karteItemKindLabel,
  kartePrintColumn,
  type KarteDayGroup,
  type KarteTimelineItem,
} from "../fhir/karteTimeline";
import { dateTimeLabel } from "../lib/dates";
import { ClinicalNoteDetailPanel } from "./ClinicalNoteDetailPanel";
import { cardMeta, cardStatus, cardTitle } from "./karteCardLabels";
import { KarteCardBody, KarteCardVersionView } from "./KarteTimeline";
import { VersionDiffView } from "./VersionDiffView";

// カルテ 2 号用紙。日ごとに、左段に記録(既往症・原因・主要症状・経過等)、右段に
// 処方・注射・部門オーダー(処方・手術・処置等)を並べる。カードの本文は画面と同じ描き方
// (KarteCardBody)なので、文字の装飾・本文の画像・シェーマもそのまま印字される。
// 見出し(患者・期間)は表の thead に置き、ブラウザがページごとに繰り返す。

interface KartePrintDocumentProps {
  header: ReactNode;
  groups: KarteDayGroup[];
  /** 履歴を印刷しないときは undefined。 */
  history: KartePrintHistory | undefined;
}

// 履歴の版を描くときのプロブレムの名前は、版に保存してある表示名を使う(印刷では引き直さない)。
const NO_PROBLEMS = new Map<string, fhir4.Condition>();

// 差分で、変わった行の前後に残す行数。
const DIFF_CONTEXT = 1;

export function KartePrintDocument({ header, groups, history }: KartePrintDocumentProps) {
  return (
    <table className="karte-print__sheet">
      <thead>
        <tr>
          <th colSpan={2} className="karte-print__header">
            {header}
          </th>
        </tr>
        <tr>
          <th className="karte-print__column-title">既往症・原因・主要症状・経過等</th>
          <th className="karte-print__column-title">処方・手術・処置等</th>
        </tr>
      </thead>
      <tbody>
        {groups.length === 0 ? (
          <tr>
            <td colSpan={2} className="karte-print__empty">
              期間内の記録はありません。
            </td>
          </tr>
        ) : (
          groups.map((group) => (
            <KartePrintDay key={group.day} group={group} history={history} />
          ))
        )}
      </tbody>
    </table>
  );
}

function KartePrintDay({ group, history }: { group: KarteDayGroup; history: KartePrintHistory | undefined }) {
  const records = group.items.filter((item) => kartePrintColumn(item) === "record");
  const orders = group.items.filter((item) => kartePrintColumn(item) === "order");
  return (
    <>
      <tr className="karte-print__day">
        <td colSpan={2}>{karteDayHeadingLabel(group.day)}</td>
      </tr>
      <tr className="karte-print__row">
        <td>
          {records.map((item) => (
            <KartePrintCard key={karteItemKey(item)} item={item} history={history} />
          ))}
        </td>
        <td>
          {orders.map((item) => (
            <KartePrintCard key={karteItemKey(item)} item={item} history={history} />
          ))}
        </td>
      </tr>
    </>
  );
}

function KartePrintCard({ item, history }: { item: KarteTimelineItem; history: KartePrintHistory | undefined }) {
  const status = cardStatus(item);
  const meta = [status?.label, cardMeta(item)].filter(Boolean).join(" | ");
  return (
    <section className="karte-print__card">
      <div className="karte-print__card-head">
        <span className="karte-print__kind">{karteItemKindLabel(item)}</span>
        {cardTitle(item) && <span className="karte-print__title">{cardTitle(item)}</span>}
        {meta && <span className="karte-print__meta">{meta}</span>}
      </div>
      <KarteCardBody item={item} />
      {history && <KartePrintCardHistory item={item} history={history} />}
    </section>
  );
}

interface HistoryStep {
  label: string;
  before: ReactNode;
  after: ReactNode;
}

function historySteps(item: KarteTimelineItem, history: KartePrintHistory): HistoryStep[] {
  if (item.kind === "note") {
    const versions = history.notes.get(item.id) ?? [];
    return versions.slice(0, -1).map((version, index) => {
      const previous = versions[index + 1];
      const author = clinicalNoteAttestation(version)?.name || version.author?.[0]?.display;
      return {
        label: [
          `第${previous.meta?.versionId}版 → 第${version.meta?.versionId}版`,
          dateTimeLabel(version.meta?.lastUpdated),
          author,
        ]
          .filter(Boolean)
          .join(" "),
        before: <ClinicalNoteDetailPanel note={previous} />,
        after: <ClinicalNoteDetailPanel note={version} />,
      };
    });
  }
  const versions = history.cards.get(karteItemKey(item)) ?? [];
  return versions.slice(0, -1).map((version, index) => {
    const previous = versions[index + 1];
    return {
      label: `第${previous.versionNo}版 → 第${version.versionNo}版 ${dateTimeLabel(version.lastModified)}`,
      before: <KarteCardVersionView item={previous.item} problemsById={NO_PROBLEMS} />,
      after: <KarteCardVersionView item={version.item} problemsById={NO_PROBLEMS} />,
    };
  });
}

// 編集された記録だけに、新しい編集から順に 1 つ前の版との差分を添える。
function KartePrintCardHistory({ item, history }: { item: KarteTimelineItem; history: KartePrintHistory }) {
  const steps = historySteps(item, history);
  if (steps.length === 0) return null;
  return (
    <div className="karte-print__history">
      <div className="karte-print__history-title">変更履歴</div>
      {steps.map((step) => (
        <div className="karte-print__history-step" key={step.label}>
          <div className="karte-print__history-label">{step.label}</div>
          <VersionDiffView before={step.before} after={step.after} autoScroll={false} context={DIFF_CONTEXT} />
        </div>
      ))}
    </div>
  );
}
