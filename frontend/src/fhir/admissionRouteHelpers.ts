// 入院の経緯(入院経路・予定/救急の区分・紹介の有無など)。DPC 様式1 の入院情報
// (A000020)の元になるので、値は様式1 のコードのまま Encounter に持つ。
//
//   hospitalization.admitSource : 入院経路(1 家庭 / 4 他院から転院 / 5 介護施設 / 8 院内出生 / 9 その他)
//   priority                    : 予定・救急医療入院(100 / 101 / 200 / 3**)
//   extension                   : 他院よりの紹介・自院の外来からの入院・救急車による搬送(boolean)、
//                                 入院前の在宅医療(0 / 1 / 2 / 9)
//
// admitSource には救急外来からの入院を表す HL7 のコード(emd)も入るので、coding は
// system ごとに差し替える。

import { ADMISSION_ROUTE_OPTIONS, ADMISSION_TYPE_OPTIONS } from "./dpcForm1/records/common";

export const DPC_ADMISSION_ROUTE_SYSTEM = "http://fhir-client.local/CodeSystem/dpc-admission-route";
export const DPC_ADMISSION_TYPE_SYSTEM = "http://fhir-client.local/CodeSystem/dpc-admission-type";

const REFERRAL_EXTENSION_URL = "http://fhir-client.local/StructureDefinition/encounter-referral";
const FROM_OUTPATIENT_EXTENSION_URL =
  "http://fhir-client.local/StructureDefinition/encounter-from-outpatient";
const AMBULANCE_EXTENSION_URL = "http://fhir-client.local/StructureDefinition/encounter-ambulance";
const PRIOR_HOME_CARE_EXTENSION_URL =
  "http://fhir-client.local/StructureDefinition/encounter-prior-home-care";

/** 紹介・外来・救急車・在宅医療を入力する入院経路(家庭・他院・介護施設から)。 */
const DETAIL_ROUTES = ["1", "4", "5"];

export function admissionRouteHasDetails(route: string): boolean {
  return DETAIL_ROUTES.includes(route);
}

export interface AdmissionRouteValues {
  /** 入院経路。未指定は ""。 */
  route: string;
  /** 予定・救急医療入院。未指定は ""。 */
  admissionType: string;
  /** 他院よりの紹介。 */
  referral: boolean;
  /** 自院の外来からの入院。 */
  fromOutpatient: boolean;
  /** 救急車による搬送。 */
  ambulance: boolean;
  /** 入院前の在宅医療。未指定は ""。 */
  priorHomeCare: string;
}

export function emptyAdmissionRoute(): AdmissionRouteValues {
  return {
    route: "",
    admissionType: "",
    referral: false,
    fromOutpatient: false,
    ambulance: false,
    priorHomeCare: "",
  };
}

function booleanExtension(encounter: fhir4.Encounter, url: string): boolean | undefined {
  return encounter.extension?.find((e) => e.url === url)?.valueBoolean;
}

function routeCode(encounter: fhir4.Encounter): string {
  return (
    encounter.hospitalization?.admitSource?.coding?.find(
      (c) => c.system === DPC_ADMISSION_ROUTE_SYSTEM,
    )?.code ?? ""
  );
}

function admissionTypeCode(encounter: fhir4.Encounter): string {
  return encounter.priority?.coding?.find((c) => c.system === DPC_ADMISSION_TYPE_SYSTEM)?.code ?? "";
}

/** Encounter から入院登録フォームの値へ。 */
export function encounterAdmissionRoute(encounter: fhir4.Encounter): AdmissionRouteValues {
  return {
    route: routeCode(encounter),
    admissionType: admissionTypeCode(encounter),
    referral: booleanExtension(encounter, REFERRAL_EXTENSION_URL) ?? false,
    fromOutpatient: booleanExtension(encounter, FROM_OUTPATIENT_EXTENSION_URL) ?? false,
    ambulance: booleanExtension(encounter, AMBULANCE_EXTENSION_URL) ?? false,
    priorHomeCare:
      encounter.extension?.find((e) => e.url === PRIOR_HOME_CARE_EXTENSION_URL)?.valueCode ?? "",
  };
}

/**
 * 様式1 の入院情報(A000020)のペイロード 2〜7 に入れる値。入力されていない項目は ""。
 * 有無の項目は、入院登録で入力されている(拡張がある)ときだけ 0 / 1 を返す。
 */
export function admissionRoutePayloads(encounter: fhir4.Encounter): {
  route: string;
  referral: string;
  fromOutpatient: string;
  admissionType: string;
  ambulance: string;
  priorHomeCare: string;
} {
  const flag = (url: string) => {
    const value = booleanExtension(encounter, url);
    return value === undefined ? "" : value ? "1" : "0";
  };
  const values = encounterAdmissionRoute(encounter);
  return {
    route: values.route,
    referral: flag(REFERRAL_EXTENSION_URL),
    fromOutpatient: flag(FROM_OUTPATIENT_EXTENSION_URL),
    admissionType: values.admissionType,
    ambulance: flag(AMBULANCE_EXTENSION_URL),
    priorHomeCare: values.priorHomeCare,
  };
}

const ROUTE_EXTENSION_URLS = [
  REFERRAL_EXTENSION_URL,
  FROM_OUTPATIENT_EXTENSION_URL,
  AMBULANCE_EXTENSION_URL,
  PRIOR_HOME_CARE_EXTENSION_URL,
];

/**
 * 入院の経緯を書き込んだ Encounter。未指定の項目は要素ごと外す。紹介の有無などは
 * 入院経路が家庭・他院・介護施設のときだけ意味を持つので、それ以外では保存しない。
 * display には画面の表示名を渡す(コード表は様式1 の定義表が持つ)。
 */
export function withAdmissionRoute(
  encounter: fhir4.Encounter,
  values: AdmissionRouteValues,
  display: { route?: string; admissionType?: string } = {},
): fhir4.Encounter {
  const next: fhir4.Encounter = { ...encounter };

  const hospitalization = { ...(encounter.hospitalization ?? {}) };
  const otherSources = (hospitalization.admitSource?.coding ?? []).filter(
    (c) => c.system !== DPC_ADMISSION_ROUTE_SYSTEM,
  );
  const sources = values.route
    ? [
        ...otherSources,
        { system: DPC_ADMISSION_ROUTE_SYSTEM, code: values.route, display: display.route },
      ]
    : otherSources;
  if (sources.length) hospitalization.admitSource = { coding: sources };
  else delete hospitalization.admitSource;
  if (Object.keys(hospitalization).length) next.hospitalization = hospitalization;
  else delete next.hospitalization;

  if (values.admissionType) {
    next.priority = {
      coding: [
        {
          system: DPC_ADMISSION_TYPE_SYSTEM,
          code: values.admissionType,
          display: display.admissionType,
        },
      ],
    };
  } else {
    delete next.priority;
  }

  const extension = (encounter.extension ?? []).filter((e) => !ROUTE_EXTENSION_URLS.includes(e.url));
  if (admissionRouteHasDetails(values.route)) {
    extension.push(
      { url: REFERRAL_EXTENSION_URL, valueBoolean: values.referral },
      { url: FROM_OUTPATIENT_EXTENSION_URL, valueBoolean: values.fromOutpatient },
      { url: AMBULANCE_EXTENSION_URL, valueBoolean: values.ambulance },
    );
    if (values.priorHomeCare) {
      extension.push({ url: PRIOR_HOME_CARE_EXTENSION_URL, valueCode: values.priorHomeCare });
    }
  } else if (values.ambulance) {
    // 入院経路をまだ決めていなくても、救急外来から引き継いだ救急車搬送は残す。
    extension.push({ url: AMBULANCE_EXTENSION_URL, valueBoolean: true });
  }
  if (extension.length) next.extension = extension;
  else delete next.extension;

  return next;
}

/** 救急車による搬送だけを立てる(救急外来から入院予定を作るときに引き継ぐ)。 */
export function withAmbulanceArrival(encounter: fhir4.Encounter): fhir4.Encounter {
  const rest = (encounter.extension ?? []).filter((e) => e.url !== AMBULANCE_EXTENSION_URL);
  return { ...encounter, extension: [...rest, { url: AMBULANCE_EXTENSION_URL, valueBoolean: true }] };
}

/** Encounter の coding.display に入れる表示名(様式1 の定義表の区分名)。 */
export function admissionRouteDisplay(values: AdmissionRouteValues): {
  route?: string;
  admissionType?: string;
} {
  return {
    route: ADMISSION_ROUTE_OPTIONS.find((o) => o.code === values.route)?.label,
    admissionType: ADMISSION_TYPE_OPTIONS.find((o) => o.code === values.admissionType)?.label,
  };
}
