// SS-MIX2 標準化ストレージ仕様書 コード表 Ver.1.2i
// 「表 53 使用者定義表-#0069 診療部門」の 2 ケタ科(SS-MIX2 統一診療科コード表 V1.0)。
// 3 ケタ科は施設ごとの細分なので、初期投入では扱わない。
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

export function departmentCodeDisplay(code: string | undefined): string {
  if (!code) return "";
  return SSMIX2_DEPARTMENT_CODES.find((d) => d.code === code)?.display ?? "";
}
