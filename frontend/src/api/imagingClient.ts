import type { ParsedInstance } from "../fhir/dicomImport";
import { masterFetch } from "./masterClient";

// 取り込んだ DICOM の保存・配信 API(backend の /imaging。docs/imaging-design.md)。
// 実体は backend が持ち、上流の ImagingStudy は backend が保存済みの内容から書く。

export class ImagingApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ImagingApiError";
    this.status = status;
  }
}

const ERROR_LABELS: Record<string, string> = {
  belongs_to_another_patient: "別の患者に取込済みの画像です。",
  file_too_large: "ファイルが大きすぎます。",
  upstream_unreachable: "FHIR サーバーに接続できませんでした。",
  upstream_authentication_failed: "FHIR サーバーの認証に失敗しました。",
  not_found: "対象の画像が見つかりません。",
};

async function buildError(res: Response): Promise<ImagingApiError> {
  let message = `サーバーエラーが発生しました (HTTP ${res.status})`;
  try {
    const body = (await res.json()) as { error?: string; errors?: string[] };
    if (body.error) message = ERROR_LABELS[body.error] ?? body.error;
    else if (body.errors?.length) message = body.errors.join(" / ");
  } catch {
    // 非JSONレスポンスはデフォルトメッセージのまま
  }
  return new ImagingApiError(message, res.status);
}

/** 1 インスタンスを保存する。同じ SOP Instance UID の送り直しは成功として扱われる。 */
export async function uploadDicomInstance(patientId: string, instance: ParsedInstance): Promise<void> {
  const formData = new FormData();
  formData.append("file", instance.blob, `${instance.key}.dcm`);
  formData.append("patient_id", patientId);
  formData.append("meta", JSON.stringify(instance.meta));

  // Content-Type は指定しない（ブラウザが multipart boundary 付きで設定する）
  const res = await masterFetch("/imaging/instances", { method: "POST", body: formData });
  if (!res.ok) throw await buildError(res);
}

export interface StoredStudy {
  study_instance_uid: string;
  instance_count: number;
}

/** 患者について backend が実体を持っているスタディと、その枚数。 */
export async function fetchStoredStudies(patientId: string): Promise<StoredStudy[]> {
  const res = await masterFetch(`/imaging/studies?patient=${encodeURIComponent(patientId)}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as StoredStudy[];
}

export interface StoredInstance {
  sop_instance_uid: string;
  series_instance_uid: string;
  sop_class_uid: string;
  transfer_syntax_uid: string | null;
  instance_number: number | null;
  number_of_frames: number | null;
  byte_size: number;
}

export async function fetchStudyInstances(
  patientId: string,
  studyUid: string,
): Promise<StoredInstance[]> {
  const res = await masterFetch(
    `/imaging/studies/${studyUid}/instances?patient=${encodeURIComponent(patientId)}`,
  );
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as StoredInstance[];
}

/** 保存済みの内容から、上流の ImagingStudy を作る・作り直す。 */
export async function commitImagingStudy(patientId: string, studyUid: string): Promise<void> {
  const res = await masterFetch(`/imaging/studies/${studyUid}/commit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ patient_id: patientId }),
  });
  if (!res.ok) throw await buildError(res);
}

export async function deleteImagingStudy(patientId: string, studyUid: string): Promise<void> {
  const res = await masterFetch(
    `/imaging/studies/${studyUid}?patient=${encodeURIComponent(patientId)}`,
    { method: "DELETE" },
  );
  if (!res.ok) throw await buildError(res);
}
