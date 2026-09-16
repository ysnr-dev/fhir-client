import { useMemo } from "react";
import { useCurrentPractitioner } from "../api/authQueries";
import { useRadItemsByCodes } from "../api/masterQueries";
import {
  useDeleteRadReport,
  useRadOrderDetail,
  useRadPerformDetail,
  useRadReportByOrder,
  useSaveRadReport,
  useSelfOrganization,
} from "../api/queries";
import { serviceRequestsOf } from "../fhir/labOrderHelpers";
import { organizationDisplayName } from "../fhir/organizationHelpers";
import { isPatientMismatch } from "../fhir/patientHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { radOrderItemRequests, radOrderItems } from "../fhir/radOrderHelpers";
import {
  buildRadReportBundle,
  emptyRadReportForm,
  parseRadReportForm,
  radReportObservationIds,
  radReportResponseIds,
  splitRadReportBundle,
  type RadReportFormValues,
} from "../fhir/radReportHelpers";
import {
  radPerformsByOrderId,
  splitRadPerformBundle,
  type RadPerformDisplay,
} from "../fhir/radResultHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";
import { RadOrderDetailPanel } from "./RadOrderDetailPanel";
import { RadReportForm } from "./RadReportForm";

// 読影レポートの登録・編集(docs/rad-report-design.md §4.1)。放射線検査一覧の「読影」と
// カルテの放射線カードの双方から開く。オーダー 1 件に読影レポート 1 件なので、オーダー id を
// 受けて、レポートがあれば編集、無ければ登録として開く。
//
// 読影医が臨床情報と造影の有無を見て読めるよう、依頼内容と実施情報を上に畳んで出す。

export function RadReportEntryModal({
  orderId,
  patientId,
  title,
  onClose,
}: {
  orderId: string;
  patientId: string;
  /** モーダルの見出しに添える患者名など。 */
  title?: string;
  onClose: () => void;
}) {
  const order = useRadOrderDetail(orderId);
  const perform = useRadPerformDetail(orderId);
  const existing = useRadReportByOrder(orderId);
  const save = useSaveRadReport();
  const remove = useDeleteRadReport();
  const selfOrganization = useSelfOrganization();
  const { practitionerId, practitioner } = useCurrentPractitioner();

  const serviceRequests = serviceRequestsOf(order.data?.data);
  const header = serviceRequests.find((request) => request.id === orderId);
  const itemRequests = useMemo(
    () => radOrderItemRequests(serviceRequests, orderId),
    // serviceRequests は取得結果から毎回作り直すので、元の Bundle で覚える。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [order.data, orderId],
  );
  const performed = useMemo(() => splitRadPerformBundle(perform.data?.data), [perform.data]);
  const performs: RadPerformDisplay[] =
    radPerformsByOrderId(performed.procedures, performed.administrations, performed.observations).get(
      orderId,
    ) ?? [];
  const { report, observations } = splitRadReportBundle(existing.data?.data);

  // 所見の既定テンプレートは撮影項目マスタが持つ。複数の撮影項目を含むオーダーは最初の項目の既定。
  const itemCodes = header ? radOrderItems(header, itemRequests).map((item) => item.code) : [];
  const master = useRadItemsByCodes(itemCodes);
  const defaultFindingsCanonical =
    itemCodes
      .map((code) => master.data?.items.find((item) => item.item_code === code))
      .find((item) => item?.report_findings_template_canonical)?.report_findings_template_canonical ??
    undefined;

  const loading = order.isLoading || perform.isLoading || existing.isLoading;
  const mismatch = isPatientMismatch(patientId, header?.subject);

  const initialValues = useMemo<RadReportFormValues | null>(() => {
    if (loading || !header) return null;
    return report
      ? parseRadReportForm(report, observations)
      : emptyRadReportForm(header, itemRequests, performed.procedures);
    // 初期値はフォームを開いたときに 1 回だけ使う(RadReportForm が useState の初期値として読む)。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, header?.id, report?.id]);

  function handleSubmit(values: RadReportFormValues) {
    if (mismatch) return;
    // 読影医と発行施設は画面に出さず、空のときだけ入れる(編集しても最初の読影医が残る)。
    const organization = selfOrganization.organization;
    const filled: RadReportFormValues = {
      ...values,
      interpreterId: values.interpreterId || (practitionerId ?? ""),
      interpreterName:
        values.interpreterName || (practitioner ? practitionerDisplayName(practitioner) : ""),
      organizationId: values.organizationId || (organization?.id ?? ""),
      organizationName:
        values.organizationName || (organization ? organizationDisplayName(organization) : ""),
    };
    const bundle = buildRadReportBundle(filled, patientId, {
      reportId: report?.id,
      originalObservationIds: report ? radReportObservationIds(report) : [],
      originalResponseIds: report ? radReportResponseIds(report) : [],
    });
    save.mutate(bundle, { onSuccess: onClose });
  }

  function handleDelete() {
    if (!report?.id) return;
    if (!window.confirm("この読影レポートを削除します。よろしいですか?")) return;
    remove.mutate(report.id, { onSuccess: onClose });
  }

  return (
    <Modal
      title={`${report ? "読影レポート編集" : "読影レポート登録"}${title ? ` - ${title}` : ""}`}
      onClose={onClose}
      className="modal--wide"
    >
      <ErrorBanner error={order.error ?? perform.error ?? existing.error} />
      <ErrorBanner error={remove.error} />
      {loading ? (
        <p>読み込み中...</p>
      ) : mismatch ? (
        <p className="patient-table__empty">指定された放射線検査は別の患者のものです。</p>
      ) : !header || !initialValues ? (
        <p className="patient-table__empty">
          この放射線検査は見つかりません(削除された可能性があります)。
        </p>
      ) : (
        <>
          <details className="rad-report-entry__order" open={!report}>
            <summary>依頼内容</summary>
            <RadOrderDetailPanel serviceRequest={header} itemRequests={itemRequests} />
            <RadPerformSummary performs={performs} />
          </details>
          {report && (
            <div className="rad-report-entry__actions">
              <button type="button" disabled={remove.isPending} onClick={handleDelete}>
                読影レポートを削除
              </button>
            </div>
          )}
          <RadReportForm
            key={report?.id ?? "new"}
            patientId={patientId}
            initialValues={initialValues}
            defaultFindingsCanonical={defaultFindingsCanonical}
            onSubmit={handleSubmit}
            submitting={save.isPending}
            submitError={save.error}
            submitLabel={report ? "更新" : "登録"}
          />
        </>
      )}
    </Modal>
  );
}

// 実施情報(撮影日時・造影剤・被曝線量)。読影で造影の有無と条件を確かめるために出す。
function RadPerformSummary({ performs }: { performs: RadPerformDisplay[] }) {
  if (performs.length === 0) return null;
  return (
    <fieldset className="rad-report-entry__perform">
      <legend>実施情報</legend>
      {performs.map((perform) => (
        <dl className="prescription-detail__common" key={perform.id}>
          <dt>実施日時</dt>
          <dd>{perform.performedAt || "-"}</dd>
          <dt>造影剤</dt>
          <dd>{perform.contrasts.join("、") || "なし"}</dd>
          <dt>被曝線量</dt>
          <dd>{perform.doses.join("、") || "-"}</dd>
          {perform.comment && (
            <>
              <dt>コメント</dt>
              <dd className="patho-result__text">{perform.comment}</dd>
            </>
          )}
        </dl>
      ))}
    </fieldset>
  );
}
