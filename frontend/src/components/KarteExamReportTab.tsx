import { useEffect, useState } from "react";
import { useExamReportEntries, useUnreviewedReportIds } from "../api/queries";
import type { ExamReportConfig } from "../fhir/examReportHelpers";
import { karteLinkLabel } from "../fhir/karteLinkHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { TruncatedNotice } from "./TruncatedNotice";
import { ExamReportCreatePanel } from "./ExamReportCreatePanel";
import { ExamReportDetailPanel } from "./ExamReportDetailPanel";
import { ExamReportEntry } from "./ExamReportEntryModal";
import { KarteLinkMenu } from "./KarteLinkMenu";
import { ResultReviewAction } from "./ResultReviewAction";
import { SpecimenDateList } from "./SpecimenDateList";

// カルテ画面の「放射線検査」「生理検査」「内視鏡」タブ(検査結果配下)。「病理検査」タブと同じ構成で、
// 左端のペインに検査日を新しい順で並べ、その右に選択したレポートの内容を表示する。
// 登録・編集もタブの中で行う(病理検査タブと同じく、内容表示をフォームに切り替える)。
//
// 表示対象は URL(view パラメータ)で表す。登録・編集は入力途中の内容を URL では
// 復元できないので、このコンポーネント内の状態に留める。

type FormMode = { kind: "create" } | { kind: "edit"; orderId: string };

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
  const [form, setForm] = useState<FormMode | null>(null);
  const { entries, isLoading, error, truncated } = useExamReportEntries(config, patientId);
  const unreviewed = useUnreviewedReportIds(patientId);
  const { labels } = config;

  // 戻る・進むで表示対象が変わったら、開いていたフォームは畳む。
  useEffect(() => setForm(null), [view]);

  // view が指すレポートが見つからないとき(削除済み・古いリンク)は最新に落とす。
  const selected = entries.find((entry) => entry.id === view) ?? entries[0];

  function closeForm() {
    setForm(null);
  }

  function handleCreated() {
    // 登録したレポート(たいてい検査日が最新)が選ばれるよう、最新表示に戻す。
    setForm(null);
    onViewChange(null);
  }

  if (form) {
    return (
      <div className="karte-tabpanel">
        <div className="karte-tabpanel__header">
          <h3>{`${labels.report}${form.kind === "edit" ? "編集" : "登録"}`}</h3>
          <div className="karte-tabpanel__actions">
            <button type="button" onClick={closeForm}>
              ← 内容表示に戻る
            </button>
          </div>
        </div>
        {form.kind === "create" ? (
          <ExamReportCreatePanel config={config} patientId={patientId} onSaved={handleCreated} />
        ) : (
          // 削除もこのフォームから行う。削除したら最新表示に戻す。
          <ExamReportEntry
            config={config}
            orderId={form.orderId}
            patientId={patientId}
            onDone={handleCreated}
          />
        )}
      </div>
    );
  }

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
            {/* 確認は結果に記録を残す操作なので、登録・編集のボタンから離して左端に置く。 */}
            {selected && <ResultReviewAction reportId={selected.id} />}
            <button type="button" onClick={() => setForm({ kind: "create" })}>
              新規登録
            </button>
            <button
              type="button"
              disabled={!selected?.orderId}
              onClick={() => selected && setForm({ kind: "edit", orderId: selected.orderId })}
            >
              編集
            </button>
            <KarteLinkMenu
              label={`この${labels.report}の操作`}
              patientId={patientId}
              link={
                selected
                  ? {
                      kind: config.detailKind,
                      resourceType: "DiagnosticReport",
                      id: selected.id,
                      label: karteLinkLabel(labels.report, selected.date),
                    }
                  : null
              }
            />
          </div>
        </div>

        <ErrorBanner error={error} />
        <TruncatedNotice show={truncated}>
          件数が多いため、古い結果の一部を表示できていません。
        </TruncatedNotice>

        {isLoading ? (
          <p>読み込み中...</p>
        ) : selected ? (
          <ExamReportDetailPanel config={config} reportId={selected.id} />
        ) : (
          <p className="patient-table__empty">{`登録されている${labels.report}がありません。`}</p>
        )}
      </div>
    </div>
  );
}
