// テンプレート回答(QuestionnaireResponse)から Observation を生成する
// (SDC の Observation-based extraction 相当)。
//
// テンプレート側で「回答から Observation を生成する」を有効にすると、項目コード
// (Questionnaire.item.code)の付いた設問の回答が Observation になる。項目コードが
// そのまま Observation.code になるので、社会歴のように JP Core のコードを付けて
// おけば、検索・時系列表示・他システム連携で使える構造化データとして残る。
//
// 上流に $extract operation は無いため、回答の保存時にクライアントで組み立てて
// 同じ transaction Bundle に載せる(シェーマ画像の Binary と同じ流儀)。
//
// 生成した Observation は Observation.derivedFrom で回答を指す。回答を更新・削除
// するときに「前回この回答から作ったもの」を引き当てるのはこの参照だけが根拠で、
// 上流の `Observation?derived-from=QuestionnaireResponse/<id>` で辿る。

// SDC 拡張。抽出の有無と、生成する Observation の category を持たせる。
export const OBSERVATION_EXTRACT_EXT_URL =
  "http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-observationExtract";
export const OBSERVATION_EXTRACT_CATEGORY_EXT_URL =
  "http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-observationExtract-category";

const OBSERVATION_CATEGORY_SYSTEM = "http://terminology.hl7.org/CodeSystem/observation-category";
const UNIT_EXT_URL = "http://hl7.org/fhir/StructureDefinition/questionnaire-unit";

/** FHIR 標準の observation-category。 */
export const OBSERVATION_CATEGORY_OPTIONS = [
  { code: "social-history", label: "社会歴" },
  { code: "vital-signs", label: "バイタルサイン" },
  { code: "exam", label: "診察" },
  { code: "survey", label: "調査・問診" },
  { code: "laboratory", label: "検査" },
  { code: "imaging", label: "画像" },
  { code: "procedure", label: "処置" },
  { code: "therapy", label: "治療" },
  { code: "activity", label: "活動" },
] as const;

/** 抽出を有効にしたときの既定 category(SDC が汎用の受け皿として挙げているもの)。 */
export const DEFAULT_OBSERVATION_CATEGORY = "survey";

export function observationExtractEnabled(questionnaire: fhir4.Questionnaire): boolean {
  return (
    questionnaire.extension?.find((e) => e.url === OBSERVATION_EXTRACT_EXT_URL)?.valueBoolean ===
    true
  );
}

export function observationExtractCategory(questionnaire: fhir4.Questionnaire): string {
  const coding = questionnaire.extension?.find(
    (e) => e.url === OBSERVATION_EXTRACT_CATEGORY_EXT_URL,
  )?.valueCodeableConcept?.coding?.[0];
  return coding?.code ?? DEFAULT_OBSERVATION_CATEGORY;
}

export function observationExtractExtensions(enabled: boolean, category: string): fhir4.Extension[] {
  if (!enabled) return [];
  return [
    { url: OBSERVATION_EXTRACT_EXT_URL, valueBoolean: true },
    {
      url: OBSERVATION_EXTRACT_CATEGORY_EXT_URL,
      valueCodeableConcept: {
        coding: [{ system: OBSERVATION_CATEGORY_SYSTEM, code: category }],
      },
    },
  ];
}

// ---- 抽出 ----

interface ItemDefinition {
  code: fhir4.Coding[];
  /** questionnaire-unit の表示文字列。 */
  unit: string;
}

/** linkId は全体一意(jsp-4)なので、階層を平らにして引ける。 */
function indexQuestionnaireItems(
  items: fhir4.QuestionnaireItem[] | undefined,
  index: Map<string, ItemDefinition>,
): void {
  for (const item of items ?? []) {
    if (item.code?.length) {
      index.set(item.linkId, {
        code: item.code,
        unit: item.extension?.find((e) => e.url === UNIT_EXT_URL)?.valueCoding?.display ?? "",
      });
    }
    indexQuestionnaireItems(item.item, index);
  }
}

/**
 * 回答 1 件を Observation.value[x] へ写す。
 *
 * 単位は表示名(unit)だけを入れ、system / code は付けない。テンプレートの単位は
 * 「本/日」「年」のように UCUM のコードではない値も入っており、そのまま
 * system=UCUM で出すと誤ったコード体系の主張になるため。
 */
function observationValue(
  answer: fhir4.QuestionnaireResponseItemAnswer,
  unit: string,
): Partial<fhir4.Observation> | null {
  if (answer.valueCoding) {
    return {
      valueCodeableConcept: {
        coding: [answer.valueCoding],
        ...(answer.valueCoding.display ? { text: answer.valueCoding.display } : {}),
      },
    };
  }
  if (typeof answer.valueInteger === "number") {
    return unit
      ? { valueQuantity: { value: answer.valueInteger, unit } }
      : { valueInteger: answer.valueInteger };
  }
  // Observation に valueDecimal は無いので、単位が無くても Quantity で持つ。
  if (typeof answer.valueDecimal === "number") {
    return { valueQuantity: { value: answer.valueDecimal, ...(unit ? { unit } : {}) } };
  }
  if (typeof answer.valueBoolean === "boolean") return { valueBoolean: answer.valueBoolean };
  if (answer.valueString) return { valueString: answer.valueString };
  // date は Observation では dateTime として扱う(日付のみの値も許容される)。
  if (answer.valueDate) return { valueDateTime: answer.valueDate };
  if (answer.valueDateTime) return { valueDateTime: answer.valueDateTime };
  if (answer.valueTime) return { valueTime: answer.valueTime };
  return null;
}

export interface ExtractObservationsArgs {
  questionnaire: fhir4.Questionnaire;
  response: fhir4.QuestionnaireResponse;
  /**
   * Observation.derivedFrom に入れる回答への参照。新規保存時は transaction 内の
   * urn:uuid(サーバーが実 ID へ解決する)、更新時は "QuestionnaireResponse/<id>"。
   */
  responseReference: string;
}

/**
 * 回答から Observation を組み立てる。項目コードの無い設問と、値の無い回答は飛ばす。
 * 複数選択(チェックボックス)は回答 1 つにつき 1 件の Observation にする
 * (CodeableConcept に複数 coding を並べるのは「同じ概念の別コード体系」の意味なので、
 * 別々の所見をまとめる用途には使えない)。
 */
export function extractObservations(args: ExtractObservationsArgs): fhir4.Observation[] {
  const { questionnaire, response, responseReference } = args;
  if (!observationExtractEnabled(questionnaire)) return [];

  const index = new Map<string, ItemDefinition>();
  indexQuestionnaireItems(questionnaire.item, index);
  if (index.size === 0) return [];

  const category = observationExtractCategory(questionnaire);
  // 下書きの回答から確定した所見は作れない。
  const status: fhir4.Observation["status"] =
    response.status === "completed" || response.status === "amended" ? "final" : "preliminary";

  const observations: fhir4.Observation[] = [];

  function walk(items: fhir4.QuestionnaireResponseItem[] | undefined): void {
    for (const item of items ?? []) {
      const definition = index.get(item.linkId);
      for (const answer of item.answer ?? []) {
        const value = definition ? observationValue(answer, definition.unit) : null;
        if (definition && value) {
          observations.push({
            resourceType: "Observation",
            status,
            category: [{ coding: [{ system: OBSERVATION_CATEGORY_SYSTEM, code: category }] }],
            code: { coding: definition.code },
            ...(response.subject ? { subject: response.subject } : {}),
            ...(response.authored ? { effectiveDateTime: response.authored } : {}),
            derivedFrom: [{ reference: responseReference }],
            ...value,
          });
        }
        // 選択肢の下にぶら下がる条件付きグループの回答。
        walk(answer.item);
      }
      walk(item.item);
    }
  }

  walk(response.item);
  return observations;
}

// ---- 保存用の transaction Bundle ----

export interface ResponseSaveBundleArgs {
  questionnaire: fhir4.Questionnaire;
  response: fhir4.QuestionnaireResponse;
  /** シェーマ画像の Binary。回答より前に並べる。 */
  imageEntries?: fhir4.BundleEntry[];
  /** 更新時の If-Match。渡すと回答は PUT になる。 */
  etag?: string;
  /**
   * 前回この回答から生成した Observation の参照("Observation/<id>")。
   * 上流の `Observation?derived-from=` で引いたものを渡す(呼び出し側が取得する)。
   */
  existingObservationRefs?: string[];
}

/**
 * 回答・シェーマ画像・生成した Observation を 1 つの transaction にまとめる。
 *
 * 更新では「前回生成した Observation を全部消して作り直す」方式にしている。
 * 回答の項目と Observation を 1 対 1 で対応付けて差分更新することもできるが、
 * テンプレート側のコードが変わると対応が崩れるため、作り直しの方が破綻しない
 * (この Observation を参照するものがまだ無いので、id が変わっても影響はない)。
 *
 * 回答は常に最後の entry に置く(resourceFromBundleResponse が末尾を本体として読む)。
 */
export function responseSaveBundle(args: ResponseSaveBundleArgs): fhir4.Bundle {
  const { questionnaire, response, imageEntries = [], etag, existingObservationRefs = [] } = args;

  // 新規保存では回答の id がまだ無いので、transaction 内の仮 URL で相互参照する
  // (サーバーが実 ID へ書き換える)。
  const responseUrl = response.id ? `QuestionnaireResponse/${response.id}` : `urn:uuid:${crypto.randomUUID()}`;
  const observations = extractObservations({
    questionnaire,
    response,
    responseReference: responseUrl,
  });

  const observationEntries: fhir4.BundleEntry[] = observations.map((observation) => ({
    fullUrl: `urn:uuid:${crypto.randomUUID()}`,
    resource: observation,
    request: { method: "POST", url: "Observation" },
  }));

  const deleteEntries: fhir4.BundleEntry[] = existingObservationRefs.map((reference) => ({
    request: { method: "DELETE", url: reference },
  }));

  const request: fhir4.BundleEntryRequest = etag
    ? { method: "PUT", url: `QuestionnaireResponse/${response.id}`, ifMatch: etag }
    : { method: "POST", url: "QuestionnaireResponse" };

  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: [
      ...imageEntries,
      ...deleteEntries,
      ...observationEntries,
      {
        ...(response.id ? {} : { fullUrl: responseUrl }),
        resource: response,
        request,
      },
    ],
  };
}

/**
 * 回答を削除するとき、一緒に消す Observation の DELETE エントリ。
 * observationRefs は `Observation?derived-from=` で引いたもの。
 */
export function responseDeleteBundle(
  responseId: string,
  observationRefs: string[],
): fhir4.Bundle {
  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: [
      ...observationRefs.map((reference) => ({
        request: { method: "DELETE" as const, url: reference },
      })),
      { request: { method: "DELETE" as const, url: `QuestionnaireResponse/${responseId}` } },
    ],
  };
}
