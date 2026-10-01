import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessages } from "../../fhir/outcome";
import {
  buildPatientFileBundle,
  buildPatientFileReplaceBundle,
  PATIENT_FILE_CATEGORY_SYSTEM,
  type PatientFileCategory,
  type PatientFileDocumentType,
  type PatientFileDraft,
} from "../../fhir/patientFileHelpers";
import {
  deleteResource,
  fetchBinaryBlob,
  type FhirResult,
  postBundle,
  readResource,
  searchResource,
  updateResource,
} from "../fhirClient";
import { deleteImagingStudy, fetchStoredStudies, fetchStudyInstances } from "../imagingClient";
import { IMAGING_STUDY_SUMMARY_ELEMENTS } from "../../fhir/imagingHelpers";
import { hasRelation } from "./patient";

// --- カルテに取り込んだファイル(docs/patient-file-design.md) ------------------

const PATIENT_FILE_COUNT = 20;
const PATIENT_FILE_KEY = ["DocumentReference", "search"];

/**
 * 患者のファイル一覧。並びは診療日(DocumentReference.date)の降順で、カテゴリは
 * 上流の category 検索で絞る(クライアント側で振り分けるとページングと両立しない)。
 */
export function usePatientFileSearch(
  patientId: string | undefined,
  categoryCode: string,
  offset: number,
) {
  const params = new URLSearchParams();
  if (patientId) params.set("patient", `Patient/${patientId}`);
  if (categoryCode) params.set("category", `${PATIENT_FILE_CATEGORY_SYSTEM}|${categoryCode}`);
  params.set("_count", String(PATIENT_FILE_COUNT));
  params.set("_offset", String(offset));
  params.set("_sort", "-date");

  const query = useQuery({
    queryKey: [...PATIENT_FILE_KEY, patientId, categoryCode, offset],
    queryFn: () => searchResource<fhir4.DocumentReference>("DocumentReference", params),
    placeholderData: keepPreviousData,
    enabled: Boolean(patientId),
  });

  return {
    ...query,
    bundle: query.data?.data,
    total: query.data?.data.total ?? 0,
    count: PATIENT_FILE_COUNT,
    hasPrevious: hasRelation(query.data?.data, "previous"),
    hasNext: hasRelation(query.data?.data, "next"),
  };
}

export function usePatientFileDocument(id: string | undefined) {
  return useQuery({
    queryKey: ["DocumentReference", id],
    queryFn: () => readResource<fhir4.DocumentReference>("DocumentReference", id as string),
    enabled: Boolean(id),
  });
}

/** ファイル 1 件ぶんの中身。Binary は書き換わらないので長くキャッシュする。 */
export function usePatientFileBlob(binaryId: string | null | undefined) {
  return useQuery({
    queryKey: ["Binary", "blob", binaryId],
    queryFn: () => fetchBinaryBlob(binaryId as string),
    enabled: Boolean(binaryId),
    staleTime: Infinity,
  });
}

export interface PatientFileUploadResult {
  saved: number;
  /** 保存できなかったファイルの key(取込フォームに残すため)。 */
  failedKeys: string[];
  /** 保存できなかったファイルの理由(表示名付き)。 */
  errors: string[];
}

/**
 * 取り込んだファイルを 1 件ずつ保存する。ファイルごとに transaction Bundle を分けるので、
 * 1 件が大きすぎて弾かれても他のファイルは残る。結果は件数と失敗の理由でまとめて返す。
 */
export function useCreatePatientFiles() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      drafts,
      ...options
    }: {
      drafts: PatientFileDraft[];
      patientId: string;
      date: string;
      category: PatientFileCategory | null;
      practitionerId?: string;
      practitionerName?: string;
      /** 文書テンプレートから作った文書なら、元のテンプレート。 */
      documentType?: PatientFileDocumentType;
    }): Promise<PatientFileUploadResult> => {
      let saved = 0;
      const failedKeys: string[] = [];
      const errors: string[] = [];
      for (const draft of drafts) {
        try {
          await postBundle(buildPatientFileBundle(draft, options));
          saved += 1;
        } catch (err) {
          failedKeys.push(draft.key);
          errors.push(`${draft.title}: ${errorMessages(err)
            .map((message) => message.text)
            .join(" ")}`);
        }
      }
      return { saved, failedKeys, errors };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PATIENT_FILE_KEY });
    },
  });
}

export function useUpdatePatientFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ doc, etag }: { doc: fhir4.DocumentReference; etag: string }) =>
      updateResource(doc, etag),
    onSuccess: (result: FhirResult<fhir4.DocumentReference>) => {
      queryClient.invalidateQueries({ queryKey: PATIENT_FILE_KEY });
      queryClient.invalidateQueries({ queryKey: ["DocumentReference", result.data.id] });
    },
  });
}

/**
 * ファイルの本体を差し替える。最新の DocumentReference を読み直してから、新しい Binary の
 * 作成と DocumentReference の更新を 1 本の transaction で送る(読み直してから送るまでに
 * 他の操作で更新されていれば 412 になる)。
 */
export function useReplacePatientFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ fileId, draft }: { fileId: string; draft: PatientFileDraft }) => {
      const current = await readResource<fhir4.DocumentReference>("DocumentReference", fileId);
      if (!current.etag) throw new Error("ファイルの版を確認できませんでした。");
      await postBundle(buildPatientFileReplaceBundle(current.data, draft, current.etag));
      return fileId;
    },
    onSuccess: (fileId) => {
      queryClient.invalidateQueries({ queryKey: PATIENT_FILE_KEY });
      queryClient.invalidateQueries({ queryKey: ["DocumentReference", fileId] });
    },
  });
}

/**
 * ファイルの削除。消すのは DocumentReference だけで、本体の Binary は残す
 * (旧バージョンがその Binary を参照しているため。シェーマ画像と同じ方針)。
 */
export function useDeletePatientFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteResource("DocumentReference", id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PATIENT_FILE_KEY });
    },
  });
}

// --- 取り込んだ DICOM(docs/imaging-design.md) --------------------------------

const IMAGING_STUDY_COUNT = 20;
export const IMAGING_STUDY_KEY = ["ImagingStudy"];
const IMAGING_STORED_KEY = ["imaging", "stored"];

/**
 * 患者のスタディ一覧。並びは検査日の降順。series(インスタンスの一覧)は数百件に
 * なるので、一覧では _elements で落とす。
 */
export function useImagingStudySearch(patientId: string | undefined, offset: number) {
  const params = new URLSearchParams();
  if (patientId) params.set("patient", `Patient/${patientId}`);
  params.set("_count", String(IMAGING_STUDY_COUNT));
  params.set("_offset", String(offset));
  params.set("_sort", "-started");
  params.set("_elements", IMAGING_STUDY_SUMMARY_ELEMENTS);

  const query = useQuery({
    queryKey: [...IMAGING_STUDY_KEY, "search", patientId, offset],
    queryFn: () => searchResource<fhir4.ImagingStudy>("ImagingStudy", params),
    placeholderData: keepPreviousData,
    enabled: Boolean(patientId),
  });

  return {
    ...query,
    bundle: query.data?.data,
    total: query.data?.data.total ?? 0,
    count: IMAGING_STUDY_COUNT,
    hasPrevious: hasRelation(query.data?.data, "previous"),
    hasNext: hasRelation(query.data?.data, "next"),
  };
}

export function useImagingStudy(id: string | undefined) {
  return useQuery({
    queryKey: [...IMAGING_STUDY_KEY, id],
    queryFn: () => readResource<fhir4.ImagingStudy>("ImagingStudy", id as string),
    enabled: Boolean(id),
  });
}

/** backend が実体を持っているスタディと枚数。取込フォームが取込済みの判定に使う。 */
export function useStoredImagingStudies(patientId: string | undefined) {
  return useQuery({
    queryKey: [...IMAGING_STORED_KEY, patientId],
    queryFn: () => fetchStoredStudies(patientId as string),
    enabled: Boolean(patientId),
  });
}

/** スタディの保存済みインスタンス(フレーム数など、ImagingStudy に無い属性を持つ)。 */
export function useImagingStudyInstances(patientId: string | undefined, studyUid: string | undefined) {
  return useQuery({
    queryKey: [...IMAGING_STORED_KEY, patientId, studyUid],
    queryFn: () => fetchStudyInstances(patientId as string, studyUid as string),
    enabled: Boolean(patientId && studyUid),
  });
}

/** 取込・削除のあとに、スタディの一覧と保存済みの枚数を読み直す。 */
export function useInvalidateImaging() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: IMAGING_STUDY_KEY });
    queryClient.invalidateQueries({ queryKey: IMAGING_STORED_KEY });
  };
}

/** スタディを実体ごと消す(上流の ImagingStudy も backend が消す)。 */
export function useDeleteImagingStudy(patientId: string) {
  const invalidate = useInvalidateImaging();
  return useMutation({
    mutationFn: (studyUid: string) => deleteImagingStudy(patientId, studyUid),
    onSuccess: invalidate,
  });
}
