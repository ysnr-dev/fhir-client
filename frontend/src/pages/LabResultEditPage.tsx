import { useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useLabResultDetail, useUpdateLabResult } from "../api/queries";
import { useLabItemsByCodes } from "../api/masterQueries";
import { ErrorBanner } from "../components/ErrorBanner";
import { LabResultForm } from "../components/LabResultForm";
import { PatientHeader } from "../components/PatientHeader";
import {
  buildLabResultUpdateBundle,
  hydrateLabResultForm,
  parseLabResultForm,
  splitLabResultDetailBundle,
  type LabResultFormValues,
} from "../fhir/labResultHelpers";

export function LabResultEditPage() {
  const { patientId, reportId } = useParams<{ patientId: string; reportId: string }>();
  const navigate = useNavigate();
  const detail = useLabResultDetail(reportId);
  const updateLabResult = useUpdateLabResult();

  const { report, observations } = detail.data
    ? splitLabResultDetailBundle(detail.data.data)
    : { report: undefined, observations: [] };

  const parsed = useMemo(() => {
    if (!detail.data) return undefined;
    const split = splitLabResultDetailBundle(detail.data.data);
    return split.report ? parseLabResultForm(split.report, split.observations) : undefined;
  }, [detail.data]);

  // 保存済みリソースにはコード型の選択肢などマスタ情報が含まれないため、
  // JLAC11 コードでマスタを引き直してフォーム初期値を補完する。
  const codes = useMemo(
    () =>
      parsed?.lines
        .map((line) => line.item?.jlac11_code)
        .filter((code): code is string => Boolean(code)) ?? [],
    [parsed],
  );
  const masterItems = useLabItemsByCodes(codes);

  const initialValues = useMemo(
    () => (parsed ? hydrateLabResultForm(parsed, masterItems.data?.items ?? []) : undefined),
    [parsed, masterItems.data],
  );

  function handleSubmit(values: LabResultFormValues) {
    if (!patientId || !reportId || !report) return;
    const originalIds = observations.map((o) => o.id).filter((id): id is string => Boolean(id));
    updateLabResult.mutate(buildLabResultUpdateBundle(values, patientId, reportId, originalIds), {
      onSuccess: () => navigate(`/patients/${patientId}/lab-results/${reportId}`),
    });
  }

  // マスタ照会の完了(またはエラー)を待ってからフォームを初期化する。
  const ready = !detail.isLoading && !masterItems.isLoading;

  return (
    <div className="page">
      <div className="page__header">
        <h1>検査結果編集</h1>
        <Link to={`/patients/${patientId}/lab-results/${reportId}`} className="button">
          ← 検査結果詳細に戻る
        </Link>
      </div>

      <PatientHeader patientId={patientId} />

      <ErrorBanner error={detail.error} />

      {!ready ? (
        <p>読み込み中...</p>
      ) : (
        report &&
        initialValues && (
          <LabResultForm
            initialValues={initialValues}
            onSubmit={handleSubmit}
            submitting={updateLabResult.isPending}
            submitError={updateLabResult.error}
            submitLabel="更新"
          />
        )
      )}
    </div>
  );
}
