import { usePathoOrderDetail, usePathoResultDetail } from "../api/queries";
import { serviceRequestsOf } from "../fhir/labOrderHelpers";
import {
  isCytologyCategory,
  pathoOrderItemRequests,
  pathoOrderLabel,
} from "../fhir/pathoOrderHelpers";
import {
  cytoJudgementDisplay,
  parsePathoResultForm,
  reportStatusDisplay,
  resultSpecimenLabel,
  splitPathoResultDetailBundle,
  type PathoResultFormValues,
} from "../fhir/pathoResultHelpers";
import { ErrorBanner } from "./ErrorBanner";

// 病理診断レポートの内容表示。カルテ画面の病理タブと、カルテカードの詳細モーダル、
// 部門一覧の双方から使う。操作ボタンと前後移動は呼び出し側が持つ。

// 紐付いている病理検査オーダーの 1 行要約。オーダーが削除済みでもレポート自体は
// 表示できるようにしたいので、引けなかった場合は id だけを見せる。
function usePathoOrderLabel(orderId: string | undefined): string {
  const order = usePathoOrderDetail(orderId);
  if (!orderId) return "";
  if (order.isLoading) return "読み込み中...";

  const serviceRequests = serviceRequestsOf(order.data?.data);
  const header = serviceRequests.find((sr) => sr.id === orderId);
  if (!header) return `${orderId} (削除済み)`;

  return pathoOrderLabel(header, pathoOrderItemRequests(serviceRequests, orderId));
}

// 未入力のセクション(規約上どれも任意)は行ごと省く。
function FindingSection({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <fieldset>
      <legend>{label}</legend>
      <p className="patho-result__text">{value}</p>
    </fieldset>
  );
}

/** 報告区分のバッジ。中間・修正は目立たせ、最終報告は素の文字で出す。 */
export function ReportStatusBadge({ status }: { status: string }) {
  if (status === "preliminary" || status === "amended") {
    return <span className="micro-result__badge">{reportStatusDisplay(status)}</span>;
  }
  return <>{reportStatusDisplay(status) || "-"}</>;
}

function DiagnosisFieldset({ values }: { values: PathoResultFormValues }) {
  // 診断は規約でレポートに必須のセクションなので、未入力でも枠は残す。
  if (isCytologyCategory(values.examCategory)) {
    return (
      <fieldset>
        <legend>診断</legend>
        <dl className="prescription-detail__common">
          <dt>判定</dt>
          <dd>{cytoJudgementDisplay(values.cytoJudgement) || "-"}</dd>
          <dt>推定病変</dt>
          <dd>{values.estimatedLesion || "-"}</dd>
        </dl>
      </fieldset>
    );
  }
  return (
    <fieldset>
      <legend>診断</legend>
      <p className="patho-result__text">{values.diagnosis || "-"}</p>
    </fieldset>
  );
}

export function PathoResultDetailPanel({ reportId }: { reportId: string }) {
  const detail = usePathoResultDetail(reportId);

  const { report, observations, specimens } = detail.data
    ? splitPathoResultDetailBundle(detail.data.data)
    : { report: undefined, observations: [], specimens: [] };
  const values = report ? parsePathoResultForm(report, observations, specimens) : undefined;
  const orderLabel = usePathoOrderLabel(values?.orderId);

  return (
    <>
      <ErrorBanner error={detail.error} />

      {detail.isLoading ? (
        <p>読み込み中...</p>
      ) : (
        report &&
        values && (
          <div className="prescription-detail">
            <fieldset>
              <legend>報告共通</legend>
              <dl className="prescription-detail__common prescription-detail__common--micro">
                <dt>報告日</dt>
                <dd>{values.reportDate}</dd>
                <dt>入外区分</dt>
                <dd>
                  {values.setting === "inpatient"
                    ? "入院"
                    : values.setting === "outpatient"
                      ? "外来"
                      : "-"}
                </dd>
                <dt>診療科</dt>
                <dd>{values.departmentName || "-"}</dd>
                <dt>報告区分</dt>
                <dd>
                  <ReportStatusBadge status={report.status} />
                </dd>
                <dt>病理検査オーダー</dt>
                <dd>{values.orderId ? orderLabel : "紐付けなし"}</dd>
              </dl>
            </fieldset>

            <fieldset>
              <legend>検体情報</legend>
              <table className="rp-card__medicines rp-card__medicines--patho">
                <thead>
                  <tr>
                    <th>№</th>
                    <th>臓器・検体</th>
                    <th className="rp-card__patho-date">採取日</th>
                  </tr>
                </thead>
                <tbody>
                  {values.specimens.map((specimen, index) => (
                    <tr key={specimen.id ?? index}>
                      <td>{index + 1}</td>
                      <td>{resultSpecimenLabel(specimen)}</td>
                      <td className="rp-card__patho-date">{specimen.collectedDate || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {values.specimens.length === 0 && (
                <p className="patient-table__empty">検体情報がありません。</p>
              )}
            </fieldset>

            <FindingSection label="肉眼所見" value={values.gross} />
            <FindingSection label="顕微鏡所見" value={values.microscopic} />
            <DiagnosisFieldset values={values} />
            <FindingSection label="採取法／検体処理法" value={values.procedureStep} />
          </div>
        )
      )}
    </>
  );
}
