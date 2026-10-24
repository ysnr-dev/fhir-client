// 様式テンプレートの回答を保存する Questionnaire の自動生成と、回答(QuestionnaireResponse)との変換。
//
// 項目の定義は様式デザイナ(layout)が正で、Questionnaire はそこから機械的に作る
// (text→string、textarea→text、date→date、select→choice + drop-down、checkbox→choice + check-box 1 選択肢)。
// 既存のエディタと同じ buildQuestionnaire に通して、プロファイル(subjectType など)の要件を満たす。
// 通常のテンプレート選択に出さないため code に印を付ける(上流は extension を検索できないが code は検索できる)。
import {
  buildQuestionnaire,
  newAnswerOption,
  newEditorItem,
  type EditorItem,
  type QuestionnaireFormValues,
} from "./questionnaireHelpers";
import {
  CHECKED_VALUE,
  type DocumentFormField,
  type DocumentFormLayout,
  type DocumentFormValues,
} from "./documentFormLayout";

export const DOCUMENT_FORM_EXT_URL = "http://fhir-client.local/StructureDefinition/questionnaire-document-form";
export const DOCUMENT_FORM_KIND_SYSTEM = "http://fhir-client.local/CodeSystem/questionnaire-kind";
export const DOCUMENT_FORM_KIND_CODE = "document-form";
/** テンプレート一覧の検索に足す除外条件(code:not の値)。 */
export const DOCUMENT_FORM_KIND_TOKEN = `${DOCUMENT_FORM_KIND_SYSTEM}|${DOCUMENT_FORM_KIND_CODE}`;
const OPTION_SYSTEM = "http://fhir-client.local/CodeSystem/document-form-option";

export function documentFormQuestionnaireUrl(code: string): string {
  return `http://fhir-client.local/Questionnaire/document-form/${code}`;
}

export function isDocumentFormQuestionnaire(questionnaire: fhir4.Questionnaire): boolean {
  return (
    questionnaire.code?.some((c) => c.system === DOCUMENT_FORM_KIND_SYSTEM && c.code === DOCUMENT_FORM_KIND_CODE) ??
    false
  );
}

function optionCode(field: DocumentFormField, index: number): string {
  return `${field.id}-${index + 1}`;
}

function editorItemOf(field: DocumentFormField): EditorItem {
  const type =
    field.type === "text"
      ? "string"
      : field.type === "textarea"
        ? "text"
        : field.type === "date"
          ? "date"
          : "choice";
  const item = newEditorItem(type);
  item.linkId = field.id;
  item.text = field.label;
  item.required = field.required;
  if (field.initial_expression) item.initialExpression = field.initial_expression;
  if (field.type === "select") {
    item.itemControl = "drop-down";
    item.answerOptions = (field.options ?? []).map((option, index) => ({
      ...newAnswerOption(),
      system: OPTION_SYSTEM,
      code: optionCode(field, index),
      display: option,
    }));
  }
  if (field.type === "checkbox") {
    item.itemControl = "check-box";
    item.answerOptions = [{ ...newAnswerOption(), system: OPTION_SYSTEM, code: optionCode(field, 0), display: field.label }];
  }
  return item;
}

export function buildDocumentFormQuestionnaire(
  template: { code: string; name: string },
  layout: DocumentFormLayout,
  version: string,
): fhir4.Questionnaire {
  const values: QuestionnaireFormValues = {
    url: documentFormQuestionnaireUrl(template.code),
    version,
    // JASPEHR(jsp-5)で name は 15 文字まで。code(UUID)の先頭で一意にする。
    name: `DF${template.code.replaceAll("-", "").slice(0, 12)}`,
    title: template.name,
    status: "active",
    description: "",
    category: null,
    observationExtract: false,
    observationCategory: "",
    variables: [],
    items: layout.fields.map(editorItemOf),
  };
  const questionnaire = buildQuestionnaire(values);
  questionnaire.code = [{ system: DOCUMENT_FORM_KIND_SYSTEM, code: DOCUMENT_FORM_KIND_CODE }];
  questionnaire.extension = [
    ...(questionnaire.extension ?? []),
    { url: DOCUMENT_FORM_EXT_URL, valueString: template.code },
  ];
  return questionnaire;
}

export function nextQuestionnaireVersion(current: string | null | undefined): string {
  const n = Number.parseInt(current ?? "", 10);
  return String(Number.isFinite(n) && n > 0 ? n + 1 : 1);
}

// ---- 回答との変換 ----

function answerOptionsOf(questionnaire: fhir4.Questionnaire | undefined, linkId: string): fhir4.QuestionnaireItemAnswerOption[] {
  return questionnaire?.item?.find((item) => item.linkId === linkId)?.answerOption ?? [];
}

/** 入力値を QuestionnaireResponse.item にする。空の項目は入れない。 */
export function buildDocumentFormResponseItems(
  layout: DocumentFormLayout,
  values: DocumentFormValues,
  questionnaire: fhir4.Questionnaire,
): fhir4.QuestionnaireResponseItem[] {
  const items: fhir4.QuestionnaireResponseItem[] = [];
  for (const field of layout.fields) {
    const value = values[field.id] ?? "";
    if (!value) continue;
    let answer: fhir4.QuestionnaireResponseItemAnswer | undefined;
    if (field.type === "select" || field.type === "checkbox") {
      const options = answerOptionsOf(questionnaire, field.id);
      const option =
        field.type === "checkbox"
          ? value === CHECKED_VALUE
            ? options[0]
            : undefined
          : options.find((o) => o.valueCoding?.display === value);
      if (option?.valueCoding) answer = { valueCoding: option.valueCoding };
    } else if (field.type === "date") {
      answer = { valueDate: value.slice(0, 10) };
    } else {
      answer = { valueString: value };
    }
    if (answer) items.push({ linkId: field.id, text: field.label, answer: [answer] });
  }
  return items;
}

/** 保存済みの回答から入力値を復元する(再編集)。レイアウトに無い項目は捨てる。 */
export function documentFormValuesFromResponse(
  response: fhir4.QuestionnaireResponse,
  layout: DocumentFormLayout,
): DocumentFormValues {
  const byLinkId = new Map((response.item ?? []).map((item) => [item.linkId, item]));
  const values: DocumentFormValues = {};
  for (const field of layout.fields) {
    const answer = byLinkId.get(field.id)?.answer?.[0];
    if (!answer) continue;
    if (field.type === "checkbox") {
      values[field.id] = answer.valueCoding ? CHECKED_VALUE : "";
    } else if (field.type === "select") {
      values[field.id] = answer.valueCoding?.display ?? "";
    } else if (field.type === "date") {
      values[field.id] = answer.valueDate ?? "";
    } else {
      values[field.id] = answer.valueString ?? "";
    }
  }
  return values;
}
