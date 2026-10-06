// 看護プロファイル(docs/nursing-profile-design.md)。入院時に看護師が聴き取る生活・看護上の状態を、
// 施設設定で並べたテンプレート(区画)ごとに 1 入院 1 件の QuestionnaireResponse で持つ。
// 書き直しは同じ回答の更新で、版の履歴は上流の _history に残る。
import { questionnaireCanonical, questionnaireResponsePlainText } from "./questionnaireResponseHelpers";

/** 施設設定の看護プロファイル。templates はテンプレートの url(版なし)を区画の順に並べたもの。 */
export interface NursingProfileSettings {
  templates: string[];
}

export const EMPTY_NURSING_PROFILE: NursingProfileSettings = { templates: [] };

/** canonical("<url>|<version>")の url の部分。区画はテンプレートの版をまたいで同じ url で引く。 */
export function questionnaireUrlOf(canonical: string | undefined): string {
  return (canonical ?? "").split("|")[0];
}

export interface NursingProfileSection {
  /** 区画のテンプレートの url(施設設定の値)。 */
  url: string;
  /** 新しく書くときに使うテンプレート(有効なもの)。無ければ書けない。 */
  questionnaire: fhir4.Questionnaire | undefined;
  /** この入院でこの区画に書いた回答(版は問わない)。 */
  response: fhir4.QuestionnaireResponse | undefined;
  /** 区画の見出し。テンプレートが見つからなければ url。 */
  title: string;
}

/**
 * 区画ごとに、書くときのテンプレートとこの入院の回答を突き合わせる。
 *
 * テンプレートは有効なもの(`activeQuestionnaires`)から url で選び、同じ url が複数の版で有効なら
 * 先に並んでいるもの(更新の新しい順に引いてある)を使う。回答は url が同じなら版を問わず拾い、
 * 1 区画に複数あれば記入日時の新しいものを採る(1 入院 1 件の前提が崩れていても読めるように)。
 * 回答を書いた版のテンプレートは `includedQuestionnaires`(回答の _include)から見出しに使う。
 */
export function nursingProfileSections(
  settings: NursingProfileSettings,
  activeQuestionnaires: fhir4.Questionnaire[],
  responses: fhir4.QuestionnaireResponse[],
  includedQuestionnaires: fhir4.Questionnaire[] = [],
): NursingProfileSection[] {
  return settings.templates.map((url) => {
    const questionnaire = activeQuestionnaires.find((q) => q.url === url);
    const response = responses
      .filter((r) => questionnaireUrlOf(r.questionnaire) === url)
      .sort((a, b) => (b.authored ?? "").localeCompare(a.authored ?? ""))[0];
    const written = response
      ? includedQuestionnaires.find((q) => questionnaireCanonical(q) === response.questionnaire)
      : undefined;
    const source = questionnaire ?? written;
    return { url, questionnaire, response, title: source?.title ?? source?.name ?? url };
  });
}

/** 看護プロファイルの区画 1 つの要約(看護サマリーの下書きに使う)。 */
export interface NursingProfileDigest {
  title: string;
  text: string;
}

/**
 * 区画の順に、回答のある区画の見出しと平文を並べる。平文は回答を書いた版のテンプレートで組み立てる(単位を引くため)。
 * 書いた版が読めない回答と、平文が空の回答は落とす。
 */
export function nursingProfileDigests(
  settings: NursingProfileSettings,
  responses: fhir4.QuestionnaireResponse[],
  includedQuestionnaires: fhir4.Questionnaire[],
): NursingProfileDigest[] {
  return nursingProfileSections(settings, [], responses, includedQuestionnaires).flatMap((section) => {
    const { response } = section;
    const written = response
      ? includedQuestionnaires.find((q) => questionnaireCanonical(q) === response.questionnaire)
      : undefined;
    const text = response && written ? questionnaireResponsePlainText(written, response) : "";
    return text ? [{ title: section.title, text }] : [];
  });
}
