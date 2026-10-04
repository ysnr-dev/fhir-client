import { useMemo, useState } from "react";
import { excludeNursingProblems } from "../../fhir/conditionHelpers";
import { useQuery } from "@tanstack/react-query";
import type { PatientCaution } from "../masterClient";
import { usePatientCautions } from "../masterQueries";
import { HAS_LAB_MAPPED_TYPES, summarizeInfections } from "../../fhir/infectionHelpers";
import type { PopulateSources } from "../../fhir/populateContext";
import { ORDER_TYPE_SYSTEM } from "../../fhir/orderHeader";
import { PRESCRIPTION_ORDER_TYPE } from "../../fhir/prescriptionHelpers";
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

/**
 * テンプレート回答フォームの初期値式(populateContext.ts の %変数)の元データ取得。
 *
 * 傷病名はアクティブなもの全件(上流の _count 上限 500 まで)、検査結果・処方は最新 1 件を
 * _sort + _count + _include/_revinclude の 1 リクエストで関連リソースごと取る
 * (この組み合わせは上流の回帰 spec で保証済み)。アレルギー・注意・血液型・感染症・
 * 身長体重・入院は患者帯やプロファイルと同じ取得を使い回す(キャッシュも共有される)。
 * 自院は施設設定、作成者はログイン中の医療従事者から取る(administrator ログインのように
 * 紐付く医療従事者が無ければ作成者は null)。
 *
 * 初期回答はフォームのマウント時に一度だけ確定するので、呼び出し側は isLoading が
 * 落ちてから buildPopulateContext に渡す。
 */
export function usePopulateSources(patientId: string | undefined) {
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
  const isLoading = queries.some((q) => q.isLoading) || facility.isLoading;

  const author = practitioner.data?.data;
  const authorRoles = practitionerRoles.data?.data;

  const sources = useMemo((): Omit<PopulateSources, "patient"> => {
    const cautionsByCode = new Map<string, PatientCaution>(
      (cautions.data?.items ?? []).map((c) => [c.code, c]),
    );
    return {
      today,
      conditions: resourcesOfType<fhir4.Condition>(conditions.data?.data, "Condition"),
      allConditions: resourcesOfType<fhir4.Condition>(allConditions.data?.data, "Condition"),
      labDetail: labDetail.data?.data,
      prescriptionDetail: rxDetail.data?.data,
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
    };
  }, [
    today,
    conditions.data,
    allConditions.data,
    labDetail.data,
    rxDetail.data,
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
  ]);

  return {
    isLoading,
    error: queries.find((q) => q.error)?.error ?? null,
    sources,
  };
}
