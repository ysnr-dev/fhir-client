import { Fragment, useMemo, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import fhirpath from "fhirpath";
// value[x] を "value" で参照できるようにする R4 のモデル情報。
import fhirpathR4Model from "fhirpath/fhir-context/r4";
import { loginAutofillValue, type LoginAutofillSource } from "../fhir/loginAutofill";
import {
  organizationFieldAnswers,
  organizationFieldTargets,
  type OrganizationFieldTarget,
} from "../fhir/organizationField";
import { organizationDisplayName } from "../fhir/organizationHelpers";
import {
  practitionerFieldAnswers,
  practitionerFieldTargets,
  practitionerRoleDefaultIn,
  type PractitionerFieldTarget,
} from "../fhir/practitionerField";
import {
  annotatedImageExtension,
  annotationOf,
  binaryIdFromAttachment,
  imageBinaryEntry,
  itemMediaOf,
} from "../fhir/schemaImage";
import { OrganizationSearchModal } from "./OrganizationSearchModal";
import { PractitionerSearchModal } from "./PractitionerSearchModal";
import { SchemaImageField, type AnnotationState } from "./SchemaImageField";

// Questionnaire の item ツリーからテンプレート入力フォームを再帰レンダリングする。
// onSubmit 指定時は入力フォーム(送信で QuestionnaireResponse.item を返す)、
// 未指定時はプレビュー(回答はローカル state のみで保持し、どこにも保存しない)。
//
// 回答のキーは「インスタンスパス」。非繰り返し項目は "親グループ.linkId"、
// 繰り返しグループ配下は "グループ#0.linkId" のようにインスタンス番号を挟む。

const HIDDEN_EXT_URL = "http://hl7.org/fhir/StructureDefinition/questionnaire-hidden";
const ITEM_CONTROL_EXT_URL = "http://hl7.org/fhir/StructureDefinition/questionnaire-itemControl";
const CHOICE_ORIENTATION_EXT_URL =
  "http://hl7.org/fhir/StructureDefinition/questionnaire-choiceOrientation";
const MAX_OCCURS_EXT_URL = "http://hl7.org/fhir/StructureDefinition/questionnaire-maxOccurs";
const MIN_VALUE_EXT_URL = "http://hl7.org/fhir/StructureDefinition/minValue";
const MAX_VALUE_EXT_URL = "http://hl7.org/fhir/StructureDefinition/maxValue";
const MAX_DECIMAL_PLACES_EXT_URL = "http://hl7.org/fhir/StructureDefinition/maxDecimalPlaces";
const UNIT_EXT_URL = "http://hl7.org/fhir/StructureDefinition/questionnaire-unit";
const REGEX_EXT_URL = "http://hl7.org/fhir/StructureDefinition/regex";
const VARIABLE_EXT_URL = "http://hl7.org/fhir/StructureDefinition/variable";
const CALCULATED_EXPRESSION_EXT_URL =
  "http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-calculatedExpression";
const INITIAL_EXPRESSION_EXT_URL =
  "http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-initialExpression";

type AnswerValue = string | string[];
type Answers = Record<string, AnswerValue>;
// シェーマ画像への描き込み。回答(Answers)は文字列型のため別レコードで持つ。
// キーは Answers と同じインスタンスパス(繰り返しグループ自体は "group#0")。
type Annotations = Record<string, AnnotationState>;

function ext(item: fhir4.QuestionnaireItem, url: string): fhir4.Extension | undefined {
  return item.extension?.find((e) => e.url === url);
}

function isHidden(item: fhir4.QuestionnaireItem): boolean {
  return ext(item, HIDDEN_EXT_URL)?.valueBoolean === true;
}

function itemControlOf(item: fhir4.QuestionnaireItem): string {
  return ext(item, ITEM_CONTROL_EXT_URL)?.valueCodeableConcept?.coding?.[0]?.code ?? "";
}

function numberExt(item: fhir4.QuestionnaireItem, url: string): number | undefined {
  const extension = ext(item, url);
  return extension?.valueInteger ?? extension?.valueDecimal;
}

function calculatedExpressionOf(item: fhir4.QuestionnaireItem): string {
  return ext(item, CALCULATED_EXPRESSION_EXT_URL)?.valueExpression?.expression ?? "";
}

function initialExpressionOf(item: fhir4.QuestionnaireItem): string {
  return ext(item, INITIAL_EXPRESSION_EXT_URL)?.valueExpression?.expression ?? "";
}

// 初期回答(initial.value[x] / answerOption.initialSelected)を組み立てる。
// 繰り返しグループは最初のインスタンス(#0)にのみ適用する。
function collectInitialAnswers(
  items: fhir4.QuestionnaireItem[] | undefined,
  prefix: string,
  answers: Answers,
): Answers {
  for (const item of items ?? []) {
    const key = prefix + item.linkId;
    if (item.type === "group") {
      const childPrefix = item.repeats ? `${key}#0.` : `${key}.`;
      collectInitialAnswers(item.item, childPrefix, answers);
      continue;
    }
    if (item.type === "choice") {
      const selected = (item.answerOption ?? [])
        .filter((o) => o.initialSelected)
        .map((o) => o.valueCoding?.code ?? "");
      if (selected.length) {
        answers[key] = itemControlOf(item) === "check-box" ? selected : selected[0];
      }
      // choice 配下の条件付きグループ内の初期値も収集する。
      collectInitialAnswers(item.item, `${key}.`, answers);
      continue;
    }
    const initial = item.initial?.[0];
    if (!initial) continue;
    const value =
      initial.valueString ??
      initial.valueDate ??
      initial.valueDateTime ??
      initial.valueTime ??
      (initial.valueInteger !== undefined ? String(initial.valueInteger) : undefined) ??
      (initial.valueDecimal !== undefined ? String(initial.valueDecimal) : undefined);
    if (value !== undefined) answers[key] = value;
  }
  return answers;
}

// initialExpression(SDC)を評価して初期回答を設定する。実行時コンテキスト
// (%変数。populateContext.ts 参照)が与えられた新規作成時のみ適用され、
// initial.value[x] / initialSelected で既に値がある項目は上書きしない。
function applyInitialExpressions(
  items: fhir4.QuestionnaireItem[] | undefined,
  answers: Answers,
  context: Record<string, unknown>,
): Answers {
  // 回答前の評価なので、式のベースリソースは空の QuestionnaireResponse で足りる
  // (初期値式は %変数 参照が主。回答参照は空を返す)。
  const resource: fhir4.QuestionnaireResponse = {
    resourceType: "QuestionnaireResponse",
    status: "in-progress",
  };

  const walk = (list: fhir4.QuestionnaireItem[] | undefined, prefix: string) => {
    for (const item of list ?? []) {
      const key = prefix + item.linkId;
      if (item.type === "group") {
        walk(item.item, item.repeats ? `${key}#0.` : `${key}.`);
        continue;
      }
      // choice 配下の条件付きグループ。
      if (item.item?.length) walk(item.item, `${key}.`);

      const expression = initialExpressionOf(item);
      if (!expression || answers[key] !== undefined) continue;
      try {
        const values = fhirpath.evaluate(resource, expression, context, fhirpathR4Model) as unknown[];
        const value = values[0];
        if (typeof value === "string" && value !== "") answers[key] = value;
        else if (typeof value === "number") answers[key] = String(value);
      } catch (e) {
        console.warn(`初期値式の評価に失敗しました(${item.linkId}):`, e);
      }
    }
  };

  walk(items, "");
  return answers;
}

// ログイン中の医療従事者(と所属医療機関)から初期回答を埋める(loginAutofill.ts)。
// 新規作成時のみ適用する。初期値・初期値式より後に適用して上書きするが、
// ログイン側に登録が無い項目(値が空)は既存の初期値をそのまま残す。
function applyLoginAutofill(
  items: fhir4.QuestionnaireItem[] | undefined,
  answers: Answers,
  source: LoginAutofillSource,
): Answers {
  const walk = (list: fhir4.QuestionnaireItem[] | undefined, prefix: string) => {
    for (const item of list ?? []) {
      const key = prefix + item.linkId;
      if (item.type === "group") {
        walk(item.item, item.repeats ? `${key}#0.` : `${key}.`);
        continue;
      }
      // choice 配下の条件付きグループ。
      if (item.item?.length) walk(item.item, `${key}.`);

      const value = loginAutofillValue(item, source);
      if (value) answers[key] = value;
    }
  };

  walk(items, "");
  return answers;
}

function answerToString(answer: fhir4.QuestionnaireResponseItemAnswer): string {
  return (
    answer.valueString ??
    answer.valueDate ??
    answer.valueDateTime ??
    answer.valueTime ??
    answer.valueCoding?.code ??
    (answer.valueInteger !== undefined ? String(answer.valueInteger) : undefined) ??
    (answer.valueDecimal !== undefined ? String(answer.valueDecimal) : undefined) ??
    ""
  );
}

// 保存済み QuestionnaireResponse から回答 state を復元する。
// 繰り返しグループは同じ linkId の response item がインスタンス数だけ並ぶ。
function collectResponseAnswers(
  qItems: fhir4.QuestionnaireItem[] | undefined,
  rItems: fhir4.QuestionnaireResponseItem[] | undefined,
  prefix: string,
  answers: Answers,
  counts: Record<string, number>,
  annotations: Annotations,
): void {
  const restoreAnnotation = (key: string, r: fhir4.QuestionnaireResponseItem | undefined) => {
    const binaryId = r ? binaryIdFromAttachment(annotationOf(r)) : null;
    if (binaryId) annotations[key] = { binaryId, dataUrl: null };
  };

  for (const q of qItems ?? []) {
    const key = prefix + q.linkId;
    const matches = (rItems ?? []).filter((r) => r.linkId === q.linkId);
    if (q.type === "group") {
      if (q.repeats) {
        if (matches.length) counts[key] = matches.length;
        matches.forEach((m, i) => {
          restoreAnnotation(`${key}#${i}`, m);
          collectResponseAnswers(q.item, m.item, `${key}#${i}.`, answers, counts, annotations);
        });
      } else if (matches[0]) {
        restoreAnnotation(key, matches[0]);
        collectResponseAnswers(q.item, matches[0].item, `${key}.`, answers, counts, annotations);
      }
      continue;
    }
    restoreAnnotation(key, matches[0]);
    if (q.type === "display") continue;
    // choice 配下の条件付きグループの回答は choice の response item の item に入る。
    if (q.item?.length) {
      collectResponseAnswers(q.item, matches[0]?.item, `${key}.`, answers, counts, annotations);
    }
    // 計算式項目の値は表示・保存時に再計算されるため復元しない。
    if (calculatedExpressionOf(q)) continue;

    const answerList = matches[0]?.answer ?? [];
    if (answerList.length === 0) continue;
    const values = answerList.map(answerToString);
    answers[key] =
      q.type === "choice" && itemControlOf(q) === "check-box" ? values : values[0];
  }
}

interface InitialState {
  answers: Answers;
  counts: Record<string, number>;
  annotations: Annotations;
}

function buildInitialState(
  questionnaire: fhir4.Questionnaire,
  initialResponse: fhir4.QuestionnaireResponse | undefined,
  expressionContext: Record<string, unknown> | undefined,
  loginAutofill: LoginAutofillSource | undefined,
): InitialState {
  if (!initialResponse) {
    const answers = collectInitialAnswers(questionnaire.item, "", {});
    if (expressionContext) applyInitialExpressions(questionnaire.item, answers, expressionContext);
    if (loginAutofill) applyLoginAutofill(questionnaire.item, answers, loginAutofill);
    return { answers, counts: {}, annotations: {} };
  }
  const answers: Answers = {};
  const counts: Record<string, number> = {};
  const annotations: Annotations = {};
  collectResponseAnswers(questionnaire.item, initialResponse.item, "", answers, counts, annotations);
  return { answers, counts, annotations };
}

interface BuildOptions {
  // 表示条件(enableWhen)を満たさないグループを除外する(保存用)。
  enabledOnly?: boolean;
  // 計算式項目の値を評価して含める(保存用)。
  evaluate?: (expression: string) => string;
  // シェーマ描き込みを extension として含める(保存用。binaryId 確定済みが前提)。
  annotations?: Annotations;
}

// 回答から QuestionnaireResponse.item ツリーを組み立てる。
// オプション未指定時は式評価用のその場限りのツリーを返す。
function buildResponseItems(
  items: fhir4.QuestionnaireItem[] | undefined,
  prefix: string,
  answers: Answers,
  counts: Record<string, number>,
  options: BuildOptions = {},
): fhir4.QuestionnaireResponseItem[] {
  const result: fhir4.QuestionnaireResponseItem[] = [];
  const annotationExt = (instanceKey: string): fhir4.Extension[] | undefined => {
    const binaryId = options.annotations?.[instanceKey]?.binaryId;
    return binaryId ? [annotatedImageExtension(binaryId)] : undefined;
  };

  for (const item of items ?? []) {
    const key = prefix + item.linkId;
    if (item.type === "group") {
      if (options.enabledOnly && !isEnabled(item, prefix, answers)) continue;
      const instances = item.repeats ? (counts[key] ?? 1) : 1;
      for (let i = 0; i < instances; i += 1) {
        const instanceKey = item.repeats ? `${key}#${i}` : key;
        const childPrefix = `${instanceKey}.`;
        const children = buildResponseItems(item.item, childPrefix, answers, counts, options);
        const extension = annotationExt(instanceKey);
        if (children.length === 0 && !extension) continue;
        result.push({
          linkId: item.linkId,
          ...(item.text ? { text: item.text } : {}),
          ...(extension ? { extension } : {}),
          ...(children.length ? { item: children } : {}),
        });
      }
      continue;
    }
    if (item.type === "display") {
      // display 項目は通常保存しないが、描き込みがあるときだけ emit する。
      const extension = annotationExt(key);
      if (extension) {
        result.push({ linkId: item.linkId, ...(item.text ? { text: item.text } : {}), extension });
      }
      continue;
    }

    const calculated = calculatedExpressionOf(item);
    const raw =
      calculated && options.evaluate ? options.evaluate(calculated) : answers[key];

    const values = raw === undefined || raw === "" ? [] : Array.isArray(raw) ? raw : [raw];
    const answerList: fhir4.QuestionnaireResponseItemAnswer[] = values
      .map((value) => {
        switch (item.type) {
          case "integer":
            return { valueInteger: Number(value) };
          case "decimal":
            return { valueDecimal: Number(value) };
          case "date":
            return { valueDate: value };
          case "dateTime":
            return { valueDateTime: value };
          case "time":
            return { valueTime: value };
          case "choice": {
            const option = item.answerOption?.find((o) => o.valueCoding?.code === value);
            return { valueCoding: option?.valueCoding ?? { code: value } };
          }
          default:
            return { valueString: value };
        }
      })
      .filter((a) => !("valueInteger" in a && Number.isNaN(a.valueInteger)))
      .filter((a) => !("valueDecimal" in a && Number.isNaN(a.valueDecimal)));

    // choice 配下の条件付きグループ。表示条件は再帰先の group 分岐(isEnabled)で評価される。
    const children = item.item?.length
      ? buildResponseItems(item.item, `${key}.`, answers, counts, options)
      : [];

    const extension = annotationExt(key);
    if (answerList.length || children.length || extension) {
      result.push({
        linkId: item.linkId,
        ...(item.text ? { text: item.text } : {}),
        ...(extension ? { extension } : {}),
        ...(answerList.length ? { answer: answerList } : {}),
        ...(children.length ? { item: children } : {}),
      });
    }
  }
  return result;
}

// enableWhen の参照先を解決する。jsp-2 で参照先は親階層に限られるため、
// 自分のスコープ(prefix)から外側のスコープへ順に辿って最初に見つかった回答を返す。
function resolveAnswer(answers: Answers, prefix: string, linkId: string): AnswerValue | undefined {
  let current = prefix;
  for (;;) {
    const value = answers[current + linkId];
    if (value !== undefined) return value;
    if (current === "") return undefined;
    // 末尾のスコープ("group." や "group#0.")をひとつ外す。
    const trimmed = current.slice(0, -1);
    const lastDot = trimmed.lastIndexOf(".");
    current = lastDot === -1 ? "" : trimmed.slice(0, lastDot + 1);
  }
}

function isEnabled(item: fhir4.QuestionnaireItem, prefix: string, answers: Answers): boolean {
  if (!item.enableWhen?.length) return true;
  // JASPEHR では演算子 "="・Coding 比較・enableWhen は最大1件(enableBehavior 禁止)。
  // 旧データや外部リソースの複数条件にも耐えるよう all 既定で評価する。
  const results = item.enableWhen.map((ew) => {
    const answer = resolveAnswer(answers, prefix, ew.question);
    const code = ew.answerCoding?.code;
    if (answer === undefined || code === undefined) return false;
    return Array.isArray(answer) ? answer.includes(code) : answer === code;
  });
  return item.enableBehavior === "any" ? results.some(Boolean) : results.every(Boolean);
}

interface QuestionnaireResponseFormProps {
  questionnaire: fhir4.Questionnaire;
  // 編集・表示時に回答を復元する保存済みリソース。
  initialResponse?: fhir4.QuestionnaireResponse;
  readOnly?: boolean;
  // 指定時は form として描画し、送信時に保存用の item ツリーを渡す。
  // imageEntries は新しく描き込んだシェーマ画像の Binary 作成エントリで、
  // 回答本体と同じ transaction Bundle で保存する。
  onSubmit?: (
    items: fhir4.QuestionnaireResponseItem[],
    imageEntries: fhir4.BundleEntry[],
  ) => void;
  submitLabel?: string;
  submitting?: boolean;
  // 初期値式・計算式から参照できる実行時コンテキスト(%変数名 → 値)。
  // 新規作成時に与えると initialExpression を評価して初期回答にする
  // (populateContext.ts の buildPopulateContext で組み立てる)。
  expressionContext?: Record<string, unknown>;
  // ログイン中の医療従事者・所属医療機関。新規作成時に与えると、自動入力を設定した
  // 項目(loginAutofill.ts)の初期回答になる。初期回答はマウント時に一度だけ確定
  // するため、呼び出し側は取得完了を待ってからフォームを描画すること。
  loginAutofill?: LoginAutofillSource;
  // フォーム先頭(質問項目の前)に描画するメタ情報フィールド。
  children?: ReactNode;
}

export function QuestionnaireResponseForm({
  questionnaire,
  initialResponse,
  readOnly = false,
  onSubmit,
  submitLabel = "登録",
  submitting = false,
  expressionContext,
  loginAutofill,
  children,
}: QuestionnaireResponseFormProps) {
  const [initialState] = useState(() =>
    buildInitialState(questionnaire, initialResponse, expressionContext, loginAutofill),
  );
  const [answers, setAnswers] = useState<Answers>(initialState.answers);
  // 繰り返しグループのインスタンス数(キーはグループのインスタンスパス)。
  const [counts, setCounts] = useState<Record<string, number>>(initialState.counts);
  // シェーマ画像への描き込み(キーはインスタンスパス)。
  const [annotations, setAnnotations] = useState<Annotations>(initialState.annotations);
  // 選択中のグループ(その時点の子プレフィックスごと保持する。入れ子や繰り返しで
  // プレフィックスは動的に決まるため、後から組み立てない)。
  const [organizationPicker, setOrganizationPicker] = useState<{
    prefix: string;
    targets: OrganizationFieldTarget[];
  } | null>(null);
  const [practitionerPicker, setPractitionerPicker] = useState<{
    prefix: string;
    targets: PractitionerFieldTarget[];
    roleDefault: string;
    /** 同じグループの「医療機関の名称」項目のキー(所属で絞り込む手掛かり)。 */
    organizationNameKey?: string;
  } | null>(null);
  // グループごとに選んだ医療機関(医療従事者を所属で絞り込むために覚えておく)。
  const [selectedOrganizations, setSelectedOrganizations] = useState<
    Record<string, { id: string; name: string }>
  >({});

  // 必須マークの入力強制はフォーム(保存あり)のときのみ行う。
  const requireInputs = Boolean(onSubmit) && !readOnly;

  // 式評価用の QuestionnaireResponse と変数値。回答が変わるたびに引き直す。
  const expressionEnv = useMemo(() => {
    const response: fhir4.QuestionnaireResponse = {
      resourceType: "QuestionnaireResponse",
      status: "in-progress",
      item: buildResponseItems(questionnaire.item, "", answers, counts),
    };
    const env: Record<string, unknown> = { ...expressionContext, resource: response };
    for (const extension of questionnaire.extension ?? []) {
      if (extension.url !== VARIABLE_EXT_URL) continue;
      const name = extension.valueExpression?.name;
      const expression = extension.valueExpression?.expression;
      if (!name || !expression) continue;
      try {
        const values = fhirpath.evaluate(response, expression, env, fhirpathR4Model) as unknown[];
        env[name] = values[0];
      } catch (e) {
        console.warn(`変数 %${name} の評価に失敗しました:`, e);
        env[name] = undefined;
      }
    }
    return { response, env };
  }, [questionnaire, answers, counts, expressionContext]);

  function evaluateCalculated(expression: string): string {
    try {
      const values = fhirpath.evaluate(
        expressionEnv.response,
        expression,
        expressionEnv.env,
        fhirpathR4Model,
      ) as unknown[];
      const value = values[0];
      if (value === undefined || value === null) return "";
      if (typeof value === "number") return String(Math.round(value * 100) / 100);
      return String(value);
    } catch (e) {
      console.warn("計算式の評価に失敗しました:", e);
      return "";
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!onSubmit) return;

    // 未保存の描き込み(dataUrl のみ)は Binary 作成エントリにして、回答本体と
    // 同じ transaction Bundle で保存する。item 側にはいったん Bundle 内の
    // プレースホルダを入れ、実 ID への解決は上流に任せる。
    const imageEntries: fhir4.BundleEntry[] = [];
    const resolved: Annotations = { ...annotations };
    for (const [key, annotation] of Object.entries(annotations)) {
      if (!annotation.dataUrl || annotation.binaryId) continue;
      const { placeholder, entry } = imageBinaryEntry(annotation.dataUrl, "image/png");
      imageEntries.push(entry);
      resolved[key] = { binaryId: placeholder, dataUrl: annotation.dataUrl };
    }

    onSubmit(
      buildResponseItems(questionnaire.item, "", answers, counts, {
        enabledOnly: true,
        evaluate: evaluateCalculated,
        annotations: resolved,
      }),
      imageEntries,
    );
  }

  function handleKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    // input 上での Enter による暗黙の form submit を抑止する。
    if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
      e.preventDefault();
    }
  }

  function setAnswer(key: string, value: AnswerValue) {
    setAnswers((current) => ({ ...current, [key]: value }));
  }

  // 選択した内容で対象グループの項目をまとめて置き換える。未登録の項目は空にする
  // (A 病院の FAX が B 病院の欄に残る、といった取り違えを防ぐため、部分的な
  // マージはしない)。入力済みの欄を上書きするときだけ確認する。
  function applyPickedValues(
    targets: { key: string; label: string }[],
    patch: Record<string, string>,
    what: string,
  ): boolean {
    const overwritten = targets
      .filter((target) => {
        const current = answers[target.key];
        return typeof current === "string" && current !== "" && current !== patch[target.key];
      })
      .map((target) => target.label);

    if (overwritten.length) {
      const list = overwritten.join("、");
      if (!window.confirm(`入力済みの項目(${list})を選択した${what}の内容で上書きします。よろしいですか?`)) {
        return false;
      }
    }

    setAnswers((current) => ({ ...current, ...patch }));
    return true;
  }

  function applyOrganization(
    picker: { prefix: string; targets: OrganizationFieldTarget[] },
    organization: fhir4.Organization,
  ) {
    const patch = organizationFieldAnswers(picker.targets, organization);
    if (!applyPickedValues(picker.targets, patch, "医療機関")) return;
    // 同じグループで医療従事者を選ぶときに所属で絞り込むため、選んだ医療機関を覚えておく。
    setSelectedOrganizations((current) => ({
      ...current,
      [picker.prefix]: {
        id: organization.id ?? "",
        name: organizationDisplayName(organization),
      },
    }));
    setOrganizationPicker(null);
  }

  function applyPractitioner(
    picker: { targets: PractitionerFieldTarget[] },
    practitioner: fhir4.Practitioner,
    role: fhir4.PractitionerRole | undefined,
  ) {
    const patch = practitionerFieldAnswers(picker.targets, practitioner, role);
    if (!applyPickedValues(picker.targets, patch, "医療従事者")) return;
    setPractitionerPicker(null);
  }

  // 繰り返しグループのインスタンス削除時のキー詰め替え(回答・描き込み共通)。
  function rekeyAfterRemoval<T>(current: Record<string, T>, groupKey: string, index: number): Record<string, T> {
    const next: Record<string, T> = {};
    for (const [key, value] of Object.entries(current)) {
      const match = key.startsWith(`${groupKey}#`)
        ? Number(key.slice(groupKey.length + 1).split(".")[0])
        : null;
      if (match === null || Number.isNaN(match)) {
        next[key] = value;
        continue;
      }
      if (match === index) continue;
      if (match > index) {
        const rest = key.slice(`${groupKey}#${match}`.length);
        next[`${groupKey}#${match - 1}${rest}`] = value;
      } else {
        next[key] = value;
      }
    }
    return next;
  }

  // 繰り返しグループのインスタンス削除。後続インスタンスの回答キーを詰め替える。
  function removeGroupInstance(groupKey: string, index: number, total: number) {
    setAnswers((current) => rekeyAfterRemoval(current, groupKey, index));
    setAnnotations((current) => rekeyAfterRemoval(current, groupKey, index));
    setCounts((current) => ({ ...current, [groupKey]: Math.max(1, total - 1) }));
  }

  function renderChoice(item: fhir4.QuestionnaireItem, key: string) {
    const control = itemControlOf(item);
    const orientation = ext(item, CHOICE_ORIENTATION_EXT_URL)?.valueCode;
    const options = item.answerOption ?? [];
    const value = answers[key];
    const required = requireInputs && item.required;

    if (control === "check-box") {
      const selected = Array.isArray(value) ? value : value ? [value] : [];
      return (
        <div className={`qp-choices${orientation === "horizontal" ? " qp-choices--horizontal" : ""}`}>
          {options.map((option) => {
            const code = option.valueCoding?.code ?? "";
            return (
              <label key={code} className="qp-choices__option">
                <input
                  type="checkbox"
                  checked={selected.includes(code)}
                  onChange={(e) =>
                    setAnswer(
                      key,
                      e.target.checked ? [...selected, code] : selected.filter((c) => c !== code),
                    )
                  }
                />
                {option.valueCoding?.display ?? code}
              </label>
            );
          })}
        </div>
      );
    }

    if (control === "radio-button") {
      return (
        <div className={`qp-choices${orientation === "horizontal" ? " qp-choices--horizontal" : ""}`}>
          {options.map((option) => {
            const code = option.valueCoding?.code ?? "";
            return (
              <label key={code} className="qp-choices__option">
                <input
                  type="radio"
                  name={key}
                  checked={value === code}
                  required={required}
                  onChange={() => setAnswer(key, code)}
                />
                {option.valueCoding?.display ?? code}
              </label>
            );
          })}
        </div>
      );
    }

    if (control === "list") {
      return (
        <select
          size={Math.min(options.length, 6)}
          value={typeof value === "string" ? value : ""}
          required={required}
          onChange={(e) => setAnswer(key, e.target.value)}
        >
          {options.map((option) => {
            const code = option.valueCoding?.code ?? "";
            return (
              <option key={code} value={code}>
                {option.valueCoding?.display ?? code}
              </option>
            );
          })}
        </select>
      );
    }

    // drop-down(inline / text-box もドロップダウンにフォールバック)
    return (
      <select
        value={typeof value === "string" ? value : ""}
        required={required}
        onChange={(e) => setAnswer(key, e.target.value)}
      >
        <option value=""></option>
        {options.map((option) => {
          const code = option.valueCoding?.code ?? "";
          return (
            <option key={code} value={code}>
              {option.valueCoding?.display ?? code}
            </option>
          );
        })}
      </select>
    );
  }

  function renderInput(item: fhir4.QuestionnaireItem, key: string) {
    const calculated = calculatedExpressionOf(item);
    if (calculated) {
      return (
        <span className="qp-calculated">
          <input type="text" readOnly value={evaluateCalculated(calculated)} />
          <span className="qp-calculated__note">自動計算</span>
        </span>
      );
    }

    const value = typeof answers[key] === "string" ? (answers[key] as string) : "";
    const required = requireInputs && item.required;

    switch (item.type) {
      case "choice":
        return renderChoice(item, key);
      case "text":
        return (
          <textarea
            rows={3}
            value={value}
            maxLength={item.maxLength}
            required={required}
            onChange={(e) => setAnswer(key, e.target.value)}
          />
        );
      case "integer":
      case "decimal": {
        const maxDecimalPlaces = numberExt(item, MAX_DECIMAL_PLACES_EXT_URL);
        const step =
          item.type === "integer"
            ? 1
            : maxDecimalPlaces !== undefined
              ? 10 ** -maxDecimalPlaces
              : "any";
        const unit = ext(item, UNIT_EXT_URL)?.valueCoding;
        return (
          <span className="qp-number">
            <input
              type="number"
              value={value}
              min={numberExt(item, MIN_VALUE_EXT_URL)}
              max={numberExt(item, MAX_VALUE_EXT_URL)}
              step={step}
              required={required}
              onChange={(e) => setAnswer(key, e.target.value)}
            />
            {unit && <span className="qp-number__unit">{unit.display ?? unit.code}</span>}
          </span>
        );
      }
      case "date":
        return (
          <input
            type="date"
            value={value}
            required={required}
            onChange={(e) => setAnswer(key, e.target.value)}
          />
        );
      case "dateTime":
        return (
          <input
            type="datetime-local"
            value={value}
            required={required}
            onChange={(e) => setAnswer(key, e.target.value)}
          />
        );
      case "time":
        return (
          <input
            type="time"
            value={value}
            required={required}
            onChange={(e) => setAnswer(key, e.target.value)}
          />
        );
      default:
        return (
          <input
            type="text"
            value={value}
            maxLength={item.maxLength}
            pattern={ext(item, REGEX_EXT_URL)?.valueString}
            required={required}
            onChange={(e) => setAnswer(key, e.target.value)}
          />
        );
    }
  }

  function renderGroupContent(item: fhir4.QuestionnaireItem, childPrefix: string) {
    return renderItems(item.item, childPrefix);
  }

  // シェーマ画像(itemMedia)があれば表示 + フォーム入力時は描き込み UI を出す。
  function renderSchemaImage(item: fhir4.QuestionnaireItem, instanceKey: string) {
    if (!itemMediaOf(item)) return null;
    return (
      <SchemaImageField
        item={item}
        instanceKey={instanceKey}
        canAnnotate={requireInputs}
        annotation={annotations[instanceKey]}
        onChange={(key, next) =>
          setAnnotations((current) => {
            const copy = { ...current };
            if (next) {
              copy[key] = next;
            } else {
              delete copy[key];
            }
            return copy;
          })
        }
      />
    );
  }

  // 医療機関・医療従事者の項目を持つグループの枠内に出す選択ボタン。
  // 読み取り専用(回答の内容表示)では出さない。
  function renderPickers(item: fhir4.QuestionnaireItem, childPrefix: string) {
    if (readOnly) return null;
    const organizationTargets = organizationFieldTargets(item, childPrefix);
    const practitionerTargets = practitionerFieldTargets(item, childPrefix);
    if (organizationTargets.length === 0 && practitionerTargets.length === 0) return null;

    return (
      <div className="qp-group__pickers">
        {organizationTargets.length > 0 && (
          <button
            type="button"
            className="qp-group__picker-button"
            onClick={() =>
              setOrganizationPicker({ prefix: childPrefix, targets: organizationTargets })
            }
          >
            医療機関を選択
          </button>
        )}
        {practitionerTargets.length > 0 && (
          <button
            type="button"
            className="qp-group__picker-button"
            onClick={() =>
              setPractitionerPicker({
                prefix: childPrefix,
                targets: practitionerTargets,
                roleDefault: practitionerRoleDefaultIn(item),
                organizationNameKey: organizationTargets.find((t) => t.code === "name")?.key,
              })
            }
          >
            医療従事者を選択
          </button>
        )}
      </div>
    );
  }

  function renderItem(item: fhir4.QuestionnaireItem, prefix: string): React.ReactNode {
    if (isHidden(item)) return null;
    const key = prefix + item.linkId;

    if (item.type === "group") {
      if (!isEnabled(item, prefix, answers)) return null;

      if (!item.repeats) {
        return (
          <fieldset className="qp-group" key={key}>
            {item.text && <legend>{item.text}</legend>}
            {renderPickers(item, `${key}.`)}
            {renderSchemaImage(item, key)}
            {renderGroupContent(item, `${key}.`)}
          </fieldset>
        );
      }

      const maxOccurs = numberExt(item, MAX_OCCURS_EXT_URL);
      const count = counts[key] ?? 1;
      return (
        <fieldset className="qp-group" key={key}>
          {item.text && <legend>{item.text}</legend>}
          {Array.from({ length: count }, (_, i) => (
            <div className="qp-group__instance" key={`${key}#${i}`}>
              <div className="qp-group__instance-header">
                <span>{i + 1}件目</span>
                {count > 1 && (
                  <button type="button" onClick={() => removeGroupInstance(key, i, count)}>
                    削除
                  </button>
                )}
              </div>
              {/* 繰り返しはインスタンスごとに別の医療機関・医療従事者を選べる。 */}
              {renderPickers(item, `${key}#${i}.`)}
              {renderSchemaImage(item, `${key}#${i}`)}
              {renderGroupContent(item, `${key}#${i}.`)}
            </div>
          ))}
          <button
            type="button"
            className="qp-group__add"
            disabled={maxOccurs !== undefined && count >= maxOccurs}
            onClick={() => setCounts((current) => ({ ...current, [key]: count + 1 }))}
          >
            + 追加
            {maxOccurs !== undefined && ` (最大${maxOccurs}件)`}
          </button>
        </fieldset>
      );
    }

    if (item.type === "display") {
      return (
        <Fragment key={key}>
          <p className="qp-display">{item.text}</p>
          {renderSchemaImage(item, key)}
        </Fragment>
      );
    }

    const initialExpression = initialExpressionOf(item);

    return (
      <Fragment key={key}>
        <div className="qp-field">
          <label>
            <span className="qp-field__label">
              {item.text}
              {item.required && <span className="qp-field__required">必須</span>}
            </span>
            {renderInput(item, key)}
          </label>
          {renderSchemaImage(item, key)}
          {initialExpression && !initialResponse && !expressionContext && (
            <p className="qp-field__note">初期値式(実行時に設定): {initialExpression}</p>
          )}
        </div>
        {/* choice 配下の条件付きグループ。表示条件は group 側の isEnabled で評価される。 */}
        {item.item?.length ? renderItems(item.item, `${key}.`) : null}
      </Fragment>
    );
  }

  function renderItems(items: fhir4.QuestionnaireItem[] | undefined, prefix: string) {
    return (items ?? []).map((item) => renderItem(item, prefix));
  }

  const header = (
    <div className="qp__header">
      <h2>{questionnaire.title}</h2>
      <p className="qp__meta">
        {questionnaire.name} / v{questionnaire.version}
      </p>
    </div>
  );

  // 読み取り専用は fieldset disabled でフォーム部品への入力をまとめて止める。
  const body = readOnly ? (
    <fieldset className="qp-readonly" disabled>
      {renderItems(questionnaire.item, "")}
    </fieldset>
  ) : (
    renderItems(questionnaire.item, "")
  );

  // 検索モーダルは項目ツリーの外側に1つだけ置く。グループごとに描画すると
  // readOnly の fieldset disabled 配下に入って操作できなくなる。
  const organizationModal = organizationPicker && (
    <OrganizationSearchModal
      onSelect={(organization) => applyOrganization(organizationPicker, organization)}
      onClose={() => setOrganizationPicker(null)}
    />
  );

  // 同じグループで医療機関が選ばれていれば、その所属の医療従事者に絞り込む。
  // 選び直しの前(保存済み回答を開いた直後)は id が分からないので、
  // 医療機関名の項目に入っている名称を手掛かりとして渡す。
  const practitionerModal = practitionerPicker && (
    <PractitionerSearchModal
      organizationId={selectedOrganizations[practitionerPicker.prefix]?.id || undefined}
      organizationName={
        selectedOrganizations[practitionerPicker.prefix]?.name ||
        (practitionerPicker.organizationNameKey
          ? ((answers[practitionerPicker.organizationNameKey] as string) ?? "") || undefined
          : undefined)
      }
      defaultRoleCode={practitionerPicker.roleDefault || undefined}
      onSelect={(practitioner, role) =>
        applyPractitioner(practitionerPicker, practitioner, role)
      }
      onClose={() => setPractitionerPicker(null)}
    />
  );

  if (!onSubmit) {
    return (
      <div className="qp">
        {header}
        {children}
        {body}
        {organizationModal}
        {practitionerModal}
      </div>
    );
  }

  return (
    <form className="qp" onSubmit={handleSubmit} onKeyDown={handleKeyDown}>
      {header}
      {children}
      {body}
      <div className="prescription-form__submit">
        <button type="submit" disabled={submitting}>
          {submitting ? "送信中..." : submitLabel}
        </button>
      </div>
      {organizationModal}
      {practitionerModal}
    </form>
  );
}
