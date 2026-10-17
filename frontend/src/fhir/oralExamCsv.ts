import {
  checkupSymbolCode,
  deriveTf,
  MOUTH_SECTIONS,
  mouthRecordHasContent,
  recordsOfTooth,
  sortTeeth,
  TM_ITEMS,
  TP_ITEMS,
  usesMissingContent,
  type OralExamCodeBook,
  type OralExamSnapshot,
} from "./oralExamHelpers";
import {
  addressLabelOf,
  calculateAge,
  displayKana,
  displayName,
  homePhoneOf,
  mobilePhoneOf,
  patientNumberOf,
} from "./patientHelpers";
import { organizationInstitutionNumber } from "./organizationHelpers";

/**
 * 口腔状態スナップショットの CSV(口腔診査情報標準コード仕様 Ver.1.02 の 6. 記録方式)。
 *
 * レコードの並び: VR・ON・PN・NS・歯の診査情報レコードグループ(歯ごとに TB・TD・TP・TM・TE・TF、
 * 仕様の記録順)・KS・KK・SI・SK・DT。情報の無いレコードは書かない。項目の数はレコードごとに決まっていて
 * (予備を含む)、空の項目もカンマで区切る。ここでは各レコードを項目の配列で作り、Shift_JIS(Windows-31J)への
 * 変換・改行(CRLF)・EOF は backend(`OralExamSnapshotFile`)が行う。
 *
 * 書かないもの: 送信先機関(ON-2〜5)、保険(PN-2〜6)・医療等 ID(PN-8・9)・健診の実施名称(PN-10・11)、
 * 歯科人間ドック検査表(TH)・傷病名部位(HS)・歯科健診等補足項目(HK)・画像情報(IM)。いずれも省略可。
 */

export const OES_VERSION = "JDAOES000102";

/** レコードごとの項目数(レコード識別情報と予備を含む)。 */
const FIELD_COUNTS: Record<string, number> = {
  VR: 7,
  ON: 17,
  PN: 30,
  NS: 9,
  TB: 10,
  TD: 8,
  TP: 38,
  TM: 15,
  TE: 13,
  TF: 33,
  KS: 10,
  KK: 14,
  SI: 13,
  SK: 9,
  DT: 10,
};

/** 歯科(SS-MIX2 統一診療科コード)。仕様は「通常は歯科の 90」としている。 */
const DENTAL_DEPARTMENT = { code: "90", name: "歯科" };
/** 入力機関種別「医療機関」。 */
const INPUT_ORGANIZATION_MEDICAL = "02";

type Fields = Record<number, string | undefined>;

/** レコード 1 行。fields は項目番号(2 始まり)→ 値。 */
function record(id: string, fields: Fields): string[] {
  const count = FIELD_COUNTS[id];
  const row = Array.from({ length: count }, () => "");
  row[0] = id;
  for (const [n, value] of Object.entries(fields)) {
    if (value) row[Number(n) - 1] = value;
  }
  return row;
}

/** Shift_JIS のバイト数の見積もり(半角英数・半角カナは 1、それ以外は 2)。 */
function sjisLength(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  return code < 0x80 || (code >= 0xff61 && code <= 0xff9f) ? 1 : 2;
}

/**
 * 自由記載の項目。区切りのカンマと引用符は使えない(仕様 6.5)ので全角に寄せ、改行は空白にして、
 * 最大バイト数で切る。
 */
function text(value: string | undefined, maxBytes: number): string {
  if (!value) return "";
  const cleaned = value.replace(/,/g, "、").replace(/"/g, "”").replace(/[\r\n\t]+/g, " ").trim();
  let bytes = 0;
  let out = "";
  for (const char of cleaned) {
    bytes += sjisLength(char);
    if (bytes > maxBytes) break;
    out += char;
  }
  return out;
}

/** 年月日(数字 8 桁)。 */
function ymd(date: string | undefined): string {
  return date ? date.slice(0, 10).replace(/-/g, "") : "";
}

function hms(date: Date): string {
  return [date.getHours(), date.getMinutes(), date.getSeconds()].map((n) => String(n).padStart(2, "0")).join("");
}

function localYmd(date: Date): string {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()].map((n, i) => String(n).padStart(i ? 2 : 4, "0")).join("");
}

/** 歯式の項目(歯式コード 6 桁を並べたもの。仕様のモデルケースは区切りなしで続ける)。 */
function toothList(codes: string[] | undefined): string {
  return (codes ?? []).map((code) => `${code}00`).join("");
}

export interface OesContext {
  patient: fhir4.Patient;
  /** 自院(入力機関)。 */
  organization?: fhir4.Organization;
  book: OralExamCodeBook | undefined;
  /** 出力日時。 */
  now: Date;
}

/** 書き出しの前に知らせること(必須項目が自院・患者に無いなど)。出力は止めない。 */
export function oesWarnings(ctx: Omit<OesContext, "book" | "now">): string[] {
  const warnings: string[] = [];
  if (!ctx.organization) warnings.push("自院が設定されていないため、入力機関の項目が空になります。");
  else if (!/^\d{10}$/.test(organizationInstitutionNumber(ctx.organization))) {
    warnings.push("自院の保険医療機関番号(10 桁)が無いため、入力機関コードと都道府県コードが空になります。");
  }
  if (!patientNumberOf(ctx.patient)) warnings.push("患者番号が無いため、医療機関内等 ID が空になります。");
  if (ctx.patient.gender !== "male" && ctx.patient.gender !== "female") {
    warnings.push("性別が男・女以外のため、性別が空になります。");
  }
  if (!ctx.patient.birthDate) warnings.push("生年月日が無いため、生年月日が空になります。");
  return warnings;
}

/** CSV の各レコード(項目の配列)。 */
export function buildOesRecords(snapshot: OralExamSnapshot, ctx: OesContext): string[][] {
  const { patient, organization, book, now } = ctx;
  const rows: string[][] = [];

  rows.push(record("VR", { 2: OES_VERSION }));

  const institution = organization ? organizationInstitutionNumber(organization) : "";
  const validInstitution = /^\d{10}$/.test(institution);
  rows.push(
    record("ON", {
      6: INPUT_ORGANIZATION_MEDICAL,
      7: validInstitution ? institution.slice(0, 2) : "",
      8: text(organization?.name, 80),
      9: validInstitution ? institution : "",
      10: text(organization?.telecom?.find((t) => t.system === "phone")?.value, 15),
      11: DENTAL_DEPARTMENT.code,
      12: DENTAL_DEPARTMENT.name,
    }),
  );

  const age = patient.birthDate ? calculateAge(patient.birthDate, new Date(`${snapshot.examDate}T00:00:00`)) : undefined;
  rows.push(
    record("PN", {
      7: text(patientNumberOf(patient), 20),
      12: ymd(snapshot.examDate),
      13: text(displayName(patient), 80),
      14: text(displayKana(patient), 80),
      15: patient.gender === "male" ? "01" : patient.gender === "female" ? "02" : "",
      16: ymd(patient.birthDate),
      17: age !== undefined ? String(age) : "",
      20: text(patient.address?.[0]?.postalCode, 8),
      21: text(addressLabelOf(patient), 80),
      23: text(homePhoneOf(patient), 15),
      24: text(mobilePhoneOf(patient), 15),
    }),
  );

  rows.push(
    record("NS", {
      2: snapshot.inputType,
      3: ymd(snapshot.firstVisitDate),
      4: ymd(snapshot.lastVisitDate),
    }),
  );

  // 歯の診査情報レコードグループ。仕様の記録順(右上遠心 → 右上近心、左上近心 → 左上遠心、…)。
  const teeth = sortTeeth(snapshot.teeth.filter((t) => t.basic));
  const toothCodes = [...new Set(teeth.map((t) => t.toothCode))];
  for (const toothCode of toothCodes) {
    const groups = recordsOfTooth(teeth, toothCode);
    groups.forEach((tooth, groupIndex) => {
      const groupSeq = groups.length > 1 ? String(groupIndex + 1).padStart(2, "0") : "";
      rows.push(record("TB", { 2: tooth.toothCode, 3: tooth.stateCode || "0", 4: tooth.partCode || "0", 5: groupSeq }));
      rows.push(record("TD", { 2: tooth.basic, 3: checkupSymbolCode(tooth.basic) }));

      if (usesMissingContent(tooth.basic)) {
        const fields: Fields = {};
        TM_ITEMS.forEach((item) => (fields[Number(item.split("-")[1])] = tooth.missing[item]));
        if (Object.values(fields).some(Boolean)) rows.push(record("TM", fields));
      } else {
        const contents = tooth.contents.filter((c) => Object.values(c.values).some(Boolean));
        contents.forEach((content, index) => {
          const fields: Fields = { 2: contents.length > 1 ? String(index + 1).padStart(2, "0") : "" };
          TP_ITEMS.forEach((item) => (fields[Number(item.split("-")[1])] = content.values[item]));
          rows.push(record("TP", fields));
        });
      }

      const remark = text(tooth.remark, 512);
      const te: Fields = {
        2: tooth.productKind,
        3: text(tooth.productName, 64),
        4: text(tooth.productNumber, 20),
        5: remark ? "01" : "",
        6: remark,
        8: ymd(tooth.updatedOn),
      };
      if (Object.values(te).some(Boolean)) rows.push(record("TE", te));

      const tf = deriveTf(tooth, book);
      const tfFields: Fields = { 2: tf.length ? "01" : "00" };
      for (const n of tf) tfFields[n] = "01";
      rows.push(record("TF", tfFields));
    });
  }

  for (const section of MOUTH_SECTIONS) {
    for (const entry of snapshot.mouth.filter((m) => m.record === section.record && mouthRecordHasContent(m))) {
      const { values, texts, teeth: mouthTeeth } = entry;
      if (section.record === "KS") {
        rows.push(
          record("KS", {
            2: values["KS-2"],
            3: text(texts["KS-3"], 512),
            4: toothList(mouthTeeth["KS-4"]),
            5: text(texts["KS-5"], 512),
          }),
        );
      } else if (section.record === "KK") {
        const other = text(texts["KK-8"], 512);
        const otherTeeth = toothList(mouthTeeth["KK-9"]);
        rows.push(
          record("KK", {
            2: "01",
            3: values["KK-3"],
            4: values["KK-4"],
            5: values["KK-5"],
            6: values["KK-6"],
            7: other || otherTeeth ? "01" : "",
            8: other,
            9: otherTeeth,
          }),
        );
      } else if (section.record === "SI") {
        rows.push(
          record("SI", {
            2: "01",
            3: values["SI-3"],
            4: values["SI-4"],
            5: toothList(mouthTeeth["SI-5"]),
            6: values["SI-6"],
            7: text(texts["SI-7"], 512),
            8: toothList(mouthTeeth["SI-8"]),
          }),
        );
      } else if (section.record === "SK") {
        rows.push(record("SK", { 2: "01", 3: text(texts["SK-3"], 512), 4: toothList(mouthTeeth["SK-4"]) }));
      }
    }
  }

  // スナップショットの時刻は持っていない(診査日だけ)ので、仕様どおり不明の 99 で埋める。
  rows.push(record("DT", { 2: localYmd(now), 3: hms(now), 4: ymd(snapshot.examDate), 5: "999999" }));
  return rows;
}

/**
 * ファイル名(仕様 6.3)。医療機関内等 ID(数字 6〜16 桁、6 桁未満は先頭を 0 で埋める)+「-」+ 出力日時(14 桁)
 * +「-」+ スナップショット日時(14 桁、時刻不明は 99)+「.oes」。ID の数字以外は除く。
 */
export function oesFileName(snapshot: OralExamSnapshot, patient: fhir4.Patient, now: Date): string {
  const id = (patientNumberOf(patient) ?? "").replace(/\D/g, "").slice(-16).padStart(6, "0");
  return `${id}-${localYmd(now)}${hms(now)}-${ymd(snapshot.examDate)}999999.oes`;
}
