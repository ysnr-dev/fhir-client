// JASPEHR 実装ガイド v1.0.0 の Questionnaire プロファイルに準拠したテンプレートの
// 編集用中間表現(EditorItem)と FHIR リソースとの相互変換。
// https://jaspehr.jp/wp-content/docs/full-ig_v1.0.0/site/index.html
export const JASPEHR_QUESTIONNAIRE_PROFILE_URL =
  "http://www.hosp.ncgm.go.jp/JASPEHR/fhir/StructureDefinition/jaspehr-questionnaire";

// Advanced Rendering / Behavior 拡張(JASPEHR 採用分)
const ITEM_CONTROL_EXT_URL = "http://hl7.org/fhir/StructureDefinition/questionnaire-itemControl";
const ITEM_CONTROL_SYSTEM = "http://hl7.org/fhir/CodeSystem/questionnaire-item-control";
const CHOICE_ORIENTATION_EXT_URL =
  "http://hl7.org/fhir/StructureDefinition/questionnaire-choiceOrientation";
const HIDDEN_EXT_URL = "http://hl7.org/fhir/StructureDefinition/questionnaire-hidden";
const MAX_OCCURS_EXT_URL = "http://hl7.org/fhir/StructureDefinition/questionnaire-maxOccurs";
const MIN_VALUE_EXT_URL = "http://hl7.org/fhir/StructureDefinition/minValue";
const MAX_VALUE_EXT_URL = "http://hl7.org/fhir/StructureDefinition/maxValue";
const MAX_DECIMAL_PLACES_EXT_URL = "http://hl7.org/fhir/StructureDefinition/maxDecimalPlaces";
const UNIT_EXT_URL = "http://hl7.org/fhir/StructureDefinition/questionnaire-unit";
const UCUM_SYSTEM = "http://unitsofmeasure.org";
const REGEX_EXT_URL = "http://hl7.org/fhir/StructureDefinition/regex";
const DESIGN_NOTE_EXT_URL = "http://hl7.org/fhir/StructureDefinition/designNote";
// SDC 拡張。式言語は JASPEHR では text/fhirpath に固定。
const VARIABLE_EXT_URL = "http://hl7.org/fhir/StructureDefinition/variable";
const INITIAL_EXPRESSION_EXT_URL =
  "http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-initialExpression";
const CALCULATED_EXPRESSION_EXT_URL =
  "http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-calculatedExpression";
const FHIRPATH_LANGUAGE = "text/fhirpath";

// JASPEHR で許可される item.type(questionnaire-item-type-Jaspehr)
export const ITEM_TYPES = [
  "group",
  "display",
  "string",
  "text",
  "integer",
  "decimal",
  "date",
  "dateTime",
  "time",
  "choice",
] as const;

export type EditorItemType = (typeof ITEM_TYPES)[number];

export const ITEM_TYPE_LABELS: Record<EditorItemType, string> = {
  group: "グループ",
  display: "表示テキスト",
  string: "短文入力",
  text: "長文入力",
  integer: "整数入力",
  decimal: "小数入力",
  date: "日付入力",
  dateTime: "日時入力",
  time: "時刻入力",
  choice: "選択肢",
};

// questionnaire-item-control-Jaspehr で許可される描画形式
export const ITEM_CONTROLS = [
  { code: "drop-down", label: "ドロップダウン" },
  { code: "radio-button", label: "ラジオボタン" },
  { code: "check-box", label: "チェックボックス(複数選択)" },
  { code: "list", label: "リスト" },
  { code: "inline", label: "インライン" },
  { code: "text-box", label: "テキストボックス" },
] as const;

export const STATUS_OPTIONS = [
  { code: "draft", label: "下書き" },
  { code: "active", label: "有効" },
  { code: "retired", label: "廃止" },
  { code: "unknown", label: "不明" },
] as const;

export type QuestionnaireStatus = (typeof STATUS_OPTIONS)[number]["code"];

export function statusLabel(code: string | undefined): string {
  return STATUS_OPTIONS.find((s) => s.code === code)?.label ?? code ?? "";
}

// ---- エディタ用の中間表現 ----
//
// 数値系プロパティは入力途中の空文字を許容するため文字列で保持する(既存フォームの流儀)。
// id は linkId の編集に耐える React key 用の内部 ID で、FHIR リソースには出力しない。

export interface EditorAnswerOption {
  id: string;
  system: string;
  code: string;
  display: string;
  initialSelected: boolean;
}

// operator は JASPEHR 仕様で "=" 固定のため保持しない。
export interface EditorEnableWhen {
  id: string;
  question: string;
  answerSystem: string;
  answerCode: string;
}

export interface EditorVariable {
  id: string;
  name: string;
  expression: string;
}

export interface EditorItem {
  id: string;
  linkId: string;
  type: EditorItemType;
  text: string;
  required: boolean;
  hidden: boolean;
  designNote: string;
  initialValue: string;
  initialExpression: string;
  calculatedExpression: string;
  // group 専用
  repeats: boolean;
  maxOccurs: string;
  enableWhen: EditorEnableWhen[];
  children: EditorItem[];
  // choice 専用
  itemControl: string;
  choiceOrientation: "" | "horizontal" | "vertical";
  answerOptions: EditorAnswerOption[];
  // integer / decimal 専用
  minValue: string;
  maxValue: string;
  maxDecimalPlaces: string;
  unit: string;
  // string / text 専用
  maxLength: string;
  regex: string;
}

export interface QuestionnaireFormValues {
  url: string;
  version: string;
  name: string;
  title: string;
  status: QuestionnaireStatus;
  description: string;
  variables: EditorVariable[];
  items: EditorItem[];
}

let linkIdCounter = 0;

// 新規 item の linkId 初期値。ユーザーが編集可能な仮の値を採番する。
function nextLinkId(): string {
  linkIdCounter += 1;
  return `item-${Date.now().toString(36)}-${linkIdCounter}`;
}

export function newEditorItem(type: EditorItemType = "string"): EditorItem {
  return {
    id: crypto.randomUUID(),
    linkId: nextLinkId(),
    type,
    text: "",
    required: false,
    hidden: false,
    designNote: "",
    initialValue: "",
    initialExpression: "",
    calculatedExpression: "",
    repeats: false,
    maxOccurs: "",
    enableWhen: [],
    children: [],
    itemControl: type === "choice" ? "drop-down" : "",
    choiceOrientation: "",
    answerOptions: [],
    minValue: "",
    maxValue: "",
    maxDecimalPlaces: "",
    unit: "",
    maxLength: "",
    regex: "",
  };
}

export function newAnswerOption(): EditorAnswerOption {
  return { id: crypto.randomUUID(), system: "", code: "", display: "", initialSelected: false };
}

export function newEnableWhen(): EditorEnableWhen {
  return { id: crypto.randomUUID(), question: "", answerSystem: "", answerCode: "" };
}

export function newVariable(): EditorVariable {
  return { id: crypto.randomUUID(), name: "", expression: "" };
}

export function emptyQuestionnaireForm(): QuestionnaireFormValues {
  return {
    url: "",
    version: "1.0.0",
    name: "",
    title: "",
    status: "draft",
    description: "",
    variables: [],
    items: [newEditorItem()],
  };
}

// 型変更時に、変更後の型に該当しないプロパティを初期値へ戻す
// (choice→string 変更後に answerOptions が残ったまま build されるのを防ぐ)。
export function changeItemType(item: EditorItem, type: EditorItemType): EditorItem {
  const base = newEditorItem(type);
  return {
    ...base,
    id: item.id,
    linkId: item.linkId,
    text: item.text,
    required: type === "group" || type === "display" ? false : item.required,
    hidden: item.hidden,
    designNote: item.designNote,
    children: type === "group" ? item.children : [],
  };
}

// ---- item ツリーのイミュータブル操作 ----

export function updateItemById(
  items: EditorItem[],
  id: string,
  updater: (item: EditorItem) => EditorItem,
): EditorItem[] {
  return items.map((item) => {
    if (item.id === id) return updater(item);
    if (item.children.length === 0) return item;
    const children = updateItemById(item.children, id, updater);
    return children === item.children ? item : { ...item, children };
  });
}

export function removeItemById(items: EditorItem[], id: string): EditorItem[] {
  return items
    .filter((item) => item.id !== id)
    .map((item) =>
      item.children.length === 0 ? item : { ...item, children: removeItemById(item.children, id) },
    );
}

export function moveItemById(items: EditorItem[], id: string, direction: "up" | "down"): EditorItem[] {
  const index = items.findIndex((item) => item.id === id);
  if (index >= 0) {
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= items.length) return items;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  }
  return items.map((item) =>
    item.children.length === 0
      ? item
      : { ...item, children: moveItemById(item.children, id, direction) },
  );
}

// parentId が null ならルート直下の末尾に追加する。
export function appendChild(items: EditorItem[], parentId: string | null, child: EditorItem): EditorItem[] {
  if (parentId === null) return [...items, child];
  return updateItemById(items, parentId, (parent) => ({
    ...parent,
    children: [...parent.children, child],
  }));
}

export function findItemById(items: EditorItem[], id: string): EditorItem | undefined {
  for (const item of items) {
    if (item.id === id) return item;
    const found = findItemById(item.children, id);
    if (found) return found;
  }
  return undefined;
}

// enableWhen の参照先候補(jsp-2: 親階層の linkId のみ)。
// 対象 group を囲む各スコープ(ルート〜親)にある choice 型 item を集める。
// group 自身の配下は候補にならない。
export function enableWhenCandidates(items: EditorItem[], groupId: string): EditorItem[] {
  const result: EditorItem[] = [];

  function walk(scope: EditorItem[]): boolean {
    if (!scopeContains(scope, groupId)) return false;
    for (const item of scope) {
      if (item.id === groupId) continue;
      if (item.type === "choice") result.push(item);
    }
    const parent = scope.find((item) => item.id !== groupId && scopeContains(item.children, groupId));
    if (parent) walk(parent.children);
    return true;
  }

  function scopeContains(scope: EditorItem[], id: string): boolean {
    return scope.some((item) => item.id === id || scopeContains(item.children, id));
  }

  walk(items);
  return result;
}

// ---- FHIR リソースへの変換 (build) ----

function buildExpressionExt(url: string, expression: string, name?: string): fhir4.Extension {
  return {
    url,
    valueExpression: { language: FHIRPATH_LANGUAGE, expression, ...(name ? { name } : {}) },
  };
}

function buildItemExtensions(item: EditorItem): fhir4.Extension[] {
  const extensions: fhir4.Extension[] = [];

  if (item.hidden) extensions.push({ url: HIDDEN_EXT_URL, valueBoolean: true });
  if (item.designNote) extensions.push({ url: DESIGN_NOTE_EXT_URL, valueMarkdown: item.designNote });

  if (item.type === "choice") {
    if (item.itemControl) {
      extensions.push({
        url: ITEM_CONTROL_EXT_URL,
        valueCodeableConcept: {
          coding: [{ system: ITEM_CONTROL_SYSTEM, code: item.itemControl }],
        },
      });
    }
    if (item.choiceOrientation) {
      extensions.push({ url: CHOICE_ORIENTATION_EXT_URL, valueCode: item.choiceOrientation });
    }
  }

  if (item.type === "group" && item.repeats && item.maxOccurs) {
    extensions.push({ url: MAX_OCCURS_EXT_URL, valueInteger: Number(item.maxOccurs) });
  }

  if (item.type === "integer" || item.type === "decimal") {
    if (item.minValue) {
      extensions.push(
        item.type === "integer"
          ? { url: MIN_VALUE_EXT_URL, valueInteger: Number(item.minValue) }
          : { url: MIN_VALUE_EXT_URL, valueDecimal: Number(item.minValue) },
      );
    }
    if (item.maxValue) {
      extensions.push(
        item.type === "integer"
          ? { url: MAX_VALUE_EXT_URL, valueInteger: Number(item.maxValue) }
          : { url: MAX_VALUE_EXT_URL, valueDecimal: Number(item.maxValue) },
      );
    }
    if (item.type === "decimal" && item.maxDecimalPlaces) {
      extensions.push({ url: MAX_DECIMAL_PLACES_EXT_URL, valueInteger: Number(item.maxDecimalPlaces) });
    }
    if (item.unit) {
      extensions.push({
        url: UNIT_EXT_URL,
        valueCoding: { system: UCUM_SYSTEM, code: item.unit, display: item.unit },
      });
    }
  }

  if ((item.type === "string" || item.type === "text") && item.regex) {
    extensions.push({ url: REGEX_EXT_URL, valueString: item.regex });
  }

  if (item.initialExpression) {
    extensions.push(buildExpressionExt(INITIAL_EXPRESSION_EXT_URL, item.initialExpression));
  }
  if (item.calculatedExpression) {
    extensions.push(buildExpressionExt(CALCULATED_EXPRESSION_EXT_URL, item.calculatedExpression));
  }

  return extensions;
}

function buildInitial(item: EditorItem): fhir4.QuestionnaireItemInitial[] | undefined {
  if (!item.initialValue) return undefined;
  switch (item.type) {
    case "string":
    case "text":
      return [{ valueString: item.initialValue }];
    case "integer":
      return [{ valueInteger: Number(item.initialValue) }];
    case "decimal":
      return [{ valueDecimal: Number(item.initialValue) }];
    case "date":
      return [{ valueDate: item.initialValue }];
    case "dateTime":
      return [{ valueDateTime: item.initialValue }];
    case "time":
      return [{ valueTime: item.initialValue }];
    default:
      return undefined;
  }
}

function buildItem(item: EditorItem): fhir4.QuestionnaireItem {
  const extensions = buildItemExtensions(item);

  const result: fhir4.QuestionnaireItem = {
    linkId: item.linkId,
    type: item.type,
  };

  if (extensions.length) result.extension = extensions;
  if (item.text) result.text = item.text;
  if (item.required && item.type !== "group" && item.type !== "display") result.required = true;

  if (item.type === "group") {
    if (item.repeats) result.repeats = true;
    if (item.enableWhen.length) {
      result.enableWhen = item.enableWhen.map((ew) => ({
        question: ew.question,
        operator: "=",
        answerCoding: {
          ...(ew.answerSystem ? { system: ew.answerSystem } : {}),
          code: ew.answerCode,
        },
      }));
      if (item.enableWhen.length > 1) result.enableBehavior = "all";
    }
    if (item.children.length) result.item = item.children.map(buildItem);
  }

  if (item.type === "choice" && item.answerOptions.length) {
    result.answerOption = item.answerOptions.map((option) => ({
      valueCoding: {
        ...(option.system ? { system: option.system } : {}),
        code: option.code,
        ...(option.display ? { display: option.display } : {}),
      },
      ...(option.initialSelected ? { initialSelected: true } : {}),
    }));
  }

  if (item.type === "string" || item.type === "text") {
    if (item.maxLength) result.maxLength = Number(item.maxLength);
  }

  const initial = buildInitial(item);
  if (initial) result.initial = initial;

  return result;
}

export function buildQuestionnaire(
  values: QuestionnaireFormValues,
  questionnaireId?: string,
): fhir4.Questionnaire {
  const questionnaire: fhir4.Questionnaire = {
    resourceType: "Questionnaire",
    meta: { profile: [JASPEHR_QUESTIONNAIRE_PROFILE_URL] },
    url: values.url,
    version: values.version,
    name: values.name,
    title: values.title,
    status: values.status,
    // JASPEHR プロファイルで 1..1。本アプリのテンプレートは患者を対象とする。
    subjectType: ["Patient"],
    item: values.items.map(buildItem),
  };

  if (questionnaireId) questionnaire.id = questionnaireId;
  if (values.description) questionnaire.description = values.description;
  if (values.variables.length) {
    questionnaire.extension = values.variables.map((v) =>
      buildExpressionExt(VARIABLE_EXT_URL, v.expression, v.name),
    );
  }

  return questionnaire;
}

// ---- FHIR リソースからの復元 (parse) ----
//
// エディタが扱わない要素・拡張は復元されない(編集して保存すると失われる)。
// 本アプリで作成したテンプレートの編集を前提とする。

function extensionByUrl(extensions: fhir4.Extension[] | undefined, url: string): fhir4.Extension | undefined {
  return extensions?.find((ext) => ext.url === url);
}

function numberToString(value: number | undefined): string {
  return value === undefined ? "" : String(value);
}

function parseInitialValue(item: fhir4.QuestionnaireItem): string {
  const initial = item.initial?.[0];
  if (!initial) return "";
  return (
    initial.valueString ??
    initial.valueDate ??
    initial.valueDateTime ??
    initial.valueTime ??
    (initial.valueInteger !== undefined ? String(initial.valueInteger) : undefined) ??
    (initial.valueDecimal !== undefined ? String(initial.valueDecimal) : undefined) ??
    ""
  );
}

function parseItem(item: fhir4.QuestionnaireItem): EditorItem {
  const ext = item.extension;
  const type = (ITEM_TYPES as readonly string[]).includes(item.type)
    ? (item.type as EditorItemType)
    : "string";

  const minValueExt = extensionByUrl(ext, MIN_VALUE_EXT_URL);
  const maxValueExt = extensionByUrl(ext, MAX_VALUE_EXT_URL);

  return {
    id: crypto.randomUUID(),
    linkId: item.linkId,
    type,
    text: item.text ?? "",
    required: item.required ?? false,
    hidden: extensionByUrl(ext, HIDDEN_EXT_URL)?.valueBoolean ?? false,
    designNote: extensionByUrl(ext, DESIGN_NOTE_EXT_URL)?.valueMarkdown ?? "",
    initialValue: parseInitialValue(item),
    initialExpression:
      extensionByUrl(ext, INITIAL_EXPRESSION_EXT_URL)?.valueExpression?.expression ?? "",
    calculatedExpression:
      extensionByUrl(ext, CALCULATED_EXPRESSION_EXT_URL)?.valueExpression?.expression ?? "",
    repeats: item.repeats ?? false,
    maxOccurs: numberToString(extensionByUrl(ext, MAX_OCCURS_EXT_URL)?.valueInteger),
    enableWhen: (item.enableWhen ?? []).map((ew) => ({
      id: crypto.randomUUID(),
      question: ew.question,
      answerSystem: ew.answerCoding?.system ?? "",
      answerCode: ew.answerCoding?.code ?? "",
    })),
    children: (item.item ?? []).map(parseItem),
    itemControl:
      extensionByUrl(ext, ITEM_CONTROL_EXT_URL)?.valueCodeableConcept?.coding?.[0]?.code ?? "",
    choiceOrientation: (extensionByUrl(ext, CHOICE_ORIENTATION_EXT_URL)?.valueCode ?? "") as
      | ""
      | "horizontal"
      | "vertical",
    answerOptions: (item.answerOption ?? []).map((option) => ({
      id: crypto.randomUUID(),
      system: option.valueCoding?.system ?? "",
      code: option.valueCoding?.code ?? "",
      display: option.valueCoding?.display ?? "",
      initialSelected: option.initialSelected ?? false,
    })),
    minValue: numberToString(minValueExt?.valueInteger ?? minValueExt?.valueDecimal),
    maxValue: numberToString(maxValueExt?.valueInteger ?? maxValueExt?.valueDecimal),
    maxDecimalPlaces: numberToString(extensionByUrl(ext, MAX_DECIMAL_PLACES_EXT_URL)?.valueInteger),
    unit: extensionByUrl(ext, UNIT_EXT_URL)?.valueCoding?.code ?? "",
    maxLength: numberToString(item.maxLength),
    regex: extensionByUrl(ext, REGEX_EXT_URL)?.valueString ?? "",
  };
}

export function parseQuestionnaireForm(questionnaire: fhir4.Questionnaire): QuestionnaireFormValues {
  const status = STATUS_OPTIONS.some((s) => s.code === questionnaire.status)
    ? (questionnaire.status as QuestionnaireStatus)
    : "draft";

  return {
    url: questionnaire.url ?? "",
    version: questionnaire.version ?? "",
    name: questionnaire.name ?? "",
    title: questionnaire.title ?? "",
    status,
    description: questionnaire.description ?? "",
    variables: (questionnaire.extension ?? [])
      .filter((ext) => ext.url === VARIABLE_EXT_URL)
      .map((ext) => ({
        id: crypto.randomUUID(),
        name: ext.valueExpression?.name ?? "",
        expression: ext.valueExpression?.expression ?? "",
      })),
    items: (questionnaire.item ?? []).map(parseItem),
  };
}

// ---- 一覧表示用 ----

export interface QuestionnaireSummary {
  id: string;
  title: string;
  name: string;
  version: string;
  status: string;
  statusLabel: string;
  lastUpdated: string;
}

export function summarizeQuestionnaire(questionnaire: fhir4.Questionnaire): QuestionnaireSummary {
  const lastUpdated = questionnaire.meta?.lastUpdated;
  return {
    id: questionnaire.id ?? "",
    title: questionnaire.title ?? "",
    name: questionnaire.name ?? "",
    version: questionnaire.version ?? "",
    status: questionnaire.status ?? "",
    statusLabel: statusLabel(questionnaire.status),
    lastUpdated: lastUpdated ? new Date(lastUpdated).toLocaleString("ja-JP") : "",
  };
}

// ---- バリデーション ----

// jsp-4: linkId は半角英数字と一部記号のみ・1〜255文字
const LINK_ID_PATTERN = /^[A-Za-z0-9\-.!#%/:;?@_~]{1,255}$/;
// jsp-5: name は半角英数字記号のみ(15バイト以下は別途チェック)
const NAME_PATTERN = /^[\x21-\x7e]+$/;
const NAME_MAX_BYTES = 15;

function itemLabel(item: EditorItem, position: string): string {
  return item.text ? `「${item.text}」` : `(${position})`;
}

function validateItems(
  items: EditorItem[],
  ancestors: EditorItem[],
  seenLinkIds: Map<string, EditorItem>,
  position: string,
): string | null {
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const pos = position ? `${position}-${i + 1}` : String(i + 1);
    const label = `項目${itemLabel(item, pos)}`;

    if (!item.linkId) return `${label}: linkId を入力してください。`;
    if (!LINK_ID_PATTERN.test(item.linkId)) {
      return `${label}: linkId は半角英数字と記号(- . ! # % / : ; ? @ _ ~)のみ、255文字以内で入力してください。`;
    }
    if (seenLinkIds.has(item.linkId)) {
      return `linkId「${item.linkId}」が重複しています。linkId はテンプレート全体で一意にしてください。`;
    }
    seenLinkIds.set(item.linkId, item);

    if (item.type !== "display" && item.type !== "group" && !item.text) {
      return `${label}: 質問文(表示文言)を入力してください。`;
    }
    if (item.type === "display" && !item.text) {
      return `${label}: 表示するテキストを入力してください。`;
    }

    if (item.initialExpression && item.calculatedExpression) {
      return `${label}: 初期値式と計算式は同時に設定できません(jsp-7)。`;
    }

    if (item.type === "group") {
      if (item.children.length === 0) {
        return `${label}: グループには1つ以上の子項目が必要です。`;
      }
      if (item.repeats && item.maxOccurs) {
        const n = Number(item.maxOccurs);
        if (!Number.isInteger(n) || n < 1) {
          return `${label}: 最大繰り返し数は1以上の整数で入力してください。`;
        }
      }
      for (const ew of item.enableWhen) {
        if (!ew.question) return `${label}: 表示条件の参照先項目を選択してください。`;
        const referenced = ancestors.find((a) => a.linkId === ew.question);
        const inScope =
          referenced ??
          [...seenLinkIds.values()].find((s) => s.linkId === ew.question && s.type === "choice");
        if (!inScope) {
          return `${label}: 表示条件の参照先「${ew.question}」が親階層に見つかりません。`;
        }
        if (!ew.answerCode) return `${label}: 表示条件の比較値を選択してください。`;
      }
      const childError = validateItems(item.children, [...ancestors, ...items], seenLinkIds, pos);
      if (childError) return childError;
    }

    if (item.type === "choice") {
      if (!item.itemControl) return `${label}: 描画形式を選択してください(jsp-6)。`;
      if (item.answerOptions.length === 0) {
        return `${label}: 選択肢を1つ以上追加してください。`;
      }
      const codes = new Set<string>();
      for (const option of item.answerOptions) {
        if (!option.code) return `${label}: 選択肢のコードを入力してください。`;
        if (codes.has(option.code)) {
          return `${label}: 選択肢のコード「${option.code}」が重複しています。`;
        }
        codes.add(option.code);
      }
      if (item.itemControl !== "check-box") {
        const selected = item.answerOptions.filter((o) => o.initialSelected).length;
        if (selected > 1) {
          return `${label}: 初期選択は1つまでです(チェックボックス以外)。`;
        }
      }
    }

    if (item.type === "integer" || item.type === "decimal") {
      const isInt = item.type === "integer";
      const check = (value: string, name: string): string | null => {
        if (!value) return null;
        const n = Number(value);
        if (Number.isNaN(n)) return `${label}: ${name}は数値で入力してください。`;
        if (isInt && !Number.isInteger(n)) return `${label}: ${name}は整数で入力してください。`;
        return null;
      };
      const minError = check(item.minValue, "最小値");
      if (minError) return minError;
      const maxError = check(item.maxValue, "最大値");
      if (maxError) return maxError;
      if (item.minValue && item.maxValue && Number(item.minValue) > Number(item.maxValue)) {
        return `${label}: 最小値は最大値以下にしてください。`;
      }
      if (!isInt && item.maxDecimalPlaces) {
        const n = Number(item.maxDecimalPlaces);
        if (!Number.isInteger(n) || n < 0) {
          return `${label}: 小数点以下桁数は0以上の整数で入力してください。`;
        }
      }
      if (item.initialValue) {
        const initialError = check(item.initialValue, "初期値");
        if (initialError) return initialError;
      }
    }

    if (item.type === "string" || item.type === "text") {
      if (item.maxLength) {
        const n = Number(item.maxLength);
        if (!Number.isInteger(n) || n < 1) {
          return `${label}: 最大文字数は1以上の整数で入力してください。`;
        }
      }
      if (item.regex) {
        try {
          new RegExp(item.regex);
        } catch {
          return `${label}: 正規表現が不正です。`;
        }
      }
    }
  }
  return null;
}

export function validateQuestionnaireForm(values: QuestionnaireFormValues): string | null {
  if (!values.url) return "URL(一意識別子)を入力してください。";
  if (!/^https?:\/\/.+/.test(values.url)) {
    return "URL は http:// または https:// で始まる形式で入力してください。";
  }
  if (!values.version) return "バージョンを入力してください。";
  if (!values.name) return "名前(テンプレートコード)を入力してください。";
  if (!NAME_PATTERN.test(values.name)) {
    return "名前は半角英数字・記号のみで入力してください(jsp-5)。";
  }
  if (new TextEncoder().encode(values.name).length > NAME_MAX_BYTES) {
    return `名前は${NAME_MAX_BYTES}バイト以下で入力してください(jsp-5)。`;
  }
  if (!values.title) return "タイトルを入力してください。";

  const varNames = new Set<string>();
  for (const variable of values.variables) {
    if (!variable.name) return "変数の名前を入力してください。";
    if (varNames.has(variable.name)) return `変数名「${variable.name}」が重複しています。`;
    varNames.add(variable.name);
    if (!variable.expression) return `変数「${variable.name}」の式を入力してください。`;
  }

  if (values.items.length === 0) return "項目を1つ以上追加してください。";

  return validateItems(values.items, [], new Map(), "");
}
