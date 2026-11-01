import type { AboBloodType, RhdBloodType } from "./transfusionOrderHelpers";

// 日本赤十字社の血液製剤ラベルのバーコード(ISBT 128)。
//
// ラベルには 4 つの一次元バーコードがあり、先頭 1〜2 文字のデータ識別子で区別する:
//   =  + 13 桁     献血番号(製剤番号。出庫・実施記録の製剤番号になる)。後ろにフラグ 2 桁
//   =< + 8 桁      製品コード(E0382V00 など。製剤マスタの item_code に手入力してあればそれで引ける)
//   =% + 4 桁      血液型(先頭 2 桁が ABO/RhD)
//   &> + 10 桁     有効期限(c yy jjj hh mm。c は世紀、jjj は年内通算日)
// 読み取り欄は 1 つで、どの構造かはここで振り分ける。

export type Isbt128Field =
  | { kind: "din"; value: string }
  | { kind: "product"; value: string }
  | { kind: "blood-type"; abo: AboBloodType; rhd: RhdBloodType }
  | { kind: "expiry"; date: string; dateTime: string };

/** ISBT 128 の ABO/RhD コード(血液型構造の先頭 2 桁)。 */
const BLOOD_GROUP_CODES: Record<string, { abo: AboBloodType; rhd: RhdBloodType }> = {
  "51": { abo: "O", rhd: "positive" },
  "95": { abo: "O", rhd: "negative" },
  "62": { abo: "A", rhd: "positive" },
  "06": { abo: "A", rhd: "negative" },
  "73": { abo: "B", rhd: "positive" },
  "17": { abo: "B", rhd: "negative" },
  "84": { abo: "AB", rhd: "positive" },
  "28": { abo: "AB", rhd: "negative" },
  // 同じ型で RhD の検査区分が違うコード。
  "55": { abo: "O", rhd: "positive" },
  "66": { abo: "A", rhd: "positive" },
  "77": { abo: "B", rhd: "positive" },
  "88": { abo: "AB", rhd: "positive" },
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** 有効期限の構造(c yy jjj hh mm)を日付に直す。世紀 c は 1 が 2000 年代。 */
function parseExpiry(body: string): Isbt128Field | null {
  const match = /^(\d)(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(body);
  if (!match) return null;
  const year = 1900 + Number(match[1]) * 100 + Number(match[2]);
  const dayOfYear = Number(match[3]);
  if (dayOfYear < 1 || dayOfYear > 366) return null;
  const date = new Date(year, 0, dayOfYear, Number(match[4]), Number(match[5]));
  if (Number.isNaN(date.getTime())) return null;
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return { kind: "expiry", date: day, dateTime: `${day}T${pad(date.getHours())}:${pad(date.getMinutes())}` };
}

/**
 * 読んだ文字列を ISBT 128 の構造に振り分ける。どれでもなければ null
 * (手入力の製剤番号として扱うかは呼び出し側が決める)。
 */
export function parseIsbt128(raw: string): Isbt128Field | null {
  const value = raw.normalize("NFKC").trim().toUpperCase();
  if (value.startsWith("=<")) {
    const code = value.slice(2, 10);
    return /^[A-Z0-9]{8}$/.test(code) ? { kind: "product", value: code } : null;
  }
  if (value.startsWith("=%")) {
    const group = BLOOD_GROUP_CODES[value.slice(2, 4)];
    return group ? { kind: "blood-type", ...group } : null;
  }
  if (value.startsWith("&>")) return parseExpiry(value.slice(2, 12));
  if (value.startsWith("=")) {
    const din = value.slice(1, 14);
    return /^[A-Z0-9]{13}$/.test(din) ? { kind: "din", value: din } : null;
  }
  return null;
}
