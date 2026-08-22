import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useKarteLinkState } from "../karteReturn";
import { useCurrentPractitioner } from "../api/authQueries";
import {
  fetchLabArrivalContext,
  fetchLabelSpecimenByNumber,
  useUpdateLabArrival,
  useUpdateLabTaskStatus,
} from "../api/queries";
import { displayJapaneseName } from "../fhir/humanName";
import { groupBySpecimen, labOrderItems, specimenGroupLabel } from "../fhir/labOrderHelpers";
import {
  isValidLabelNumber,
  specimenArrived,
  specimenOrderIdOf,
  specimenTypeCodeOf,
} from "../fhir/labSpecimenHelpers";
import { labTaskStatus } from "../fhir/labTaskHelpers";
import { displayName } from "../fhir/patientHelpers";

// 検体到着確認(docs/lab-arrival-design.md §4-1)。検体ラベルのバーコードを
// スキャンして、採取管 1 本ずつの到着を記録する画面。
//
// 台帳は上流の Specimen リソース(同 §6-1)。スキャンの流れは、番号で管を引き
// (accession 検索)→ オーダー文脈(患者・検査項目・進捗・他の管)を読み →
// 管の receivedTime と、全検体が揃ったときのオーダー進捗(Task → 実施済)を
// 1 つの transaction で書き込む。揃い判定を「今のオーダーの検体グループ」で行うのは、
// 発行後のオーダー訂正(検体の増減)に追従するため。
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
  /** kind=error のときの理由、kind=already のときの記録時刻。 */
  message?: string;
  patientFhirId?: string;
  patientNumber?: string;
  patientName?: string;
  specimenLabel?: string;
  warnings: string[];
  /** このスキャンで全検体が揃い、オーダーを実施済にした。 */
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
  const updateArrival = useUpdateLabArrival();
  const updateTask = useUpdateLabTaskStatus();

  // 到着を記録したユーザー(Specimen のローカル拡張)。医師アカウント以外では省略。
  const { practitionerId, practitioner } = useCurrentPractitioner();
  const recorder = practitionerId
    ? { practitionerId, display: displayJapaneseName(practitioner?.name) }
    : undefined;

  function pushEntry(entry: Omit<FeedEntry, "key" | "time">) {
    keyRef.current += 1;
    setEntries((prev) => [{ ...entry, key: keyRef.current, time: timeLabel(new Date()) }, ...prev]);
  }

  // 到着バッジ・ステータスの表示を追い付かせる(useUpdateLabArrival の invalidate に
  // 加えて、失敗時もエラーバナーではなくフィードで見せるため個別には持たない)。
  function invalidate() {
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

    const specimen = await fetchLabelSpecimenByNumber(number);
    if (!specimen) {
      pushEntry({ number, kind: "error", message: "この番号の発行記録がありません", warnings: [] });
      return;
    }

    const orderId = specimenOrderIdOf(specimen);
    const context = orderId ? await fetchLabArrivalContext(orderId) : null;

    const already = specimenArrived(specimen);
    const entry: Omit<FeedEntry, "key" | "time"> = {
      number,
      kind: already ? "already" : "arrived",
      warnings: [],
    };
    if (already && specimen.receivedTime) {
      entry.message = `${recordedAtLabel(specimen.receivedTime)} に記録済み`;
    }

    let taskUpdate;
    if (!context) {
      entry.warnings.push("オーダーが見つかりません(削除された可能性)");
    } else {
      const { order, itemRequests, patient, task, specimens } = context;
      entry.patientFhirId = patient?.id;
      entry.patientNumber = patient?.identifier?.[0]?.value;
      entry.patientName = patient ? displayName(patient) : undefined;

      const groups = groupBySpecimen(labOrderItems(order, itemRequests));
      const scannedCode = specimenTypeCodeOf(specimen);
      const group = groups.find((g) => g.specimenCode === scannedCode);
      entry.specimenLabel = group ? specimenGroupLabel(group) : scannedCode || "検体未設定";
      if (!group) entry.warnings.push("オーダーにこの検体はありません(訂正で外れた可能性)");

      const status = labTaskStatus(task);
      if (status === "cancelled") entry.warnings.push("このオーダーは中止されています");

      // 今のオーダーの検体グループ全部に到着が付いたら実施済へ。今回の管も織り込む。
      const arrivedCodes = new Set(
        specimens.filter(specimenArrived).map((s) => specimenTypeCodeOf(s)),
      );
      arrivedCodes.add(scannedCode);
      const allArrived = groups.length > 0 && groups.every((g) => arrivedCodes.has(g.specimenCode));
      if (allArrived && status === "accepted") {
        taskUpdate = { order, task, status: "completed" as const };
      }
    }

    if (!already) {
      // 管の到着と進捗を 1 transaction で書き込む。失敗したら記録されていないので、
      // エラーを見せて再スキャンしてもらう。
      await updateArrival.mutateAsync({ specimen, recorder, taskUpdate });
      entry.taskCompleted = Boolean(taskUpdate);
    } else if (taskUpdate) {
      // 二重スキャンでも、前回取りこぼした進捗(全部揃っているのに受付済のまま)は回収する。
      await updateTask.mutateAsync(taskUpdate);
      entry.taskCompleted = true;
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
    } catch {
      pushEntry({
        number,
        kind: "error",
        message: "到着を記録できませんでした(通信エラー)。もう一度スキャンしてください",
        warnings: [],
      });
    } finally {
      setProcessing(false);
      // ハンディスキャナは入力欄にフォーカスがある前提で打ってくるので、必ず戻す。
      inputRef.current?.focus();
    }
  }

  async function handleCancel(entry: FeedEntry) {
    try {
      // 一覧を開いたまま別端末で状態が変わっていることがあるので、管も進捗も引き直す。
      const specimen = await fetchLabelSpecimenByNumber(entry.number);
      if (!specimen) throw new Error("specimen not found");
      const context = await fetchLabArrivalContext(specimenOrderIdOf(specimen));
      // このスキャンで実施済まで進めていた場合は受付済へ戻す。
      const taskUpdate =
        context && labTaskStatus(context.task) === "completed"
          ? { order: context.order, task: context.task, status: "accepted" as const }
          : undefined;
      await updateArrival.mutateAsync({ specimen, cancel: true, taskUpdate });
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
        検体検査一覧のステータスが「実施済」になります。番号は手入力もできます。
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
  // カルテの「戻る」でこの一覧に戻れるように遷移元を渡す。
  const karteLinkState = useKarteLinkState();
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
              <Link to={`/patients/${entry.patientFhirId}/karte`} state={karteLinkState}>{entry.patientName}</Link>
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
              全検体到着 → 実施済
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
