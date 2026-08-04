import { practitionerDisplayName } from "./practitionerHelpers";
import { questionnaireResponsePlainText } from "./questionnaireResponseHelpers";

// 診療記録(経過記録)を FHIR Composition で表現するためのヘルパー群。
//
// 設計方針:
// - US Core Clinical Notes / C-CDA on FHIR の Progress Note を参考に、
//   type = LOINC 11506-3 (Progress note) の base Composition として保存する
//   (上流 fhir-server は base プロファイルで Composition に対応済み)。
// - 本文はセクション単位の Narrative (section.text.div) に XHTML で保存する。
//   文字装飾は inline style、画像は data: URI の <img> として本文に埋め込む
//   (FHIR の narrative 規約は data: URI の画像埋め込みを許容している)。
// - Binary リソースは使わない。1 リソースで完結させ、transaction Bundle も不要。

const LOINC_SYSTEM = "http://loinc.org";

export const PROGRESS_NOTE_TYPE: fhir4.CodeableConcept = {
  coding: [{ system: LOINC_SYSTEM, code: "11506-3", display: "Progress note" }],
  text: "経過記録",
};

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

// モーダルで記入したテンプレート内容(未保存)。診療記録の保存時に
// QuestionnaireResponse として同じ transaction Bundle で POST/PUT する。
export interface ClinicalNoteTemplateDraft {
  questionnaire: fhir4.Questionnaire;
  response: fhir4.QuestionnaireResponse;
  // シェーマ画像描き込みの Binary 作成エントリ(QR と同じ Bundle に同梱)。
  imageEntries: fhir4.BundleEntry[];
}

export interface ClinicalNoteSectionTemplate {
  // 保存済み QR の id。新規記入でまだ保存していなければ null。
  responseId: string | null;
  // 直近のモーダル記入内容。保存済みで再編集していなければ null。
  draft: ClinicalNoteTemplateDraft | null;
}

// 記録が対象とするプロブレム(Condition)。POMR は「プロブレムごとに SOAP を書く」ので、
// 紐付けはセクションではなく診療記録 1 件に対して 1 つ持たせる(複数のプロブレムを
// 扱うときは記録を分けて登録する)。
// display には保存時点の「#番号 名称」を入れておき、参照解決なしでも描画できるようにする
// (表示側はプロブレム一覧が引けるなら最新の名称で上書きする)。
export interface ClinicalNoteProblem {
  conditionId: string;
  display: string;
}

// 対象プロブレムを記録するアプリローカル拡張。base Composition には診療記録の対象
// 疾患を表す要素が無いため(event は検査・手術などの「行為」用)、SECTION_QR_EXT_URL
// と同じ URL 規約で持たせる。
export const NOTE_PROBLEM_EXT_URL =
  "http://fhir-client.local/StructureDefinition/clinical-note-problem";

export interface ClinicalNoteSectionDraft {
  // React の key と並べ替えのための安定 ID。FHIR には保存しない。
  uid: string;
  code: SectionCode;
  // Tiptap が出力する HTML(編集中の内部形式)。保存時に XHTML へ変換する。
  // テンプレート由来のセクションでは回答の平文から生成し、直接編集は不可。
  html: string;
  // テンプレート由来のセクションであることの印。undefined なら通常の手入力。
  template?: ClinicalNoteSectionTemplate;
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

// FHIR dateTime は時刻を含む場合タイムゾーン必須。datetime-local の値(ローカル時刻)に
// 実行環境のオフセットを付けて "+09:00" 形式にする。
export function toFhirDateTime(input: string): string {
  if (!input) return "";
  const offsetMinutes = -new Date(input).getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${input.length === 16 ? `${input}:00` : input}${sign}${hh}:${mm}`;
}

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

// 逆方向。HTML パーサーは XHTML を寛容に読むので、外側 div の中身を取り出すだけで
// Tiptap の content にそのまま渡せる。
export function xhtmlToHtml(div: string | undefined): string {
  if (!div) return "";
  const doc = new DOMParser().parseFromString(div, "text/html");
  return doc.body.firstElementChild?.innerHTML ?? "";
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
  },
): ClinicalNoteSave {
  const { patientId, practitioner, existing } = options;
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

  const composition: fhir4.Composition = {
    resourceType: "Composition",
    status,
    type: PROGRESS_NOTE_TYPE,
    // 対象プロブレム(POMR)。指定が無ければ拡張ごと出さない。
    extension: values.problem
      ? [
          {
            url: NOTE_PROBLEM_EXT_URL,
            valueReference: {
              reference: `Condition/${values.problem.conditionId}`,
              display: values.problem.display,
            },
          },
        ]
      : undefined,
    subject: { reference: `Patient/${patientId}` },
    date: toFhirDateTime(values.date),
    author,
    title: values.title.trim(),
    section: values.sections
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
      }),
  };

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

// Composition のセクション拡張が参照している保存済み QR の id 一覧。
export function referencedResponseIds(composition: fhir4.Composition | undefined): string[] {
  return (composition?.section ?? []).flatMap((section) => {
    const ref = section.extension?.find((e) => e.url === SECTION_QR_EXT_URL)?.valueReference
      ?.reference;
    const id = ref?.match(/^QuestionnaireResponse\/(.+)$/)?.[1];
    return id ? [id] : [];
  });
}

// 記録が対象としているプロブレム。編集フォームの復元とタイムライン表示の双方から使う。
// セクション単位で紐付けていた頃のデータも読めるよう、拡張が無ければ section.entry の
// Condition 参照にフォールバックする(保存し直せば拡張へ正規化される)。
export function clinicalNoteProblem(
  composition: fhir4.Composition | undefined,
): ClinicalNoteProblem | null {
  const ref = composition?.extension?.find((e) => e.url === NOTE_PROBLEM_EXT_URL)?.valueReference;
  const fromExtension = ref?.reference?.match(/^Condition\/(.+)$/)?.[1];
  if (fromExtension) return { conditionId: fromExtension, display: ref?.display ?? "" };

  for (const section of composition?.section ?? []) {
    for (const entry of section.entry ?? []) {
      const conditionId = entry.reference?.match(/^Condition\/(.+)$/)?.[1];
      if (conditionId) return { conditionId, display: entry.display ?? "" };
    }
  }
  return null;
}

export function parseClinicalNoteForm(composition: fhir4.Composition): ClinicalNoteFormValues {
  const knownCodes = new Set<string>(SECTION_OPTIONS.map((o) => o.code));
  const sections = (composition.section ?? []).map((section) => {
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
  const sections = (composition.section ?? [])
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
