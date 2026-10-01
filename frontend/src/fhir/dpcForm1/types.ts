// DPC 様式1(退院患者調査)の定義表の型。
//
// 様式1 の提出ファイルは「ヘッダ部 + コード + バージョン + 連番 + ペイロード1〜9」の
// 縦持ちで、1 行が 1 レコード。定義表はレコード(コード)ごとに、どのペイロードに何を
// 入れるかを持つ。入力フォームの描画・検証・保存(QuestionnaireResponse)・提出行は
// すべてこの定義から導く。
//
// 値は提出ファイルに書く文字列そのままで持つ(日付は YYYYMMDD、選択肢はコード)。
// 画面と提出ファイルのあいだに変換を挟まないので、保存した内容がそのまま提出行になる。

export type Dpc1PayloadNo = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export interface Dpc1Option {
  code: string;
  label: string;
}

/**
 * 入力欄の種類。
 *   date      : YYYYMMDD(画面は日付入力)
 *   select    : options から 1 つ
 *   digits    : 数字のみ。digits を指定すると桁数固定(前ゼロを保つ)
 *   number    : 整数(min / max)
 *   decimal1  : 小数点第一位までの数値(体重など)
 *   text      : 文字列(maxLength は全角も 1 文字と数える)
 *   composite : 複数の入力を連結して 1 つのペイロードにする(ADL 10 桁など)
 */
export type Dpc1FieldKind =
  | "date"
  | "select"
  | "digits"
  | "number"
  | "decimal1"
  | "text"
  | "composite";

/** composite の 1 部品。options の code を連結したものがペイロードの値になる。 */
export interface Dpc1Part {
  label: string;
  options: Dpc1Option[];
}

/**
 * 必須かどうか。関数は入力中の値から決まる条件(真なら必須)。
 * 連番のあるレコードの欄の条件では、同じレコードの値を行番号なしで読むとその行の値になる
 * (「同じ行の測定日が 99999999 なら入れない」のような条件を書ける)。
 */
export type Dpc1Rule = (ctx: Dpc1Context) => boolean;
export type Dpc1Requirement = "always" | "optional" | Dpc1Rule;

export interface Dpc1FieldDef {
  payload: Dpc1PayloadNo;
  label: string;
  kind: Dpc1FieldKind;
  /** select の選択肢。 */
  options?: Dpc1Option[];
  /** digits の固定桁数。 */
  digits?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  /** text の書式(正規表現のソース。全体一致)。 */
  pattern?: string;
  /** composite の部品。各部品の code は同じ長さに揃える(分解を桁位置で行うため)。 */
  parts?: Dpc1Part[];
  /**
   * 日付・数値の欄に、値の代わりに入れられる決まった値(不明の "99999999" など)。
   * 画面では入力欄の横の選択で入れる。
   */
  specials?: Dpc1Option[];
  /** 省略時は "always"(レコードを出すなら必須)。 */
  required?: Dpc1Requirement;
  /** 偽のとき欄を出さず、値も保存しない。省略時は常に出す。 */
  visible?: Dpc1Rule;
}

/** 画面のまとまり(fieldset)。 */
export type Dpc1Section =
  | "patient"
  | "admission"
  | "discharge"
  | "profile"
  | "diagnosis"
  | "surgery"
  | "score"
  | "cancer"
  | "disease"
  | "psychiatry"
  | "intensive"
  | "rehab";

export const DPC1_SECTION_LABELS: Record<Dpc1Section, string> = {
  patient: "患者属性",
  admission: "入院情報",
  discharge: "退院情報",
  profile: "患者プロファイル",
  diagnosis: "診断情報",
  surgery: "手術情報",
  score: "ADL・JCS",
  cancer: "がん",
  disease: "疾患別",
  psychiatry: "精神",
  intensive: "SOFA",
  rehab: "FIM",
};

export interface Dpc1RecordDef {
  /** ペイロード種別のコード(A000010 など)。 */
  code: string;
  name: string;
  /** 新設年度を表すバージョン(20140401 など)。 */
  version: string;
  section: Dpc1Section;
  /** 連番を持つレコード(複数行)。max は行数の上限。 */
  repeat?: { max: number };
  /**
   * レコードそのものが必須かどうか。"always" は全入院、"optional" は任意、
   * 関数は条件を満たすとき必須。必須でないレコードは画面で手動で開く。
   */
  required: Dpc1Requirement;
  fields: Dpc1FieldDef[];
  /**
   * 汎用の描画ではなく専用の入力部品を使うレコード。
   *   diagnosis : 病名(登録病名・病名マスタから選ぶ)
   *   surgery   : 手術(実施記録・診療行為マスタから選ぶ)
   */
  custom?: "diagnosis" | "surgery";
}

/** 1 レコード(1 行)の値。p はペイロード番号 → 提出文字列。 */
export interface Dpc1Row {
  p: Partial<Record<Dpc1PayloadNo, string>>;
  /** 値の元になったリソース("Condition/x"、"Procedure/x")。集め直しの突き合わせに使う。 */
  ref?: string;
}

/** 提出ファイルのヘッダ部。 */
export interface Dpc1Header {
  /** 施設コード(都道府県番号 2 桁 + 医療機関コード 7 桁)。 */
  facility: string;
  /** データ識別番号(10 桁)。 */
  dataId: string;
  /** 入院年月日(YYYYMMDD)。 */
  admitDate: string;
  /** 回数管理番号。同日入退院でなければ 0。 */
  count: string;
  /** 統括診療情報番号。親様式1 は 0。 */
  summaryNo: string;
  /** 定義表の年度(退院日の属する年度)。 */
  fiscalYear: string;
}

export interface Dpc1Values {
  header: Dpc1Header;
  /** コード → 行。連番の無いレコードは 1 行。入力していないレコードはキーごと無い。 */
  records: Record<string, Dpc1Row[]>;
}

/** 条件(Dpc1Rule)が読む、入力中の内容。 */
export interface Dpc1Context {
  /** 入院時の年齢。生年月日が無ければ null。 */
  age: number | null;
  /** レコードの値。連番のあるレコードは index で行を指す(省略時は先頭行)。 */
  get(code: string, payload: Dpc1PayloadNo, index?: number): string;
  rows(code: string): Dpc1Row[];
  /** ICD-10(小数点なし)が属する診断群分類の上 6 桁。対応表に無ければ空。 */
  mdc6(icd10: string): string[];
}
