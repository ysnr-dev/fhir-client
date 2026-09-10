import { useMemo } from "react";
import { useLabObservationHistories } from "../api/queries";
import {
  interpretationClass,
  labInstantLabel,
  labReportStatusDisplay,
  observationLineDisplay,
} from "../fhir/labResultHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

// 検査項目の変更履歴。訂正報告で値がどう変わったかを、上流の _history から読む。
// 版そのものを描くので、行の作り方は内容表示と同じ observationLineDisplay を使う。
//
// 履歴の照会は 1 項目 1 リクエストになるため、内容表示でチェックした項目だけを対象にする
// (レポートの全項目を毎回引くと数十回の照会になる)。

interface LabResultHistoryModalProps {
  /** 内容表示でチェックした検査項目。並びは画面の並びのまま。 */
  observations: fhir4.Observation[];
  /** 材料名の解決(内容表示と同じ表示にするため)。 */
  specimenNames: Map<string, string>;
  onClose: () => void;
}

export function LabResultHistoryModal({
  observations,
  specimenNames,
  onClose,
}: LabResultHistoryModalProps) {
  const ids = useMemo(
    () => observations.map((obs) => obs.id).filter((id): id is string => Boolean(id)),
    [observations],
  );
  const { data, isLoading, error } = useLabObservationHistories(ids);
  const namesById = useMemo(
    () =>
      new Map(
        observations.flatMap((obs) => {
          const line = observationLineDisplay(obs, specimenNames);
          return obs.id ? [[obs.id, line.abbreviation || line.name] as [string, string]] : [];
        }),
      ),
    [observations, specimenNames],
  );

  return (
    <Modal title="変更履歴(選択項目)" onClose={onClose} className="modal--wide">
      <ErrorBanner error={error} />
      {isLoading ? (
        <p>読み込み中...</p>
      ) : (
        (data ?? []).map((history) => (
          <section key={history.id} className="lab-result-history__item">
            <h4 className="lab-result-history__name">{namesById.get(history.id) || "-"}</h4>
            {history.versions.length === 0 ? (
              <p className="patient-table__empty">履歴がありません。</p>
            ) : (
              <table className="lab-result-history__table">
                <thead>
                  <tr>
                    <th>版</th>
                    <th>更新日時</th>
                    <th>報告区分</th>
                    <th>結果値</th>
                    <th>単位</th>
                    <th>基準値</th>
                    <th>コメント</th>
                  </tr>
                </thead>
                <tbody>
                  {history.versions.map((version, index) => {
                    const line = observationLineDisplay(version, specimenNames);
                    const versionId = version.meta?.versionId ?? "";
                    return (
                      <tr key={versionId || index}>
                        <td>
                          第{versionId || history.versions.length - index}版
                          {index === 0 && "(最新)"}
                        </td>
                        <td>
                          {version.meta?.lastUpdated
                            ? labInstantLabel(version.meta.lastUpdated)
                            : "-"}
                        </td>
                        <td>{labReportStatusDisplay(version.status) || "-"}</td>
                        <td className={interpretationClass(line.interpretation, "rp-card__lab-value")}>
                          {line.value || "-"}
                        </td>
                        <td className="rp-card__lab-unit">{line.unit || "-"}</td>
                        <td className="rp-card__lab-unit">{line.referenceRange || "-"}</td>
                        <td>{line.note || "-"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        ))
      )}
    </Modal>
  );
}
