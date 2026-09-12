import { usePatient } from "../api/queries";
import { ErrorBanner } from "./ErrorBanner";
import { PlannedAdmissionForm } from "./PlannedAdmissionForm";

// 入院予定の登録。カルテ画面の右ペインから使う。患者はカルテで開いている本人なので、
// 入院患者一覧のモーダルと違って患者検索は挟まない。

export function PlannedAdmissionCreatePanel({
  patientId,
  onSaved,
}: {
  patientId: string;
  onSaved: () => void;
}) {
  const { data: result, isLoading, error } = usePatient(patientId);

  if (isLoading) return <p>読み込み中...</p>;

  const patient = result?.data;
  if (error || !patient) {
    return <ErrorBanner error={error ?? new Error("患者を読み込めませんでした。")} />;
  }

  return <PlannedAdmissionForm patient={patient} onSaved={onSaved} />;
}
