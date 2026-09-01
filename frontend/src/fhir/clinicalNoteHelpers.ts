import { problemRefFromReference, type ProblemRef } from "./conditionHelpers";
import { draftObservationEntries } from "./observationExtract";
import { departmentExtension, departmentOf } from "./prescriptionHelpers";
import { practitionerDisplayName } from "./practitionerHelpers";
import {
  SCHEMA_IMAGE_NOTE,
  questionnaireResponsePlainText,
  type TemplateBinding,
} from "./questionnaireResponseHelpers";

// 診療記録(経過記録)を FHIR Composition で表現するためのヘルパー群。
//
// 設計方針:
// - C-CDA on FHIR の Progress Note を参考に、type = LOINC 11506-3 (Progress note) の
//   base Composition として保存する(上流 fhir-server は base プロファイルで
//   Composition に対応済み)。US Core は臨床ノートを DocumentReference /
//   DiagnosticReport で扱い Composition プロファイルを持たないので参照していない。
// - 本文はセクション単位の Narrative (section.text.div) に XHTML で保存する。
//   文字装飾は inline style、画像は data: URI の <img> として本文に埋め込む
//   (FHIR の narrative 規約は data: URI の画像埋め込みを許容している)。
// - Binary リソースは使わない。1 リソースで完結させ、transaction Bundle も不要。

const LOINC_SYSTEM = "http://loinc.org";

export const PROGRESS_NOTE_TYPE: fhir4.CodeableConcept = {
  coding: [{ system: LOINC_SYSTEM, code: "11506-3", display: "Progress note" }],
  text: "経過記録",
};

/**
 * 他科依頼の回答として書いた診療記録の種別(LOINC 11488-4 Consult note)。
 * 回答は専用の様式を作らず通常の診療記録として書くので、経過記録と違うのは
 * type と event(下記)だけ(docs/consult-order-design.md §5)。
 */
export const CONSULT_NOTE_TYPE: fhir4.CodeableConcept = {
  coding: [{ system: LOINC_SYSTEM, code: "11488-4", display: "Consult note" }],
  text: "他科依頼回答",
};

/**
 * カルテのタイムライン・診療日ペインに出す診療記録の種別(token 検索のカンマ = OR)。
 *
 * 経過記録に加えて他科依頼の回答も出す。回答は依頼先科の医師が書いた診療記録で、
 * 依頼のカードからも開けるが、**カルテを時系列に読む人にも見えている必要がある**
 * (docs/consult-order-design.md §5)。種別を増やしたらここに足す — 検索から漏れると
 * 記録は保存されているのにカルテに出ない、という気付きにくい欠落になる。
 */
export const KARTE_NOTE_TYPE_SEARCH = `${LOINC_SYSTEM}|11506-3,${LOINC_SYSTEM}|11488-4`;

const CONSULT_NOTE_EVENT_SYSTEM = "http://fhir-client.local/CodeSystem/consult-note-event";

/**
 * この記録が記述している出来事(Composition.event)。他科依頼の回答では
 * `event.detail` が回答した依頼(ServiceRequest)を指す。
 *
 * R4 の Composition に basedOn は無く、`event`(この文書が記述している臨床上の
 * 出来事)がその位置づけに当たる標準の場所なので、ローカル拡張を作らずここを使う
 * (docs/consult-order-design.md §2.3)。
 */
function consultNoteEvent(serviceRequestId: string): fhir4.CompositionEvent[] {
  return [
    {
      code: [
        {
          coding: [
            { system: CONSULT_NOTE_EVENT_SYSTEM, code: "reply", display: "他科依頼への回答" },
          ],
        },
      ],
      detail: [{ reference: `ServiceRequest/${serviceRequestId}` }],
    },
  ];
}

/** 回答が答えている他科依頼の ServiceRequest id。回答でなければ空。 */
export function clinicalNoteConsultOrderId(composition: fhir4.Composition | undefined): string {
  for (const event of composition?.event ?? []) {
    const isReply = event.code?.some((c) =>
      c.coding?.some((coding) => coding.system === CONSULT_NOTE_EVENT_SYSTEM),
    );
    if (!isReply) continue;
    for (const detail of event.detail ?? []) {
      const id = detail.reference?.match(/^ServiceRequest\/(.+)$/)?.[1];
      if (id) return id;
    }
  }
  return "";
}

// セクションの選択肢。コードは C-CDA on FHIR Progress Note のセクション定義に合わせた
// LOINC (Subjective 61150-9 / Objective 61149-1 / Assessment 51848-0 /
// Plan of Treatment 18776-5 / Assessment and Plan 51847-2 / Additional documentation 77599-9)。
export const SECTION_OPTIONS = [
  { code: "61150-9", display: "Subjective", title: "主観的情報(S)" },
  { code: "61149-1", display: "Objective", title: "客観的情報(O)" },
  { code: "51848-0", display: "Assessment", title: "評価(A)" },
  { code: "18776-5", display: "Plan of Treatment", title: "治療計画(P)" },
  { code: "51847-2", display: "Assessment and Plan", title: "評価と計画(A/P)" },
  { code: "77599-9", display: "Additional documentation", title: "自由記載" },
] as const;

export type SectionCode = (typeof SECTION_OPTIONS)[number]["code"];

// 自由記載モードで使う唯一のセクション。
export const FREE_TEXT_SECTION_CODE = "77599-9" satisfies SectionCode;
// SOAP モードの初期セクション。
const SOAP_SECTION_CODES = ["61150-9", "61149-1", "51848-0", "18776-5"] as const;

// 記載形式。SOAP は複数セクション、自由記載は 1 セクション(自由記載)のみ。
export type ClinicalNoteMode = "soap" | "free";

export function sectionTitle(code: string | undefined): string {
  return SECTION_OPTIONS.find((o) => o.code === code)?.title ?? "";
}

// ステータス。preliminary/final をユーザーが選び、確定後の編集保存は amended に遷移する。
// entered-in-error はスコープ外(取り消しは削除で行う)。
export const STATUS_LABELS: Record<string, string> = {
  preliminary: "下書き",
  final: "確定",
  amended: "修正済み",
  "entered-in-error": "入力誤り",
};

export function statusLabel(status: string | undefined): string {
  return STATUS_LABELS[status ?? ""] ?? status ?? "";
}

// セクションがテンプレート(QuestionnaireResponse)由来であることを表す
// アプリローカル拡張。valueReference で該当 QR を参照する(schemaImage.ts の
// ANNOTATED_IMAGE_EXT_URL と同じ URL 規約)。
export const SECTION_QR_EXT_URL =
  "http://fhir-client.local/StructureDefinition/clinical-note-section-questionnaire-response";

// 記録が対象とするプロブレム(Condition)。POMR は「プロブレムごとに SOAP を書く」ので、
// 紐付けは診療記録 1 件に対して 1 つ持たせる(複数のプロブレムを扱うときは記録を
// 分けて登録する)。処方と共通の参照型を使う。
export type ClinicalNoteProblem = ProblemRef;

// 対象プロブレムは C-CDA on FHIR Progress Note の problems_section (LOINC 11450-4)
// として持ち、section.entry で Condition を参照する。ローカル拡張ではなく標準要素な
// ので、絞り込みが R4 標準の検索パラメータ entry に乗る。本文のセクションではないので
// 編集 UI の選択肢(SECTION_OPTIONS)には入れない。
export const PROBLEMS_SECTION_CODE = "11450-4";
const PROBLEMS_SECTION_TITLE = "プロブレム";

function isProblemsSection(section: fhir4.CompositionSection): boolean {
  return (
    section.code?.coding?.some(
      (c) => c.system === LOINC_SYSTEM && c.code === PROBLEMS_SECTION_CODE,
    ) ?? false
  );
}

// 本文のセクション。表示・編集・要約はプロブレムセクションを除いたこちらを見る。
export function noteBodySections(
  composition: fhir4.Composition | undefined,
): fhir4.CompositionSection[] {
  return (composition?.section ?? []).filter((s) => !isProblemsSection(s));
}

export interface ClinicalNoteSectionDraft {
  // React の key と並べ替えのための安定 ID。FHIR には保存しない。
  uid: string;
  code: SectionCode;
  // Tiptap が出力する HTML(編集中の内部形式)。保存時に XHTML へ変換する。
  // テンプレート由来のセクションでは回答の平文から生成し、直接編集は不可。
  html: string;
  // テンプレート由来のセクションであることの印。undefined なら通常の手入力。
  template?: TemplateBinding;
}

export interface ClinicalNoteFormValues {
  mode: ClinicalNoteMode;
  title: string;
  status: "preliminary" | "final";
  // datetime-local 形式 "YYYY-MM-DDTHH:mm"
  date: string;
  // 対象プロブレム。null なら特定の問題に紐付かない記録。
  problem: ClinicalNoteProblem | null;
  sections: ClinicalNoteSectionDraft[];
}

export function newSectionDraft(code: SectionCode): ClinicalNoteSectionDraft {
  return { uid: crypto.randomUUID(), code, html: "" };
}

// 記載形式ごとのセクション初期形。モード切替時はこれで作り直す
// (入力済みの本文は引き継がない)。
export function defaultSectionsForMode(mode: ClinicalNoteMode): ClinicalNoteSectionDraft[] {
  return mode === "free"
    ? [newSectionDraft(FREE_TEXT_SECTION_CODE)]
    : SOAP_SECTION_CODES.map(newSectionDraft);
}

// problem を渡すと対象プロブレムを選択済みで開く(プロブレムリストで選んでいる
// プロブレムをそのまま新規記録の対象にするため)。
export function emptyClinicalNoteForm(
  problem: ClinicalNoteProblem | null = null,
): ClinicalNoteFormValues {
  return {
    mode: "soap",
    // タイトルは必須(Composition.title 1..1)。毎回の入力を省けるよう既定値を入れておく。
    title: "診療記録",
    status: "final",
    date: toDateTimeInput(new Date()),
    problem,
    sections: defaultSectionsForMode("soap"),
  };
}

// ---- 日時変換 ----

// toFhirDateTime は lib/dates.ts に移した(オーダーの登録日時 nowFhirDateTime と同じ場所)。
// 既存の import 元を変えずに済むようここからも出す。
import { toFhirDateTime } from "../lib/dates";

export { toFhirDateTime };

export function toDateTimeInput(value: Date | string | undefined): string {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// ---- HTML ⇔ XHTML 変換 ----

// Tiptap の HTML 出力を FHIR Narrative 用の XHTML に変換する。
// XMLSerializer に通すことで xmlns 付与・自己終了タグ(<br/> <img/>)・属性エスケープの
// well-formed 性が保証される(正規表現置換だとエスケープ漏れの事故があり得る)。
export function htmlToXhtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const div = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  while (doc.body.firstChild) div.appendChild(doc.body.firstChild);
  return new XMLSerializer().serializeToString(div);
}

// 平文 1 行を Narrative にする。エスケープは DOM 側に任せる。
function plainTextXhtml(text: string): string {
  const doc = new DOMParser().parseFromString("", "text/html");
  const div = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  const p = doc.createElementNS("http://www.w3.org/1999/xhtml", "p");
  p.textContent = text;
  div.appendChild(p);
  return new XMLSerializer().serializeToString(div);
}

// 逆方向。HTML パーサーは XHTML を寛容に読むので、外側 div の中身を取り出すだけで
// Tiptap の content にそのまま渡せる。
export function xhtmlToHtml(div: string | undefined): string {
  if (!div) return "";
  const doc = new DOMParser().parseFromString(div, "text/html");
  return doc.body.firstElementChild?.innerHTML ?? "";
}

// Narrative を抜粋表示用の平文にする。段落や改行は 1 つの空白に潰す
// (1 行に丸めて出す場所でしか使わないため)。
export function narrativePlainText(div: string | undefined): string {
  if (!div) return "";
  const doc = new DOMParser().parseFromString(div, "text/html");
  return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
}

// Narrative が実質空(タグだけで文字も画像もない)かどうか。空セクションの保存を防ぐ。
export function isEmptyNoteHtml(html: string): boolean {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return !doc.body.textContent?.trim() && !doc.body.querySelector("img");
}

// テンプレート回答の平文をセクション本文の HTML にする。
// 既存の平文化(questionnaireResponsePlainText)の行をそのまま <p> に落とす。
export function templateHtml(
  questionnaire: fhir4.Questionnaire,
  response: fhir4.QuestionnaireResponse,
): string {
  const escape = (s: string) =>
    s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return questionnaireResponsePlainText(questionnaire, response)
    .split("\n")
    .map((line) => `<p>${escape(line)}</p>`)
    .join("");
}

// ---- build / parse / validate / summarize ----

// practitionerId: 新規作成時はログイン中の Practitioner ID(null = 未紐付けでエラー)。
// 編集時は既存 author を引き継ぐため undefined を渡してチェックを省略する。
export function validateClinicalNote(
  values: ClinicalNoteFormValues,
  practitionerId: string | null | undefined,
): string | null {
  if (!values.title.trim()) return "タイトルを入力してください。";
  if (!values.date) return "記録日時を入力してください。";
  if (values.sections.length === 0) return "セクションを 1 件以上追加してください。";
  if (values.sections.every((s) => isEmptyNoteHtml(s.html)))
    return "本文が空です。いずれかのセクションに本文を入力してください。";
  // Composition.author は 1..* の必須。administrator など Practitioner 未紐付けの
  // アカウントでは作成できない(編集は既存 author を引き継ぐため可能)。
  if (practitionerId === null)
    return "ログイン中のアカウントに医療従事者が紐付いていないため、診療記録を作成できません。";
  return null;
}

/**
 * 確定した記録の署名。「誰がいつ内容に責任を負ったか」を残す
 * (status だけでは確定の事実しか分からず、診療録の真正性の根拠にならない)。
 *
 * mode は legal(内容に法的責任を負う者)。attester は 0..* だが、
 * 最後に確定した 1 件だけを持つ。過去の署名は版履歴(_history)に残るので
 * 二重に持たず、「今この記録に責任を負っているのは誰か」を一意に読めるようにする。
 *
 * 下書きに戻した場合は署名を外す。医療従事者が紐付いていないアカウント
 * (administrator 等)が確定済みの記録を編集したときは、既存の署名をそのまま残す
 * (署名者を空にすると、誰も責任を負っていない確定記録になってしまうため)。
 */
function buildAttester(
  status: fhir4.Composition["status"],
  practitioner: fhir4.Practitioner | null | undefined,
  existing: fhir4.Composition | undefined,
): fhir4.CompositionAttester[] | undefined {
  if (status === "preliminary") return undefined;
  if (!practitioner?.id) return existing?.attester;
  return [
    {
      mode: "legal",
      time: new Date().toISOString(),
      party: {
        reference: `Practitioner/${practitioner.id}`,
        display: practitionerDisplayName(practitioner),
      },
    },
  ];
}

/** 確定した記録の署名者と署名日時。未確定なら null。 */
export function clinicalNoteAttestation(
  composition: fhir4.Composition | undefined,
): { name: string; time: string } | null {
  const attester = composition?.attester?.find((a) => a.mode === "legal") ?? composition?.attester?.[0];
  if (!attester) return null;
  return { name: attester.party?.display ?? "", time: attester.time ?? "" };
}

export interface ClinicalNoteSave {
  composition: fhir4.Composition;
  // Composition より先に同じ transaction Bundle へ入れるエントリ
  // (テンプレートの QuestionnaireResponse とそのシェーマ画像 Binary)。
  // 先行して単独 POST しない — 診療記録を保存しなかったときに QR だけが
  // 残る孤児を構造的に防ぐため(schemaImage.ts の設計と同じ)。
  entries: fhir4.BundleEntry[];
}

export function buildClinicalNote(
  values: ClinicalNoteFormValues,
  options: {
    patientId: string;
    // 新規作成時の author。編集時(existing あり)は既存の author を保持するので不要。
    practitioner?: fhir4.Practitioner | null;
    existing?: fhir4.Composition;
    /**
     * 他科依頼の回答として書くときの、回答する依頼の ServiceRequest id。
     * type と event が変わるだけで、本文の作りは通常の診療記録と同じ
     * (docs/consult-order-design.md §5)。
     */
    consultOrderId?: string;
    /**
     * 回答した診療科。オーダーの依頼科・検査結果の実施科と同じローカル拡張に入れる
     * (どの科が答えたかを、参照を引き直さずに一覧・カードで出せるように)。
     */
    department?: { departmentId: string; departmentName: string };
  },
): ClinicalNoteSave {
  const { patientId, practitioner, existing, consultOrderId, department } = options;
  const entries: fhir4.BundleEntry[] = [];
  // 保存後も参照され続ける保存済み QR の id。既存 Composition が参照していたものとの
  // 差分で「参照が外れた QR」を求め、同じ transaction で削除する(孤児を残さない)。
  const keptResponseIds = new Set<string>();

  // 確定(final)・修正済み(amended)の記録を編集保存したら amended に遷移させる。
  // 下書き(preliminary)の間はユーザーの選択値のまま。
  const status: fhir4.Composition["status"] =
    existing && existing.status !== "preliminary" ? "amended" : values.status;

  const author: fhir4.Reference[] = existing
    ? existing.author
    : [
        {
          reference: `Practitioner/${practitioner?.id}`,
          // 一覧の作成者列は検索応答だけで描画するため display を埋めておく
          display: practitioner ? practitionerDisplayName(practitioner) : undefined,
        },
      ];

  // 対象プロブレム(POMR)。指定が無ければセクションごと出さない。display に保存時点の
  // 「#番号 名称」を残しておくと参照解決なしでも描画できる(表示側は現在のプロブレム
  // から名称を引き直すので、病名を編集しても古い名前は残らない)。
  const problemsSection: fhir4.CompositionSection[] = values.problem
    ? [
        {
          title: PROBLEMS_SECTION_TITLE,
          code: {
            coding: [
              { system: LOINC_SYSTEM, code: PROBLEMS_SECTION_CODE, display: "Problem list" },
            ],
          },
          // entry から導出した narrative なので generated(手入力の本文は additional)。
          text: { status: "generated", div: plainTextXhtml(values.problem.display) },
          entry: [
            {
              reference: `Condition/${values.problem.conditionId}`,
              display: values.problem.display,
            },
          ],
        },
      ]
    : [];

  const bodySections = values.sections
    .filter((s) => !isEmptyNoteHtml(s.html))
    .map((s) => {
      const option = SECTION_OPTIONS.find((o) => o.code === s.code);

      // テンプレート由来セクション: QR への参照拡張を付け、未保存の記入内容が
      // あれば QR(+シェーマ画像 Binary)を Bundle エントリに積む。
      let extension: fhir4.Extension[] | undefined;
      if (s.template) {
        const { responseId, draft } = s.template;
        let reference: string;
        if (draft) {
          if (responseId) {
            // 保存済み QR の再編集 → 同じ id へ PUT(参照は実 ID のまま)。
            reference = `QuestionnaireResponse/${responseId}`;
            keptResponseIds.add(responseId);
            entries.push({
              resource: { ...draft.response, id: responseId },
              request: { method: "PUT", url: reference },
            });
          } else {
            // 新規記入 → urn:uuid プレースホルダで POST し、拡張から参照する
            // (実 ID への書き換えは上流の transaction 処理が行う)。
            reference = `urn:uuid:${crypto.randomUUID()}`;
            entries.push({
              fullUrl: reference,
              resource: draft.response,
              request: { method: "POST", url: "QuestionnaireResponse" },
            });
          }
          entries.push(...draft.imageEntries);
          // 「回答から Observation を生成する」テンプレートなら、単独登録と同じく
          // 構造化データも残す(前回の生成物の削除は保存側で行う)。
          entries.push(
            ...draftObservationEntries({
              questionnaire: draft.questionnaire,
              response: draft.response,
              responseReference: reference,
            }),
          );
        } else if (responseId) {
          // 再編集していない保存済みテンプレート → 参照だけ引き継ぐ。
          reference = `QuestionnaireResponse/${responseId}`;
          keptResponseIds.add(responseId);
        } else {
          reference = "";
        }
        if (reference) {
          extension = [{ url: SECTION_QR_EXT_URL, valueReference: { reference } }];
        }
      }

      return {
        title: option?.title ?? s.code,
        extension,
        code: {
          coding: [{ system: LOINC_SYSTEM, code: s.code, display: option?.display }],
        },
        text: {
          // 手入力由来の narrative なので additional(構造化データの要約ではない)
          status: "additional" as const,
          div: htmlToXhtml(s.html),
        },
      };
    });

  // 他科依頼の回答は種別と event が違う。編集(existing あり)では呼び出し側が
  // consultOrderId を渡さないので、保存済みの値をそのまま引き継ぐ
  // (回答を編集し直しても依頼との紐付きが外れないように)。
  const event = consultOrderId ? consultNoteEvent(consultOrderId) : existing?.event;
  const type = consultOrderId ? CONSULT_NOTE_TYPE : (existing?.type ?? PROGRESS_NOTE_TYPE);

  const composition: fhir4.Composition = {
    resourceType: "Composition",
    status,
    type,
    attester: buildAttester(status, practitioner, existing),
    subject: { reference: `Patient/${patientId}` },
    date: toFhirDateTime(values.date),
    author,
    title: values.title.trim(),
    section: [...problemsSection, ...bodySections],
  };

  if (event?.length) composition.event = event;

  // 診療科も同じく、新規は渡されたもの・編集は保存済みのものを引き継ぐ。
  const noteDepartment = department?.departmentId ? department : departmentOf(existing ?? {});
  if (noteDepartment.departmentId) {
    composition.extension = [
      departmentExtension(noteDepartment.departmentId, noteDepartment.departmentName),
    ];
  }

  if (existing?.id) composition.id = existing.id;

  // 参照が外れた QR(セクション削除・記載形式の切替・本文が空になった等で
  // 既存 Composition の拡張から消えたもの)を同じ transaction で削除する。
  // 差分は「既存リソースの参照 − 保存後も残る参照」で求めるので、フォーム側の
  // 削除操作を追跡する必要がない。
  for (const id of referencedResponseIds(existing)) {
    if (!keptResponseIds.has(id)) {
      entries.push({ request: { method: "DELETE", url: `QuestionnaireResponse/${id}` } });
    }
  }

  return { composition, entries };
}

// 診療記録の削除。セクションが参照しているテンプレート回答(QuestionnaireResponse)も
// 同じ Bundle で消す。参照が無ければ null を返し、呼び出し側は単体 DELETE でよい。
export function buildClinicalNoteDeleteBundle(
  composition: fhir4.Composition,
): fhir4.Bundle | null {
  const responseIds = referencedResponseIds(composition);
  if (!responseIds.length) return null;

  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: [
      ...responseIds.map((id) => ({
        request: { method: "DELETE" as const, url: `QuestionnaireResponse/${id}` },
      })),
      { request: { method: "DELETE", url: `Composition/${composition.id}` } },
    ],
  };
}

// セクション拡張が参照している保存済み QR の id(テンプレート由来でなければ空)。
export function sectionResponseId(section: fhir4.CompositionSection): string {
  const ref = section.extension?.find((e) => e.url === SECTION_QR_EXT_URL)?.valueReference
    ?.reference;
  return ref?.match(/^QuestionnaireResponse\/(.+)$/)?.[1] ?? "";
}

// Composition のセクション拡張が参照している保存済み QR の id 一覧。
export function referencedResponseIds(composition: fhir4.Composition | undefined): string[] {
  return (composition?.section ?? []).flatMap((section) => {
    const id = sectionResponseId(section);
    return id ? [id] : [];
  });
}

// テンプレート由来セクションの narrative から「(シェーマ画像あり)」の印を落とす。
// 画像の実物を本文の下に並べる表示で使う(印だけになる段落は、項目名が画像側の
// キャプションに出るので捨てる)。保存してある本文自体は印を含んだままにする
// — 平文として読む場所では「画像がある」ことが分かる必要があるため。
export function stripSchemaImageNotes(div: string | undefined): string {
  if (!div?.includes(SCHEMA_IMAGE_NOTE)) return div ?? "";

  const doc = new DOMParser().parseFromString(div, "text/html");
  const root = doc.body.firstElementChild ?? doc.body;
  for (const child of Array.from(root.children)) {
    const text = child.textContent ?? "";
    if (!text.includes(SCHEMA_IMAGE_NOTE)) continue;
    // テンプレート由来の本文は装飾を持たない平文の段落なので、textContent の
    // 置き換えで失われるものはない。
    const stripped = text.replace(SCHEMA_IMAGE_NOTE, "").trimEnd();
    if (!stripped.trim() || /[:：]$/.test(stripped.trim())) child.remove();
    else child.textContent = stripped;
  }
  return doc.body.innerHTML;
}

// 記録が対象としているプロブレム。編集フォームの復元とタイムライン表示の双方から使う。
export function clinicalNoteProblem(
  composition: fhir4.Composition | undefined,
): ClinicalNoteProblem | null {
  for (const section of composition?.section ?? []) {
    if (!isProblemsSection(section)) continue;
    for (const entry of section.entry ?? []) {
      const ref = problemRefFromReference(entry);
      if (ref) return ref;
    }
  }
  return null;
}

export function parseClinicalNoteForm(composition: fhir4.Composition): ClinicalNoteFormValues {
  const knownCodes = new Set<string>(SECTION_OPTIONS.map((o) => o.code));
  // プロブレムセクションは本文ではないので編集欄に出さない(未知コードは自由記載に
  // 丸められるため、除外しないと編集できてしまい記載形式の復元も狂う)。
  const sections = noteBodySections(composition).map((section) => {
    const code = section.code?.coding?.find((c) => c.system === LOINC_SYSTEM)?.code;
    // テンプレート参照拡張(QuestionnaireResponse/<id>)があれば復元する。
    // draft は null = 「再編集されるまで QR は触らない」。
    const qrRef = section.extension?.find((e) => e.url === SECTION_QR_EXT_URL)?.valueReference
      ?.reference;
    const responseId = qrRef?.match(/^QuestionnaireResponse\/(.+)$/)?.[1];
    return {
      uid: crypto.randomUUID(),
      // 未知コードは「自由記載」として編集を継続できるようにする(保存で正規化される)
      code: (knownCodes.has(code ?? "") ? code : FREE_TEXT_SECTION_CODE) as SectionCode,
      html: xhtmlToHtml(section.text?.div),
      template: responseId ? { responseId, draft: null } : undefined,
    };
  });

  return {
    // 記載形式は保存されないので構成から復元する。自由記載セクション 1 つだけなら
    // 自由記載モード、それ以外(複数セクション・SOAP 系コード)は SOAP モード。
    mode: sections.length === 1 && sections[0].code === FREE_TEXT_SECTION_CODE ? "free" : "soap",
    title: composition.title ?? "",
    status: composition.status === "preliminary" ? "preliminary" : "final",
    date: toDateTimeInput(composition.date),
    problem: clinicalNoteProblem(composition),
    sections,
  };
}

export interface ClinicalNoteSummary {
  id: string;
  dateTime: string;
  title: string;
  status: string;
  statusLabel: string;
  sectionSummary: string;
  authorName: string;
}

export function summarizeClinicalNote(composition: fhir4.Composition): ClinicalNoteSummary {
  const date = composition.date ? new Date(composition.date) : null;
  const pad = (n: number) => String(n).padStart(2, "0");
  const sections = noteBodySections(composition)
    .map((s) => s.title || sectionTitle(s.code?.coding?.[0]?.code))
    .filter(Boolean);
  return {
    id: composition.id ?? "",
    dateTime:
      date && !Number.isNaN(date.getTime())
        ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
        : "",
    title: composition.title ?? "",
    status: composition.status ?? "",
    statusLabel: statusLabel(composition.status),
    // _summary=true の応答では section が落ちる(SUBSETTED)ため "-" 表示になる
    sectionSummary: sections.length ? sections.join("・") : "-",
    authorName: composition.author?.[0]?.display ?? "-",
  };
}
