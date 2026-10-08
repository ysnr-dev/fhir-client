import { useEffect, useMemo, useState } from "react";
import { useCurrentPractitioner } from "../api/authQueries";
import type { DpcBranch, DpcCandidate, DpcCodingRow, DpcEvidence } from "../api/masterClient";
import { useDpcCoding } from "../api/masterQueries";
import {
  useCancelDpcCodingDecision,
  useDpcCodingDecisions,
  useSaveDpcCodingDecision,
} from "../api/queries";
import {
  dpcCodingInputsFromForm1,
  dpcEstimatedYen,
  EMPTY_DPC_OVERRIDES,
  setDpcBranch,
  toggleDpcItem,
} from "../fhir/dpcCodingHelpers";
import {
  buildDpcCodingResponse,
  dpcCodeName,
  dpcTimingLabel,
  DPC_TIMINGS,
  type DpcTiming,
} from "../fhir/dpcCodingRecord";
import type { Dpc1Values } from "../fhir/dpcForm1/types";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { useSelfInstitutionNumber } from "../hooks/useSelfInstitutionNumber";
import { formatDateTime } from "../lib/dates";
import { ErrorBanner } from "./ErrorBanner";

// 診断群分類(14 桁)の判定と決定(カルテ右ペインの DPC の「診断群分類」)。
// 医療資源病名・JCS・重症度などは入力中の様式1 の値をそのまま使い、手術・処置・薬剤は
// backend が入院期間の実施記録から集める。分岐ごとに自動の値と根拠を出し、人が上書きする。

const SOURCE_LABELS: Record<string, string> = {
  performed: "実施",
  form1: "様式1",
  override: "追加",
  derived: "導出",
  suggested: "候補",
  accepted: "確定",
};

const CANDIDATE_STATUS_LABELS: Record<DpcCandidate["status"], string> = {
  suggested: "確定待ち",
  accepted: "確定",
  rejected: "除外",
  derived: "実施記録",
};

const BRANCH_STATUS_LABELS: Record<DpcBranch["status"], string> = {
  auto: "自動",
  override: "上書き",
  undetermined: "未確定",
  not_applicable: "",
};

/** 入力が落ち着いてから判定を引く(1 文字ごとに backend へ行かない)。 */
function useSettled<T>(value: T, delay = 500): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

function evidenceText(e: DpcEvidence): string {
  return [SOURCE_LABELS[e.source] ?? e.source, e.date, e.code, e.name, e.note].filter(Boolean).join(" ");
}

interface DpcCodingViewProps {
  patient: fhir4.Patient;
  encounter: fhir4.Encounter;
  values: Dpc1Values;
  /** 入院時の年齢(A-DROP の年齢の点に使う)。 */
  age: number | null;
  /** タブが開いているときだけ判定する(様式1 の入力中に backend を叩き続けない)。 */
  active: boolean;
}

export function DpcCodingView({ patient, encounter, values, age, active }: DpcCodingViewProps) {
  const [overrides, setOverrides] = useState(EMPTY_DPC_OVERRIDES);
  const [manualCode, setManualCode] = useState("");
  const [timing, setTiming] = useState<DpcTiming>(encounter.status === "finished" ? "discharge" : "admission");
  const [note, setNote] = useState("");

  const inputs = useSettled(useMemo(() => dpcCodingInputsFromForm1(values, age), [values, age]));
  const coding = useDpcCoding(encounter.id, inputs, overrides, active);
  const decisions = useDpcCodingDecisions(encounter.id);
  const save = useSaveDpcCodingDecision();
  const cancel = useCancelDpcCodingDecision();
  const { practitioner, practitionerId, user } = useCurrentPractitioner();
  const institutionNumber = useSelfInstitutionNumber();

  const data = coding.data;
  const result = data?.result ?? null;
  const branches = (data?.branches ?? []).filter((b) => b.status !== "not_applicable");
  const candidates = data?.candidates ?? [];
  const pending = candidates.some((c) => c.status === "suggested");
  const coefficient = data?.coefficient?.value;

  function decide() {
    if (!result || !data?.edition || !encounter.id) return;
    save.mutate(
      buildDpcCodingResponse({
        patient,
        institutionNumber,
        encounterId: encounter.id,
        author: practitioner
          ? { id: practitionerId ?? undefined, name: practitionerDisplayName(practitioner) }
          : { name: user?.administrator ? "管理者" : (user?.login_id ?? "") },
        row: result,
        edition: data.edition,
        timing,
        icd10: inputs.icd10 ?? "",
        branches: data.branches ?? [],
        note,
      }),
      { onSuccess: () => setNote("") },
    );
  }

  function addManualCode() {
    const code = manualCode.trim().toUpperCase();
    if (!code) return;
    setOverrides((o) => toggleDpcItem(o, code, "accept"));
    setManualCode("");
  }

  return (
    <div className="dpc-coding">
      <ErrorBanner error={coding.error ?? decisions.error ?? save.error ?? cancel.error} />
      {(data?.warnings ?? []).map((warning) => (
        <p key={warning} className="dpc-coding__warning">
          {warning}
        </p>
      ))}

      <dl className="prescription-detail__common">
        <dt>医療資源病名</dt>
        <dd>{inputs.icd10 ?? "-"}</dd>
        <dt>分類</dt>
        <dd>{data?.mdc6 ? `${data.mdc6} ${data.classification_name ?? ""}` : "-"}</dd>
        <dt>版</dt>
        <dd>{data?.edition ?? "-"}</dd>
        <dt>在院日数</dt>
        <dd>
          {data?.stay ? `${data.stay.days} 日(${data.stay.admitted_on} 〜 ${data.stay.discharged_on ?? data.base_date})` : "-"}
        </dd>
      </dl>

      {coding.isLoading && <p>判定しています...</p>}

      {data?.mdc6 && (
        <>
          <section className="dpc-coding__result">
            <h4>診断群分類</h4>
            {result ? (
              <ResultSummary row={result} coefficient={coefficient} stayDays={data.stay?.days ?? 0} />
            ) : (
              <p className="dpc-coding__undetermined">候補 {data.dpc_codes?.length ?? 0} 件</p>
            )}
          </section>

          <section>
            <h4>分岐</h4>
            <table className="patient-table dpc-coding__branches">
              <thead>
                <tr>
                  <th>分岐</th>
                  <th>値</th>
                  <th>根拠</th>
                  <th>状態</th>
                </tr>
              </thead>
              <tbody>
                {branches.map((branch) => (
                  <tr key={branch.key} className={branch.status === "undetermined" ? "dpc-coding__row--open" : undefined}>
                    <td>{branch.label}</td>
                    <td>
                      <select
                        aria-label={branch.label}
                        value={overrides.branches[branch.key] ?? ""}
                        onChange={(e) => setOverrides((o) => setDpcBranch(o, branch.key, e.target.value))}
                      >
                        <option value="">
                          {branch.auto_value
                            ? `自動: ${branch.auto_value} ${optionLabel(branch, branch.auto_value)}`
                            : "自動: 未確定"}
                        </option>
                        {branch.options.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.value} {option.label ?? ""}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="dpc-coding__evidence">
                      {branch.evidence.map((e, i) => (
                        <div key={i}>{evidenceText(e)}</div>
                      ))}
                    </td>
                    <td>{BRANCH_STATUS_LABELS[branch.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section>
            <h4>手術・処置等の候補</h4>
            {candidates.length > 0 && (
              <table className="patient-table dpc-coding__candidates">
                <thead>
                  <tr>
                    <th>コード</th>
                    <th>名称</th>
                    <th>根拠</th>
                    <th>状態</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((candidate) => (
                    <tr key={candidate.code} className={candidate.status === "rejected" ? "dpc-coding__row--muted" : undefined}>
                      <td>{candidate.code}</td>
                      <td>
                        {candidate.name}
                        {candidate.note && <div className="dpc-coding__note">{candidate.note}</div>}
                      </td>
                      <td className="dpc-coding__evidence">
                        {candidate.basis.map((e, i) => (
                          <div key={i}>{evidenceText(e)}</div>
                        ))}
                      </td>
                      <td>{CANDIDATE_STATUS_LABELS[candidate.status]}</td>
                      <td className="dpc-coding__actions">
                        {candidate.status === "suggested" && (
                          <button
                            type="button"
                            className="rp-card__compact-button"
                            onClick={() => setOverrides((o) => toggleDpcItem(o, candidate.code, "accept"))}
                          >
                            確定
                          </button>
                        )}
                        {(candidate.status === "suggested" || candidate.status === "derived") && (
                          <button
                            type="button"
                            className="rp-card__compact-button"
                            onClick={() => setOverrides((o) => toggleDpcItem(o, candidate.code, "reject"))}
                          >
                            除外
                          </button>
                        )}
                        {(candidate.status === "accepted" || candidate.status === "rejected") && (
                          <button
                            type="button"
                            className="rp-card__compact-button"
                            onClick={() => setOverrides((o) => toggleDpcItem(o, candidate.code, "reset"))}
                          >
                            戻す
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="dpc-coding__manual">
              <label>
                コード
                <input value={manualCode} onChange={(e) => setManualCode(e.target.value)} />
              </label>
              <button type="button" className="rp-card__compact-button" onClick={addManualCode}>
                追加
              </button>
              {overrides.accepted
                .filter((code) => !candidates.some((c) => c.code === code))
                .map((code) => (
                  <span key={code} className="dpc-coding__chip">
                    {code}
                    <button
                      type="button"
                      aria-label={`${code}を外す`}
                      onClick={() => setOverrides((o) => toggleDpcItem(o, code, "reset"))}
                    >
                      ×
                    </button>
                  </span>
                ))}
            </div>
          </section>

          <section>
            <h4>同じ分類の候補</h4>
            <SimulationTable rows={data.simulation ?? []} coefficient={coefficient} />
          </section>
        </>
      )}

      <section className="dpc-coding__decide">
        <label>
          時点
          <select value={timing} onChange={(e) => setTiming(e.target.value as DpcTiming)}>
            {DPC_TIMINGS.map((t) => (
              <option key={t.code} value={t.code}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="dpc-coding__decide-note">
          コメント
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button
          type="button"
          disabled={!result || pending || coding.isFetching || save.isPending}
          onClick={decide}
        >
          決定
        </button>
      </section>

      <section>
        <h4>DPC歴</h4>
        {decisions.data?.length ? (
          <table className="patient-table">
            <thead>
              <tr>
                <th>日時</th>
                <th>時点</th>
                <th>診断群分類</th>
                <th>決定者</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {decisions.data.map((decision) => {
                const cancelled = decision.status === "entered-in-error";
                return (
                  <tr key={decision.id} className={cancelled ? "dpc-coding__row--muted" : undefined}>
                    <td>{formatDateTime(decision.authored)}</td>
                    <td>{dpcTimingLabel(decision.timing)}</td>
                    <td>
                      <div className="dpc-coding__code">{decision.dpcCode}</div>
                      <div className="dpc-coding__note">{decision.name}</div>
                      {decision.note && <div className="dpc-coding__note">{decision.note}</div>}
                    </td>
                    <td>{decision.authorName}</td>
                    <td>
                      {cancelled ? (
                        "取消済"
                      ) : (
                        <button
                          type="button"
                          className="rp-card__compact-button"
                          disabled={cancel.isPending}
                          onClick={() => cancel.mutate(decision.response)}
                        >
                          取消
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="patient-table__empty">決定した分類はありません。</p>
        )}
      </section>
    </div>
  );
}

function optionLabel(branch: DpcBranch, value: string): string {
  return branch.options.find((o) => o.value === value)?.label ?? "";
}

const PERIODS = ["Ⅰ", "Ⅱ", "Ⅲ"];

function ResultSummary({
  row,
  coefficient,
  stayDays,
}: {
  row: DpcCodingRow;
  coefficient?: string;
  stayDays: number;
}) {
  const yen = dpcEstimatedYen(row.estimated_points, coefficient);
  const over = row.days[2] != null && stayDays > (row.days[2] ?? 0);
  return (
    <div>
      <div className="dpc-coding__code">
        {row.dpc_code} <span className="dpc-coding__bundled">{row.bundled ? "包括" : "出来高"}</span>
        {row.ccpm && <span className="dpc-coding__note"> CCPM {row.ccpm}</span>}
      </div>
      <div>{dpcCodeName(row)}</div>
      {row.bundled && (
        <>
          <table className="patient-table dpc-coding__periods">
            <thead>
              <tr>
                <th />
                {PERIODS.map((p) => (
                  <th key={p}>期間{p}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th>日数</th>
                {row.days.map((d, i) => (
                  <td key={i}>{d ?? "-"}</td>
                ))}
              </tr>
              <tr>
                <th>末日</th>
                {row.period_ends.map((d, i) => (
                  <td key={i}>{d ?? "-"}</td>
                ))}
              </tr>
              <tr>
                <th>点数/日</th>
                {row.points.map((p, i) => (
                  <td key={i}>{p?.toLocaleString() ?? "-"}</td>
                ))}
              </tr>
            </tbody>
          </table>
          <p>
            推定包括点数 {row.estimated_points?.toLocaleString() ?? "-"} 点
            {yen != null && ` / ${yen.toLocaleString()} 円(係数 ${coefficient})`}
            {over && <span className="dpc-coding__over"> 期間Ⅲ超え</span>}
          </p>
        </>
      )}
    </div>
  );
}

function SimulationTable({ rows, coefficient }: { rows: DpcCodingRow[]; coefficient?: string }) {
  if (!rows.length) return null;
  return (
    <table className="patient-table dpc-coding__simulation">
      <thead>
        <tr>
          <th>14 桁</th>
          <th>手術</th>
          <th>処置等1</th>
          <th>処置等2</th>
          <th>副傷病・重症度</th>
          <th>日数</th>
          <th>推定点数</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const yen = dpcEstimatedYen(row.estimated_points, coefficient);
          const className = row.current
            ? "dpc-coding__row--current"
            : row.consistent
              ? undefined
              : "dpc-coding__row--muted";
          return (
            <tr key={row.dpc_code} className={className}>
              <td className="dpc-coding__code">{row.dpc_code}</td>
              <td>{row.names.surgery}</td>
              <td>{row.names.proc1}</td>
              <td>{row.names.proc2}</td>
              <td>{[row.names.comorbidity, row.names.severity].filter(Boolean).join(" / ")}</td>
              <td>{row.bundled ? row.days.map((d) => d ?? "-").join("/") : "出来高"}</td>
              <td>
                {row.estimated_points?.toLocaleString() ?? "-"}
                {yen != null && <div className="dpc-coding__note">{yen.toLocaleString()} 円</div>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
