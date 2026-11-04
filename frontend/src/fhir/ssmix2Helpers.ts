// SS-MIX2 標準化ストレージへの出力(docs/ssmix2-export-design.md)の施設設定。
// 出力の有無・出力先・医療施設 ID・患者 ID の桁数・送信アプリケーション名を持つ。
// エージェント向けの受信トークンは「外部システム連携」の ssmix2_storage で発行する。

export interface Ssmix2Settings {
  /** 中継の書き込みを記録し、エージェントが標準化ストレージへ書き出すか。 */
  enabled: boolean;
  /** 標準化ストレージのルートフォルダ(エージェントが解釈する絶対パス。UNC 可)。 */
  root_path: string;
  /** 医療施設 ID 10 桁(都道府県 2 + 機関区分 1 + 機関コード 6 + チェックデジット 1)。 */
  facility_id: string;
  /** 患者 ID の桁数。足りない分は前ゼロで埋める。 */
  patient_id_digits: number;
  /** MSH-3 送信アプリケーション。 */
  sending_application: string;
}

export const DEFAULT_SSMIX2: Ssmix2Settings = {
  enabled: false,
  root_path: "",
  facility_id: "",
  patient_id_digits: 6,
  sending_application: "fhir-client",
};

export const SSMIX2_FACILITY_ID_PATTERN = /^(\d{10})?$/;

/** 保存できる形か。有効にするときだけ出力先と医療施設 ID を要求する。 */
export function ssmix2SettingsValid(settings: Ssmix2Settings): boolean {
  if (!SSMIX2_FACILITY_ID_PATTERN.test(settings.facility_id)) return false;
  if (!Number.isInteger(settings.patient_id_digits) || settings.patient_id_digits < 1 || settings.patient_id_digits > 15) {
    return false;
  }
  if (!/^[ -~]{1,40}$/.test(settings.sending_application)) return false;
  if (!settings.enabled) return true;
  return settings.root_path.trim().length > 0 && settings.facility_id.length === 10;
}
