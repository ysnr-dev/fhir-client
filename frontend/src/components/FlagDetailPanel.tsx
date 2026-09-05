import { useState } from "react";
import { FhirError } from "../api/fhirClient";
import { usePatientCautions } from "../api/masterQueries";
import { useFlag, useUpdateFlag } from "../api/queries";
import type { PatientCaution } from "../api/masterClient";
import { endFlag, summarizeFlag } from "../fhir/flagHelpers";
import { isPatientMismatch } from "../fhir/patientHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { JsonBlock } from "./JsonBlock";
import { CautionPictogram } from "./icons/cautionPictograms";

// 診療上の注意の内容表示。「終了」はここに置く(更新に必要な ETag を
// 詳細の読み込みで持っているため、一覧から直接終了させない)。
export function FlagDetailPanel({
  patientId,
  flagId,
  onEnded,
}: {
  patientId: string;
  flagId: string;
  onEnded: () => void;
}) {
  const { data: result, isLoading, error: loadError } = useFlag(flagId);
  const cautions = usePatientCautions();
  const updateFlag = useUpdateFlag();
  const [conflict, setConflict] = useState(false);

  const flag = result?.data;
  // URL の患者と Flag.subject が食い違う場合は他患者のものなので表示しない。
  const patientMismatch = isPatientMismatch(patientId, flag?.subject);
  const error =
    loadError ?? (patientMismatch ? new Error("指定された注意は別の患者のものです。") : undefined);

  const cautionsByCode = new Map<string, PatientCaution>(
    (cautions.data?.items ?? []).map((c) => [c.code, c]),
  );
  const summary = flag && !patientMismatch ? summarizeFlag(flag, cautionsByCode) : undefined;

  function handleEnd() {
    if (!flag || !result?.etag) return;
    if (!window.confirm(`注意「${summary?.name ?? ""}」を終了します。よろしいですか?`)) return;

    setConflict(false);
    updateFlag.mutate(
      { flag: endFlag(flag), etag: result.etag },
      {
        onSuccess: onEnded,
        onError: (err) => {
          if (err instanceof FhirError && err.status === 412) setConflict(true);
        },
      },
    );
  }

  return (
    <>
      <ErrorBanner error={error} />

      {conflict && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">
            この注意は他の操作によって更新されています。画面を再読込してから操作してください。
          </p>
        </div>
      )}

      {isLoading ? (
        <p>読み込み中...</p>
      ) : (
        summary && (
          <div className="prescription-detail">
            <fieldset>
              <legend>診療上の注意</legend>
              <dl className="prescription-detail__common">
                <dt>注意</dt>
                <dd>
                  {summary.pictogram && (
                    <span
                      className={`flag-table__pictogram flag-table__pictogram--${summary.category}`}
                    >
                      <CautionPictogram pictogram={summary.pictogram} />
                    </span>
                  )}
                  {summary.name}
                </dd>
                <dt>区分</dt>
                <dd>{summary.categoryLabel || "-"}</dd>
                <dt>内容</dt>
                <dd>{summary.text || "-"}</dd>
                <dt>開始日</dt>
                <dd>{summary.periodStart || "-"}</dd>
                <dt>終了日</dt>
                <dd>{summary.periodEnd || "-"}</dd>
                <dt>状態</dt>
                <dd>{summary.statusLabel || "-"}</dd>
              </dl>
            </fieldset>

            {summary.status === "active" && (
              <div className="prescription-form__actions">
                <button type="button" onClick={handleEnd} disabled={updateFlag.isPending}>
                  終了
                </button>
              </div>
            )}

            <ErrorBanner error={conflict ? undefined : updateFlag.error} />

            <details className="prescription-detail__raw">
              <summary>FHIR リソース</summary>
              <JsonBlock value={flag} />
            </details>
          </div>
        )
      )}
    </>
  );
}
