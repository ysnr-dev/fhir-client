import { useEffect, useMemo, useState } from "react";
import { useLabItemsByCodes } from "../api/masterQueries";
import { useLabOrderDetail, useLabResultDetail } from "../api/queries";
import {
  labOrderItemRequests,
  labOrderItems,
  labOrderLabel,
  serviceRequestsOf,
} from "../fhir/labOrderHelpers";
import {
  interpretationClass,
  labJlac11CodeOf,
  labTimelineKeyOf,
  observationLineDisplay,
  specimenNamesById,
  splitLabResultDetailBundle,
  summarizeDiagnosticReport,
} from "../fhir/labResultHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { FhirJsonView } from "./FhirJsonView";
import { LAB_CATEGORIES } from "./labOrderItemOptions";
import { LabResultTimelinePanel } from "./LabResultTimelinePanel";
import { Modal } from "./Modal";
import { RowMenu } from "./RowMenu";

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

// 検査分野が引けなかった項目(JLAC11 コードなし・マスタに無いコード)のまとめ先。
const UNKNOWN_CATEGORY = "その他";

interface LabResultCategoryGroup {
  category: string;
  observations: fhir4.Observation[];
}

// 検査項目を検査分野(生化学検査・血液学的検査など)ごとにまとめる。分野は Observation
// には持たないので、JLAC11 コードで引いた共有項目JLACコードマスタの区分名称を使う。
// 分野の並びはマスタ画面の選択肢と揃え、そこに無い分野は末尾に置く。
function groupByCategory(
  observations: fhir4.Observation[],
  categoryByCode: Map<string, string>,
): LabResultCategoryGroup[] {
  const groups = new Map<string, fhir4.Observation[]>();
  for (const obs of observations) {
    const category = categoryByCode.get(labJlac11CodeOf(obs)) || UNKNOWN_CATEGORY;
    const list = groups.get(category);
    if (list) list.push(obs);
    else groups.set(category, [obs]);
  }

  const rank = (category: string) => {
    const index = LAB_CATEGORIES.indexOf(category);
    return index < 0 ? LAB_CATEGORIES.length : index;
  };
  return [...groups.entries()]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([category, list]) => ({ category, observations: list }));
}

export function LabResultDetailPanel({ reportId }: { reportId: string }) {
  const detail = useLabResultDetail(reportId);
  const [checkedIds, setCheckedIds] = useState<ReadonlySet<string>>(new Set());
  const [copyResult, setCopyResult] = useState<"copied" | "failed" | null>(null);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);

  // 前後移動などで別の検査結果に切り替わったら選択状態をリセットする。
  useEffect(() => {
    setCheckedIds(new Set());
    setCopyResult(null);
    setTimelineOpen(false);
    setJsonOpen(false);
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

  // 検査分野でグループ化するため、項目の JLAC11 コードでマスタを引き直す。
  const jlac11Codes = useMemo(
    () => [...new Set(observations.map(labJlac11CodeOf).filter(Boolean))],
    [observations],
  );
  const masterItems = useLabItemsByCodes(jlac11Codes);
  const categoryByCode = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of masterItems.data?.items ?? []) {
      if (item.category_name) map.set(item.jlac11_code, item.category_name);
    }
    return map;
  }, [masterItems.data]);

  // マスタ照会中は分野が決まらないので、見出しを出さずに登録順のまま並べる。
  const groups = useMemo(
    () =>
      masterItems.isLoading
        ? [{ category: "", observations }]
        : groupByCategory(observations, categoryByCode),
    [masterItems.isLoading, observations, categoryByCode],
  );

  // コピーは画面に見えている並び(分野ごと)に合わせる。
  const checkedObservations = useMemo(
    () =>
      groups
        .flatMap((group) => group.observations)
        .filter((obs) => obs.id && checkedIds.has(obs.id)),
    [groups, checkedIds],
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
              {/* 短い 3 項目を 1 行に並べ、長い検体検査オーダーだけを次の行に置く。 */}
              <dl className="prescription-detail__common prescription-detail__common--lab">
                <dt>検体採取日</dt>
                <dd>{summary.date}</dd>
                <dt>入外区分</dt>
                <dd>{summary.settingDisplay}</dd>
                <dt>診療科</dt>
                <dd>{summary.departmentName || "-"}</dd>
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
              {/* 普段は使わない FHIR JSON 表示はケバブに畳む。 */}
              <RowMenu label="この検査結果の操作">
                <button
                  type="button"
                  className="row-menu__item"
                  onClick={() => setJsonOpen(true)}
                >
                  FHIR JSON を表示
                </button>
              </RowMenu>
            </div>

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
              {/* 分野ごとに tbody を分け、その先頭行を分野の見出しにする。 */}
              {groups.map((group) => (
                <tbody key={group.category}>
                  {group.category && (
                    <tr className="lab-result-detail__category">
                      <th colSpan={6}>{group.category}</th>
                    </tr>
                  )}
                  {group.observations.map((obs, index) => {
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
                        {/* 材料名称は長いものがあるので、はみ出す分は見切って全文はツールチップで読む。 */}
                        <td>
                          <span
                            className="lab-result-detail__specimen"
                            title={line.specimen || undefined}
                          >
                            {line.specimen || "-"}
                          </span>
                        </td>
                        <td
                          className={interpretationClass(line.interpretation, "rp-card__lab-value")}
                        >
                          {line.value || "-"}
                        </td>
                        <td className="rp-card__lab-unit">{line.unit || "-"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              ))}
            </table>

            {jsonOpen && (
              <Modal
                title="FHIR JSON(検査結果)"
                onClose={() => setJsonOpen(false)}
                className="modal--wide"
              >
                <FhirJsonView resource={detail.data?.data} />
              </Modal>
            )}

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
