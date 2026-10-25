import { useMemo, useState } from "react";
import { excludeNursingProblems } from "../../fhir/conditionHelpers";
import { useQueries, useQuery } from "@tanstack/react-query";
import { RESULT_ITEM_SYSTEM } from "../../fhir/labResultHelpers";
import { populateLabRow } from "../../fhir/populateLab";
import type { PatientCaution } from "../masterClient";
import { usePatientCautions } from "../masterQueries";
import { HAS_LAB_MAPPED_TYPES, summarizeInfections } from "../../fhir/infectionHelpers";
import type { PopulateSources } from "../../fhir/populateContext";
import { ORDER_TYPE_SYSTEM } from "../../fhir/orderHeader";
import { PRESCRIPTION_ORDER_TYPE } from "../../fhir/prescriptionHelpers";
import { REGIMEN_ORDER_TYPE } from "../../fhir/regimenOrderHelpers";
import { RADIOTHERAPY_ORDER_TYPE } from "../../fhir/radiotherapyOrderHelpers";
import { SURGERY_ORDER_TYPE } from "../../fhir/surgeryOrderHelpers";
import type { CancerPopulateSources } from "../../fhir/cancerRegistryHelpers";
import { pathoDiagnosisResponseIdOf } from "../../fhir/pathoResultHelpers";
import { ADMISSION_CLASS_CODE } from "../../fhir/encounterHelpers";
import type { NcdPopulateSources } from "../../fhir/ncdHelpers";
import { isSurgeryProcedure } from "../../fhir/surgeryResultHelpers";
import { today as todayString } from "../../lib/dates";
import { useAuthSession } from "../authQueries";
import { searchResource } from "../fhirClient";
import { useActiveAllergies } from "./dischargeSummary";
import { useActiveMedications, usePatientAdmission } from "./encounter";
import { useKarteConditions } from "./micro";
import { useSelfOrganization } from "./organization";
import {
  useActiveFlags,
  useBloodType,
  useBodyMeasures,
  useLabInfectionResults,
  useManualInfections,
} from "./patientProfile";
import { usePractitioner, usePractitionerRoles } from "./practitioner";
import { resourcesOfType } from "./core";

/** 項目ごとの最新値を拾うのに読むバイタルの件数(新しい順)。測定 10 回ぶん程度。 */
const VITAL_COUNT = 50;

/** がん登録の変数(docs/cancer-registry-design.md §3)の元データを読むときの指定。 */
export interface PopulateCancerOptions {
  /** 記入しているテンプレートの canonical(版付きと版なし)。同じテンプレートの登録件数(腫瘍番号)に使う。 */
  canonicals: string[];
}

/** NCD の変数(docs/ncd-registration-design.md §3)の元データを読むときの指定。 */
export interface PopulateNcdOptions {
  /** 対象の手術(ハブ Procedure)の id。無ければ患者の最新の手術。 */
  focusProcedureId?: string;
}

/**
 * テンプレート回答フォームの初期値式(populateContext.ts の %変数)の元データ取得。
 *
 * 傷病名はアクティブなもの全件(上流の _count 上限 500 まで)、検査結果・処方は最新 1 件を
 * _sort + _count + _include/_revinclude の 1 リクエストで関連リソースごと取る
 * (この組み合わせは上流の回帰 spec で保証済み)。アレルギー・注意・血液型・感染症・
 * 身長体重・入院は患者帯やプロファイルと同じ取得を使い回す(キャッシュも共有される)。
 * 自院は施設設定、作成者はログイン中の医療従事者から取る(administrator ログインのように
 * 紐付く医療従事者が無ければ作成者は null)。
 * 検査項目の最新値(%labs)は、テンプレートが式の中で参照している結果項目コード(labCodes)だけを
 * コードごとに最新 1 件ずつ取る(呼び出し側が populateLab.ts の collectLabCodes で集める)。
 *
 * がん登録の変数(病理レポート・手術・レジメン・放射線治療・最終来院・同じテンプレートの登録)は、
 * テンプレートの式がそれらを参照しているとき(cancer を渡したとき)だけ読む。
 *
 * 初期回答はフォームのマウント時に一度だけ確定するので、呼び出し側は isLoading が
 * 落ちてから buildPopulateContext に渡す。
 */
export function usePopulateSources(
  patientId: string | undefined,
  options: {
    labCodes?: string[];
    /** 記入を始めたときの対象プロブレム(一覧から渡した病名)。がん登録・発生届の変数が対象を決めるのに使う。 */
    focusConditionId?: string;
    cancer?: PopulateCancerOptions;
    ncd?: PopulateNcdOptions;
  } = {},
) {
  const labCodes = options.labCodes ?? [];
  const cancer = options.cancer;
  const ncd = options.ncd;
  // 記入を始めた日で固定する(日付をまたいで開きっぱなしでも値がぶれないように)。
  const [today] = useState(todayString);

  const conditionParams = new URLSearchParams();
  if (patientId) conditionParams.set("patient", `Patient/${patientId}`);
  conditionParams.set("clinical-status", "active");
  conditionParams.set("_count", "500");
  conditionParams.set("_sort", "-onset-date");
  excludeNursingProblems(conditionParams);
  const conditions = useQuery({
    queryKey: ["Condition", "populate", patientId],
    queryFn: () => searchResource<fhir4.Condition>("Condition", conditionParams),
    enabled: Boolean(patientId),
  });

  const labParams = new URLSearchParams();
  if (patientId) labParams.set("patient", `Patient/${patientId}`);
  labParams.set("category", "LAB");
  labParams.set("_count", "1");
  labParams.set("_sort", "-date");
  labParams.append("_include", "DiagnosticReport:result");
  labParams.append("_include", "DiagnosticReport:specimen");
  const labDetail = useQuery({
    queryKey: ["DiagnosticReport", "populate", patientId],
    queryFn: () => searchResource<fhir4.Resource>("DiagnosticReport", labParams),
    enabled: Boolean(patientId),
  });

  const rxParams = new URLSearchParams();
  if (patientId) rxParams.set("patient", `Patient/${patientId}`);
  rxParams.set("category", `${ORDER_TYPE_SYSTEM}|${PRESCRIPTION_ORDER_TYPE.code}`);
  rxParams.set("_count", "1");
  rxParams.set("_sort", "-authoredon");
  rxParams.set("_revinclude", "MedicationRequest:based-on");
  const rxDetail = useQuery({
    queryKey: ["ServiceRequest", "populate", patientId],
    queryFn: () => searchResource<fhir4.Resource>("ServiceRequest", rxParams),
    enabled: Boolean(patientId),
  });

  // 経過表と同じく、他の記録から派生したもの(derived-from あり)は数えない。
  const vitalParams = new URLSearchParams();
  if (patientId) vitalParams.set("patient", `Patient/${patientId}`);
  vitalParams.set("category", "vital-signs");
  vitalParams.set("derived-from:missing", "true");
  vitalParams.set("_count", String(VITAL_COUNT));
  vitalParams.set("_sort", "-date");
  const vitals = useQuery({
    queryKey: ["Observation", "search", "populate-vital", patientId],
    queryFn: () => searchResource<fhir4.Observation>("Observation", vitalParams),
    enabled: Boolean(patientId),
  });

  // 結果項目ごとの最新 1 件。上流の code 検索は完全一致なので施設コードの coding で引く。
  const labQueries = useQueries({
    queries: labCodes.map((code) => {
      const params = new URLSearchParams();
      params.set("patient", `Patient/${patientId}`);
      params.set("code", `${RESULT_ITEM_SYSTEM}|${code}`);
      params.set("status:not", "entered-in-error,cancelled");
      params.set("_sort", "-date");
      params.set("_count", "1");
      return {
        queryKey: ["Observation", "search", "populate-lab", patientId, code],
        queryFn: async () => {
          const result = await searchResource<fhir4.Observation>("Observation", params);
          return resourcesOfType<fhir4.Observation>(result.data, "Observation")[0] ?? null;
        },
        enabled: Boolean(patientId),
      };
    }),
  });
  // useQueries の結果配列は毎回作り直されるので、更新時刻の並びが変わったときだけ組み直す。
  const labUpdatedKey = labQueries.map((q) => q.dataUpdatedAt).join(",");
  const labs = useMemo(
    () =>
      labQueries
        .map((q) => q.data)
        .filter((obs): obs is fhir4.Observation => Boolean(obs))
        .map(populateLabRow),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [labUpdatedKey],
  );

  // ---- がん登録(式が参照するときだけ) ----
  const cancerEnabled = Boolean(patientId && cancer);
  const pathoParams = new URLSearchParams();
  pathoParams.set("patient", `Patient/${patientId}`);
  pathoParams.set("category", "SP,CP");
  pathoParams.set("status", "final,amended");
  pathoParams.set("_count", "1");
  pathoParams.set("_sort", "-date");
  pathoParams.append("_include", "DiagnosticReport:result");
  const pathoDetail = useQuery({
    queryKey: ["DiagnosticReport", "populate-patho", patientId],
    queryFn: () => searchResource<fhir4.Resource>("DiagnosticReport", pathoParams),
    enabled: cancerEnabled,
  });

  // 最新の病理レポートの診断がテンプレート(シノプティックレポート)なら、その回答とテンプレートを読む
  // (病期・組織型の初期値。レポートの拡張が指すので _include では辿れない)。
  const pathoReport = resourcesOfType<fhir4.DiagnosticReport>(pathoDetail.data?.data, "DiagnosticReport")[0];
  const synopticResponseId = pathoReport ? pathoDiagnosisResponseIdOf(pathoReport) : "";
  const synopticParams = new URLSearchParams();
  synopticParams.set("_id", synopticResponseId);
  synopticParams.set("_include", "QuestionnaireResponse:questionnaire");
  const pathoSynoptic = useQuery({
    queryKey: ["QuestionnaireResponse", synopticResponseId, "withQuestionnaire"],
    queryFn: () => searchResource<fhir4.Resource>("QuestionnaireResponse", synopticParams),
    enabled: cancerEnabled && Boolean(synopticResponseId),
  });

  const surgeryParams = new URLSearchParams();
  surgeryParams.set("patient", `Patient/${patientId}`);
  surgeryParams.set("category", `${ORDER_TYPE_SYSTEM}|${SURGERY_ORDER_TYPE.code}`);
  surgeryParams.set("part-of:missing", "true");
  surgeryParams.set("status", "completed");
  surgeryParams.set("_sort", "date");
  surgeryParams.set("_count", "100");
  const surgeries = useQuery({
    queryKey: ["Procedure", "search", "populate-surgery", patientId],
    queryFn: () => searchResource<fhir4.Procedure>("Procedure", surgeryParams),
    enabled: cancerEnabled,
  });

  const regimenParams = new URLSearchParams();
  regimenParams.set("subject", `Patient/${patientId}`);
  regimenParams.set("category", `${ORDER_TYPE_SYSTEM}|${REGIMEN_ORDER_TYPE.code}`);
  regimenParams.set("_sort", "occurrence");
  regimenParams.set("_count", "100");
  const regimens = useQuery({
    queryKey: ["ServiceRequest", "populate-regimen", patientId],
    queryFn: () => searchResource<fhir4.ServiceRequest>("ServiceRequest", regimenParams),
    enabled: cancerEnabled,
  });

  const radiotherapyParams = new URLSearchParams();
  radiotherapyParams.set("subject", `Patient/${patientId}`);
  radiotherapyParams.set("category", `${ORDER_TYPE_SYSTEM}|${RADIOTHERAPY_ORDER_TYPE.code}`);
  radiotherapyParams.set("status", "active,on-hold,completed");
  radiotherapyParams.set("_revinclude", "Procedure:based-on");
  radiotherapyParams.set("_count", "50");
  const radiotherapy = useQuery({
    queryKey: ["ServiceRequest", "populate-radiotherapy", patientId],
    queryFn: () => searchResource<fhir4.Resource>("ServiceRequest", radiotherapyParams),
    enabled: cancerEnabled,
  });

  const encounterParams = new URLSearchParams();
  encounterParams.set("patient", `Patient/${patientId}`);
  encounterParams.set("status", "in-progress,finished");
  encounterParams.set("_sort", "-date");
  encounterParams.set("_count", "1");
  const lastEncounter = useQuery({
    queryKey: ["Encounter", "populate-last", patientId],
    queryFn: () => searchResource<fhir4.Encounter>("Encounter", encounterParams),
    enabled: cancerEnabled,
  });

  const canonicals = cancer?.canonicals ?? [];
  const registrationParams = new URLSearchParams();
  registrationParams.set("patient", `Patient/${patientId}`);
  registrationParams.set("questionnaire", canonicals.join(","));
  registrationParams.set("_elements", "id,status");
  registrationParams.set("_count", "100");
  const registrations = useQuery({
    queryKey: ["QuestionnaireResponse", "search", "populate-registrations", patientId, canonicals.join(",")],
    queryFn: () => searchResource<fhir4.QuestionnaireResponse>("QuestionnaireResponse", registrationParams),
    enabled: cancerEnabled && canonicals.length > 0,
  });
  const cancerQueries = [pathoDetail, pathoSynoptic, surgeries, regimens, radiotherapy, lastEncounter, registrations];

  // ---- NCD(式が参照するときだけ) ----
  // 対象の手術のハブと、その子(術式・麻酔)・測定値・申込を 1 検索で揃える。id が無ければ患者の最新の手術。
  const ncdEnabled = Boolean(patientId && ncd);
  const ncdSurgeryParams = new URLSearchParams();
  if (ncd?.focusProcedureId) {
    ncdSurgeryParams.set("_id", ncd.focusProcedureId);
  } else {
    ncdSurgeryParams.set("patient", `Patient/${patientId}`);
    ncdSurgeryParams.set("category", `${ORDER_TYPE_SYSTEM}|${SURGERY_ORDER_TYPE.code}`);
    ncdSurgeryParams.set("part-of:missing", "true");
    ncdSurgeryParams.set("status:not", "entered-in-error");
    ncdSurgeryParams.set("_sort", "-date");
    ncdSurgeryParams.set("_count", "1");
  }
  ncdSurgeryParams.append("_include", "Procedure:based-on");
  ncdSurgeryParams.append("_revinclude", "Procedure:part-of");
  ncdSurgeryParams.append("_revinclude", "Observation:part-of");
  const ncdSurgery = useQuery({
    queryKey: ["Procedure", "search", "populate-ncd", patientId, ncd?.focusProcedureId ?? ""],
    queryFn: () => searchResource<fhir4.Resource>("Procedure", ncdSurgeryParams),
    enabled: ncdEnabled,
  });
  const ncdAdmissionParams = new URLSearchParams();
  ncdAdmissionParams.set("patient", `Patient/${patientId}`);
  ncdAdmissionParams.set("class", ADMISSION_CLASS_CODE);
  ncdAdmissionParams.set("status", "in-progress,finished");
  ncdAdmissionParams.set("_sort", "-date");
  ncdAdmissionParams.set("_count", "20");
  const ncdAdmissions = useQuery({
    queryKey: ["Encounter", "populate-ncd-admissions", patientId],
    queryFn: () => searchResource<fhir4.Encounter>("Encounter", ncdAdmissionParams),
    enabled: ncdEnabled,
  });
  const ncdQueries = [ncdSurgery, ncdAdmissions];

  const allConditions = useKarteConditions(patientId);
  const allergies = useActiveAllergies(patientId);
  const flags = useActiveFlags(patientId);
  const cautions = usePatientCautions();
  const bloodType = useBloodType(patientId);
  const bodyMeasures = useBodyMeasures(patientId);
  const manualInfections = useManualInfections(patientId);
  const labInfections = useLabInfectionResults(patientId, HAS_LAB_MAPPED_TYPES);
  const admission = usePatientAdmission(patientId);
  const activeMedications = useActiveMedications(patientId, today);

  const facility = useSelfOrganization();
  const session = useAuthSession();
  const practitionerId = session.data?.user?.practitioner_id ?? undefined;
  const practitioner = usePractitioner(practitionerId);
  const practitionerRoles = usePractitionerRoles(practitionerId);

  const queries = [
    conditions,
    labDetail,
    rxDetail,
    vitals,
    allConditions,
    allergies,
    flags,
    cautions,
    bloodType,
    bodyMeasures,
    manualInfections,
    labInfections,
    admission,
    activeMedications,
    session,
    practitioner,
    practitionerRoles,
  ];
  // isPending だと無効化したクエリ(感染症の検査由来など)で落ちないので isLoading で見る。
  const isLoading =
    queries.some((q) => q.isLoading) ||
    facility.isLoading ||
    labQueries.some((q) => q.isLoading) ||
    cancerQueries.some((q) => q.isLoading) ||
    ncdQueries.some((q) => q.isLoading);

  const author = practitioner.data?.data;
  const authorRoles = practitionerRoles.data?.data;

  const sources = useMemo((): Omit<PopulateSources, "patient"> => {
    const cautionsByCode = new Map<string, PatientCaution>(
      (cautions.data?.items ?? []).map((c) => [c.code, c]),
    );
    return {
      today,
      focusConditionId: options.focusConditionId,
      conditions: resourcesOfType<fhir4.Condition>(conditions.data?.data, "Condition"),
      allConditions: resourcesOfType<fhir4.Condition>(allConditions.data?.data, "Condition"),
      labDetail: labDetail.data?.data,
      prescriptionDetail: rxDetail.data?.data,
      labs,
      allergies: resourcesOfType<fhir4.AllergyIntolerance>(allergies.data?.data, "AllergyIntolerance"),
      bloodType: resourcesOfType<fhir4.Observation>(bloodType.data?.data, "Observation"),
      infections: summarizeInfections(
        resourcesOfType<fhir4.Observation>(manualInfections.data?.data, "Observation"),
        resourcesOfType<fhir4.Observation>(labInfections.data?.data, "Observation"),
      ),
      flags: resourcesOfType<fhir4.Flag>(flags.data?.data, "Flag"),
      cautionsByCode,
      bodyMeasures: resourcesOfType<fhir4.Observation>(bodyMeasures.data?.data, "Observation"),
      vitals: resourcesOfType<fhir4.Observation>(vitals.data?.data, "Observation"),
      admission: admission.data ?? null,
      activeMedications: activeMedications.data ?? [],
      facility: facility.organization ?? null,
      author: author
        ? {
            practitioner: author,
            roles: resourcesOfType<fhir4.PractitionerRole>(authorRoles, "PractitionerRole"),
          }
        : null,
      cancer: cancer
        ? ({
            pathoDetail: pathoDetail.data?.data,
            pathoSynoptic: (() => {
              const response = resourcesOfType<fhir4.QuestionnaireResponse>(
                pathoSynoptic.data?.data,
                "QuestionnaireResponse",
              )[0];
              return response
                ? {
                    response,
                    questionnaire: resourcesOfType<fhir4.Questionnaire>(pathoSynoptic.data?.data, "Questionnaire")[0],
                  }
                : undefined;
            })(),
            surgeries: resourcesOfType<fhir4.Procedure>(surgeries.data?.data, "Procedure"),
            regimens: resourcesOfType<fhir4.ServiceRequest>(regimens.data?.data, "ServiceRequest"),
            radiotherapy: (radiotherapy.data?.data.entry ?? [])
              .map((entry) => entry.resource)
              .filter((resource): resource is fhir4.Resource => Boolean(resource)),
            lastEncounter: resourcesOfType<fhir4.Encounter>(lastEncounter.data?.data, "Encounter")[0],
            registrations: resourcesOfType<fhir4.QuestionnaireResponse>(
              registrations.data?.data,
              "QuestionnaireResponse",
            ),
          } satisfies CancerPopulateSources)
        : undefined,
      ncd: ncd ? ncdSourcesOf(ncdSurgery.data?.data, ncdAdmissions.data?.data) : undefined,
    };
  }, [
    today,
    options.focusConditionId,
    conditions.data,
    allConditions.data,
    labDetail.data,
    rxDetail.data,
    labs,
    allergies.data,
    bloodType.data,
    manualInfections.data,
    labInfections.data,
    flags.data,
    cautions.data,
    bodyMeasures.data,
    vitals.data,
    admission.data,
    activeMedications.data,
    facility.organization,
    author,
    authorRoles,
    cancer,
    pathoDetail.data,
    pathoSynoptic.data,
    surgeries.data,
    regimens.data,
    radiotherapy.data,
    lastEncounter.data,
    registrations.data,
    ncd,
    ncdSurgery.data,
    ncdAdmissions.data,
  ]);

  return {
    isLoading,
    error:
      queries.find((q) => q.error)?.error ??
      labQueries.find((q) => q.error)?.error ??
      cancerQueries.find((q) => q.error)?.error ??
      ncdQueries.find((q) => q.error)?.error ??
      null,
    sources,
  };
}

/** 手術の検索結果(ハブ + 子 + 測定値 + 申込)と入院から NCD の元データを組む。ハブは partOf を持たない手術の Procedure。 */
function ncdSourcesOf(surgeryBundle: fhir4.Bundle | undefined, admissionBundle: fhir4.Bundle | undefined): NcdPopulateSources {
  const procedures = resourcesOfType<fhir4.Procedure>(surgeryBundle, "Procedure").filter(
    (procedure) => procedure.status !== "entered-in-error",
  );
  const hub = procedures.find((procedure) => isSurgeryProcedure(procedure) && !procedure.partOf?.length);
  const admissions = resourcesOfType<fhir4.Encounter>(admissionBundle, "Encounter");
  if (!hub) return { admissions };
  const partIds = new Set([hub.id ?? ""]);
  const children = procedures.filter((procedure) =>
    procedure.partOf?.some((reference) => reference.reference === `Procedure/${hub.id}`),
  );
  for (const child of children) if (child.id) partIds.add(child.id);
  const observations = resourcesOfType<fhir4.Observation>(surgeryBundle, "Observation").filter((observation) =>
    observation.partOf?.some((reference) => partIds.has(reference.reference?.split("/").pop() ?? "")),
  );
  const orderId = hub.basedOn?.find((r) => r.reference?.startsWith("ServiceRequest/"))?.reference?.split("/").pop();
  const order = resourcesOfType<fhir4.ServiceRequest>(surgeryBundle, "ServiceRequest").find((sr) => sr.id === orderId);
  return { surgery: { hub, children, observations, order }, admissions };
}
