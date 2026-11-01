import { useState } from "react";
import {
  VERIFICATION_SKIP_REASON_OPTIONS,
  applyTransfusionScan,
  normalizeScanCode,
  patientVerifyLabel,
  type TransfusionBagLine,
  type TransfusionScanState,
} from "../fhir/transfusionResultHelpers";
import { BarcodeScanField } from "./BarcodeScanField";
import { MatchIcon } from "./icons/MatchIcon";
import { MismatchIcon } from "./icons/MismatchIcon";

// 輸血の投与時の照合(JAHIS 患者安全ガイド 輸血編 7.5.3-1)。実施入力の前段。
// 患者番号(リストバンド)と製剤ラベルの献血番号(ISBT 128)を順不同で読み、実施中の
// バッグ全部と患者が一致したら入力へ進む。実施者はログイン中の医療従事者、確認者は
// 選んだ医療従事者。照合できないときは理由を選んでスキップする(注射の 3 点認証と同じ)。

interface Props {
  patient: fhir4.Patient | undefined;
  /** 実施するバッグ(製剤番号つき)。 */
  bags: TransfusionBagLine[];
  practitionerName: string | null;
  confirmerName: string;
  scan: TransfusionScanState;
  onScanChange: (scan: TransfusionScanState) => void;
  onComplete: () => void;
  onSkip: (reasonCode: string, reasonText: string) => void;
}

export function TransfusionVerifyStep({
  patient,
  bags,
  practitionerName,
  confirmerName,
  scan,
  onScanChange,
  onComplete,
  onSkip,
}: Props) {
  const [skipping, setSkipping] = useState(practitionerName === null);
  const [reasonCode, setReasonCode] = useState(practitionerName === null ? "no-practitioner" : "");
  const [reasonText, setReasonText] = useState("");

  const bagNumbers = bags.map((bag) => bag.lotNumber.trim()).filter(Boolean);
  const matched = (number: string) => scan.bagNumbers.includes(normalizeScanCode(number));
  const canComplete =
    scan.patient === "matched" &&
    practitionerName !== null &&
    bagNumbers.length > 0 &&
    bagNumbers.every(matched);
  const canSkip = reasonCode !== "" && (reasonCode !== "other" || reasonText.trim() !== "");

  function handleScan(value: string) {
    onScanChange(applyTransfusionScan(scan, value, { patient, bagNumbers }));
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
            <td>{patient ? patientVerifyLabel(patient) : "読み込み中..."}</td>
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
            <td>{practitionerName !== null ? <State kind="ok" /> : <State kind="error" />}</td>
          </tr>
          <tr>
            <th>確認者</th>
            <td>{confirmerName || "(未選択)"}</td>
            <td>{confirmerName ? <State kind="ok" /> : <State kind="none">未選択</State>}</td>
          </tr>
          {bags.map((bag, index) => (
            <tr key={index}>
              <th>{`バッグ${index + 1}`}</th>
              <td>
                {bag.productName}
                {bag.lotNumber && ` No.${bag.lotNumber}`}
              </td>
              <td>
                {bag.lotNumber && matched(bag.lotNumber) ? (
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
              {VERIFICATION_SKIP_REASON_OPTIONS.map((option) => (
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
