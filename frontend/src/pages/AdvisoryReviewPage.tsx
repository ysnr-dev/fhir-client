import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAdvisoryStats } from "../api/adminQueries";
import { advisoryRuleHooks, useAdvisoryOverrideReasons } from "../api/masterQueries";
import { useFacilitySettings, useUpdateFacilitySettings } from "../api/queries";
import {
  ADVISORY_GROUPS,
  ADVISORY_KIND_DEFS,
  ADVISORY_KINDS,
  ADVISORY_SEVERITY_LABELS,
  ADVISORY_SEVERITY_OVERRIDE_LABELS,
  type AdvisoryKind,
  type AdvisorySeverityOverride,
  advisoryKey,
} from "../fhir/advisoryHelpers";
import { ADVISORY_RULE_KIND } from "../fhir/advisoryRuleHelpers";
import { ErrorBanner } from "../components/ErrorBanner";
import { addMonths, today } from "../lib/dates";

// 警告の集計と設定(docs/advisory-design.md §4)。種別 × 月の発火数・無視数(率)と主な無視理由を並べ、
// 行ごとに重さを下げる・出さないを選ぶ(施設設定 advisory_severity)。施設の規則は種別の行の下に
// 規則ごとの行を出す(重さは規則のマスタで決める)。

/** 既定で出す月数。 */
const DEFAULT_MONTHS = 6;
/** 主な理由として出す件数。 */
const TOP_REASONS = 3;

const OVERRIDE_OPTIONS: AdvisorySeverityOverride[] = ["default", "info", "off"];

/** 見出しの月(「5月」)。年は期間の入力で分かるので出さない。 */
function monthLabel(month: string): string {
  return `${Number(month.slice(5, 7))}月`;
}

function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** from〜to の月(YYYY-MM)を順に。 */
function monthsBetween(from: string, to: string): string[] {
  const months: string[] = [];
  let cursor = `${from}-01`;
  while (monthOf(cursor) <= to && months.length < 36) {
    months.push(monthOf(cursor));
    cursor = addMonths(cursor, 1);
  }
  return months;
}

export function AdvisoryReviewPage() {
  const [range, setRange] = useState(() => {
    const now = today();
    return { from: monthOf(addMonths(`${monthOf(now)}-01`, -(DEFAULT_MONTHS - 1))), to: monthOf(now) };
  });
  const stats = useAdvisoryStats(range);
  const reasons = useAdvisoryOverrideReasons();
  const settings = useFacilitySettings();
  const update = useUpdateFacilitySettings();
  const overrides = settings.data?.advisory_severity ?? {};

  const reasonName = useMemo(() => new Map(reasons.map((r) => [r.code, r.name])), [reasons]);
  const months = useMemo(() => monthsBetween(range.from, range.to), [range]);
  // 行のキーは種別。施設の規則の内訳は警告の key と同じ「facility-rule|<コード>」。
  const byKind = useMemo(() => {
    const map = new Map<string, { byMonth: Map<string, { fired: number; overridden: number }>; reasons: Map<string, number> }>();
    const rows = [
      ...(stats.data?.rows ?? []).map((row) => ({ ...row, key: row.kind })),
      ...(stats.data?.rule_rows ?? []).map((row) => ({ ...row, key: advisoryKey(ADVISORY_RULE_KIND, row.rule_code) })),
    ];
    for (const row of rows) {
      const entry = map.get(row.key) ?? { byMonth: new Map(), reasons: new Map() };
      entry.byMonth.set(row.month, { fired: row.fired, overridden: row.overridden });
      for (const [code, count] of Object.entries(row.reasons)) {
        entry.reasons.set(code, (entry.reasons.get(code) ?? 0) + count);
      }
      map.set(row.key, entry);
    }
    return map;
  }, [stats.data]);
  // 規則のマスタにある規則と、台帳にだけ残っている(削除した)規則。
  const ruleList = advisoryRuleHooks.useList();
  const rules = useMemo(() => {
    const list = (ruleList.data?.items ?? []).map((rule) => ({
      key: advisoryKey(ADVISORY_RULE_KIND, rule.code),
      name: rule.name,
      severity: rule.severity,
    }));
    for (const row of stats.data?.rule_rows ?? []) {
      const key = advisoryKey(ADVISORY_RULE_KIND, row.rule_code);
      if (!list.some((rule) => rule.key === key)) list.push({ key, name: `${row.rule_code}(削除済み)`, severity: "info" });
    }
    return list;
  }, [ruleList.data, stats.data]);

  function setOverride(kind: AdvisoryKind, value: AdvisorySeverityOverride) {
    const next = { ...overrides };
    if (value === "default") delete next[kind];
    else next[kind] = value;
    update.mutate({ advisory_severity: next });
  }

  function cell(kind: string, month: string) {
    const count = byKind.get(kind)?.byMonth.get(month);
    if (!count || (count.fired === 0 && count.overridden === 0)) return <td key={month} className="advisory-review__count" />;
    const rate = count.fired > 0 ? Math.round((count.overridden / count.fired) * 100) : null;
    return (
      <td key={month} className="advisory-review__count">
        {count.fired}
        {count.overridden > 0 && (
          <span className="advisory-review__overridden">
            {` / ${count.overridden}${rate !== null ? `（${rate}%）` : ""}`}
          </span>
        )}
      </td>
    );
  }

  function topReasons(kind: string): string {
    const entries = [...(byKind.get(kind)?.reasons ?? new Map<string, number>())]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_REASONS);
    return entries.map(([code, count]) => `${reasonName.get(code) ?? code} ${count}`).join("、");
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>警告の集計と設定</h1>
      </div>
      <div className="advisory-review__range">
        <label>
          期間
          <input
            type="month"
            value={range.from}
            max={range.to}
            onChange={(e) => e.target.value && setRange((r) => ({ ...r, from: e.target.value }))}
          />
        </label>
        <span>〜</span>
        <input
          type="month"
          aria-label="期間の終わり"
          value={range.to}
          min={range.from}
          onChange={(e) => e.target.value && setRange((r) => ({ ...r, to: e.target.value }))}
        />
      </div>

      <ErrorBanner error={stats.error ?? settings.error ?? update.error} />

      <div className="advisory-review__scroll">
      <table className="master-search__table advisory-review__table">
        <thead>
          <tr>
            <th className="advisory-review__kind">種別</th>
            <th className="advisory-review__default">既定</th>
            <th className="advisory-review__severity">重さ</th>
            {months.map((month) => (
              <th key={month} className="advisory-review__count" title={month}>
                {monthLabel(month)}
              </th>
            ))}
            <th className="advisory-review__reasons">主な理由</th>
          </tr>
        </thead>
        <tbody>
          {ADVISORY_GROUPS.map((group) => (
            <GroupRows
              key={group}
              group={group}
              months={months}
              cell={cell}
              topReasons={topReasons}
              overrides={overrides}
              onChange={setOverride}
              saving={update.isPending}
              rules={rules}
            />
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

function GroupRows({
  group,
  months,
  cell,
  topReasons,
  overrides,
  onChange,
  saving,
  rules,
}: {
  group: (typeof ADVISORY_GROUPS)[number];
  months: string[];
  cell: (key: string, month: string) => ReactNode;
  topReasons: (key: string) => string;
  overrides: Record<string, AdvisorySeverityOverride>;
  onChange: (kind: AdvisoryKind, value: AdvisorySeverityOverride) => void;
  saving: boolean;
  /** 施設の規則の内訳の行(key は警告の key)。 */
  rules: { key: string; name: string; severity: keyof typeof ADVISORY_SEVERITY_LABELS }[];
}) {
  const kinds = ADVISORY_KINDS.filter((kind) => ADVISORY_KIND_DEFS[kind].group === group);
  return (
    <>
      <tr className="advisory-review__group">
        <th colSpan={months.length + 4}>{group}</th>
      </tr>
      {kinds.map((kind) => {
        const def = ADVISORY_KIND_DEFS[kind];
        const value = overrides[kind] ?? "default";
        return (
          <tr key={kind}>
            <td className="advisory-review__kind">{def.label}</td>
            <td className="advisory-review__default">{ADVISORY_SEVERITY_LABELS[def.defaultSeverity]}</td>
            <td className="advisory-review__severity">
              <select
                aria-label={`${def.label}の重さ`}
                value={value}
                disabled={saving || def.defaultSeverity === "block"}
                onChange={(e) => onChange(kind, e.target.value as AdvisorySeverityOverride)}
              >
                {OVERRIDE_OPTIONS.map((option) => (
                  <option key={option} value={option} disabled={option === "info" && def.defaultSeverity === "info"}>
                    {ADVISORY_SEVERITY_OVERRIDE_LABELS[option]}
                  </option>
                ))}
              </select>
            </td>
            {months.map((month) => cell(kind, month))}
            <td className="advisory-review__reasons">{topReasons(kind)}</td>
          </tr>
        );
      })}
      {group === ADVISORY_KIND_DEFS[ADVISORY_RULE_KIND].group &&
        rules.map((rule) => (
          <tr key={rule.key} className="advisory-review__rule">
            <td className="advisory-review__kind">{rule.name}</td>
            <td className="advisory-review__default">{ADVISORY_SEVERITY_LABELS[rule.severity]}</td>
            <td className="advisory-review__severity">
              <Link to="/advisory-rules">規則マスタ</Link>
            </td>
            {months.map((month) => cell(rule.key, month))}
            <td className="advisory-review__reasons">{topReasons(rule.key)}</td>
          </tr>
        ))}
    </>
  );
}
