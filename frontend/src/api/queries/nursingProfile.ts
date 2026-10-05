import { useQuery } from "@tanstack/react-query";
import { EMPTY_NURSING_PROFILE } from "../../fhir/nursingProfileHelpers";
import { DPC_FORM1_QUESTIONNAIRE } from "../../fhir/dpcForm1Helpers";
import { searchResource } from "../fhirClient";
import { resourcesOfType } from "./core";
import { useFacilitySettings } from "./organization";

// 看護プロファイル(docs/nursing-profile-design.md)。区画は施設設定、回答は入院ごと。

/** 施設設定の看護プロファイル(区画のテンプレートの url)。読めるまでは区画なし。 */
export function useNursingProfileSettings() {
  const settings = useFacilitySettings();
  return {
    settings: settings.data?.nursing_profile ?? EMPTY_NURSING_PROFILE,
    isLoading: settings.isLoading,
    error: settings.error,
  };
}

/**
 * その入院の看護プロファイルの回答と、回答を書いた版のテンプレート。
 *
 * 入院に結び付く回答は DPC 様式1 と看護プロファイルだけなので、入院で引いて様式1 を除けば
 * 区画の回答が揃う(区画の url は版を持たず、上流の questionnaire 検索は版込みの完全一致なので、
 * 区画の url では引かない)。1 入院あたり区画の数(数件)しか無いので 1 ページで足りる。
 * クエリキーは ["QuestionnaireResponse", "search"] 配下に置き、登録・更新の invalidate を効かせる。
 */
export function useNursingProfileResponses(encounterId: string | undefined) {
  return useQuery({
    queryKey: ["QuestionnaireResponse", "search", "nursing-profile", encounterId],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("encounter", `Encounter/${encounterId}`);
      params.set("questionnaire:not", DPC_FORM1_QUESTIONNAIRE);
      params.set("_include", "QuestionnaireResponse:questionnaire");
      params.set("_count", "100");
      const { data: bundle } = await searchResource<fhir4.Resource>("QuestionnaireResponse", params);
      return {
        responses: resourcesOfType<fhir4.QuestionnaireResponse>(bundle, "QuestionnaireResponse"),
        questionnaires: resourcesOfType<fhir4.Questionnaire>(bundle, "Questionnaire"),
      };
    },
    enabled: Boolean(encounterId),
  });
}
