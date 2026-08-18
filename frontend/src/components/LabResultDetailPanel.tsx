import { useEffect, useMemo, useState } from "react";
import { useLabOrderDetail, useLabResultDetail } from "../api/queries";
import {
  labOrderItemRequests,
  labOrderItems,
  labOrderLabel,
  serviceRequestsOf,
} from "../fhir/labOrderHelpers";
import {
  interpretationClass,
  labTimelineKeyOf,
  observationLineDisplay,
  specimenNamesById,
  splitLabResultDetailBundle,
  summarizeDiagnosticReport,
} from "../fhir/labResultHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { FhirJsonView } from "./FhirJsonView";
import { LabResultTimelinePanel } from "./LabResultTimelinePanel";
import { Modal } from "./Modal";

// 検査結果の内容表示。詳細ページとカルテ画面の検査結果タブの双方から使う。
// DO・編集・削除の操作ボタンと前後移動は、遷移先が異なるので呼び出し側が持つ。

// 紐付いている検体検査オーダーの 1 行要約。オーダーが削除済みでも検査結果自体は
// 表示できるようにしたいので、引けなかった場合は id だけを見せる。
function useLabOrderLabel(orderId: string | undefined): string {
  const order = useLabOrderDetail(orderId);
  if (!orderId) return "";
  if (order.isLoading) return "読み込み中...";

  const serviceRequests = serviceRequestsOf(order.data?.data);
  const header = serviceRequests.find((sr) => sr.id === orderId);
  if (!header) return `${orderId} (削除済み)`;

  return labOrderLabel(
    header,
    labOrderItems(header, labOrderItemRequests(serviceRequests, orderId)),
  );
}

export function LabResultDetailPanel({ reportId }: { reportId: string }) {
  const detail = useLabResultDetail(reportId);
  const [checkedIds, setCheckedIds] = useState<ReadonlySet<string>>(new Set());
  const [copyResult, setCopyResult] = useState<"copied" | "failed" | null>(null);
  const [timelineOpen, setTimelineOpen] = useState(false);

  // 前後移動などで別の検査結果に切り替わったら選択状態をリセットする。
  useEffect(() => {
    setCheckedIds(new Set());
    setCopyResult(null);
    setTimelineOpen(false);
  }, [reportId]);

  const { report, observations, specimens } = useMemo(
    () =>
      detail.data
        ? splitLabResultDetailBundle(detail.data.data)
        : { report: undefined, observations: [], specimens: [] },
    [detail.data],
  );
  const summary = report ? summarizeDiagnosticReport(report) : undefined;
  const specimenNames = specimenNamesById(specimens);
  const orderLabel = useLabOrderLabel(summary?.orderId);

  // 時系列表示は患者単位の検索なので、レポートの subject から患者 id を引く。
  const patientId = report?.subject?.reference?.split("/").pop() ?? "";
  const checkedObservations = useMemo(
    () => observations.filter((obs) => obs.id && checkedIds.has(obs.id)),
    [observations, checkedIds],
  );
  const timelineKeys = useMemo(
    () => new Set(checkedObservations.map(labTimelineKeyOf)),
    [checkedObservations],
  );

  function toggleChecked(id: string) {
    setCopyResult(null);
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  // チェックした項目の 略称・結果値・単位・H/L をタブ区切りでコピーする。
  // 略称がない項目は項目名で代用する。
  async function handleCopy() {
    const text = checkedObservations
      .map((obs) => {
        const line = observationLineDisplay(obs, specimenNames);
        return [line.abbreviation || line.name, line.value, line.unit, line.interpretation].join(
          "\t",
        );
      })
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopyResult("copied");
    } catch {
      setCopyResult("failed");
    }
  }

  return (
    <>
      <ErrorBanner error={detail.error} />

      {detail.isLoading ? (
        <p>読み込み中...</p>
      ) : (
        report &&
        summary && (
          <div className="prescription-detail">
            <fieldset>
              <legend>検査共通</legend>
              <dl className="prescription-detail__common">
                <dt>検体採取日</dt>
                <dd>{summary.date}</dd>
                <dt>入外区分</dt>
                <dd>{summary.settingDisplay}</dd>
                <dt>検体検査オーダー</dt>
                <dd>{summary.orderId ? orderLabel : "紐付けなし"}</dd>
              </dl>
            </fieldset>

            <div className="lab-result-detail__actions">
              <span className="lab-result-detail__copy-result" role="status">
                {copyResult === "copied" && "コピーしました。"}
                {copyResult === "failed" && "コピーに失敗しました。"}
              </span>
              <button
                type="button"
                disabled={checkedObservations.length === 0}
                onClick={handleCopy}
              >
                クリップボードにコピー
              </button>
              <button
                type="button"
                disabled={checkedObservations.length === 0 || !patientId}
                onClick={() => setTimelineOpen(true)}
              >
                時系列表示
              </button>
            </div>

            <fieldset className="rp-card">
              <legend>検査項目</legend>
              <table className="rp-card__medicines rp-card__medicines--detail rp-card__medicines--lab">
                <thead>
                  <tr>
                    <th className="rp-card__lab-check" />
                    <th>検査項目</th>
                    <th>略称</th>
                    <th>材料</th>
                    <th className="rp-card__lab-value">結果値</th>
                    <th className="rp-card__lab-unit">単位</th>
                  </tr>
                </thead>
                <tbody>
                  {observations.map((obs, index) => {
                    const line = observationLineDisplay(obs, specimenNames);
                    return (
                      <tr key={line.id || index}>
                        <td className="rp-card__lab-check">
                          <input
                            type="checkbox"
                            checked={Boolean(line.id) && checkedIds.has(line.id)}
                            disabled={!line.id}
                            onChange={() => line.id && toggleChecked(line.id)}
                          />
                        </td>
                        <td>{line.name || "-"}</td>
                        <td>{line.abbreviation || "-"}</td>
                        <td>{line.specimen || "-"}</td>
                        <td className={interpretationClass(line.interpretation, "rp-card__lab-value")}>
                          {line.value || "-"}
                        </td>
                        <td className="rp-card__lab-unit">{line.unit || "-"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </fieldset>

            <details className="prescription-detail__raw">
              <summary>FHIR JSON を表示</summary>
              <FhirJsonView resource={detail.data?.data} />
            </details>

            {timelineOpen && (
              <Modal
                title="時系列表示(選択項目)"
                onClose={() => setTimelineOpen(false)}
                className="modal--wide"
              >
                <LabResultTimelinePanel patientId={patientId} filterKeys={timelineKeys} />
              </Modal>
            )}
          </div>
        )
      )}
    </>
  );
}
