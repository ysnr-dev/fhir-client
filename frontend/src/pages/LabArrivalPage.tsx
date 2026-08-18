import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  LAB_LABELS_KEY,
  LabLabelsApiError,
  cancelLabelArrival,
  fetchLabLabelRecords,
  isValidLabelNumber,
  recordLabelArrival,
} from "../api/labLabelsClient";
import {
  fetchLabArrivalContext,
  useUpdateLabTaskStatus,
  type LabArrivalContext,
} from "../api/queries";
import { groupBySpecimen, labOrderItems, specimenGroupLabel } from "../fhir/labOrderHelpers";
import { labTaskStatus } from "../fhir/labTaskHelpers";
import { displayName } from "../fhir/patientHelpers";

// 検体到着確認(docs/lab-arrival-design.md §4-1)。検体ラベルのバーコードを
// スキャンして、採取管 1 本ずつの到着を記録する画面。
//
// 1 スキャンの流れ: 台帳に到着を記録 → 上流からオーダー文脈(患者・検査項目・進捗)を
// 読んで結果フィードに積む → 今のオーダーの検体グループ全部に到着記録が付いたら
// Task を到着済へ進める。判定を「発行記録が揃ったか」ではなく「今のオーダーの検体が
// 揃ったか」にするのは、発行後のオーダー訂正(検体の増減)に追従するため。
//
// フィードには患者氏名と検体を必ず出す。スキャンした管と画面の表示が食い違ったら
// 貼り間違いに気付ける(ラベルの目的そのもの)。

/** フィードの 1 行 = スキャン(または手入力)1 回。 */
interface FeedEntry {
  key: number;
  /** スキャンした時刻(表示用)。 */
  time: string;
  number: string;
  kind: "arrived" | "already" | "error";
  /** kind=error のときの理由。 */
  message?: string;
  patientFhirId?: string;
  patientNumber?: string;
  patientName?: string;
  specimenLabel?: string;
  warnings: string[];
  /** このスキャンで全検体が揃い、オーダーを到着済にした。 */
  taskCompleted?: boolean;
  /** 「取消」で到着の記録を消した行。 */
  cancelled?: boolean;
}

function timeLabel(date: Date): string {
  return date.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function recordedAtLabel(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function LabArrivalPage() {
  const [entries, setEntries] = useState<FeedEntry[]>([]);
  const [input, setInput] = useState("");
  const [processing, setProcessing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const keyRef = useRef(0);
  const queryClient = useQueryClient();
  const updateStatus = useUpdateLabTaskStatus();

  function pushEntry(entry: Omit<FeedEntry, "key" | "time">) {
    keyRef.current += 1;
    setEntries((prev) => [{ ...entry, key: keyRef.current, time: timeLabel(new Date()) }, ...prev]);
  }

  // 台帳とワークリストの表示を追い付かせる(到着バッジ・ステータス)。
  function invalidate() {
    queryClient.invalidateQueries({ queryKey: [LAB_LABELS_KEY] });
    queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "lab-worklist"] });
  }

  async function handleScan(number: string) {
    if (!isValidLabelNumber(number)) {
      pushEntry({
        number,
        kind: "error",
        message: "番号の形式が正しくありません(読み取りエラーの可能性)",
        warnings: [],
      });
      return;
    }

    let result;
    try {
      result = await recordLabelArrival(number);
    } catch (e) {
      pushEntry({
        number,
        kind: "error",
        message: e instanceof LabLabelsApiError ? e.message : "到着の記録に失敗しました",
        warnings: [],
      });
      return;
    }

    // 記録はできたので、以降(文脈の取得・到着済への遷移)の失敗は警告に留める。
    const entry: Omit<FeedEntry, "key" | "time"> = {
      number,
      kind: result.already_arrived ? "already" : "arrived",
      warnings: [],
    };
    if (result.already_arrived && result.arrived_at) {
      entry.message = `${recordedAtLabel(result.arrived_at)} に記録済み`;
    }

    let context: LabArrivalContext | null = null;
    try {
      const [fetched, records] = await Promise.all([
        fetchLabArrivalContext(result.order_fhir_id),
        fetchLabLabelRecords([result.order_fhir_id]),
      ]);
      context = fetched;

      if (!context) {
        entry.warnings.push("オーダーが見つかりません(削除された可能性)");
      } else {
        const { order, itemRequests, patient, task } = context;
        entry.patientFhirId = patient?.id;
        entry.patientNumber = patient?.identifier?.[0]?.value;
        entry.patientName = patient ? displayName(patient) : undefined;

        const groups = groupBySpecimen(labOrderItems(order, itemRequests));
        const group = groups.find((g) => g.specimenCode === result.specimen_code);
        entry.specimenLabel = group
          ? specimenGroupLabel(group)
          : result.specimen_code || "検体未設定";
        if (!group) entry.warnings.push("オーダーにこの検体はありません(訂正で外れた可能性)");

        const status = labTaskStatus(task);
        if (status === "cancelled") entry.warnings.push("このオーダーは中止されています");

        // 今のオーダーの検体グループ全部に到着記録が付いたら到着済へ。
        const allArrived =
          groups.length > 0 &&
          groups.every((g) =>
            records.some((r) => r.specimen_code === g.specimenCode && r.arrived_at),
          );
        if (allArrived && status === "accepted") {
          await updateStatus.mutateAsync({ order, task, status: "completed" });
          entry.taskCompleted = true;
        }
      }
    } catch {
      entry.warnings.push("オーダー情報の取得に失敗しました(到着は記録されています)");
    }

    pushEntry(entry);
    invalidate();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const number = input.trim();
    if (!number || processing) return;

    setInput("");
    setProcessing(true);
    try {
      await handleScan(number);
    } finally {
      setProcessing(false);
      // ハンディスキャナは入力欄にフォーカスがある前提で打ってくるので、必ず戻す。
      inputRef.current?.focus();
    }
  }

  async function handleCancel(entry: FeedEntry) {
    try {
      const record = await cancelLabelArrival(entry.number);
      // このスキャンで到着済まで進めていた場合は受付済へ戻す。
      const context = await fetchLabArrivalContext(record.order_fhir_id);
      if (context && labTaskStatus(context.task) === "completed") {
        await updateStatus.mutateAsync({
          order: context.order,
          task: context.task,
          status: "accepted",
        });
      }
      setEntries((prev) =>
        prev.map((e) => (e.key === entry.key ? { ...e, cancelled: true } : e)),
      );
      invalidate();
    } catch {
      setEntries((prev) =>
        prev.map((e) =>
          e.key === entry.key
            ? { ...e, warnings: [...e.warnings, "取消に失敗しました"] }
            : e,
        ),
      );
    } finally {
      inputRef.current?.focus();
    }
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>検体到着確認</h1>
      </div>
      <p className="oauth-clients__lead">
        検体ラベルのバーコードをスキャンすると到着を記録します。オーダーの検体が全部揃うと、
        検体検査一覧のステータスが「到着済」になります。番号は手入力もできます。
      </p>

      <form className="lab-arrival__scan" onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="バーコードをスキャン(11桁)"
          autoFocus
        />
        <button type="submit" disabled={processing}>
          確定
        </button>
      </form>

      <ul className="lab-arrival__feed">
        {entries.map((entry) => (
          <FeedRow key={entry.key} entry={entry} onCancel={() => handleCancel(entry)} />
        ))}
        {entries.length === 0 && (
          <li className="lab-arrival__empty order-select__muted">スキャンした結果がここに並びます</li>
        )}
      </ul>
    </div>
  );
}

function FeedRow({ entry, onCancel }: { entry: FeedEntry; onCancel: () => void }) {
  return (
    <li className={entry.cancelled ? "lab-arrival__row--cancelled" : undefined}>
      <span className="lab-arrival__time order-select__muted">{entry.time}</span>
      <span className="lab-arrival__number">{entry.number}</span>
      {entry.kind === "error" ? (
        <span className="lab-arrival__result lab-arrival__result--error">{entry.message}</span>
      ) : (
        <>
          <span>
            {entry.patientNumber ?? "-"}{" "}
            {entry.patientFhirId ? (
              <Link to={`/patients/${entry.patientFhirId}/karte`}>{entry.patientName}</Link>
            ) : (
              (entry.patientName ?? "")
            )}
          </span>
          <span>{entry.specimenLabel ?? ""}</span>
          {entry.cancelled ? (
            <span className="lab-arrival__result">取消済み</span>
          ) : entry.kind === "already" ? (
            <span className="lab-arrival__result">到着済み({entry.message})</span>
          ) : (
            <span className="lab-arrival__result lab-arrival__result--arrived">到着</span>
          )}
          {entry.taskCompleted && !entry.cancelled && (
            <span className="lab-arrival__result lab-arrival__result--completed">
              全検体到着 → 到着済
            </span>
          )}
        </>
      )}
      {entry.warnings.map((warning) => (
        <span key={warning} className="lab-arrival__warning">
          {warning}
        </span>
      ))}
      {entry.kind !== "error" && !entry.cancelled && (
        <button type="button" className="lab-arrival__cancel" onClick={onCancel}>
          取消
        </button>
      )}
    </li>
  );
}
