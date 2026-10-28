import { useState } from "react";
import type { InjectionRpDisplay } from "../fhir/injectionHelpers";
import {
  SKIP_REASON_OPTIONS,
  applyScan,
  type InjectionScanState,
} from "../fhir/injectionVerificationHelpers";
import { displayName, patientNumberOf } from "../fhir/patientHelpers";
import { BarcodeScanField } from "./BarcodeScanField";
import { MatchIcon } from "./icons/MatchIcon";
import { MismatchIcon } from "./icons/MismatchIcon";

// 注射の3点認証の照合(docs/injection-order-design.md §6.5)。実施入力の前段。
// 患者番号(リストバンド・注射ラベル)と RP バーコードを順不同で読み、実施者はログイン中の医療従事者で代替する。
// 不一致のあいだは先へ進めない。照合できないときは理由を選んでスキップする。

interface Props {
  orderId: string;
  rps: InjectionRpDisplay[];
  patient: fhir4.Patient | undefined;
  /** ログイン中の医療従事者の氏名。医療従事者が紐づかないログインでは null。 */
  practitionerName: string | null;
  scan: InjectionScanState;
  onScanChange: (scan: InjectionScanState) => void;
  onComplete: () => void;
  onSkip: (reasonCode: string, reasonText: string) => void;
}

export function InjectionVerifyStep({
  orderId,
  rps,
  patient,
  practitionerName,
  scan,
  onScanChange,
  onComplete,
  onSkip,
}: Props) {
  const [skipping, setSkipping] = useState(practitionerName === null);
  const [reasonCode, setReasonCode] = useState(practitionerName === null ? "no-practitioner" : "");
  const [reasonText, setReasonText] = useState("");

  const rpNumbers = rps.map((rp) => rp.rpNumber);
  const canComplete =
    scan.patient === "matched" && practitionerName !== null && scan.rpNumbers.length > 0;
  const canSkip = reasonCode !== "" && (reasonCode !== "other" || reasonText.trim() !== "");

  function handleScan(value: string) {
    onScanChange(applyScan(scan, value, { orderId, patient, rpNumbers }));
  }

  return (
    <div className="injection-verify">
      <label className="injection-verify__scan">
        読み取り
        <BarcodeScanField ariaLabel="バーコードの読み取り" onScan={handleScan} />
      </label>
      {scan.message && (
        <p
          className={`injection-verify__message${scan.message.error ? " injection-verify__message--error" : ""}`}
          role={scan.message.error ? "alert" : "status"}
        >
          {scan.message.text}
        </p>
      )}

      <table className="injection-verify__table">
        <tbody>
          <tr>
            <th>患者</th>
            <td>
              {patient ? `${displayName(patient)}　${patientNumberOf(patient) ?? ""}` : "読み込み中..."}
            </td>
            <td>
              {scan.patient === "matched" ? (
                <State kind="ok" />
              ) : scan.patient === "mismatch" ? (
                <State kind="error">{scan.scannedPatient}</State>
              ) : (
                <State kind="none">未読取</State>
              )}
            </td>
          </tr>
          <tr>
            <th>実施者</th>
            <td>{practitionerName ?? "(未設定)"}</td>
            <td>
              {practitionerName !== null ? <State kind="ok" /> : <State kind="error" />}
            </td>
          </tr>
          {rps.map((rp) => (
            <tr key={rp.rpNumber}>
              <th>{`RP${rp.rpNumber}`}</th>
              <td>{rp.medicines.map((m) => m.name).join("、")}</td>
              <td>
                {scan.rpNumbers.includes(rp.rpNumber) ? (
                  <State kind="ok" />
                ) : (
                  <State kind="none">未読取</State>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {skipping && (
        <div className="lab-order-item__fields">
          <label>
            スキップ理由 *
            <select value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
              <option value="">選択してください</option>
              {SKIP_REASON_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.display}
                </option>
              ))}
            </select>
          </label>
          <label>
            {reasonCode === "other" ? "理由 *" : "理由"}
            <input type="text" value={reasonText} onChange={(e) => setReasonText(e.target.value)} />
          </label>
        </div>
      )}

      <div className="lab-order-item__actions">
        {skipping ? (
          <>
            {practitionerName !== null && (
              <button type="button" onClick={() => setSkipping(false)}>
                取消
              </button>
            )}
            <button type="button" disabled={!canSkip} onClick={() => onSkip(reasonCode, reasonText)}>
              スキップ
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => setSkipping(true)}>
              スキップ
            </button>
            <button type="button" disabled={!canComplete} onClick={onComplete}>
              照合完了
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** 一致はマル、不一致はバツ。不一致に添える読んだ値は children で渡す。 */
function State({ kind, children }: { kind: "ok" | "error" | "none"; children?: string }) {
  const label = kind === "ok" ? "一致" : kind === "error" ? "不一致" : undefined;
  return (
    <span
      className={`injection-verify__state injection-verify__state--${kind}`}
      role={label ? "img" : undefined}
      aria-label={label && children ? `${label} ${children}` : label}
      title={label}
    >
      {kind === "ok" && <MatchIcon />}
      {kind === "error" && <MismatchIcon />}
      {children}
    </span>
  );
}
