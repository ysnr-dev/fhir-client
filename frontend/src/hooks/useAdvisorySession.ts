import { useCallback, useEffect, useMemo, useRef } from "react";
import { recordAdvisoryEvents, type AdvisoryEventPayload } from "../api/advisoryClient";
import { useFacilitySettings } from "../api/queries";
import {
  type Advisory,
  type AdvisoryOverride,
  applySeverityOverrides,
  overrideReasonText,
} from "../fhir/advisoryHelpers";
import { clearStagedAdvisoryOverrides, stageAdvisoryOverrides } from "../lib/advisoryOverrideStage";
import { nowFhirDateTime } from "../lib/dates";

/** 警告を出すフォーム。台帳の context。 */
export type AdvisoryContext =
  | "prescription"
  | "injection"
  | "rad-order"
  | "radiotherapy"
  | "physio"
  | "endoscopy"
  | "meal-order"
  | "regimen-apply"
  | "regimen-cycle";

export interface AdvisorySession {
  /** 施設設定(種別ごとの調整)を当てたあとの警告。画面はこれを描く。 */
  advisories: Advisory[];
  /** 止める警告。1 件でもあれば登録できない。 */
  blocked: Advisory[];
  /** 確認を要する警告。登録するときに理由を選ぶ。 */
  pending: Advisory[];
  /**
   * 登録の直前に呼ぶ。無視した警告を来歴に載せる準備(`stageAdvisoryOverrides`)をし、
   * セッション中に出た警告の発火と無視を台帳に送る。確認が要る警告が無ければ空で呼ぶ。
   */
  confirm(overrides: AdvisoryOverride[]): void;
}

/**
 * フォームを開いてから閉じるまでを 1 セッションとして、警告の発火と無視を追う
 * (docs/advisory-design.md §2.5)。発火 = セッション中に一度でも表示された警告(key で同一視)。
 * 登録せずに閉じたときは発火だけを送る。送信はサーバー側で冪等なので、StrictMode の
 * 二重 unmount や再送は数を増やさない。
 */
export function useAdvisorySession(
  input: Advisory[],
  context: AdvisoryContext,
  enabled = true,
): AdvisorySession {
  const settings = useFacilitySettings();
  const advisories = useMemo(
    () => (enabled ? applySeverityOverrides(input, settings.data?.advisory_severity) : []),
    [enabled, input, settings.data?.advisory_severity],
  );

  const sessionId = useRef(crypto.randomUUID());
  /** 表示した警告と、初めて表示した日時。 */
  const seen = useRef(new Map<string, { advisory: Advisory; at: string }>());
  const submitted = useRef(false);
  const contextRef = useRef(context);
  contextRef.current = context;

  useEffect(() => {
    const now = nowFhirDateTime();
    for (const advisory of advisories) {
      if (!seen.current.has(advisory.key)) seen.current.set(advisory.key, { advisory, at: now });
    }
  }, [advisories]);

  const firedEvents = useCallback(
    (): AdvisoryEventPayload[] =>
      [...seen.current.values()].map(({ advisory, at }) => ({
        key: advisory.key,
        kind: advisory.kind,
        severity: advisory.severity,
        outcome: "fired",
        occurred_at: at,
      })),
    [],
  );

  useEffect(
    () => () => {
      clearStagedAdvisoryOverrides();
      if (submitted.current || seen.current.size === 0) return;
      recordAdvisoryEvents({ context: contextRef.current, session_id: sessionId.current, events: firedEvents() });
    },
    [firedEvents],
  );

  const confirm = useCallback(
    (overrides: AdvisoryOverride[]) => {
      submitted.current = true;
      stageAdvisoryOverrides(overrides);
      const now = nowFhirDateTime();
      const overridden: AdvisoryEventPayload[] = overrides.map((override) => ({
        key: override.advisory.key,
        kind: override.advisory.kind,
        severity: override.advisory.severity,
        outcome: "overridden",
        reason_code: override.reasonCode,
        reason_text: overrideReasonText(override),
        occurred_at: now,
      }));
      recordAdvisoryEvents({
        context: contextRef.current,
        session_id: sessionId.current,
        events: [...firedEvents(), ...overridden],
      });
    },
    [firedEvents],
  );

  return useMemo(
    () => ({
      advisories,
      blocked: advisories.filter((advisory) => advisory.severity === "block"),
      pending: advisories.filter((advisory) => advisory.severity === "warning"),
      confirm,
    }),
    [advisories, confirm],
  );
}
