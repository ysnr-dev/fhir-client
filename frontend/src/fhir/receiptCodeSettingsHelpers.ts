// 医事会計へ送るレセプト電算コードのうち、施設基準や届出で決まる「1 施設 1 値」のもの
// (施設設定 `receipt_codes`。backend の FacilitySettings::DEFAULT_RECEIPT_CODES と同じ形)。
// マスタを持たない種別(病理・リハビリ・栄養指導)の診療行為コードと、送信時にルールで
// 足す加算。空なら送らず、送信前のプレビューに「送れない項目」として出る。

export const REHAB_CATEGORY_KEYS = [
  "cardiovascular",
  "cerebrovascular",
  "disuse",
  "musculoskeletal",
  "respiratory",
] as const;
export type RehabCategoryKey = (typeof REHAB_CATEGORY_KEYS)[number];

export const REHAB_THERAPY_KEYS = ["pt", "ot", "st"] as const;
export type RehabTherapyKey = (typeof REHAB_THERAPY_KEYS)[number];

/** 疾患別リハに添えるコメント(区分ごとにコードが違う)。疾患名(830 系)と発症年月日(850 系)。 */
export const REHAB_COMMENT_KEYS = ["disease_name_comment", "onset_date_comment"] as const;
export type RehabCommentKey = (typeof REHAB_COMMENT_KEYS)[number];
export type RehabColumnKey = RehabTherapyKey | RehabCommentKey;
export const REHAB_COLUMN_KEYS: readonly RehabColumnKey[] = [...REHAB_THERAPY_KEYS, ...REHAB_COMMENT_KEYS];

export interface ReceiptCodeSettings {
  /** 病理の検査区分(JAHIS LPATHO001)ごとの診療行為コード。 */
  pathology: { N000: string; N004: string; N003: string };
  /** 疾患別リハビリテーション料。区分 × 療法の担い手(PT/OT/ST)と、区分ごとのコメント。 */
  rehab: Record<RehabCategoryKey, Record<RehabColumnKey, string>>;
  /** 放射線治療管理料に添える照射部位のコメント(830 系)。 */
  radiotherapy: { site_comment: string };
  /** 栄養食事指導料。初回 / 2 回目以降 / 集団。 */
  nutrition_guidance: { initial: string; "follow-up": string; group: string };
  /** 血液採取(B-V)。検体検査に血液の検体があるとき 1 日 1 回足す。 */
  lab: { blood_draw: string };
  /** 保存血液輸血の手技。1 回目(最初の 200mL)と 2 回目以降(200mL ごと)。 */
  transfusion: { first: string; subsequent: string };
  /** 外来化学療法加算(15 歳未満は別コード)と無菌製剤処理料。レジメン由来の注射に 1 日 1 回足す。 */
  injection: {
    outpatient_chemo_addition: string;
    outpatient_chemo_addition_child: string;
    aseptic_preparation: string;
  };
}

function emptyRehab(): ReceiptCodeSettings["rehab"] {
  return Object.fromEntries(
    REHAB_CATEGORY_KEYS.map((category) => [
      category,
      Object.fromEntries(REHAB_COLUMN_KEYS.map((column) => [column, ""])),
    ]),
  ) as ReceiptCodeSettings["rehab"];
}

export const DEFAULT_RECEIPT_CODES: ReceiptCodeSettings = {
  pathology: { N000: "", N004: "", N003: "" },
  rehab: emptyRehab(),
  radiotherapy: { site_comment: "" },
  nutrition_guidance: { initial: "", "follow-up": "", group: "" },
  lab: { blood_draw: "" },
  transfusion: { first: "", subsequent: "" },
  injection: {
    outpatient_chemo_addition: "",
    outpatient_chemo_addition_child: "",
    aseptic_preparation: "",
  },
};

export const PATHOLOGY_LABELS: Record<keyof ReceiptCodeSettings["pathology"], string> = {
  N000: "組織診(病理組織標本作製)",
  N004: "細胞診",
  N003: "術中迅速",
};

export const REHAB_CATEGORY_LABELS: Record<RehabCategoryKey, string> = {
  cardiovascular: "心大血管疾患",
  cerebrovascular: "脳血管疾患等",
  disuse: "廃用症候群",
  musculoskeletal: "運動器",
  respiratory: "呼吸器",
};

export const REHAB_THERAPY_LABELS: Record<RehabTherapyKey, string> = {
  pt: "理学療法士",
  ot: "作業療法士",
  st: "言語聴覚士",
};

export const REHAB_COLUMN_LABELS: Record<RehabColumnKey, string> = {
  ...REHAB_THERAPY_LABELS,
  disease_name_comment: "疾患名コメント(830)",
  onset_date_comment: "発症日コメント(850)",
};

export const NUTRITION_LABELS: Record<keyof ReceiptCodeSettings["nutrition_guidance"], string> = {
  initial: "初回",
  "follow-up": "2 回目以降",
  group: "集団",
};

export const TRANSFUSION_LABELS: Record<keyof ReceiptCodeSettings["transfusion"], string> = {
  first: "保存血液輸血(1 回目)",
  subsequent: "保存血液輸血(2 回目以降)",
};

export const INJECTION_LABELS: Record<keyof ReceiptCodeSettings["injection"], string> = {
  outpatient_chemo_addition: "外来化学療法加算",
  outpatient_chemo_addition_child: "外来化学療法加算(15 歳未満)",
  aseptic_preparation: "無菌製剤処理料",
};

/** 9 桁の数字か空。 */
export function receiptCodeValid(value: string): boolean {
  return value === "" || /^\d{9}$/.test(value);
}

/** 設定全体の値が入力規則を満たすか。 */
export function receiptCodesValid(settings: ReceiptCodeSettings): boolean {
  const flat: string[] = [
    ...Object.values(settings.pathology),
    ...Object.values(settings.rehab).flatMap((row) => Object.values(row)),
    ...Object.values(settings.nutrition_guidance),
    ...Object.values(settings.lab),
    ...Object.values(settings.radiotherapy),
    ...Object.values(settings.transfusion),
    ...Object.values(settings.injection),
  ];
  return flat.every(receiptCodeValid);
}
