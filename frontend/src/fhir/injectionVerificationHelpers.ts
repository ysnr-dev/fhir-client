// 注射の3点認証(docs/injection-order-design.md §6.5)。実施入力の前に患者番号(リストバンド・注射ラベル)と
// 注射ラベルの RP バーコードを読み、開いているオーダーと照合する。実施者はログイン中の医療従事者で代替する。
// 照合の結果は実施記録のハブ(Procedure)の拡張に残す。

export const INJECTION_VERIFICATION_EXT_URL =
  "http://fhir-client.local/StructureDefinition/injection-verification";
export const INJECTION_VERIFICATION_SKIP_REASON_SYSTEM =
  "http://fhir-client.local/CodeSystem/injection-verification-skip-reason";

/** 施設設定 injection_verification。 */
export interface InjectionVerificationSettings {
  /** 注射の実施入力の前に照合を出す。 */
  enabled: boolean;
}

export const DEFAULT_INJECTION_VERIFICATION: InjectionVerificationSettings = { enabled: false };

export const SKIP_REASON_OPTIONS: { code: string; display: string }[] = [
  { code: "emergency", display: "緊急・急変" },
  { code: "no-wristband", display: "リストバンド未装着・読取不可" },
  { code: "no-label", display: "ラベル未発行・読取不可" },
  { code: "scanner-unavailable", display: "リーダー不調" },
  { code: "no-practitioner", display: "ログインに医療従事者が無い" },
  { code: "other", display: "その他" },
];

export function skipReasonDisplay(code: string): string {
  return SKIP_REASON_OPTIONS.find((o) => o.code === code)?.display ?? code;
}

// ---- RP バーコード ----

/** RP バーコードに入れるオーダー id の桁数(backend の Reports::InjectionMeta::ORDER_KEY_LENGTH と同じ)。 */
const ORDER_KEY_LENGTH = 12;

/** オーダー id(UUID)を縮めた照合用のキー。60mm のラベルに収めるため先頭だけを使う。 */
export function injectionOrderKey(orderId: string): string {
  return orderId.replaceAll("-", "").toUpperCase().slice(0, ORDER_KEY_LENGTH);
}

/** 「INJ-3F2A9C01B7D4-2」。キーボードウェッジで化けない英大文字・数字・ハイフンだけで組む。 */
export function injectionRpBarcode(orderId: string, rpNumber: number): string {
  return `INJ-${injectionOrderKey(orderId)}-${rpNumber}`;
}

export type ScannedCode =
  | { kind: "injection-rp"; orderKey: string; rpNumber: number }
  | { kind: "patient"; number: string };

/** 読んだ文字列を RP バーコードか患者番号に振り分ける。RP の形でなければ患者番号として扱う。 */
export function parseScannedCode(raw: string): ScannedCode | null {
  const value = raw.normalize("NFKC").trim().toUpperCase();
  if (!value) return null;
  const match = /^INJ-([0-9A-F]+)-(\d+)$/.exec(value);
  if (match) return { kind: "injection-rp", orderKey: match[1], rpNumber: Number(match[2]) };
  return { kind: "patient", number: value };
}

/**
 * 患者番号として受け付ける値。帳票は identifier の先頭(無ければ id)を刷るので、
 * system を問わず identifier の値すべてと id を照合の対象にする。
 */
function patientCodesOf(patient: fhir4.Patient): Set<string> {
  const codes = (patient.identifier ?? []).map((i) => i.value ?? "").filter(Boolean);
  if (patient.id) codes.push(patient.id);
  return new Set(codes.map((code) => code.normalize("NFKC").trim().toUpperCase()));
}

// ---- 照合ステップの状態 ----

export interface InjectionScanState {
  patient: "none" | "matched" | "mismatch";
  /** 最後に読んだ患者番号(不一致のときに見せる)。 */
  scannedPatient: string;
  /** 一致した RP 番号。 */
  rpNumbers: number[];
  /** 直近の読み取りの結果。 */
  message: { text: string; error: boolean } | null;
}

export const EMPTY_SCAN_STATE: InjectionScanState = {
  patient: "none",
  scannedPatient: "",
  rpNumbers: [],
  message: null,
};

/** 1 回の読み取りを照合して次の状態を返す。別オーダー・無い RP は状態を変えずにメッセージだけ出す。 */
export function applyScan(
  state: InjectionScanState,
  raw: string,
  context: { orderId: string; patient: fhir4.Patient | undefined; rpNumbers: number[] },
): InjectionScanState {
  const code = parseScannedCode(raw);
  if (!code) return state;
  if (code.kind === "injection-rp") {
    if (code.orderKey !== injectionOrderKey(context.orderId)) {
      return { ...state, message: { text: "別のオーダーのラベルです。", error: true } };
    }
    if (!context.rpNumbers.includes(code.rpNumber)) {
      return { ...state, message: { text: `このオーダーに RP${code.rpNumber} はありません。`, error: true } };
    }
    const rpNumbers = state.rpNumbers.includes(code.rpNumber)
      ? state.rpNumbers
      : [...state.rpNumbers, code.rpNumber].sort((a, b) => a - b);
    return { ...state, rpNumbers, message: { text: `RP${code.rpNumber} 一致`, error: false } };
  }
  if (!context.patient) return state;
  if (patientCodesOf(context.patient).has(code.number)) {
    return { ...state, patient: "matched", scannedPatient: code.number, message: { text: "患者 一致", error: false } };
  }
  return {
    ...state,
    patient: "mismatch",
    scannedPatient: code.number,
    message: { text: `患者番号 ${code.number} はこの患者ではありません。`, error: true },
  };
}

// ---- 記録 ----

/** 照合の結果。実施入力フォームが持ち、ハブの Procedure の拡張に書く。 */
export interface InjectionVerificationValues {
  status: "verified" | "skipped";
  patientMatched: boolean;
  /** 実施者がログイン中の医療従事者か(医療従事者の紐づかないログインでは false)。 */
  performerFromLogin: boolean;
  /** 一致した RP 番号。 */
  rpNumbers: number[];
  /** スキップの理由(SKIP_REASON_OPTIONS の code)。 */
  reasonCode?: string;
  reasonText?: string;
  /** 照合を終えた・スキップした日時(オフセット付き)。 */
  at: string;
}

/** 照合の拡張を付けたハブの写しを返す。拡張以外は触らない。 */
export function withInjectionVerification(
  procedure: fhir4.Procedure,
  values: InjectionVerificationValues,
): fhir4.Procedure {
  const parts: fhir4.Extension[] = [
    { url: "status", valueCode: values.status },
    { url: "patient", valueCode: values.patientMatched ? "matched" : "not-scanned" },
    { url: "performer", valueCode: values.performerFromLogin ? "login" : "missing" },
    ...values.rpNumbers.map((rp) => ({ url: "rp", valueString: String(rp) })),
  ];
  if (values.status === "skipped" && values.reasonCode) {
    const text = values.reasonText?.trim();
    parts.push({
      url: "reason",
      valueCodeableConcept: {
        coding: [
          {
            system: INJECTION_VERIFICATION_SKIP_REASON_SYSTEM,
            code: values.reasonCode,
            display: skipReasonDisplay(values.reasonCode),
          },
        ],
        ...(text ? { text } : {}),
      },
    });
  }
  parts.push({ url: "at", valueDateTime: values.at });
  const others = (procedure.extension ?? []).filter((e) => e.url !== INJECTION_VERIFICATION_EXT_URL);
  return { ...procedure, extension: [...others, { url: INJECTION_VERIFICATION_EXT_URL, extension: parts }] };
}

export interface InjectionVerificationRecord {
  status: "verified" | "skipped";
  reason: string;
}

export function injectionVerificationOf(procedure: fhir4.Procedure): InjectionVerificationRecord | null {
  const ext = procedure.extension?.find((e) => e.url === INJECTION_VERIFICATION_EXT_URL);
  if (!ext) return null;
  const part = (url: string) => ext.extension?.find((e) => e.url === url);
  const status = part("status")?.valueCode === "skipped" ? "skipped" : "verified";
  const reason = part("reason")?.valueCodeableConcept;
  const reasonLabel = [reason?.coding?.[0]?.display, reason?.text].filter(Boolean).join(" ");
  return { status, reason: reasonLabel };
}

/** 「照合済」/「照合スキップ(緊急・急変)」。照合を出さなかった記録は空。 */
export function injectionVerificationLabel(record: InjectionVerificationRecord | null): string {
  if (!record) return "";
  if (record.status === "verified") return "照合済";
  return record.reason ? `照合スキップ(${record.reason})` : "照合スキップ";
}
