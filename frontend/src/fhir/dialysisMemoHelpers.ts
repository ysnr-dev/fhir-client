// 透析の患者メモ(docs/dialysis-order-design.md §6.1)。消毒液・止血方法・導入年月日・シャントのシェーマなど、
// 透析室の看護師が穿刺・止血のたびに見返す患者ごとの状態。
//
// テンプレート(同梱の雛形 `docs/report-mappings/dialysis-memo-01.questionnaire.json`)の回答を
// 患者 1 人に 1 件持ち、書き直しは同じ回答の更新にする(版の履歴は上流の _history)。
// 入院に結び付かないので、用途の印(meta.tag)で引き、カルテの時系列から外す。
import { questionnaireCanonical, QR_PURPOSE_SYSTEM } from "./questionnaireResponseHelpers";

/** 透析の患者メモのテンプレートの url。施設は同じ url のまま版を上げて項目や台紙を直す。 */
export const DIALYSIS_MEMO_QUESTIONNAIRE_URL = "http://fhir-client.local/Questionnaire/dialysis-memo-01";

export const DIALYSIS_MEMO_TAG: fhir4.Coding = {
  system: QR_PURPOSE_SYSTEM,
  code: "dialysis-memo",
  display: "透析の患者メモ",
};

export const DIALYSIS_MEMO_TAG_TOKEN = `${QR_PURPOSE_SYSTEM}|${DIALYSIS_MEMO_TAG.code}`;

export interface DialysisMemo {
  response: fhir4.QuestionnaireResponse | undefined;
  /** 回答を書いた版のテンプレート(表示に使う)。 */
  questionnaire: fhir4.Questionnaire | undefined;
}

/** 検索結果(新しい順・_include でテンプレート)から、いちばん新しいメモと、それを書いた版のテンプレート。 */
export function dialysisMemoOf(bundle: fhir4.Bundle): DialysisMemo {
  const resources = (bundle.entry ?? []).flatMap((entry) => (entry.resource ? [entry.resource] : []));
  const response = resources.find((r) => r.resourceType === "QuestionnaireResponse") as
    | fhir4.QuestionnaireResponse
    | undefined;
  const questionnaire = response
    ? (resources.find(
        (r) =>
          r.resourceType === "Questionnaire" &&
          questionnaireCanonical(r as fhir4.Questionnaire) === response.questionnaire,
      ) as fhir4.Questionnaire | undefined)
    : undefined;
  return { response, questionnaire };
}

/** 新しく書くときのテンプレート。有効なものから url で選ぶ(更新の新しい順に並んでいる前提で先頭)。 */
export function dialysisMemoTemplate(activeQuestionnaires: fhir4.Questionnaire[]): fhir4.Questionnaire | undefined {
  return activeQuestionnaires.find((q) => q.url === DIALYSIS_MEMO_QUESTIONNAIRE_URL);
}
