// マスタメンテの一覧(/masters)に並べるマスタの定義。診療領域ごとにまとめ、
// どの領域にも属さないものは「共通」に入れる。マスタの画面を足すときはここに 1 行足す。

export type MasterMenuItem = { label: string; to: string };
export type MasterMenuGroup = { label: string; items: MasterMenuItem[] };

export const MASTER_MENU: MasterMenuGroup[] = [
  // 自院のマスタ。診療科・診察室・スタッフは自院のものしか登録しない(他院は下の「連携先」)。
  {
    label: "共通",
    items: [
      // マスタ取込は領域をまたぐので先頭に置く。
      { label: "マスタ取込", to: "/master-import" },
      { label: "医療機関", to: "/organizations" },
      { label: "診療科", to: "/departments" },
      { label: "医療従事者", to: "/practitioners" },
      { label: "診察室・撮影室", to: "/locations" },
      { label: "病棟・病室", to: "/wards" },
      { label: "注意区分", to: "/patient-cautions" },
      { label: "診療記録タイトル", to: "/clinical-note-titles" },
    ],
  },
  // 他院。診療情報提供書の送付先候補として登録する。
  {
    label: "連携先",
    items: [
      { label: "連携先医療機関", to: "/partner-organizations" },
      { label: "連携先医師", to: "/partner-practitioners" },
    ],
  },
  {
    label: "テンプレート",
    items: [
      { label: "テンプレート", to: "/questionnaires" },
      { label: "帳票レイアウト", to: "/report-layouts" },
      { label: "文書テンプレート", to: "/document-templates" },
      { label: "シェーマ", to: "/schemas" },
    ],
  },
  {
    label: "医薬品",
    items: [
      { label: "投与量換算", to: "/medicine-dose-conversions" },
      { label: "フォーミュラリ", to: "/formularies" },
      { label: "薬剤チェック", to: "/drug-checks" },
      { label: "スケールセット", to: "/insulin-scale-sets" },
    ],
  },
  // 化学療法のマスタ。レジメンは審査委員会で承認する施設共通の参照表なので
  // マスタメンテに置く(docs/chemo-regimen-design.md)。
  {
    label: "化学療法",
    items: [{ label: "レジメン", to: "/regimens" }],
  },
  // クリニカルパス(施設パス)の定義。承認制の施設共通マスタ(docs/clinical-pathway-design.md)。
  {
    label: "クリニカルパス",
    items: [{ label: "パス定義", to: "/pathways" }],
  },
  {
    label: "検体検査",
    items: [
      { label: "検査オーダー項目", to: "/lab-order-items" },
      { label: "検査結果項目", to: "/lab-result-items" },
      { label: "検査オーダーレイアウト", to: "/lab-order-item-layouts" },
      { label: "検体", to: "/lab-specimens" },
      { label: "採取管", to: "/lab-containers" },
    ],
  },
  // 細菌検査は検体を扱う点で検体検査に近いので、その次に並べる。
  {
    label: "細菌検査",
    items: [
      { label: "検査項目・採取部位", to: "/micro-order-items" },
      { label: "JANIS材料コード", to: "/micro-specimen-types" },
      { label: "JANIS病原体コード", to: "/micro-organisms" },
      { label: "JANIS抗菌薬コード", to: "/micro-antimicrobials" },
      { label: "JANIS感受性測定法コード", to: "/micro-susceptibility-methods" },
    ],
  },
  {
    label: "病理検査",
    items: [
      { label: "臓器・検査材料", to: "/patho-organs" },
      { label: "採取法", to: "/patho-collection-methods" },
    ],
  },
  {
    label: "放射線検査",
    items: [
      { label: "放射線オーダー項目", to: "/rad-items" },
      { label: "放射線オーダーレイアウト", to: "/rad-item-layouts" },
      { label: "JJ1017コード", to: "/rad-jj1017-codes" },
      // 実施入力で使う器材。実際の製品を登録し、算定用の特定器材コードを紐付ける。
      { label: "放射線器材", to: "/rad-materials" },
      // 実施入力の初期明細。撮影項目に紐付けて使う。
      { label: "実施入力データセット", to: "/rad-datasets" },
    ],
  },
  // 生理検査。JJ1017 に収載されていないので部品コード・頻用コードは無く、
  // モダリティの代わりに施設が定義する「検査種別」を持つ。
  {
    label: "生理検査",
    items: [
      { label: "生理検査オーダー項目", to: "/physio-items" },
      { label: "生理検査オーダーレイアウト", to: "/physio-item-layouts" },
      // 心電図・超音波検査などの検査分野。放射線のモダリティに当たる。
      { label: "検査種別", to: "/physio-exam-types" },
      // 実施入力の初期明細。検査項目に紐付けて使う。
      { label: "実施入力データセット", to: "/physio-datasets" },
    ],
  },
  // 内視鏡。生理検査と同じ構成。
  {
    label: "内視鏡",
    items: [
      { label: "内視鏡オーダー項目", to: "/endoscopy-items" },
      { label: "内視鏡オーダーレイアウト", to: "/endoscopy-item-layouts" },
      // 上部・下部などの検査分野。JED の4区分との対応を持てる。
      { label: "検査種別", to: "/endoscopy-exam-types" },
      // 実施入力の初期明細。検査項目に紐付けて使う。
      { label: "実施入力データセット", to: "/endoscopy-datasets" },
    ],
  },
  // 処置。生理検査と同じ構成だが、検査種別に当たる分類軸は持たない。
  {
    label: "処置",
    items: [
      { label: "処置オーダー項目", to: "/treatment-items" },
      { label: "処置オーダーレイアウト", to: "/treatment-item-layouts" },
      // 実施入力の初期明細。処置項目に紐付けて使う。
      { label: "実施入力データセット", to: "/treatment-datasets" },
    ],
  },
  // 手術。術式は検索で選ぶだけなのでレイアウト・データセットのマスタは無い。
  {
    label: "手術",
    items: [
      { label: "術式マスタ", to: "/surgery-items" },
      // 術式の分類。点数表 第10部の「款 → 区分」に合わせて入れ子にできる。
      { label: "術式種別", to: "/surgery-categories" },
      { label: "手術室 ブロックスケジュール", to: "/surgery-room-blocks" },
    ],
  },
  // 食事。食種(種別・食止め・主成分量を持つ)と、主食・副食形態のリスト。
  // セット・レイアウト・データセットは持たない。
  {
    label: "食事",
    items: [
      { label: "食種", to: "/meal-diets" },
      { label: "主食・副食形態", to: "/meal-items" },
      // 食種の分類(一般食・特別食 など)。主食には付けない。
      { label: "食種種別", to: "/meal-categories" },
    ],
  },
  // 輸血。食事と同じく製剤マスタ 1 本だけ(セット・レイアウト・データセットは持たない)。
  {
    label: "輸血",
    items: [{ label: "輸血製剤マスタ", to: "/transfusion-products" }],
  },
  // 放射線治療。装置・技法・定型の線量分割は施設ごとに違うので、選択肢をマスタで持つ。
  {
    label: "放射線治療",
    items: [
      { label: "治療プロトコルマスタ", to: "/radiotherapy-protocols" },
      { label: "照射モダリティマスタ", to: "/radiotherapy-modalities" },
      { label: "照射技法マスタ", to: "/radiotherapy-techniques" },
      { label: "治療装置マスタ", to: "/radiotherapy-devices" },
      { label: "休止・中止理由マスタ", to: "/radiotherapy-stop-reasons" },
    ],
  },
  // 看護。MEDIS 看護実践用語標準マスターの閲覧(取込で洗い替える読み取り専用)と、
  // 看護計画の用語・標準看護計画。
  {
    label: "看護",
    items: [
      { label: "看護行為マスタ", to: "/nursing-acts" },
      { label: "看護観察マスタ", to: "/nursing-observations" },
      { label: "看護診断マスタ", to: "/nursing-diagnoses" },
      { label: "看護成果マスタ", to: "/nursing-outcomes" },
      { label: "看護介入マスタ", to: "/nursing-interventions" },
      { label: "標準看護計画マスタ", to: "/nursing-standard-plans" },
    ],
  },
];

const MASTER_MENU_PATH = "/masters";

const MASTER_PATHS = MASTER_MENU.flatMap((group) => group.items.map((item) => item.to));

/** マスタメンテの一覧か、そこから入る画面(登録・編集などの配下も含む)にいるかどうか。 */
export function isMasterPath(pathname: string): boolean {
  if (pathname === MASTER_MENU_PATH) return true;
  return MASTER_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}
