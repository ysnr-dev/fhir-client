import { useState } from "react";
import { useExamReportEntries, useUnreviewedReportIds } from "../api/queries";
import type { ExamReportConfig } from "../fhir/examReportHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { ExamReportDetailPanel } from "./ExamReportDetailPanel";
import { ExamReportEntryModal } from "./ExamReportEntryModal";
import { ResultReviewAction } from "./ResultReviewAction";
import { SpecimenDateList } from "./SpecimenDateList";

// カルテ画面の「放射線検査」「生理検査」「内視鏡」タブ(検査結果配下)。「病理検査」タブと同じ構成で、
// 左端のペインに検査日を新しい順で並べ、その右に選択したレポートの内容を表示する。
//
// レポートはオーダーに 1 件ずつ付き、実施した後にしか書けないので、ここに新規登録は置かない
// (部門一覧とカルテのカードから書く)。編集は部門一覧と同じ入力モーダルを開く。
//
// 表示対象は URL(view パラメータ)で表す。

interface KarteExamReportTabProps {
  config: ExamReportConfig;
  patientId: string;
  /** URL から渡される表示対象のレポート ID。空なら最新のレポート。 */
  view: string;
  onViewChange: (view: string | null) => void;
}

export function KarteExamReportTab({
  config,
  patientId,
  view,
  onViewChange,
}: KarteExamReportTabProps) {
  const [editing, setEditing] = useState(false);
  const { entries, isLoading, error } = useExamReportEntries(config, patientId);
  const unreviewed = useUnreviewedReportIds(patientId);
  const { labels } = config;

  // view が指すレポートが見つからないとき(削除済み・古いリンク)は最新に落とす。
  const selected = entries.find((entry) => entry.id === view) ?? entries[0];

  return (
    <div className="karte-tabpanel karte-lab">
      <SpecimenDateList
        title={`${labels.exam}日`}
        entries={entries}
        selectedId={selected?.id}
        isLoading={isLoading}
        unreviewedIds={unreviewed.data}
        onSelect={(reportId) => onViewChange(reportId)}
      />

      <div className="karte-lab__content">
        <div className="karte-tabpanel__header">
          <h3>{labels.report}</h3>
          <div className="karte-tabpanel__actions">
            {/* 確認は結果に記録を残す操作なので、編集のボタンから離して左端に置く。 */}
            {selected && <ResultReviewAction reportId={selected.id} />}
            <button
              type="button"
              disabled={!selected?.orderId}
              onClick={() => setEditing(true)}
            >
              編集
            </button>
          </div>
        </div>

        <ErrorBanner error={error} />

        {isLoading ? (
          <p>読み込み中...</p>
        ) : selected ? (
          <ExamReportDetailPanel config={config} reportId={selected.id} />
        ) : (
          <p className="patient-table__empty">{`登録されている${labels.report}がありません。`}</p>
        )}
      </div>

      {editing && selected?.orderId && (
        <ExamReportEntryModal
          config={config}
          orderId={selected.orderId}
          patientId={patientId}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}
