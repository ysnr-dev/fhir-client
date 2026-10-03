// 様式1 の共通項目(患者属性・入退院情報・患者プロファイル)のレコード定義。
// 親様式1 を対象にする。子様式1 だけで使う値は、選択肢に区分名で分かるように残す。

import {
  admissionRouteIn,
  ageAtLeast,
  manual,
  or,
  payloadIn,
  psychiatricWard,
  resourceMdc6In,
} from "../rules";
import type { Dpc1Option, Dpc1Part, Dpc1RecordDef } from "../types";

const V2014 = "20140401";
const V2018 = "20180401";
const V2024 = "20240601";

const NO_YES: Dpc1Option[] = [
  { code: "0", label: "無" },
  { code: "1", label: "有" },
];

const SEX_OPTIONS: Dpc1Option[] = [
  { code: "1", label: "男" },
  { code: "2", label: "女" },
];

export const ADMISSION_ROUTE_OPTIONS: Dpc1Option[] = [
  { code: "0", label: "院内の他病棟からの転棟" },
  { code: "1", label: "家庭からの入院" },
  { code: "4", label: "他の病院・診療所の病棟からの転院" },
  { code: "5", label: "介護施設・福祉施設に入所中" },
  { code: "8", label: "院内で出生" },
  { code: "9", label: "その他" },
];

// 救急医療入院(3**)の理由。下 2 桁と患者の状態の組で、資料の並び順のまま持つ。
const EMERGENCY_STATES: [string, string][] = [
  ["01", "吐血、喀血又は重篤な脱水で全身状態不良の状態"],
  ["02", "意識障害又は昏睡"],
  ["33", "呼吸不全で重篤な状態"],
  ["34", "心不全で重篤な状態"],
  ["04", "急性薬物中毒"],
  ["05", "ショック"],
  ["06", "重篤な代謝障害(肝不全、腎不全、重症糖尿病等)"],
  ["07", "広範囲熱傷、顔面熱傷又は気道熱傷"],
  ["08", "外傷、破傷風等で重篤な状態"],
  ["09", "緊急手術、緊急カテーテル治療・検査又はt-PA療法を必要とする状態"],
  ["31", "消化器疾患で緊急処置を必要とする重篤な状態"],
  ["32", "蘇生術を必要とする重篤な状態"],
];

// 「準ずる状態」の下 2 桁と、元になる状態の下 2 桁。
const EMERGENCY_QUASI: [string, string][] = [
  ["11", "01"],
  ["12", "02"],
  ["23", "33"],
  ["24", "34"],
  ["14", "04"],
  ["15", "05"],
  ["16", "06"],
  ["17", "07"],
  ["18", "08"],
  ["19", "09"],
  ["21", "31"],
  ["22", "32"],
];

const emergencyStateLabel = (suffix: string): string =>
  EMERGENCY_STATES.find(([code]) => code === suffix)?.[1] ?? "";

export const ADMISSION_TYPE_OPTIONS: Dpc1Option[] = [
  { code: "100", label: "予定入院" },
  { code: "101", label: "予定された再入院(悪性腫瘍患者に係る化学療法を実施)" },
  { code: "200", label: "救急医療入院以外の予定外入院" },
  ...EMERGENCY_STATES.map(([suffix, label]) => ({
    code: `3${suffix}`,
    label: `救急医療入院: ${label}`,
  })),
  ...EMERGENCY_QUASI.map(([suffix, base]) => ({
    code: `3${suffix}`,
    label: `救急医療入院: ${emergencyStateLabel(base)}に準ずる状態`,
  })),
  { code: "320", label: "救急医療入院: その他の重症な状態" },
];

export const HOME_CARE_OPTIONS: Dpc1Option[] = [
  { code: "0", label: "無" },
  { code: "1", label: "当院が提供" },
  { code: "2", label: "他施設が提供" },
  { code: "9", label: "不明" },
];

const SELF_HARM_OPTIONS: Dpc1Option[] = [
  { code: "1", label: "縊頚・自絞" },
  { code: "2", label: "飛び降り・飛び込み" },
  { code: "3", label: "服毒(消毒薬・洗剤・針等の異物を含む)" },
  { code: "4", label: "過量服薬" },
  { code: "5", label: "刃物等による体幹の切創・刺創" },
  { code: "6", label: "四肢の切創・刺創(手首自傷を含む)" },
  { code: "7", label: "一酸化炭素中毒・焼身" },
  { code: "8", label: "入水" },
  { code: "9", label: "上記の複合的併用" },
  { code: "10", label: "その他" },
  { code: "99", label: "無" },
];

const PAST_SELF_HARM_OPTIONS: Dpc1Option[] = [
  { code: "0", label: "無" },
  { code: "1", label: "有" },
  { code: "9", label: "不明" },
];

export const DISCHARGE_DESTINATION_OPTIONS: Dpc1Option[] = [
  { code: "0", label: "院内の他病棟への転棟" },
  { code: "1", label: "家庭への退院(当院に通院)" },
  { code: "2", label: "家庭への退院(他の病院・診療所に通院)" },
  { code: "3", label: "家庭への退院(その他)" },
  { code: "4", label: "他の病院・診療所への転院" },
  { code: "5", label: "介護老人保健施設に入所" },
  { code: "6", label: "介護老人福祉施設に入所" },
  { code: "7", label: "社会福祉施設、有料老人ホーム等に入所" },
  { code: "8", label: "終了(死亡等)" },
  { code: "9", label: "その他" },
  { code: "a", label: "介護医療院" },
];

export const DISCHARGE_OUTCOME_OPTIONS: Dpc1Option[] = [
  { code: "1", label: "治癒・軽快" },
  { code: "3", label: "寛解" },
  { code: "4", label: "不変" },
  { code: "5", label: "増悪" },
  { code: "6", label: "最も医療資源を投入した傷病による死亡" },
  { code: "7", label: "最も医療資源を投入した傷病以外による死亡" },
  { code: "9", label: "その他(検査入院含む)" },
];

const DEATH_WITHIN_24H_OPTIONS: Dpc1Option[] = [
  { code: "0", label: "入院後24時間以内の死亡無し" },
  { code: "1", label: "入院後24時間以内の死亡有り" },
  { code: "2", label: "救急患者として搬送され、入院前に処置室、手術室等で死亡有り" },
];

export const DEPARTMENT_OPTIONS: Dpc1Option[] = [
  { code: "010", label: "内科" },
  { code: "020", label: "心療内科" },
  { code: "030", label: "精神科" },
  { code: "040", label: "神経科" },
  { code: "050", label: "呼吸器科" },
  { code: "060", label: "消化器科" },
  { code: "070", label: "循環器科" },
  { code: "080", label: "アレルギー科" },
  { code: "090", label: "リウマチ科" },
  { code: "100", label: "小児科" },
  { code: "110", label: "外科" },
  { code: "120", label: "整形外科" },
  { code: "130", label: "形成外科" },
  { code: "140", label: "美容外科" },
  { code: "150", label: "脳神経外科" },
  { code: "160", label: "呼吸器外科" },
  { code: "170", label: "心臓血管外科" },
  { code: "180", label: "小児外科" },
  { code: "190", label: "皮膚泌尿器科" },
  { code: "200", label: "性病科" },
  { code: "210", label: "肛門科" },
  { code: "220", label: "産婦人科" },
  { code: "230", label: "眼科" },
  { code: "240", label: "耳鼻咽喉科" },
  { code: "250", label: "気管食道科" },
  { code: "260", label: "リハビリテーション科" },
  { code: "270", label: "放射線科" },
  { code: "280", label: "神経内科" },
  { code: "290", label: "胃腸科" },
  { code: "300", label: "皮膚科" },
  { code: "310", label: "泌尿器科" },
  { code: "320", label: "産科" },
  { code: "330", label: "婦人科" },
  { code: "340", label: "呼吸器内科" },
  { code: "350", label: "循環器内科" },
  { code: "360", label: "歯科" },
  { code: "370", label: "歯科矯正科" },
  { code: "380", label: "小児歯科" },
  { code: "390", label: "歯科口腔外科" },
  { code: "400", label: "糖尿病科" },
  { code: "410", label: "腎臓内科" },
  { code: "420", label: "腎移植科" },
  { code: "430", label: "血液透析科" },
  { code: "440", label: "代謝内科" },
  { code: "450", label: "内分泌内科" },
  { code: "460", label: "救急医学科" },
  { code: "470", label: "血液科" },
  { code: "480", label: "血液内科" },
  { code: "490", label: "麻酔科" },
  { code: "500", label: "消化器内科" },
  { code: "510", label: "消化器外科" },
  { code: "520", label: "肝胆膵外科" },
  { code: "530", label: "糖尿内科" },
  { code: "540", label: "大腸肛門科" },
  { code: "550", label: "眼形成眼窩外科" },
  { code: "560", label: "不妊内分泌科" },
  { code: "570", label: "膠原病リウマチ内科" },
  { code: "580", label: "脳卒中科" },
  { code: "590", label: "腫瘍治療科" },
  { code: "600", label: "総合診療科" },
  { code: "610", label: "乳腺甲状腺外科" },
  { code: "620", label: "新生児科" },
  { code: "630", label: "小児循環器科" },
  { code: "640", label: "緩和ケア科" },
  { code: "650", label: "内分泌リウマチ科" },
  { code: "660", label: "血液腫瘍内科" },
  { code: "670", label: "腎不全科" },
  { code: "680", label: "精神神経科" },
  { code: "690", label: "内分泌代謝科" },
  { code: "700", label: "病理診断科" },
  { code: "710", label: "臨床検査科" },
];

const PURPOSE_OPTIONS: Dpc1Option[] = [
  { code: "1", label: "診断・検査のみ" },
  { code: "2", label: "教育入院" },
  { code: "3", label: "計画された短期入院の繰り返し(化学療法、放射線療法、抜釘)" },
  { code: "4", label: "その他の加療" },
];

const READMISSION_KIND_OPTIONS: Dpc1Option[] = [
  { code: "1", label: "計画的再入院" },
  { code: "2", label: "計画外の再入院" },
];

// 理由の種別は、同じ値でも種別(計画的・計画外)によって意味が変わる。
// 選択肢を種別で切り替える手段が無いので、両方の意味を 1 つの label に並べる。
const READMISSION_REASON_OPTIONS: Dpc1Option[] = [
  {
    code: "1",
    label:
      "計画的: 前回入院で術前検査等を行い、今回入院で手術を行うため / " +
      "計画外: 原疾患の悪化、再発のため",
  },
  {
    code: "2",
    label:
      "計画的: 前回入院以前に手術を行い、今回入院で計画的に術後の手術・処置・検査を行うため / " +
      "計画外: 原疾患の合併症発症のため",
  },
  {
    code: "3",
    label: "計画的: 計画的な化学療法のため / 計画外: 前回入院時の入院時併存症の悪化のため",
  },
  {
    code: "4",
    label: "計画的: 計画的な放射線療法のため / 計画外: 前回入院時の入院後発症疾患の悪化のため",
  },
  {
    code: "5",
    label:
      "計画的: 前回入院時、予定された手術・検査等が実施できなかったため / " +
      "計画外: 前回入院時の手術・処置や治療の合併症が退院後に発症したため",
  },
  {
    code: "6",
    label: "計画的: 患者のQOL向上のため一時帰宅したため / 計画外: 新たな他疾患発症のため",
  },
  { code: "7", label: "その他" },
];

const RETRANSFER_KIND_OPTIONS: Dpc1Option[] = [
  { code: "1", label: "計画的再転棟" },
  { code: "2", label: "計画外の再転棟" },
];

const RETRANSFER_REASON_OPTIONS: Dpc1Option[] = [
  {
    code: "1",
    label:
      "計画的: 術前検査等で一般病棟グループへ入院後手術のため / " +
      "計画外: 原疾患の悪化、再発のため",
  },
  {
    code: "2",
    label: "計画的: 計画的な手術・処置・検査のため / 計画外: 原疾患の合併症発症のため",
  },
  {
    code: "3",
    label: "計画的: 計画的な化学療法のため / 計画外: 入院時併存症の悪化のため",
  },
  {
    code: "4",
    label: "計画的: 計画的な放射線療法のため / 計画外: 入院後発症疾患の悪化のため",
  },
  {
    code: "5",
    label:
      "計画的: 前回一般病棟グループでの入院時、予定された手術・検査等を中止して一時転棟したため / " +
      "計画外: 手術・処置や治療の合併症が転棟後に発症したため",
  },
  {
    code: "6",
    label: "計画的: 患者のQOL向上のため一時転棟したため / 計画外: 新たな他疾患発症のため",
  },
  { code: "7", label: "その他" },
];

// 理由の種別の「その他」。自由記載欄を出す条件に使う。
const REASON_OTHER = "7";

// 褥瘡の状態(DESIGN-R 分類)。各分類の値を 1 桁ずつ連ねた 7 桁で表す。
const PRESSURE_ULCER_PARTS: Dpc1Part[] = [
  {
    label: "深さ",
    options: [
      { code: "0", label: "皮膚損傷・発赤なし" },
      { code: "1", label: "持続する発赤" },
      { code: "2", label: "真皮までの損傷" },
      { code: "3", label: "皮下組織までの損傷" },
      { code: "4", label: "皮下組織をこえる損傷" },
      { code: "5", label: "関節腔、体腔に至る損傷" },
      { code: "6", label: "深部損傷褥瘡(DTI)疑い" },
      { code: "9", label: "判定不能" },
    ],
  },
  {
    label: "滲出液",
    options: [
      { code: "0", label: "なし" },
      { code: "1", label: "少量: 毎日の交換を要しない" },
      { code: "2", label: "中等量: 1日1回の交換" },
      { code: "3", label: "多量: 1日2回以上の交換" },
    ],
  },
  {
    label: "大きさ(cm2)",
    options: [
      { code: "0", label: "皮膚損傷なし" },
      { code: "1", label: "4未満" },
      { code: "2", label: "4以上16未満" },
      { code: "3", label: "16以上36未満" },
      { code: "4", label: "36以上64未満" },
      { code: "5", label: "64以上100未満" },
      { code: "6", label: "100以上" },
    ],
  },
  {
    label: "炎症・感染",
    options: [
      { code: "0", label: "局所の炎症徴候なし" },
      { code: "1", label: "局所の炎症徴候あり" },
      { code: "2", label: "臨界的定着疑い" },
      { code: "3", label: "局所の明らかな感染徴候あり" },
      { code: "4", label: "全身的影響あり" },
    ],
  },
  {
    label: "肉芽形成(良性肉芽が占める割合)",
    options: [
      { code: "0", label: "創が治癒した場合、創が浅い場合、深部損傷褥瘡(DTI)疑い" },
      { code: "1", label: "創面の90%以上を占める" },
      { code: "2", label: "創面の50%以上90%未満を占める" },
      { code: "3", label: "創面の10%以上50%未満を占める" },
      { code: "4", label: "創面の10%未満を占める" },
      { code: "5", label: "全く形成されていない" },
    ],
  },
  {
    label: "壊死組織",
    options: [
      { code: "0", label: "なし" },
      { code: "1", label: "柔らかい壊死組織あり" },
      { code: "2", label: "硬く厚い密着した壊死組織あり" },
    ],
  },
  {
    label: "ポケット(cm2)",
    options: [
      { code: "0", label: "なし" },
      { code: "1", label: "4未満" },
      { code: "2", label: "4以上16未満" },
      { code: "3", label: "16以上36未満" },
      { code: "4", label: "36以上" },
    ],
  },
];

const PREGNANCY_OPTIONS: Dpc1Option[] = [
  { code: "0", label: "無" },
  { code: "1", label: "有" },
  { code: "2", label: "不明" },
];

const DEMENTIA_INDEPENDENCE_OPTIONS: Dpc1Option[] = [
  { code: "0", label: "無" },
  { code: "1", label: "Ⅰ" },
  { code: "2", label: "Ⅱ" },
  { code: "3", label: "Ⅲ" },
  { code: "4", label: "Ⅳ" },
  { code: "5", label: "Ｍ" },
];

const CARE_LEVEL_OPTIONS: Dpc1Option[] = [
  { code: "0", label: "無" },
  { code: "1", label: "要支援1" },
  { code: "2", label: "要支援2" },
  { code: "3", label: "要介護1" },
  { code: "4", label: "要介護2" },
  { code: "5", label: "要介護3" },
  { code: "6", label: "要介護4" },
  { code: "7", label: "要介護5" },
  { code: "8", label: "申請中" },
  { code: "9", label: "不明" },
];

// やむを得ず評価できない評価項目に入れる値。
const NOT_EVALUABLE: Dpc1Option = { code: "9", label: "評価不能" };

// 低栄養の有無(GLIM 基準)。判定と該当項目の値を 1 桁ずつ連ねた 6 桁で表す。
// 評価を行わなかった場合は全部「該当しない」("000000")にする。
const MALNUTRITION_PARTS: Dpc1Part[] = [
  {
    label: "低栄養",
    options: [
      { code: "0", label: "該当しない" },
      { code: "1", label: "該当する" },
      NOT_EVALUABLE,
    ],
  },
  {
    label: "意図しない体重の減少",
    options: [
      { code: "0", label: "該当しない" },
      { code: "1", label: ">5% 過去6カ月以内" },
      { code: "2", label: ">10% 過去6カ月以上" },
      NOT_EVALUABLE,
    ],
  },
  {
    label: "低BMI",
    options: [
      { code: "0", label: "該当しない" },
      { code: "1", label: "<18.5: 70歳未満" },
      { code: "2", label: "<20: 70歳以上" },
      NOT_EVALUABLE,
    ],
  },
  {
    label: "筋肉量減少",
    options: [
      { code: "0", label: "該当しない" },
      { code: "1", label: "筋肉量減少" },
      NOT_EVALUABLE,
    ],
  },
  {
    label: "食事摂取量減少/消化吸収能低下",
    options: [
      { code: "0", label: "該当しない" },
      { code: "1", label: "1週間以上、必要栄養量の50%以下の食事摂取量" },
      { code: "2", label: "2週間以上、様々な程度の食事摂取量減少" },
      { code: "3", label: "消化吸収に悪影響を及ぼす慢性的な消化管の状態" },
      NOT_EVALUABLE,
    ],
  },
  {
    label: "疾患負荷/炎症",
    options: [
      { code: "0", label: "なし" },
      { code: "1", label: "急性疾患や外傷による炎症" },
      { code: "2", label: "慢性疾患による炎症" },
      NOT_EVALUABLE,
    ],
  },
];

const DYSPHAGIA_OPTIONS: Dpc1Option[] = [
  { code: "0", label: "無" },
  { code: "1", label: "有" },
  { code: "9", label: "当該判断を行っていない" },
];

const NOT_DONE_DONE: Dpc1Option[] = [
  { code: "0", label: "実施していない" },
  { code: "1", label: "実施している" },
];

// 経管・経静脈栄養の状況。栄養摂取方法ごとの実施の有無を 1 桁ずつ連ねた 5 桁で表す。
const TUBE_NUTRITION_PARTS: Dpc1Part[] = [
  "経鼻胃管",
  "胃瘻・腸瘻",
  "末梢静脈栄養",
  "中心静脈栄養",
  "皮下注射",
].map((label) => ({ label, options: NOT_DONE_DONE }));

const DATE_UNKNOWN: Dpc1Option = { code: "00000000", label: "不明" };
const NOT_MEASURABLE: Dpc1Option = { code: "000", label: "測定不能" };

/** 入院経路が家庭・他院・施設からの入院(1・4・5)。入院時の状況の欄はこのときだけ入力する。 */
const admittedFromOutside = admissionRouteIn("1", "4", "5");

export const COMMON_RECORDS: Dpc1RecordDef[] = [
  {
    code: "A000010",
    name: "患者属性",
    version: V2014,
    section: "patient",
    required: "always",
    fields: [
      { payload: 1, label: "生年月日", kind: "date", specials: [DATE_UNKNOWN] },
      { payload: 2, label: "性別", kind: "select", options: SEX_OPTIONS },
      {
        payload: 3,
        label: "患者住所地域の郵便番号",
        kind: "digits",
        digits: 7,
        specials: [
          { code: "0000000", label: "不明" },
          { code: "9999999", label: "海外在住" },
        ],
      },
    ],
  },
  {
    code: "A000020",
    name: "入院情報",
    version: V2014,
    section: "admission",
    required: "always",
    fields: [
      { payload: 1, label: "入院年月日", kind: "date" },
      { payload: 2, label: "入院経路", kind: "select", options: ADMISSION_ROUTE_OPTIONS },
      {
        payload: 3,
        label: "他院よりの紹介の有無",
        kind: "select",
        options: NO_YES,
        visible: admittedFromOutside,
      },
      {
        payload: 4,
        label: "自院の外来からの入院",
        kind: "select",
        options: NO_YES,
        visible: admittedFromOutside,
      },
      {
        payload: 5,
        label: "予定・救急医療入院",
        kind: "select",
        options: ADMISSION_TYPE_OPTIONS,
        visible: admittedFromOutside,
      },
      {
        payload: 6,
        label: "救急車による搬送の有無",
        kind: "select",
        options: NO_YES,
        visible: admittedFromOutside,
      },
      {
        payload: 7,
        label: "入院前の在宅医療の有無",
        kind: "select",
        options: HOME_CARE_OPTIONS,
        visible: admittedFromOutside,
      },
      {
        payload: 8,
        label: "自傷行為・自殺企図の有無",
        kind: "select",
        options: SELF_HARM_OPTIONS,
        // 必須になるのは MDC17 の傷病か精神病棟グループの入院があるときで、それ以外は任意。
        required: or(resourceMdc6In("17"), psychiatricWard),
        visible: admissionRouteIn("0", "1", "4", "5"),
      },
      {
        payload: 9,
        label: "過去の自傷行為・自殺企図の有無",
        kind: "select",
        options: PAST_SELF_HARM_OPTIONS,
        visible: payloadIn("A000020", 8, "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"),
      },
    ],
  },
  {
    code: "A000030",
    name: "退院情報",
    version: V2014,
    section: "discharge",
    required: "always",
    fields: [
      { payload: 1, label: "退院年月日", kind: "date" },
      { payload: 2, label: "退院先", kind: "select", options: DISCHARGE_DESTINATION_OPTIONS },
      { payload: 3, label: "退院時転帰", kind: "select", options: DISCHARGE_OUTCOME_OPTIONS },
      {
        payload: 4,
        label: "24時間以内の死亡の有無",
        kind: "select",
        options: DEATH_WITHIN_24H_OPTIONS,
      },
      {
        payload: 5,
        label: "退院後の在宅医療の有無",
        kind: "select",
        options: HOME_CARE_OPTIONS,
        visible: payloadIn("A000030", 2, "1", "2", "3", "4", "5", "6", "7", "8", "9", "a"),
      },
    ],
  },
  {
    code: "A000031",
    name: "様式1対象期間",
    version: V2014,
    section: "discharge",
    required: "always",
    fields: [
      { payload: 1, label: "様式1開始日", kind: "date" },
      { payload: 2, label: "様式1終了日", kind: "date" },
    ],
  },
  {
    code: "A000040",
    name: "診療科",
    version: V2014,
    section: "admission",
    required: "always",
    fields: [
      { payload: 2, label: "診療科コード", kind: "select", options: DEPARTMENT_OPTIONS },
      { payload: 3, label: "転科の有無", kind: "select", options: NO_YES },
    ],
  },
  {
    code: "A000050",
    name: "病棟",
    version: V2014,
    section: "admission",
    required: "always",
    fields: [
      {
        payload: 2,
        label: "調査対象となる一般病棟への入院の有無",
        kind: "select",
        options: NO_YES,
      },
      {
        payload: 3,
        label: "調査対象となる精神病棟への入院の有無",
        kind: "select",
        options: NO_YES,
      },
      {
        payload: 4,
        label: "調査対象となるその他の病棟への入院の有無",
        kind: "select",
        options: NO_YES,
      },
    ],
  },
  {
    code: "A000060",
    name: "診療目的・経過",
    version: V2014,
    section: "admission",
    required: "always",
    fields: [
      { payload: 2, label: "入院中の主な診療目的", kind: "select", options: PURPOSE_OPTIONS },
      { payload: 3, label: "治験実施の有無", kind: "select", options: NO_YES },
    ],
  },
  {
    code: "A000070",
    name: "前回退院",
    version: V2014,
    section: "admission",
    required: "always",
    fields: [
      {
        payload: 1,
        label: "前回退院年月日",
        kind: "date",
        specials: [DATE_UNKNOWN, { code: "99999999", label: "初回入院" }],
      },
      {
        // 前回入院と同一傷病(MDC が同じ)で予定外の入院のとき、前回退院の年月日を入れる。
        payload: 2,
        label: "前回同一傷病で自院入院の有無",
        kind: "date",
        specials: [
          DATE_UNKNOWN,
          { code: "99999999", label: "初回入院、予定入院及び同一傷病名以外" },
        ],
      },
    ],
  },
  {
    code: "A000080",
    name: "再入院調査",
    version: V2014,
    section: "admission",
    // 一般病棟グループ間の 4 週間以内の再入院かどうかは入力値から分からない。
    required: manual,
    fields: [
      { payload: 2, label: "再入院種別", kind: "select", options: READMISSION_KIND_OPTIONS },
      { payload: 3, label: "理由の種別", kind: "select", options: READMISSION_REASON_OPTIONS },
      {
        payload: 9,
        label: "自由記載欄",
        kind: "text",
        maxLength: 100,
        visible: payloadIn("A000080", 3, REASON_OTHER),
      },
    ],
  },
  {
    code: "A000090",
    name: "再転棟調査",
    version: V2014,
    section: "admission",
    // 1 入院内で一般病棟グループへ再転棟したかどうかは入力値から分からない。
    required: manual,
    fields: [
      { payload: 2, label: "再転棟種別", kind: "select", options: RETRANSFER_KIND_OPTIONS },
      { payload: 3, label: "理由の種別", kind: "select", options: RETRANSFER_REASON_OPTIONS },
      {
        payload: 9,
        label: "自由記載欄",
        kind: "text",
        maxLength: 100,
        visible: payloadIn("A000090", 3, REASON_OTHER),
      },
    ],
  },
  {
    code: "A001010",
    name: "患者プロファイル/身長・体重",
    version: V2014,
    section: "profile",
    required: "always",
    fields: [
      { payload: 2, label: "身長(cm)", kind: "number", min: 0, specials: [NOT_MEASURABLE] },
      { payload: 3, label: "入院時体重(kg)", kind: "decimal1", specials: [NOT_MEASURABLE] },
      { payload: 4, label: "退院時体重(kg)", kind: "decimal1", specials: [NOT_MEASURABLE] },
    ],
  },
  {
    code: "A001020",
    name: "患者プロファイル/喫煙指数",
    version: V2014,
    section: "profile",
    required: "always",
    fields: [
      {
        payload: 2,
        label: "喫煙指数",
        kind: "number",
        min: 0,
        specials: [{ code: "9999", label: "不明" }],
      },
    ],
  },
  {
    code: "A001030",
    name: "患者プロファイル/褥瘡(療養病棟)",
    version: V2014,
    section: "profile",
    repeat: { max: 3 },
    required: "optional",
    fields: [
      { payload: 1, label: "入棟日", kind: "date" },
      { payload: 2, label: "退棟日", kind: "date" },
      { payload: 3, label: "入棟時の褥瘡の有無", kind: "composite", parts: PRESSURE_ULCER_PARTS },
      { payload: 4, label: "退棟時の褥瘡の有無", kind: "composite", parts: PRESSURE_ULCER_PARTS },
    ],
  },
  {
    code: "A001040",
    name: "患者プロファイル/褥瘡",
    version: V2024,
    section: "profile",
    required: "optional",
    fields: [
      { payload: 3, label: "入院時の褥瘡の有無", kind: "composite", parts: PRESSURE_ULCER_PARTS },
      { payload: 4, label: "退院時の褥瘡の有無", kind: "composite", parts: PRESSURE_ULCER_PARTS },
      {
        payload: 5,
        label: "入院中の褥瘡の最大深度等",
        kind: "composite",
        parts: PRESSURE_ULCER_PARTS,
      },
      {
        payload: 6,
        label: "入院中の褥瘡の最大深度等の日付",
        kind: "date",
        specials: [{ code: "99999999", label: "褥瘡なし" }],
      },
    ],
  },
  {
    code: "A002010",
    name: "妊婦情報",
    version: V2014,
    section: "profile",
    required: "always",
    fields: [
      { payload: 2, label: "現在の妊娠の有無", kind: "select", options: PREGNANCY_OPTIONS },
      {
        payload: 3,
        label: "入院時の妊娠週数",
        kind: "number",
        min: 0,
        max: 99,
        visible: payloadIn("A002010", 2, "1"),
      },
    ],
  },
  {
    code: "A003010",
    name: "出生児情報",
    version: V2014,
    section: "profile",
    // 医療資源を最も投入した傷病名が新生児疾患かどうかは人が決める。
    required: manual,
    fields: [
      { payload: 2, label: "出生時体重(g)", kind: "number", min: 0 },
      { payload: 3, label: "出生時妊娠週数", kind: "digits", digits: 2 },
    ],
  },
  {
    code: "A004010",
    name: "高齢者情報",
    version: V2014,
    section: "profile",
    // 65 歳以上は必須。40〜64 歳の介護保険適用者は入力値から分からないので手動で開く。
    required: ageAtLeast(65),
    fields: [
      {
        payload: 2,
        label: "認知症高齢者の日常生活自立度判定基準",
        kind: "select",
        options: DEMENTIA_INDEPENDENCE_OPTIONS,
      },
    ],
  },
  {
    code: "A004020",
    name: "要介護度",
    version: V2018,
    section: "profile",
    // 65 歳以上は必須。40〜64 歳の介護保険適用者は入力値から分からないので手動で開く。
    required: ageAtLeast(65),
    fields: [{ payload: 2, label: "要介護度", kind: "select", options: CARE_LEVEL_OPTIONS }],
  },
  {
    code: "A004030",
    name: "栄養情報",
    version: V2018,
    section: "profile",
    required: "always",
    fields: [
      {
        payload: 3,
        label: "低栄養の有無(様式1開始日時点)",
        kind: "composite",
        parts: MALNUTRITION_PARTS,
        required: "optional",
      },
      {
        payload: 4,
        label: "摂食・嚥下機能障害の有無(様式1開始日時点)",
        kind: "select",
        options: DYSPHAGIA_OPTIONS,
      },
      {
        payload: 5,
        label: "低栄養の有無(様式1終了日時点)",
        kind: "composite",
        parts: MALNUTRITION_PARTS,
        required: "optional",
      },
      {
        payload: 6,
        label: "摂食・嚥下機能障害の有無(様式1終了日時点)",
        kind: "select",
        options: DYSPHAGIA_OPTIONS,
      },
      {
        payload: 7,
        label: "経管・経静脈栄養の状況(様式1開始日時点)",
        kind: "composite",
        parts: TUBE_NUTRITION_PARTS,
      },
      {
        payload: 8,
        label: "経管・経静脈栄養の状況(様式1終了日時点)",
        kind: "composite",
        parts: TUBE_NUTRITION_PARTS,
      },
      {
        payload: 9,
        label: "入院後48時間以内の栄養アセスメントの実施",
        kind: "select",
        options: NO_YES,
        required: "optional",
        visible: ageAtLeast(65),
      },
    ],
  },
  {
    code: "A004040",
    name: "転倒・転落",
    version: V2024,
    section: "profile",
    required: "optional",
    fields: [
      { payload: 2, label: "転倒・転落回数", kind: "number", min: 0 },
      {
        payload: 3,
        label: "インシデント影響度分類レベル3b以上の転倒・転落",
        kind: "number",
        min: 0,
      },
    ],
  },
  {
    code: "A004050",
    name: "身体的拘束",
    version: V2024,
    section: "profile",
    required: "optional",
    fields: [{ payload: 2, label: "身体的拘束日数", kind: "number", min: 0 }],
  },
];
