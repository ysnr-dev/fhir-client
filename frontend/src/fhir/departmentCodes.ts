// SS-MIX2 標準化ストレージ仕様書 コード表 Ver.1.2i
// 「表 53 使用者定義表-#0069 診療部門」(SS-MIX2 統一診療科コード表 V1.0)。
// 原典は「2 ケタ科ないし 3 ケタ科のいずれかの値を使用する。両者が混在しても構わない」
// とするので、2 ケタ科(SSMIX2_DEPARTMENT_CODES)と 3 ケタ科(SSMIX2_DEPARTMENT_SUB_CODES)を
// どちらも持つ。**一括登録に使うのは 2 ケタ科だけ**で、3 ケタ科は細分なので登録画面で選ぶ。
// コード 01〜39 はレセプト電算「別表 10 診療科名コード」と同一値。欠番(29/32 など)は原典どおり。
//
// 診療科(Organization)の identifier.system に使う。SS-MIX2 側に FHIR 用の
// 正式な URI 定義がないため、本アプリのローカル CodeSystem URI を割り当てる。
export const SSMIX2_DEPARTMENT_CODE_SYSTEM =
  "http://fhir-client.local/CodeSystem/ssmix2-department-code";

export interface DepartmentCode {
  code: string;
  display: string;
}

export const SSMIX2_DEPARTMENT_CODES: readonly DepartmentCode[] = [
  { code: "01", display: "内科" },
  { code: "02", display: "精神科" },
  { code: "03", display: "神経科" },
  { code: "04", display: "神経内科" },
  { code: "05", display: "呼吸器科" },
  { code: "06", display: "消化器科" },
  { code: "07", display: "胃腸科" },
  { code: "08", display: "循環器科" },
  { code: "09", display: "小児科" },
  { code: "10", display: "外科" },
  { code: "11", display: "整形外科" },
  { code: "12", display: "形成外科" },
  { code: "13", display: "美容外科" },
  { code: "14", display: "脳神経外科" },
  { code: "15", display: "呼吸器外科" },
  { code: "16", display: "心臓血管外科" },
  { code: "17", display: "小児外科" },
  { code: "18", display: "皮膚泌尿器科" },
  { code: "19", display: "皮膚科" },
  { code: "20", display: "泌尿器科" },
  { code: "21", display: "性病科" },
  { code: "22", display: "肛門科" },
  { code: "23", display: "産婦人科" },
  { code: "24", display: "産科" },
  { code: "25", display: "婦人科" },
  { code: "26", display: "眼科" },
  { code: "27", display: "耳鼻咽喉科" },
  { code: "28", display: "気管食道科" },
  { code: "30", display: "放射線科" },
  { code: "31", display: "麻酔科" },
  { code: "33", display: "心療内科" },
  { code: "34", display: "アレルギー科" },
  { code: "35", display: "リウマチ科" },
  { code: "36", display: "リハビリテーション科" },
  { code: "37", display: "病理診断科" },
  { code: "38", display: "臨床検査科" },
  { code: "39", display: "救急科" },
  { code: "40", display: "遺伝科" },
  { code: "41", display: "血液内科" },
  { code: "42", display: "血液腫瘍内科" },
  { code: "43", display: "血液透析科" },
  { code: "44", display: "健診科" },
  { code: "45", display: "呼吸器内科" },
  { code: "46", display: "在宅診療科" },
  { code: "47", display: "腫瘍診療科" },
  { code: "48", display: "腎臓内科" },
  { code: "49", display: "睡眠診療部" },
  { code: "50", display: "精神神経科" },
  { code: "51", display: "総合診療科" },
  { code: "52", display: "内視鏡診療部" },
  { code: "53", display: "内分泌・代謝科" },
  { code: "54", display: "膠原病科" },
  { code: "70", display: "消化器内科" },
  { code: "71", display: "内分泌内科" },
  { code: "72", display: "代謝内科" },
  { code: "73", display: "糖尿病内科" },
  { code: "74", display: "腎臓・内分泌内科" },
  { code: "75", display: "感染症科" },
  { code: "76", display: "漢方科" },
  { code: "77", display: "老年科" },
  { code: "78", display: "血管外科" },
  { code: "79", display: "血管内治療科" },
  { code: "7A", display: "消化器外科" },
  { code: "7B", display: "上部消化管外科" },
  { code: "7C", display: "下部消化管外科" },
  { code: "80", display: "肝胆膵外科" },
  { code: "81", display: "移植外科" },
  { code: "82", display: "乳腺外科" },
  { code: "83", display: "緩和ケア科" },
  { code: "84", display: "集中治療部" },
  { code: "85", display: "遺伝子診療部" },
  { code: "86", display: "顎口腔診療科" },
  { code: "87", display: "輸血診療部" },
  { code: "88", display: "予防医学診療部" },
  { code: "89", display: "予防接種科" },
  { code: "8A", display: "先端医療開発診療" },
  { code: "8B", display: "分子診療・細胞治療" },
  { code: "8C", display: "特殊外来" },
  { code: "8D", display: "手術部" },
  { code: "8E", display: "薬剤部" },
  { code: "8G", display: "栄養指導科" },
  { code: "8H", display: "看護部" },
  { code: "8J", display: "地域医療連携部" },
  { code: "8K", display: "治験センター" },
  { code: "90", display: "歯科" },
  { code: "98", display: "医事・事務" },
  { code: "9Z", display: "その他" },];

/**
 * 3 ケタ科。2 ケタ科をさらに細分したもので、原典では「第１内科」「放射線治療科」のように
 * 施設の名乗りに近い名前が並ぶ。先頭 2 文字が親の 2 ケタ科(コメントで区切ってある)。
 *
 * 一括登録には使わない(233 件あり、施設が実際に持つ科はその一部)。登録画面で選ぶ。
 * 原典の「膠原病・アレルギ—内科」は長音記号がダッシュになっているので、ここでは直してある。
 */
export const SSMIX2_DEPARTMENT_SUB_CODES: readonly DepartmentCode[] = [
  // 01 内科
  { code: "011", display: "第１内科" },
  { code: "012", display: "第２内科" },
  { code: "013", display: "第３内科" },
  { code: "014", display: "第４内科" },
  { code: "018", display: "一般内科" },
  { code: "01A", display: "被爆放射線医療内科" },
  // 02 精神科
  { code: "021", display: "精神科・心の診療科" },
  { code: "022", display: "精神科デイケア" },
  // 04 神経内科
  { code: "04A", display: "てんかん科" },
  { code: "04B", display: "もの忘れ科" },
  { code: "04C", display: "高次脳機能障害科" },
  { code: "04D", display: "頭痛外来" },
  { code: "04E", display: "脳卒中外来" },
  // 05 呼吸器科
  { code: "051", display: "呼吸器・アレルギー科" },
  { code: "052", display: "呼吸器・感染症内科" },
  { code: "05A", display: "せき外来" },
  { code: "05B", display: "禁煙外来" },
  // 06 消化器科
  { code: "061", display: "肝臓内科" },
  { code: "062", display: "肝胆膵科" },
  { code: "063", display: "膵臓内科" },
  { code: "064", display: "胆道・膵臓内科" },
  { code: "06A", display: "肝臓病科" },
  { code: "06B", display: "脂肪肝外来" },
  // 07 胃腸科
  { code: "07A", display: "炎症性腸疾患外来" },
  { code: "07B", display: "ピロリ菌外来" },
  // 08 循環器科
  { code: "081", display: "循環器内科" },
  { code: "082", display: "冠動脈疾患治療部" },
  { code: "083", display: "リンパ科" },
  // 09 小児科
  { code: "091", display: "小児科周産母子" },
  { code: "092", display: "新生児科" },
  { code: "093", display: "小児循環器科" },
  { code: "094", display: "小児神経科" },
  { code: "095", display: "未熟児センター" },
  { code: "096", display: "ＮＩＣＵ" },
  { code: "097", display: "GCU" },
  { code: "09A", display: "成長発達外来" },
  // 10 外科
  { code: "101", display: "第１外科" },
  { code: "102", display: "第２外科" },
  { code: "103", display: "第３外科" },
  { code: "105", display: "一般外科" },
  { code: "106", display: "総合外科" },
  { code: "107", display: "病態外科" },
  { code: "10A", display: "被爆放射線医療外科" },
  // 11 整形外科
  { code: "111", display: "整形外科・脊椎外科" },
  { code: "112", display: "脊椎外科" },
  { code: "113", display: "ロコモティブ外来" },
  { code: "114", display: "人工関節センター" },
  { code: "115", display: "装具外来" },
  { code: "116", display: "アスリート診療" },
  { code: "117", display: "スポーツ医学" },
  { code: "119", display: "関節外科" },
  { code: "11A", display: "手外科" },
  // 12 形成外科
  { code: "121", display: "形成外科・美容外科" },
  { code: "122", display: "再建外科" },
  // 14 脳神経外科
  { code: "141", display: "脳腫瘍科" },
  // 16 心臓血管外科
  { code: "162", display: "心臓外科" },
  { code: "163", display: "胸部外科" },
  { code: "164", display: "循環器外科" },
  { code: "165", display: "心臓・人工臓器外科" },
  // 17 小児外科
  { code: "171", display: "小児外科（周産母子）" },
  // 19 皮膚科
  { code: "191", display: "皮膚科・レーザ科" },
  { code: "192", display: "紫外線外来" },
  // 20 泌尿器科
  { code: "201", display: "泌尿器科・男性科" },
  { code: "202", display: "コンチネンス外来" },
  // 22 肛門科
  { code: "221", display: "ストマケア外来" },
  // 23 産婦人科
  { code: "230", display: "産科婦人科" },
  { code: "231", display: "女性外科" },
  // 24 産科
  { code: "241", display: "助産師外来" },
  // 25 婦人科
  { code: "251", display: "不妊内分泌科" },
  { code: "252", display: "周産科" },
  { code: "253", display: "周産期母性科" },
  { code: "254", display: "婦人周産期科" },
  { code: "255", display: "腹腔鏡外来" },
  { code: "25A", display: "女性科" },
  { code: "25B", display: "女性外来" },
  { code: "25C", display: "女性診療科・産科" },
  // 26 眼科
  { code: "261", display: "眼科・視覚矯正科" },
  { code: "262", display: "白内障外来" },
  { code: "263", display: "コンタクトレンズ外来" },
  { code: "264", display: "ドライアイ外来" },
  { code: "265", display: "ぶどう膜炎外来" },
  { code: "266", display: "角膜・眼アレルギー外来" },
  { code: "267", display: "網膜疾患外来" },
  { code: "26A", display: "角膜移植部" },
  // 27 耳鼻咽喉科
  { code: "271", display: "耳鼻咽喉科・神経耳科" },
  { code: "272", display: "耳鼻咽喉・頭頸部外科" },
  { code: "273", display: "困難気道外来" },
  { code: "274", display: "頭頸部科" },
  // 30 放射線科
  { code: "301", display: "放射線部" },
  { code: "302", display: "放射線診断科" },
  { code: "303", display: "放射線画像診断・ＩＶＲ科" },
  { code: "304", display: "核医学科" },
  { code: "30B", display: "放射線治療科" },
  { code: "30C", display: "Ｘ線科" },
  // 31 麻酔科
  { code: "311", display: "麻酔・疼痛・緩和医療科" },
  { code: "312", display: "麻酔科蘇生科" },
  { code: "313", display: "麻酔・疼痛科" },
  { code: "31A", display: "ペインクリニック科" },
  // 33 心療内科
  { code: "331", display: "心身医学科" },
  { code: "332", display: "心の内科" },
  { code: "333", display: "こどものこころ診療" },
  { code: "334", display: "小児精神科" },
  // 34 アレルギー科
  { code: "34A", display: "環境医学外来（アレルギー科）" },
  { code: "34B", display: "アレルギー内科" },
  { code: "34C", display: "アレルギー・免疫内科" },
  { code: "34D", display: "アレルギー・リウマチ内科" },
  // 35 リウマチ科
  { code: "35A", display: "リウマチ内科" },
  { code: "35B", display: "内分泌・リウマチ科" },
  // 36 リハビリテーション科
  { code: "361", display: "言語療法科" },
  { code: "362", display: "股体不自由リハビリテーション科" },
  { code: "363", display: "内部障害リハビリテーション科" },
  { code: "364", display: "理学療法科" },
  { code: "365", display: "物理療法内科" },
  // 39 救急科
  { code: "391", display: "救命救急センター" },
  { code: "392", display: "内科系救急科" },
  { code: "393", display: "救急外科" },
  { code: "394", display: "外科系救急科" },
  { code: "398", display: "初期診療・救急科" },
  // 41 血液内科
  { code: "41C", display: "血液免疫科" },
  { code: "41D", display: "血液科" },
  // 42 血液腫瘍内科
  { code: "421", display: "無菌治療部" },
  // 43 血液透析科
  { code: "431", display: "血液浄化療法部" },
  { code: "432", display: "透析治療部" },
  // 47 腫瘍診療科
  { code: "471", display: "腫瘍内科" },
  { code: "472", display: "化学療法部" },
  { code: "473", display: "小児腫瘍科" },
  { code: "474", display: "精神腫瘍外来" },
  { code: "475", display: "免疫療法外来" },
  { code: "476", display: "脳腫瘍診療部" },
  // 48 腎臓内科
  { code: "48D", display: "腎不全科" },
  { code: "48E", display: "腎移植科" },
  // 49 睡眠診療部
  { code: "491", display: "睡眠時無呼吸症候群外来" },
  // 51 総合診療科
  { code: "51A", display: "予診科" },
  { code: "51B", display: "初診科" },
  { code: "51G", display: "総合内科" },
  // 52 内視鏡診療部
  { code: "521", display: "光学医療診療部" },
  // 53 内分泌・代謝科
  { code: "53A", display: "内分泌・代謝内科" },
  // 54 膠原病科
  { code: "54A", display: "膠原病内科" },
  { code: "54B", display: "膠原病・アレルギー内科" },
  { code: "54C", display: "膠原病・アレルギー・リウマチ内科" },
  { code: "54D", display: "免疫・膠原病・感染症科" },
  { code: "54E", display: "膠原病・リウマチ内科" },
  { code: "54F", display: "膠原病・感染症内科" },
  { code: "54G", display: "免疫・膠原病内科" },
  // 70 消化器内科
  { code: "70A", display: "消化管内科" },
  // 72 代謝内科
  { code: "72A", display: "骨粗鬆症外来" },
  // 73 糖尿病内科
  { code: "731", display: "糖尿病科" },
  { code: "73B", display: "糖尿病・代謝内科" },
  { code: "73C", display: "糖尿病・内分泌内科" },
  { code: "73D", display: "糖尿病・代謝・内分泌内科" },
  { code: "73F", display: "肝臓・糖尿病・内分泌内科" },
  { code: "73G", display: "糖尿病・栄養内科" },
  // 74 腎臓・内分泌内科
  { code: "74A", display: "腎・高血圧・脳血管科" },
  { code: "74B", display: "腎・高血圧・内分泌科" },
  { code: "74C", display: "腎臓・内分泌代謝内科" },
  // 75 感染症科
  { code: "751", display: "感染症内科" },
  { code: "752", display: "総合感染症科" },
  { code: "753", display: "感染症管理治療部" },
  { code: "754", display: "感染制御部" },
  // 76 漢方科
  { code: "761", display: "漢方内科" },
  { code: "762", display: "和漢診療科" },
  // 77 老年科
  { code: "771", display: "老年病内科" },
  { code: "772", display: "老人科" },
  // 79 血管内治療科
  { code: "79A", display: "脳血管内治療科" },
  // 7A 消化器外科
  { code: "7A1", display: "消化管外科" },
  // 7B 上部消化管外科
  { code: "7B1", display: "食道外科" },
  { code: "7B2", display: "食道・胃腸外科" },
  { code: "7B3", display: "胃・食道外科" },
  { code: "7B4", display: "胃腸外科" },
  { code: "7B5", display: "胃外科" },
  // 7C 下部消化管外科
  { code: "7C1", display: "大腸外科" },
  { code: "7C2", display: "大腸・肛門外科" },
  // 80 肝胆膵外科
  { code: "801", display: "肝胆外科" },
  { code: "802", display: "肝胆膵・移植外科" },
  // 81 移植外科
  { code: "811", display: "移植・再建・内視鏡外科" },
  { code: "812", display: "人工臓器移植外科" },
  { code: "813", display: "移植診療部" },
  { code: "814", display: "骨バンク" },
  // 82 乳腺外科
  { code: "821", display: "乳腺内分泌外科" },
  { code: "822", display: "乳腺・甲状腺外科" },
  { code: "823", display: "乳腺・内分泌外科" },
  { code: "824", display: "ブレストセンター" },
  // 83 緩和ケア科
  { code: "831", display: "緩和ケア相談" },
  { code: "832", display: "緩和医療" },
  { code: "833", display: "地域包括緩和ケア" },
  // 85 遺伝子診療部
  { code: "851", display: "ゲノム診療部" },
  // 86 顎口腔診療科
  { code: "861", display: "顎口腔外科" },
  { code: "862", display: "顎顔面再建科" },
  { code: "863", display: "顎機能科" },
  { code: "864", display: "顎検査科" },
  { code: "865", display: "顎歯科" },
  { code: "866", display: "顔面口腔外科" },
  { code: "867", display: "顔面外科" },
  { code: "86A", display: "口腔診療科" },
  { code: "86D", display: "口腔総合診療科" },
  { code: "86E", display: "口腔画像診断科" },
  { code: "86F", display: "口腔機能回復科" },
  { code: "86G", display: "口腔診断科" },
  { code: "86H", display: "口腔言語科" },
  // 88 予防医学診療部
  { code: "882", display: "保健診療部" },
  { code: "883", display: "メディカルフィットネス" },
  // 8D 手術部
  { code: "8D2", display: "デイ・サージェリー" },
  // 8E 薬剤部
  { code: "8E1", display: "薬剤情報部" },
  { code: "8E2", display: "臨床薬理内科" },
  // 90 歯科
  { code: "901", display: "歯科顎口腔外科" },
  { code: "902", display: "歯科口腔外科" },
  { code: "903", display: "矯正歯科" },
  { code: "904", display: "歯周科" },
  { code: "905", display: "歯内治療科" },
  { code: "906", display: "小児歯科" },
  { code: "907", display: "障害歯科" },
  { code: "908", display: "クラウン補綴科" },
  { code: "909", display: "特殊歯科" },
  { code: "90A", display: "虫歯科" },
  { code: "90B", display: "医学支援歯科" },
  { code: "90C", display: "全身管理歯科" },
  { code: "90D", display: "総合歯科" },
  { code: "90E", display: "保存修復歯科" },
  { code: "90F", display: "予防歯科" },
  { code: "90G", display: "咬合修復科" },
  { code: "90H", display: "審美歯科" },
  { code: "90J", display: "義歯科" },
  { code: "90K", display: "義歯補綴科" },
  { code: "90L", display: "インプラント歯科" },
  { code: "90M", display: "高齢歯科" },
  { code: "90N", display: "小児咬合障害科" },
  { code: "90P", display: "歯科麻酔科" },
  { code: "90R", display: "歯科 X 線科" },
  { code: "90S", display: "健康歯科" },
  { code: "90T", display: "歯科予診" },
  // 98 医事・事務
  { code: "981", display: "病歴部" },
  { code: "982", display: "事務" },
  { code: "983", display: "医療社会福祉部" },
];

const DEPARTMENT_CODES_BY_CODE = new Map(
  [...SSMIX2_DEPARTMENT_CODES, ...SSMIX2_DEPARTMENT_SUB_CODES].map((d) => [d.code, d.display]),
);

export function departmentCodeDisplay(code: string | undefined): string {
  if (!code) return "";
  return DEPARTMENT_CODES_BY_CODE.get(code) ?? "";
}

/** 2 ケタ科ごとにまとめた 3 ケタ科。登録画面の選択肢を親科で束ねるのに使う。 */
export function subCodesOf(parentCode: string): DepartmentCode[] {
  return SSMIX2_DEPARTMENT_SUB_CODES.filter((d) => d.code.startsWith(parentCode));
}
