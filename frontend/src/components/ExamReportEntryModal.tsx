import { Fragment, useMemo, type ComponentType } from "react";
import { useCurrentPractitioner } from "../api/authQueries";
import {
  useEndoscopyItemsByCodes,
  usePhysioItemsByCodes,
  useRadItemsByCodes,
} from "../api/masterQueries";
import {
  useDeleteExamReport,
  useEndoscopyOrderDetail,
  useEndoscopyPerformDetail,
  useExamReportByOrder,
  usePhysioOrderDetail,
  usePhysioPerformDetail,
  useRadOrderDetail,
  useRadPerformDetail,
  useSaveExamReport,
  useSelfOrganization,
} from "../api/queries";
import { endoscopyOrderItemRequests, endoscopyOrderItems } from "../fhir/endoscopyOrderHelpers";
import { endoscopyPerformsByOrderId } from "../fhir/endoscopyResultHelpers";
import {
  buildExamReportBundle,
  emptyExamReportForm,
  examReportObservationIds,
  examReportResponseIds,
  parseExamReportForm,
  splitExamReportBundle,
  type ExamReportConfig,
  type ExamReportFormValues,
  type ExamReportKind,
} from "../fhir/examReportHelpers";
import { serviceRequestsOf } from "../fhir/labOrderHelpers";
import { organizationDisplayName } from "../fhir/organizationHelpers";
import { isPatientMismatch } from "../fhir/patientHelpers";
import { physioOrderItemRequests, physioOrderItems } from "../fhir/physioOrderHelpers";
import { physioPerformsByOrderId } from "../fhir/physioResultHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { radOrderItemRequests, radOrderItems } from "../fhir/radOrderHelpers";
import { radPerformsByOrderId, splitPerformBundle } from "../fhir/radResultHelpers";
import { EndoscopyOrderDetailPanel } from "./EndoscopyOrderDetailPanel";
import { ErrorBanner } from "./ErrorBanner";
import { ExamReportForm } from "./ExamReportForm";
import { Modal } from "./Modal";
import { PhysioOrderDetailPanel } from "./PhysioOrderDetailPanel";
import { RadOrderDetailPanel } from "./RadOrderDetailPanel";

// 検査レポート(読影・生理検査・内視鏡の所見)の登録・編集(docs/rad-report-design.md §4.1)。
// 部門一覧のボタンとカルテのカードはモーダルで、カルテの検査結果タブはタブの中で開く。
// オーダー 1 件にレポート 1 件なので、オーダー id を
// 受けて、レポートがあれば編集、無ければ登録として開く。
//
// 記載医が臨床情報と実施内容(造影の有無・前処置の薬剤など)を見て書けるよう、依頼内容と
// 実施情報を上に畳んで出す。

/** 実施情報の 1 行ぶん(見出しと値)。種別ごとに並べる項目が違う。 */
type PerformRow = { label: string; value: string };

/** 種別ごとに違う部品(オーダー・実施記録の取得、依頼内容の表示、既定テンプレートの引き方)。 */
interface OrderAdapter {
  useOrderDetail: typeof useRadOrderDetail;
  usePerformDetail: typeof useRadPerformDetail;
  itemRequestsOf(serviceRequests: fhir4.ServiceRequest[], orderId: string): fhir4.ServiceRequest[];
  itemCodesOf(order: fhir4.ServiceRequest, itemRequests: fhir4.ServiceRequest[]): string[];
  useItemsByCodes(codes: string[]): {
    data?: { items: { item_code: string; report_findings_template_canonical: string | null }[] };
  };
  OrderDetailPanel: ComponentType<{
    serviceRequest: fhir4.ServiceRequest;
    itemRequests: fhir4.ServiceRequest[];
  }>;
  performRows(bundle: fhir4.Bundle | undefined, orderId: string): { id: string; rows: PerformRow[] }[];
}

const joined = (values: string[], empty = "-") => values.join("、") || empty;

const ADAPTERS: Record<ExamReportKind, OrderAdapter> = {
  rad: {
    useOrderDetail: useRadOrderDetail,
    usePerformDetail: useRadPerformDetail,
    itemRequestsOf: radOrderItemRequests,
    itemCodesOf: (order, itemRequests) => radOrderItems(order, itemRequests).map((item) => item.code),
    useItemsByCodes: useRadItemsByCodes,
    OrderDetailPanel: RadOrderDetailPanel,
    // 読影で造影の有無と条件を確かめるために、造影剤と被曝線量を出す。
    performRows: (bundle, orderId) => {
      const { procedures, administrations, observations } = splitPerformBundle(bundle);
      return (radPerformsByOrderId(procedures, administrations, observations).get(orderId) ?? []).map(
        (perform) => ({
          id: perform.id,
          rows: [
            { label: "実施日時", value: perform.performedAt || "-" },
            { label: "造影剤", value: joined(perform.contrasts, "なし") },
            { label: "被曝線量", value: joined(perform.doses) },
            ...(perform.comment ? [{ label: "コメント", value: perform.comment }] : []),
          ],
        }),
      );
    },
  },
  physio: {
    useOrderDetail: usePhysioOrderDetail,
    usePerformDetail: usePhysioPerformDetail,
    itemRequestsOf: physioOrderItemRequests,
    itemCodesOf: (order, itemRequests) => physioOrderItems(order, itemRequests).map((item) => item.code),
    useItemsByCodes: usePhysioItemsByCodes,
    OrderDetailPanel: PhysioOrderDetailPanel,
    performRows: (bundle, orderId) => {
      const { procedures, administrations } = splitPerformBundle(bundle);
      return (physioPerformsByOrderId(procedures, administrations).get(orderId) ?? []).map(
        (perform) => ({
          id: perform.id,
          rows: [
            { label: "実施日時", value: perform.performedAt || "-" },
            { label: "実施者", value: perform.performerName || "-" },
            { label: "手技", value: joined(perform.procedures) },
            { label: "薬剤", value: joined(perform.medicines, "なし") },
            ...(perform.comment ? [{ label: "コメント", value: perform.comment }] : []),
          ],
        }),
      );
    },
  },
  endoscopy: {
    useOrderDetail: useEndoscopyOrderDetail,
    usePerformDetail: useEndoscopyPerformDetail,
    itemRequestsOf: endoscopyOrderItemRequests,
    itemCodesOf: (order, itemRequests) =>
      endoscopyOrderItems(order, itemRequests).map((item) => item.code),
    useItemsByCodes: useEndoscopyItemsByCodes,
    OrderDetailPanel: EndoscopyOrderDetailPanel,
    // 前処置・鎮静の薬剤と、生検などの追加手技を所見と突き合わせるために出す。
    performRows: (bundle, orderId) => {
      const { procedures, administrations } = splitPerformBundle(bundle);
      return (endoscopyPerformsByOrderId(procedures, administrations).get(orderId) ?? []).map(
        (perform) => ({
          id: perform.id,
          rows: [
            { label: "実施日時", value: perform.performedAt || "-" },
            { label: "実施者", value: perform.performerName || "-" },
            { label: "手技", value: joined(perform.procedures) },
            { label: "薬剤", value: joined(perform.medicines, "なし") },
            ...(perform.comment ? [{ label: "コメント", value: perform.comment }] : []),
          ],
        }),
      );
    },
  },
};

export function ExamReportEntryModal({
  config,
  orderId,
  patientId,
  title,
  onClose,
}: {
  config: ExamReportConfig;
  orderId: string;
  patientId: string;
  /** モーダルの見出しに添える患者名など。 */
  title?: string;
  onClose: () => void;
}) {
  // 見出しの登録 / 編集の判定。本体(ExamReportEntry)と同じ検索なのでキャッシュを共有する。
  const existing = useExamReportByOrder(config, orderId);
  const hasReport = Boolean(splitExamReportBundle(config, existing.data?.data).report);
  return (
    <Modal
      title={`${config.labels.report}${hasReport ? "編集" : "登録"}${title ? ` - ${title}` : ""}`}
      onClose={onClose}
      className="modal--wide"
    >
      <ExamReportEntry config={config} orderId={orderId} patientId={patientId} onDone={onClose} />
    </Modal>
  );
}

/**
 * レポートの登録・編集の本体(依頼内容・実施情報とフォーム)。モーダルとカルテの検査結果タブの双方に置く。
 * onDone は保存・削除が済んだとき。
 */
export function ExamReportEntry({
  config,
  orderId,
  patientId,
  onDone,
}: {
  config: ExamReportConfig;
  orderId: string;
  patientId: string;
  onDone: () => void;
}) {
  // 種別は開いている間変わらないので、フックの呼び出し順も変わらない。
  const adapter = ADAPTERS[config.kind];
  const { labels } = config;
  const order = adapter.useOrderDetail(orderId);
  const perform = adapter.usePerformDetail(orderId);
  const existing = useExamReportByOrder(config, orderId);
  const save = useSaveExamReport(config);
  const remove = useDeleteExamReport(config);
  const selfOrganization = useSelfOrganization();
  const { practitionerId, practitioner } = useCurrentPractitioner();

  const serviceRequests = serviceRequestsOf(order.data?.data);
  const header = serviceRequests.find((request) => request.id === orderId);
  const itemRequests = useMemo(
    () => adapter.itemRequestsOf(serviceRequests, orderId),
    // serviceRequests は取得結果から毎回作り直すので、元の Bundle で覚える。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [order.data, orderId],
  );
  const procedures = useMemo(() => splitPerformBundle(perform.data?.data).procedures, [perform.data]);
  const performs = adapter.performRows(perform.data?.data, orderId);
  const { report, observations } = splitExamReportBundle(config, existing.data?.data);

  // 所見の既定テンプレートは検査項目マスタが持つ。複数の項目を含むオーダーは最初の項目の既定。
  const itemCodes = header ? adapter.itemCodesOf(header, itemRequests) : [];
  const master = adapter.useItemsByCodes(itemCodes);
  const defaultFindingsCanonical =
    itemCodes
      .map((code) => master.data?.items.find((item) => item.item_code === code))
      .find((item) => item?.report_findings_template_canonical)?.report_findings_template_canonical ??
    undefined;

  const loading = order.isLoading || perform.isLoading || existing.isLoading;
  const mismatch = isPatientMismatch(patientId, header?.subject);

  const initialValues = useMemo<ExamReportFormValues | null>(() => {
    if (loading || !header) return null;
    return report
      ? parseExamReportForm(config, report, observations)
      : emptyExamReportForm(config, header, itemRequests, procedures);
    // 初期値はフォームを開いたときに 1 回だけ使う(ExamReportForm が useState の初期値として読む)。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, header?.id, report?.id]);

  function handleSubmit(values: ExamReportFormValues) {
    if (mismatch) return;
    // 記載医と発行施設は画面に出さず、空のときだけ入れる(編集しても最初の記載医が残る)。
    const organization = selfOrganization.organization;
    const filled: ExamReportFormValues = {
      ...values,
      interpreterId: values.interpreterId || (practitionerId ?? ""),
      interpreterName:
        values.interpreterName || (practitioner ? practitionerDisplayName(practitioner) : ""),
      organizationId: values.organizationId || (organization?.id ?? ""),
      organizationName:
        values.organizationName || (organization ? organizationDisplayName(organization) : ""),
    };
    const bundle = buildExamReportBundle(config, filled, patientId, {
      reportId: report?.id,
      originalObservationIds: report ? examReportObservationIds(report) : [],
      originalResponseIds: report ? examReportResponseIds(config, report) : [],
    });
    save.mutate(bundle, { onSuccess: onDone });
  }

  function handleDelete() {
    if (!report?.id) return;
    if (!window.confirm(`この${labels.report}を削除します。よろしいですか?`)) return;
    remove.mutate(report.id, { onSuccess: onDone });
  }

  const OrderDetailPanel = adapter.OrderDetailPanel;

  return (
    <>
      <ErrorBanner error={order.error ?? perform.error ?? existing.error} />
      <ErrorBanner error={remove.error} />
      {loading ? (
        <p>読み込み中...</p>
      ) : mismatch ? (
        <p className="patient-table__empty">{`指定された${labels.order}は別の患者のものです。`}</p>
      ) : !header || !initialValues ? (
        <p className="patient-table__empty">
          {`この${labels.order}は見つかりません(削除された可能性があります)。`}
        </p>
      ) : (
        <>
          <details className="exam-report-entry__order" open={!report}>
            <summary>依頼内容</summary>
            <OrderDetailPanel serviceRequest={header} itemRequests={itemRequests} />
            <PerformSummary performs={performs} />
          </details>
          {report && (
            <div className="exam-report-entry__actions">
              <button type="button" disabled={remove.isPending} onClick={handleDelete}>
                {`${labels.report}を削除`}
              </button>
            </div>
          )}
          <ExamReportForm
            key={report?.id ?? "new"}
            config={config}
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
    </>
  );
}

function PerformSummary({ performs }: { performs: { id: string; rows: PerformRow[] }[] }) {
  if (performs.length === 0) return null;
  return (
    <fieldset className="exam-report-entry__perform">
      <legend>実施情報</legend>
      {performs.map((perform) => (
        <dl className="prescription-detail__common" key={perform.id}>
          {perform.rows.map((row) => (
            <Fragment key={row.label}>
              <dt>{row.label}</dt>
              <dd className={row.label === "コメント" ? "patho-result__text" : undefined}>
                {row.value}
              </dd>
            </Fragment>
          ))}
        </dl>
      ))}
    </fieldset>
  );
}
