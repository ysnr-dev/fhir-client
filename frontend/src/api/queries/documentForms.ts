import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  copyDocumentTemplate,
  createDocumentTemplate,
  fetchDocumentTemplates,
  updateDocumentTemplate,
  type DocumentTemplatePagePayload,
  type DocumentTemplateSummary,
} from "../adminClient";
import { DOCUMENT_TEMPLATES_KEY } from "../adminQueries";
import { createResource, postBundle, searchResource } from "../fhirClient";
import { postDocumentFormPdf } from "../reportsClient";
import {
  fieldSetChanged,
  normalizeLayout,
  pdfFieldPayload,
  type DocumentFormLayout,
  type DocumentFormValues,
} from "../../fhir/documentFormLayout";
import {
  buildDocumentFormQuestionnaire,
  buildDocumentFormResponseItems,
  documentFormQuestionnaireUrl,
  nextQuestionnaireVersion,
  responseDocumentExtension,
} from "../../fhir/documentFormQuestionnaire";
import { buildKarteTimeline, type KarteTimelineItem } from "../../fhir/karteTimeline";
import {
  buildDocumentFormBundle,
  buildDocumentFormReplaceBundle,
  PATIENT_FILE_MAX_BYTES,
  formatFileSize,
  type PatientFileCategory,
  type PatientFileDocumentType,
} from "../../fhir/patientFileHelpers";
import {
  buildQuestionnaireResponse,
  type QuestionnaireResponseMetaValues,
} from "../../fhir/questionnaireResponseHelpers";
import { readFileAsDataUrl } from "../../fhir/schemaImage";
import { appendKarteOrderIncludes, karteOrderParams } from "./karte";

// --- 様式テンプレート(docs/document-template-design.md §7) --------------------

async function fetchQuestionnaireByCanonical(url: string, version: string): Promise<fhir4.Questionnaire | null> {
  const params = new URLSearchParams();
  params.set("url", url);
  params.set("version", version);
  const { data } = await searchResource<fhir4.Questionnaire>("Questionnaire", params);
  return data.entry?.map((e) => e.resource).find((r): r is fhir4.Questionnaire => r?.resourceType === "Questionnaire") ?? null;
}

export interface SaveDocumentFormTemplateArgs {
  /** 編集なら既存のテンプレート。 */
  template?: DocumentTemplateSummary;
  name: string;
  fileCategoryId: number | null;
  /** 元ファイルの名前と種類(表示用)。 */
  fileName: string;
  contentType: string;
  layout: DocumentFormLayout;
  /** 再ラスタライズしたときだけ渡す。省くとページは据え置き。 */
  pages?: DocumentTemplatePagePayload[];
}

/**
 * 様式テンプレートの保存。回答の意味が変わる差(項目の増減・種類・ラベル・選択肢)があるときだけ
 * Questionnaire の版を上げ、新しい版を新しいリソースとして POST する(旧版は既存の回答が指すので残す)。
 * Questionnaire → テンプレートの順に書き、途中で止まっても次の保存で同じ版を見つけて続きから進む。
 */
export function useSaveDocumentFormTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: SaveDocumentFormTemplateArgs): Promise<DocumentTemplateSummary> => {
      const code = args.template?.code ?? crypto.randomUUID();
      const url = documentFormQuestionnaireUrl(code);
      const previous = args.template?.layout ? normalizeLayout(args.template.layout) : null;
      const bump = !args.template?.questionnaire_version || !previous || fieldSetChanged(previous, args.layout);
      const version = bump
        ? nextQuestionnaireVersion(args.template?.questionnaire_version)
        : (args.template?.questionnaire_version as string);

      if (bump) {
        const existing = await fetchQuestionnaireByCanonical(url, version);
        if (!existing) {
          await createResource(buildDocumentFormQuestionnaire({ code, name: args.name }, args.layout, version));
        }
      }

      const payload = {
        kind: "form" as const,
        name: args.name,
        file_category_id: args.fileCategoryId,
        file_name: args.fileName,
        content_type: args.contentType,
        layout: args.layout,
        questionnaire_url: url,
        questionnaire_version: version,
        ...(args.pages ? { pages: args.pages } : {}),
      };
      return args.template
        ? updateDocumentTemplate(args.template.id, payload)
        : createDocumentTemplate({ ...payload, code });
    },
    retry: false,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DOCUMENT_TEMPLATES_KEY });
      queryClient.invalidateQueries({ queryKey: ["Questionnaire", "search"] });
    },
  });
}

/**
 * 様式テンプレートの複製。新しい code で Questionnaire の 1 版を作ってから、ページ画像と配置を backend で写す。
 * 名称は「〜 のコピー」(使われていれば番号を付ける)。
 */
export function useCopyDocumentFormTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (template: DocumentTemplateSummary) => {
      // 名称は Word / Excel とも重ならないようにするので、種類を問わず全件の名前を見る。
      const names = new Set((await fetchDocumentTemplates()).map((t) => t.name));
      const base = `${template.name} のコピー`;
      let name = base;
      for (let n = 2; names.has(name); n += 1) name = `${base}${n}`;
      const code = crypto.randomUUID();
      const url = documentFormQuestionnaireUrl(code);
      const version = nextQuestionnaireVersion(null);
      const layout = template.layout ? normalizeLayout(template.layout) : null;
      if (!layout) throw new Error("項目の配置が読めないため複製できません。");
      await createResource(buildDocumentFormQuestionnaire({ code, name }, layout, version));
      return copyDocumentTemplate(template.id, {
        code,
        name,
        questionnaire_url: url,
        questionnaire_version: version,
      });
    },
    retry: false,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DOCUMENT_TEMPLATES_KEY });
      queryClient.invalidateQueries({ queryKey: ["Questionnaire", "search"] });
    },
  });
}

// --- 様式文書の保存 -------------------------------------------------------------

export interface SaveDocumentFormDocumentArgs {
  template: DocumentTemplateSummary;
  layout: DocumentFormLayout;
  questionnaire: fhir4.Questionnaire;
  patient: fhir4.Patient;
  values: DocumentFormValues;
  title: string;
  date: string;
  meta: QuestionnaireResponseMetaValues;
  practitionerId?: string;
  practitionerName?: string;
  /** 再編集なら、読んだ時点の文書と回答(版を固定したもの)。 */
  existing?: {
    doc: fhir4.DocumentReference;
    docEtag: string;
    response: fhir4.QuestionnaireResponse;
    responseEtag: string;
  };
}

/**
 * 表示用 PDF を backend で作り、回答(QuestionnaireResponse)と一緒に 1 本の transaction で保存する。
 * 再編集は回答を PUT、PDF は新しい Binary、DocumentReference を向け替え(旧 Binary は履歴が参照するので残す)。
 */
export function useSaveDocumentFormDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: SaveDocumentFormDocumentArgs): Promise<Blob> => {
      const blob = await postDocumentFormPdf(args.template.id, pdfFieldPayload(args.layout, args.values));
      if (blob.size > PATIENT_FILE_MAX_BYTES) {
        throw new Error(`${formatFileSize(PATIENT_FILE_MAX_BYTES)}を超える文書は保存できません。`);
      }
      const fileName = /\.pdf$/i.test(args.title) ? args.title : `${args.title}.pdf`;
      const dataUrl = await readFileAsDataUrl(new File([blob], fileName, { type: "application/pdf" }));
      const draft = { key: crypto.randomUUID(), title: fileName, contentType: "application/pdf", size: blob.size, dataUrl };

      const documentUrl = args.existing
        ? `DocumentReference/${args.existing.doc.id}`
        : `urn:uuid:${crypto.randomUUID()}`;
      const response = buildQuestionnaireResponse({
        questionnaire: args.questionnaire,
        patient: args.patient,
        items: buildDocumentFormResponseItems(args.layout, args.values, args.questionnaire),
        meta: args.meta,
        existing: args.existing?.response,
        extension: [responseDocumentExtension(documentUrl)],
      });

      const documentType: PatientFileDocumentType = { code: args.template.code, name: args.template.name };
      const category: PatientFileCategory | null =
        args.template.file_category_code && args.template.file_category_name
          ? { code: args.template.file_category_code, name: args.template.file_category_name }
          : null;

      const bundle = args.existing
        ? buildDocumentFormReplaceBundle({
            doc: args.existing.doc,
            docEtag: args.existing.docEtag,
            response,
            responseEtag: args.existing.responseEtag,
            draft,
            date: args.date,
          })
        : buildDocumentFormBundle({
            draft,
            response,
            documentUrl,
            patientId: args.patient.id ?? "",
            date: args.date,
            category,
            practitionerId: args.practitionerId,
            practitionerName: args.practitionerName,
            documentType,
          });
      await postBundle(bundle);
      return blob;
    },
    retry: false,
    onSuccess: (_blob, args) => {
      queryClient.invalidateQueries({ queryKey: ["DocumentReference", "search"] });
      queryClient.invalidateQueries({ queryKey: ["QuestionnaireResponse"] });
      if (args.existing) {
        queryClient.invalidateQueries({ queryKey: ["DocumentReference", args.existing.doc.id] });
      }
    },
  });
}

// --- 転記の出どころ --------------------------------------------------------------

const TRANSFER_ORDER_COUNT = 100;

/**
 * 転記モーダルに出すオーダー(処方・注射・部門オーダー)。カルテのタイムラインと同じ検索条件を
 * 1 ページぶん読み、同じ組み立て(buildKarteTimeline)でカードの単位にする。
 */
export function useTransferOrders(patientId: string | undefined, enabled: boolean) {
  const query = useQuery({
    queryKey: ["ServiceRequest", "search", "document-transfer", patientId],
    queryFn: async () => {
      const params = karteOrderParams(patientId);
      appendKarteOrderIncludes(params);
      params.set("_sort", "-authoredon");
      params.set("_count", String(TRANSFER_ORDER_COUNT));
      const { data } = await searchResource<fhir4.Resource>("ServiceRequest", params);
      const timeline = buildKarteTimeline({
        noteBundles: [],
        prescriptionBundles: [data],
        pendingBundles: [],
        responseBundles: [],
        vitalBundles: [],
        pathwayEvaluations: [],
        noteHasNext: false,
        prescriptionHasNext: false,
        responseHasNext: false,
        vitalHasNext: false,
      });
      const items: { day: string; item: KarteTimelineItem }[] = [];
      for (const group of timeline.groups) {
        for (const item of group.items) items.push({ day: group.day, item });
      }
      const headers = (data.entry ?? []).filter(
        (e) => e.resource?.resourceType === "ServiceRequest" && e.search?.mode !== "include",
      ).length;
      return { items, truncated: headers >= TRANSFER_ORDER_COUNT };
    },
    enabled: Boolean(patientId) && enabled,
    staleTime: 60 * 1000,
  });
  return query;
}
