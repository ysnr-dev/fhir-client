import { useEffect, useMemo, useState } from "react";
import { useLabResultItemsByCodes, useLabResultItemsByJlac11Codes } from "../api/masterQueries";
import { useLabOrderDetail, useLabResultDetail } from "../api/queries";
import {
  labOrderItemRequests,
  labOrderItems,
  labOrderLabel,
  serviceRequestsOf,
} from "../fhir/labOrderHelpers";
import {
  interpretationClass,
  isFinalReport,
  labReportInfo,
  labResultItemCodeOf,
  labTimelineKeyOf,
  legacyJlac11CodesOf,
  observationLineDisplay,
  resultItemAliases,
  specimenNamesById,
  splitLabResultDetailBundle,
  summarizeDiagnosticReport,
} from "../fhir/labResultHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { FhirJsonView } from "./FhirJsonView";
import { LAB_CATEGORIES } from "./labOrderItemOptions";
import { LabResultHistoryModal } from "./LabResultHistoryModal";
import { LabResultTimelinePanel } from "./LabResultTimelinePanel";
import { Modal } from "./Modal";
import { PictogramPopover } from "./PictogramPopover";
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

// 検査分野が引けなかった項目(結果項目コードなし・マスタに無いコード)のまとめ先。
const UNKNOWN_CATEGORY = "その他";

// 項目名セルのツールチップ。列を増やさずに済むよう、正式名称と測定法をここで読ませる。
function itemTooltip(name: string, method: string): string | undefined {
  return [name, method && `測定法: ${method}`].filter(Boolean).join("\n") || undefined;
}

function NoteIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        d="M2.5 3.5h11v7.5h-6.2L4.5 13.5V11h-2z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// 項目のコメント。列を増やさないよう行の右端に印だけ出し、押すとその場で中身を開く
// (患者帯のピクトグラムと同じ吹き出し)。
function LabResultNoteButton({ note }: { note: string }) {
  return (
    <PictogramPopover
      label={`コメント: ${note}`}
      className="lab-result-detail__note-icon"
      icon={<NoteIcon />}
    >
      <span className="patient-header__popover-text">{note}</span>
    </PictogramPopover>
  );
}

interface LabResultCategoryGroup {
  category: string;
  observations: fhir4.Observation[];
}

// 検査項目を検査分野(生化学検査・血液学的検査など)ごとにまとめる。分野は Observation
// には持たないので、結果項目コードで引いた結果項目マスタの検査分野を使う(結果項目マスタ
// 導入前の保存済み結果は JLAC11 で読み替える)。
// 分野の並びはマスタ画面の選択肢と揃え、そこに無い分野は末尾に置く。
function groupByCategory(
  observations: fhir4.Observation[],
  categoryByKey: Map<string, string>,
  aliases: Map<string, string>,
): LabResultCategoryGroup[] {
  const groups = new Map<string, fhir4.Observation[]>();
  for (const obs of observations) {
    const category = categoryByKey.get(labTimelineKeyOf(obs, aliases)) || UNKNOWN_CATEGORY;
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
  const [historyOpen, setHistoryOpen] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);

  // 前後移動などで別の検査結果に切り替わったら選択状態をリセットする。
  useEffect(() => {
    setCheckedIds(new Set());
    setCopyResult(null);
    setTimelineOpen(false);
    setHistoryOpen(false);
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
  const info = report ? labReportInfo(report) : undefined;
  const specimenNames = specimenNamesById(specimens);
  const orderLabel = useLabOrderLabel(summary?.orderId);

  // 時系列表示は患者単位の検索なので、レポートの subject から患者 id を引く。
  const patientId = report?.subject?.reference?.split("/").pop() ?? "";

  // 検査分野でグループ化するため、項目の結果項目コードでマスタを引き直す。
  // 結果項目マスタ導入前の保存済み結果(施設コード無し)は JLAC11 で引いて読み替える。
  const resultItemCodes = useMemo(
    () => [...new Set(observations.map(labResultItemCodeOf).filter(Boolean))],
    [observations],
  );
  const legacyCodes = useMemo(() => legacyJlac11CodesOf(observations), [observations]);
  const masterItems = useLabResultItemsByCodes(resultItemCodes);
  const legacyItems = useLabResultItemsByJlac11Codes(legacyCodes);
  const aliases = useMemo(
    () => resultItemAliases(legacyItems.data?.items ?? []),
    [legacyItems.data],
  );
  const categoryByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of [...(masterItems.data?.items ?? []), ...(legacyItems.data?.items ?? [])]) {
      if (item.category) map.set(`item:${item.result_item_code}`, item.category);
    }
    return map;
  }, [masterItems.data, legacyItems.data]);

  // マスタ照会中は分野が決まらないので、見出しを出さずに登録順のまま並べる。
  const groups = useMemo(
    () =>
      masterItems.isLoading || legacyItems.isLoading
        ? [{ category: "", observations }]
        : groupByCategory(observations, categoryByKey, aliases),
    [masterItems.isLoading, legacyItems.isLoading, observations, categoryByKey, aliases],
  );

  // コピーは画面に見えている並び(分野ごと)に合わせる。
  const checkedObservations = useMemo(
    () =>
      groups
        .flatMap((group) => group.observations)
        .filter((obs) => obs.id && checkedIds.has(obs.id)),
    [groups, checkedIds],
  );
  // 時系列表示と同じ読み替え(JLAC11 → 結果項目コード)でキーを作る。
  const timelineKeys = useMemo(
    () => new Set(checkedObservations.map((obs) => labTimelineKeyOf(obs, aliases))),
    [checkedObservations, aliases],
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
              {/* 短い項目を 4 組ずつ 2 行に並べ、長い検体検査オーダーだけを次の行に置く。 */}
              <dl className="prescription-detail__common prescription-detail__common--lab">
                <dt>検体採取日</dt>
                <dd>{summary.date}</dd>
                <dt>入外区分</dt>
                <dd>{summary.settingDisplay}</dd>
                <dt>診療科</dt>
                <dd>{summary.departmentName || "-"}</dd>
                <dt>報告区分</dt>
                <dd>
                  {/* 最終報告は素の文字、中間・訂正は最終化されていないことが分かるよう目立たせる。 */}
                  {info && !isFinalReport(info.status) ? (
                    <span className="micro-result__badge">{info.statusDisplay}</span>
                  ) : (
                    (info?.statusDisplay ?? "-")
                  )}
                </dd>
                <dt>報告日時</dt>
                <dd>{info?.issued || "-"}</dd>
                <dt>実施施設</dt>
                <dd>{info?.performer.organizationName || "-"}</dd>
                <dt>実施者</dt>
                <dd>{info?.performer.practitionerName || "-"}</dd>
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
              {/* 普段は使わない変更履歴・FHIR JSON 表示はケバブに畳む。 */}
              <RowMenu label="この検査結果の操作">
                <button
                  type="button"
                  className="row-menu__item"
                  disabled={checkedObservations.length === 0}
                  title={
                    checkedObservations.length === 0
                      ? "履歴を見る検査項目を選んでください"
                      : undefined
                  }
                  onClick={() => setHistoryOpen(true)}
                >
                  選択項目の変更履歴
                </button>
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
                  <th>材料</th>
                  <th className="rp-card__lab-value">結果値</th>
                  <th className="rp-card__lab-unit">単位</th>
                  <th className="rp-card__lab-unit">基準値</th>
                  {/* 項目のコメント。入る項目が限られるので、列は空のまま確保して印だけ出す。 */}
                  <th className="rp-card__lab-note" />
                </tr>
              </thead>
              {/* 分野ごとに tbody を分け、その先頭行を分野の見出しにする。 */}
              {groups.map((group) => (
                <tbody key={group.category}>
                  {group.category && (
                    <tr className="lab-result-detail__category">
                      <th colSpan={7}>{group.category}</th>
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
                        <td>
                          <span title={itemTooltip(line.name, line.method)}>
                            {line.abbreviation || line.name || "-"}
                          </span>
                        </td>
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
                        <td className="rp-card__lab-unit">{line.referenceRange || "-"}</td>
                        <td className="rp-card__lab-note">
                          {line.note && <LabResultNoteButton note={line.note} />}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              ))}
            </table>

            {/* 検査室の総合所見。検査項目を見てから読むものなので表の下に置く
                (書かれている結果だけ枠を出す)。 */}
            {info?.conclusion && (
              <fieldset>
                <legend>総合所見</legend>
                <p className="lab-result-detail__conclusion">{info.conclusion}</p>
              </fieldset>
            )}

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

            {historyOpen && (
              <LabResultHistoryModal
                observations={checkedObservations}
                specimenNames={specimenNames}
                onClose={() => setHistoryOpen(false)}
              />
            )}
          </div>
        )
      )}
    </>
  );
}
