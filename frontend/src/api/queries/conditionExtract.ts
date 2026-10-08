import { useCallback, useRef, useState } from "react";
import { NURSING_PROBLEM_CODE } from "../../fhir/conditionHelpers";
import type { ExtractCode } from "../../fhir/extractQueryHelpers";
import { fetchMissingPatients, searchExtractRecords, subjectIdOf } from "./extractRecords";

// 病名の抽出(docs/data-extract-design.md §20)。病名(Condition。看護問題は除く)を開始日か登録日の期間で引く。
// 病名・ICD10 を選んだら 100 件ずつ code= で引いて合わせる。区分(保険病名 / プロブレム / 既往歴)と疑いは上流が絞る。

const CODE_CHUNK = 100;
const CATEGORY_SYSTEM = "http://terminology.hl7.org/CodeSystem/condition-category";
const LOCAL_CATEGORY_SYSTEM = "http://fhir-client.local/CodeSystem/condition-category";
const PAST_HISTORY = `${LOCAL_CATEGORY_SYSTEM}|past-history`;
const NURSING_PROBLEM = `${LOCAL_CATEGORY_SYSTEM}|${NURSING_PROBLEM_CODE}`;
const PROBLEM_LIST_ITEM = `${CATEGORY_SYSTEM}|problem-list-item`;

export type ConditionExtractCategory = "billing" | "problem" | "past";
export type ConditionExtractSuspected = "exclude" | "only";

export interface ConditionExtractCriteria {
  codes: ExtractCode[];
  clinicalStatus: string[];
  category?: ConditionExtractCategory;
  suspected?: ConditionExtractSuspected;
  dateField: "onset" | "recorded";
  from: string;
  to: string;
  patientIds?: string[];
}

export interface ConditionExtractResult {
  conditions: fhir4.Condition[];
  patients: Map<string, fhir4.Patient>;
  truncated: boolean;
}

interface ConditionExtractState {
  running: boolean;
  error: unknown;
  result: ConditionExtractResult | null;
}

const IDLE: ConditionExtractState = { running: false, error: null, result: null };

/**
 * 区分の絞り込み。保険病名は category を持たない古い病名もあるので「プロブレムでない」で引く。
 * プロブレムは既往歴(problem-list-item も併記する)を除き、既往歴はローカルのコードで引く。
 */
function applyCategory(params: URLSearchParams, category: ConditionExtractCategory | undefined) {
  if (category === "billing") {
    params.set("category:not", `${PROBLEM_LIST_ITEM},${NURSING_PROBLEM}`);
  } else if (category === "problem") {
    params.set("category", PROBLEM_LIST_ITEM);
    params.set("category:not", `${PAST_HISTORY},${NURSING_PROBLEM}`);
  } else if (category === "past") {
    params.set("category", PAST_HISTORY);
  } else {
    params.set("category:not", NURSING_PROBLEM);
  }
}

/** 病名の抽出の実行。条件を変えても自動では走らせない。 */
export function useConditionExtract() {
  const [state, setState] = useState<ConditionExtractState>(IDLE);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async (criteria: ConditionExtractCriteria) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const signal = controller.signal;
    setState({ running: true, error: null, result: null });
    try {
      const base = new URLSearchParams();
      if (criteria.clinicalStatus.length) base.set("clinical-status", criteria.clinicalStatus.join(","));
      if (criteria.suspected === "only") {
        base.set("verification-status", "provisional");
      } else {
        const excluded = ["entered-in-error", "refuted", ...(criteria.suspected === "exclude" ? ["provisional"] : [])];
        base.set("verification-status:not", excluded.join(","));
      }
      applyCategory(base, criteria.category);
      // 病名の開始日は onsetDateTime(この画面の病名登録は recordedDate を書かない)。登録日は他のシステムから来た病名のため。
      const dateParam = criteria.dateField === "recorded" ? "recorded-date" : "onset-date";
      if (criteria.from) base.append(dateParam, `ge${criteria.from}`);
      if (criteria.to) base.append(dateParam, `le${criteria.to}`);
      base.set("_sort", criteria.dateField === "recorded" ? "-recorded-date" : "-onset-date");

      const tokens = [...new Set(criteria.codes.map((c) => `${c.system}|${c.code}`))];
      const searches: URLSearchParams[] = [];
      if (tokens.length === 0) searches.push(base);
      for (let i = 0; i < tokens.length; i += CODE_CHUNK) {
        const params = new URLSearchParams(base);
        params.set("code", tokens.slice(i, i + CODE_CHUNK).join(","));
        searches.push(params);
      }

      const conditions = new Map<string, fhir4.Condition>();
      const patients = new Map<string, fhir4.Patient>();
      let truncated = false;
      for (const params of searches) {
        const page = await searchExtractRecords<fhir4.Condition>("Condition", params, criteria.patientIds, signal);
        for (const condition of page.matches) conditions.set(condition.id ?? `${conditions.size}`, condition);
        for (const [id, patient] of page.patients) patients.set(id, patient);
        truncated ||= page.truncated;
      }
      const matches = [...conditions.values()];
      await fetchMissingPatients(matches.map(subjectIdOf), patients, signal);
      setState({ running: false, error: null, result: { conditions: matches, patients, truncated } });
    } catch (error) {
      setState({ running: false, error: signal.aborted ? null : error, result: null });
    }
  }, []);

  const cancel = useCallback(() => abortRef.current?.abort(), []);

  return { ...state, run, cancel };
}
