import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  useDiscardSsmix2Failures,
  useRetrySsmix2Failures,
  useSsmix2Failures,
  useSsmix2Warnings,
} from "../api/queries";
import type { Ssmix2FailureSelection, Ssmix2MessageStatus } from "../api/ssmix2Client";
import { ErrorBanner } from "../components/ErrorBanner";
import { TruncatedNotice } from "../components/TruncatedNotice";
import { formatDateTime } from "../lib/dates";

// SS-MIX2 出力の確認(docs/ssmix2-export-design.md §8)。施設設定の SS-MIX2 区画から開く。
//
// 「失敗」は諦めた行の一覧で、組み立て(FHIR の書き込みをメッセージに起こす)の失敗と、
// 書き込み(エージェントがファイルにする)の失敗が並ぶ。選んで再実行するか、出力しないと決めて破棄する。
// 「警告」は書き出せたが一部を落としたメッセージ(診療科コードや HOT が引けないなど)。

type Tab = "failures" | "warnings";

const MESSAGE_STATUS_LABELS: Record<Ssmix2MessageStatus, string> = {
  pending: "未出力",
  leased: "書き込み中",
  written: "出力済",
  failed: "失敗",
  discarded: "破棄",
};

export function Ssmix2OutputPage() {
  const [tab, setTab] = useState<Tab>("failures");
  const failures = useSsmix2Failures();
  const failureCount = failures.data
    ? failures.data.transactions.length + failures.data.messages.length
    : undefined;

  return (
    <div className="page">
      <div className="page__header">
        <h1>SS-MIX2 出力の確認</h1>
        <Link to="/facility-settings">施設設定</Link>
      </div>
      <div className="inpatient-tabs" role="tablist" aria-label="SS-MIX2 出力の確認の表示切替">
        {(
          [
            { key: "failures", label: failureCount === undefined ? "失敗" : `失敗（${failureCount}）` },
            { key: "warnings", label: "警告" },
          ] as const
        ).map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            className={`inpatient-tabs__tab${tab === item.key ? " is-active" : ""}`}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {tab === "failures" ? <FailuresTab failures={failures} /> : <WarningsTab />}
    </div>
  );
}

// 行の key。組み立ての失敗とメッセージの失敗は id の空間が別なので種別を前に付ける。
type RowKey = `t${number}` | `m${number}`;

interface FailureRow {
  key: RowKey;
  at: string;
  stage: string;
  target: string;
  patientId: string;
  attempts: number;
  error: string;
}

function FailuresTab({ failures }: { failures: ReturnType<typeof useSsmix2Failures> }) {
  const [selected, setSelected] = useState<Set<RowKey>>(new Set());
  const retry = useRetrySsmix2Failures();
  const discard = useDiscardSsmix2Failures();

  const rows = useMemo<FailureRow[]>(() => {
    const data = failures.data;
    if (!data) return [];
    return [
      ...data.transactions.map((t) => ({
        key: `t${t.id}` as const,
        at: t.failed_at ?? t.occurred_at,
        stage: "組み立て",
        target: `${t.method} ${t.resource_types.join(", ") || t.path || "-"}`,
        patientId: "-",
        attempts: t.attempts,
        error: t.error ?? "",
      })),
      ...data.messages.map((m) => ({
        key: `m${m.id}` as const,
        at: m.updated_at,
        stage: "書き込み",
        target: m.file_stem,
        patientId: m.patient_id,
        attempts: m.attempts,
        error: m.error ?? "",
      })),
    ].sort((a, b) => b.at.localeCompare(a.at));
  }, [failures.data]);

  // 選択は今の一覧にある行だけを数える(再実行・破棄で一覧から消えた行は数えない)。
  const chosen = rows.filter((row) => selected.has(row.key));
  const pending = retry.isPending || discard.isPending;

  function toggle(key: RowKey) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAll() {
    setSelected(chosen.length === rows.length ? new Set() : new Set(rows.map((row) => row.key)));
  }

  function selection(): Ssmix2FailureSelection {
    return {
      transaction_ids: chosen.filter((row) => row.key.startsWith("t")).map((row) => Number(row.key.slice(1))),
      message_ids: chosen.filter((row) => row.key.startsWith("m")).map((row) => Number(row.key.slice(1))),
    };
  }

  function handleRetry() {
    retry.mutate(selection(), { onSuccess: () => setSelected(new Set()) });
  }

  function handleDiscard() {
    if (!window.confirm(`選んだ ${chosen.length} 件を破棄します。破棄したものは出力されません。よろしいですか?`)) return;
    discard.mutate(selection(), { onSuccess: () => setSelected(new Set()) });
  }

  return (
    <>
      <ErrorBanner error={failures.error ?? retry.error ?? discard.error} />
      <div className="ssmix2-output__actions">
        <button type="button" onClick={handleRetry} disabled={chosen.length === 0 || pending}>
          再実行{chosen.length > 0 ? `（${chosen.length} 件）` : ""}
        </button>
        <button type="button" onClick={handleDiscard} disabled={chosen.length === 0 || pending}>
          破棄
        </button>
      </div>
      <div className="ssmix2-output__table-wrap">
        <table className="master-search__table ssmix2-output__table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label="すべて選択"
                  checked={rows.length > 0 && chosen.length === rows.length}
                  disabled={rows.length === 0}
                  onChange={toggleAll}
                />
              </th>
              <th>日時</th>
              <th>段階</th>
              <th>患者 ID</th>
              <th>試行</th>
              <th>対象・エラー</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`${row.target} を選択`}
                    checked={selected.has(row.key)}
                    onChange={() => toggle(row.key)}
                  />
                </td>
                <td className="ssmix2-output__nowrap">{formatDateTime(row.at)}</td>
                <td className="ssmix2-output__nowrap">{row.stage}</td>
                <td className="ssmix2-output__nowrap">{row.patientId}</td>
                <td className="ssmix2-output__nowrap">{row.attempts} 回</td>
                <td>
                  <div className="ssmix2-output__target">{row.target}</div>
                  {row.error && <div className="ssmix2-output__error">{row.error}</div>}
                </td>
              </tr>
            ))}
            {!failures.isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="master-search__empty">
                  失敗はありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function WarningsTab() {
  const warnings = useSsmix2Warnings();
  const messages = warnings.data?.messages ?? [];

  return (
    <>
      <ErrorBanner error={warnings.error} />
      <TruncatedNotice show={warnings.data?.truncated} />
      <div className="ssmix2-output__table-wrap">
        <table className="master-search__table ssmix2-output__table">
          <thead>
            <tr>
              <th>日時</th>
              <th>データ種別</th>
              <th>患者 ID</th>
              <th>診療日</th>
              <th>オーダ No</th>
              <th>状態</th>
              <th>警告</th>
            </tr>
          </thead>
          <tbody>
            {messages.map((message) => (
              <tr key={message.id}>
                <td className="ssmix2-output__nowrap">{formatDateTime(message.created_at)}</td>
                <td className="ssmix2-output__nowrap">{message.data_kind}</td>
                <td className="ssmix2-output__nowrap">{message.patient_id}</td>
                <td className="ssmix2-output__nowrap">{message.service_date}</td>
                <td className="ssmix2-output__nowrap">{message.order_no}</td>
                <td className="ssmix2-output__nowrap">{MESSAGE_STATUS_LABELS[message.status]}</td>
                <td>
                  <ul className="ssmix2-output__warnings">
                    {message.warnings.map((warning, index) => (
                      <li key={index}>{warning}</li>
                    ))}
                  </ul>
                </td>
              </tr>
            ))}
            {!warnings.isLoading && messages.length === 0 && (
              <tr>
                <td colSpan={7} className="master-search__empty">
                  警告はありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {messages.length > 0 && <p className="order-select__muted">{messages.length} 件</p>}
    </>
  );
}
