import { useState } from "react";
import { useCoverages } from "../api/queries";
import {
  useBillingPreview,
  useBillingStatus,
  useCancelBilling,
  useSendBilling,
} from "../api/receiptQueries";
import { coverageSetsOf } from "../fhir/coverageHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

export interface BillingSendTarget {
  patientId: string;
  patientName: string;
  performDate: string;
  departmentCode?: string;
  practitionerId?: string;
  /** 受付に記録された請求セット。保険の選択の初期値にする。 */
  coverageSetKey?: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  oral: "内服",
  as_needed: "頓用",
  topical: "外用",
  lab: "検体検査",
  micro: "細菌検査",
  physio: "生理検査",
  endoscopy: "内視鏡",
  rad: "放射線検査",
  treatment: "処置",
  surgery: "手術",
};

/**
 * 診察終了時の会計送信。何が送られて何が送られないかを見せてから送る。
 *
 * 送信済みかはレセコンに訊く(カルテ側に控えを持たない)。送り直しの扱いは
 * レセコンごとに違うので backend のアダプタに任せ、ここでは区別しない。
 */
export function BillingSendModal({
  target,
  onClose,
}: {
  target: BillingSendTarget;
  onClose: () => void;
}) {
  const { coverages } = useCoverages(target.patientId);
  const preview = useBillingPreview(target.patientId, target.performDate);
  const sentStatus = useBillingStatus(target.patientId, target.performDate, target.departmentCode);
  const send = useSendBilling();
  const cancel = useCancelBilling();

  const [coverageSet, setCoverageSet] = useState("");
  const sets = coverageSetsOf(coverages);
  // 受付に記録された請求セットが選択肢に無いことがある(レセコン側で保険を選ばずに
  // 受付すると「未選択」を表す番号が入る)。選択肢に無いキーをそのまま初期値にすると、
  // 画面には先頭の保険が出たまま別の値を送ってしまうので、先頭に寄せる。
  const fromReception = sets.some((s) => s.key === target.coverageSetKey)
    ? target.coverageSetKey
    : "";
  const selected = coverageSet || fromReception || sets[0]?.key || "";
  const alreadySent = sentStatus.data?.sent ?? false;

  const items = preview.data?.items ?? [];
  const diagnoses = preview.data?.diagnoses ?? [];
  const skipped = preview.data?.skipped ?? [];
  const result = send.data?.billing;
  const diagnosisResult = send.data?.diagnoses;

  const body = {
    patient_id: target.patientId,
    date: target.performDate,
    department_code: target.departmentCode,
    practitioner_id: target.practitionerId,
    coverage_set_key: selected || undefined,
  };

  return (
    <Modal title={`医事送信 — ${target.patientName}`} onClose={onClose}>
      <div className="receipt-send">
        <ErrorBanner error={preview.error ?? send.error ?? cancel.error} />

        <dl className="prescription-detail__common">
          <dt>診療日</dt>
          <dd>{target.performDate}</dd>
        </dl>

        <label className="receipt-send__field">
          保険
          <select value={selected} onChange={(e) => setCoverageSet(e.target.value)}>
            {sets.length === 0 && <option value="">（登録なし）</option>}
            {sets.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        {preview.isLoading ? (
          <p>読み込み中...</p>
        ) : (
          <>
            <h3 className="receipt-mapping__title">病名</h3>
            {diagnoses.length === 0 ? (
              <p className="receipt-mapping__empty">送る病名はありません</p>
            ) : (
              <ul className="receipt-send__list">
                {diagnoses.map((d, index) => (
                  <li key={index}>
                    {d.name}
                    {!d.sendable && <span className="receipt-send__ng">（コードなし）</span>}
                  </li>
                ))}
              </ul>
            )}

            <h3 className="receipt-mapping__title">診療行為</h3>
            {items.length === 0 ? (
              <p className="receipt-mapping__empty">送る診療行為はありません</p>
            ) : (
              <ul className="receipt-send__list">
                {items.map((item, index) => (
                  <li key={index}>
                    <strong>
                      {CATEGORY_LABELS[item.category] ?? item.category} {item.name}
                      {item.days && item.days !== "1" ? ` ${item.days}日分` : ""}
                    </strong>
                    {item.usage_name && <div>{item.usage_name}</div>}
                    <ul>
                      {item.lines.map((line, i) => (
                        <li key={i}>
                          {line.name || line.code}
                          {line.quantity && line.quantity !== "1" ? ` ${line.quantity}` : ""}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}

            {skipped.length > 0 && (
              <>
                <h3 className="receipt-mapping__title">送れない項目</h3>
                <ul className="receipt-send__list receipt-send__list--ng">
                  {skipped.map((s, index) => (
                    <li key={index}>
                      [{s.kind}] {s.name} — {s.reason}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}

        {result && (
          <p
            className={
              result.outcome === "failed"
                ? "connection-settings-form__test-error"
                : "connection-settings-form__success"
            }
            role="status"
          >
            {result.message}
            {result.warnings.length > 0 && `（警告 ${result.warnings.length} 件）`}
            {result.skipped.length > 0 && `（送れなかった項目 ${result.skipped.length} 件）`}
          </p>
        )}
        {/* 病名と診療行為は別々に送るので、片方だけ落ちることがある。
            診療行為が通っていても病名の失敗は隠さない。 */}
        {diagnosisResult && (
          <p
            className={
              diagnosisResult.outcome === "failed"
                ? "connection-settings-form__test-error"
                : "connection-settings-form__success"
            }
            role="status"
          >
            病名: {diagnosisResult.message}
          </p>
        )}
        {cancel.data && (
          <p className="connection-settings-form__success" role="status">
            {cancel.data.message}
          </p>
        )}

        <div className="connection-settings-form__actions">
          <button
            type="button"
            disabled={send.isPending || items.length === 0}
            onClick={() => send.mutate(body)}
          >
            {send.isPending ? "送信中..." : alreadySent ? "送り直す" : "送信"}
          </button>
          {alreadySent && (
            <button
              type="button"
              disabled={cancel.isPending}
              onClick={() =>
                cancel.mutate({
                  patient_id: target.patientId,
                  date: target.performDate,
                  department_code: target.departmentCode,
                })
              }
            >
              {cancel.isPending ? "取消中..." : "医事会計から取り消す"}
            </button>
          )}
          <button type="button" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </Modal>
  );
}
