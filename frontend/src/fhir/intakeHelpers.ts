// Web 問診(docs/web-intake-design.md)。患者が自分の端末で答えた回答を、職員が確認して
// QuestionnaireResponse に取り込む。

/** 施設設定の Web 問診。questionnaires は既定の質問票(canonical)、by_department は診療科(SS-MIX2 コード)ごと。 */
export interface IntakeSettings {
  questionnaires: string[];
  by_department: Record<string, string[]>;
  expires_hours: number;
}

export const EMPTY_INTAKE_SETTINGS: IntakeSettings = { questionnaires: [], by_department: {}, expires_hours: 24 };

/** 回答の出どころ。患者が Web 問診で答えたものに付ける(valueCode = patient)。 */
export const INTAKE_SOURCE_EXT_URL = "http://fhir-client.local/StructureDefinition/intake-source";

export function intakeSourceExtension(): fhir4.Extension {
  return { url: INTAKE_SOURCE_EXT_URL, valueCode: "patient" };
}
