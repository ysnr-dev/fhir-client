import { useMicroOrderDetail, useMicroResultDetail } from "../api/queries";
import { serviceRequestsOf } from "../fhir/labOrderHelpers";
import { microOrderItemRequests, microOrderLabel } from "../fhir/microOrderHelpers";
import {
  CAUSATIVE_OPTIONS,
  COLONY_COUNT_OPTIONS,
  GECKLER_OPTIONS,
  GRADE_OPTIONS,
  MILLER_JONES_OPTIONS,
  PYURIA_METHOD_OPTIONS,
  PYURIA_RESULT_OPTIONS,
  QUANTITY_TYPE_OPTIONS,
  CULTURE_OPTIONS,
  isolateLabel,
  micDisplay,
  optionDisplay,
  parseMicroResultForm,
  reportStatusDisplay,
  splitMicroResultDetailBundle,
  type MicroResultFormValues,
} from "../fhir/microResultHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { FhirJsonView } from "./FhirJsonView";

// 細菌検査結果の内容表示。カルテ画面の細菌検査タブと、カルテカードの
// 詳細モーダルの双方から使う。操作ボタンと前後移動は呼び出し側が持つ。

// 紐付いている細菌検査オーダーの 1 行要約。オーダーが削除済みでも結果自体は
// 表示できるようにしたいので、引けなかった場合は id だけを見せる。
function useMicroOrderLabel(orderId: string | undefined): string {
  const order = useMicroOrderDetail(orderId);
  if (!orderId) return "";
  if (order.isLoading) return "読み込み中...";

  const serviceRequests = serviceRequestsOf(order.data?.data);
  const header = serviceRequests.find((sr) => sr.id === orderId);
  if (!header) return `${orderId} (削除済み)`;

  return microOrderLabel(header, microOrderItemRequests(serviceRequests, orderId));
}

// 空値を「-」ではなく行ごと省く表示。細菌検査は未実施の所見が多いため。
function DefinitionRow({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

function FindingsFieldset({ values }: { values: MicroResultFormValues }) {
  return (
    <fieldset>
      <legend>検体所見</legend>
      <dl className="prescription-detail__common">
        <DefinitionRow label="材料" value={values.specimenTypeName} />
        <DefinitionRow
          label="培養結果"
          value={values.culture ? optionDisplay(CULTURE_OPTIONS, values.culture) : ""}
        />
        <DefinitionRow
          label="Miller&Jones分類"
          value={values.millerJones ? optionDisplay(MILLER_JONES_OPTIONS, values.millerJones) : ""}
        />
        <DefinitionRow
          label="Geckler分類"
          value={values.geckler ? optionDisplay(GECKLER_OPTIONS, values.geckler) : ""}
        />
        <DefinitionRow
          label="膿尿評価法"
          value={
            values.pyuriaMethod ? optionDisplay(PYURIA_METHOD_OPTIONS, values.pyuriaMethod) : ""
          }
        />
        <DefinitionRow
          label="膿尿評価結果"
          value={
            values.pyuriaResult ? optionDisplay(PYURIA_RESULT_OPTIONS, values.pyuriaResult) : ""
          }
        />
      </dl>
      {values.smear && (
        <div className="micro-result-detail__smear">
          <span className="micro-result-detail__smear-label">塗抹・鏡検所見</span>
          <p>{values.smear}</p>
        </div>
      )}
    </fieldset>
  );
}

export function MicroResultDetailPanel({ reportId }: { reportId: string }) {
  const detail = useMicroResultDetail(reportId);

  const { report, observations, specimens } = detail.data
    ? splitMicroResultDetailBundle(detail.data.data)
    : { report: undefined, observations: [], specimens: [] };
  const values = report ? parseMicroResultForm(report, observations, specimens) : undefined;
  const orderLabel = useMicroOrderLabel(values?.orderId);

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
              <legend>検査共通</legend>
              {/* 短い 4 項目を 1 行に並べ、長い細菌検査オーダーだけを次の行に置く。 */}
              <dl className="prescription-detail__common prescription-detail__common--micro">
                <dt>検体採取日</dt>
                <dd>{values.specimenDate}</dd>
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
                  {values.reportStatus === "preliminary" ? (
                    <span className="micro-result__badge">中間報告</span>
                  ) : (
                    reportStatusDisplay(values.reportStatus)
                  )}
                </dd>
                <dt>細菌検査オーダー</dt>
                <dd>{values.orderId ? orderLabel : "紐付けなし"}</dd>
              </dl>
            </fieldset>

            <FindingsFieldset values={values} />

            {values.isolates.map((isolate, index) => (
              <fieldset key={isolate.id ?? index} className="rp-card">
                <legend>分離菌 {isolateLabel(index)}</legend>
                <dl className="prescription-detail__common">
                  {/* 菌名は分離菌ごとの塊を追う手がかりなので、他の所見と違って
                      未入力でも行を残し、値を一段強めて出す。 */}
                  <dt>菌名</dt>
                  <dd className="micro-result-detail__organism">
                    {isolate.organismName || "-"}
                  </dd>
                  <DefinitionRow
                    label="菌量"
                    value={
                      isolate.quantityType
                        ? optionDisplay(QUANTITY_TYPE_OPTIONS, isolate.quantityType)
                        : ""
                    }
                  />
                  <DefinitionRow
                    label="菌数"
                    value={
                      isolate.colonyCount
                        ? optionDisplay(COLONY_COUNT_OPTIONS, isolate.colonyCount)
                        : ""
                    }
                  />
                  <DefinitionRow
                    label="起炎性"
                    value={
                      isolate.causative ? optionDisplay(CAUSATIVE_OPTIONS, isolate.causative) : ""
                    }
                  />
                </dl>

                {isolate.susceptibilities.length > 0 && (
                  <table className="rp-card__medicines micro-result-detail__susceptibility">
                    <thead>
                      <tr>
                        <th>抗菌薬</th>
                        <th>測定法</th>
                        <th>MIC(µg/mL)</th>
                        <th>阻止円(mm)</th>
                        <th>判定</th>
                        <th>判定(+)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {isolate.susceptibilities.map((row, rowIndex) => (
                        <tr key={row.id ?? rowIndex}>
                          {/* 薬剤名は長く列が潰れるので略号だけを出し、名称はツールチップで読む。
                              略号が無いマスタもあるため、その場合は名称で代用する。 */}
                          <td title={row.drugName || undefined}>
                            {row.drugAbbreviation || row.drugName || "-"}
                          </td>
                          {/* 測定法も長いので、はみ出す分は見切って全文はツールチップで読む。 */}
                          <td>
                            <span
                              className="micro-result-detail__method"
                              title={row.methodName || undefined}
                            >
                              {row.methodName || "-"}
                            </span>
                          </td>
                          <td>{micDisplay(row) || "-"}</td>
                          <td>{row.zone || "-"}</td>
                          <td
                            className={
                              row.sir === "R"
                                ? "micro-result-detail__sir micro-result-detail__sir--resistant"
                                : "micro-result-detail__sir"
                            }
                          >
                            {row.sir || "-"}
                          </td>
                          <td>{row.grade ? optionDisplay(GRADE_OPTIONS, row.grade) : "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </fieldset>
            ))}

            <details className="prescription-detail__raw">
              <summary>FHIR JSON を表示</summary>
              <FhirJsonView resource={detail.data?.data} />
            </details>
          </div>
        )
      )}
    </>
  );
}
