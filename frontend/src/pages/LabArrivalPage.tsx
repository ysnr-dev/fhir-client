import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useReturnLinkState } from "../returnTo";
import { useCurrentPractitioner } from "../api/authQueries";
import { microOrderItemsQuery, separateContainerCodes } from "../api/masterQueries";
import {
  fetchLabArrivalContext,
  fetchLabelSpecimenByNumber,
  fetchMicroArrivalContext,
  useUpdateLabArrival,
} from "../api/queries";
import { displayJapaneseName } from "../fhir/humanName";
import { groupBySpecimen, labOrderItems, specimenGroupLabel } from "../fhir/labOrderHelpers";
import {
  isValidLabelNumber,
  specimenArrived,
  specimenOrderIdOf,
  specimenTypeCodeOf,
} from "../fhir/labSpecimenHelpers";
import { buildLabTaskUpdate, labTaskStatus } from "../fhir/labTaskHelpers";
import {
  allMicroContainersArrived,
  isMicroContainerSpecimen,
  microContainerKeyOf,
  microContainers,
} from "../fhir/microContainerHelpers";
import { buildMicroTaskUpdate, microOrderStatus } from "../fhir/microTaskHelpers";
import { isPathoContainerSpecimen } from "../fhir/pathoOrderHelpers";
import { displayName } from "../fhir/patientHelpers";

// 検体到着確認(docs/lab-arrival-design.md §4-1)。検体ラベルのバーコードを
// スキャンして、採取管・容器 1 本ずつの到着を記録する画面。検体検査の採取管と
// 細菌検査の容器(docs/micro-order-design.md §7.6)を同じ欄で読む。
//
// 台帳は上流の Specimen リソース(同 §6-1)。スキャンの流れは、番号で管を引き
// (accession 検索)→ オーダー文脈(患者・検査項目・進捗・他の管)を読み →
// 管の receivedTime と、全部が揃ったときのオーダー進捗を 1 つの transaction で書き込む。
// 揃ったときの進捗は、検体検査が実施済(採血・受付側の作業の終わり)、細菌検査が
// 受付済(検査室の手に渡った。報告済は結果の保存で進む)。揃い判定を「今のオーダー
// 内容」で行うのは、発行後のオーダー訂正(検体・項目の増減)に追従するため。
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
  /** このスキャンで全部が揃い、オーダーの進捗を進めた(「全検体到着 → 実施済」)。 */
  progressLabel?: string;
  /** 「取消」で到着の記録を消した行。 */
  cancelled?: boolean;
}

type ScanEntry = Omit<FeedEntry, "key" | "time">;

/** 揃ったときに書く進捗。無ければ進捗は動かさない。 */
interface ArrivalProgress {
  task?: fhir4.Task;
  label?: string;
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

function setPatient(entry: ScanEntry, patient: fhir4.Patient | undefined) {
  entry.patientFhirId = patient?.id;
  entry.patientNumber = patient?.identifier?.[0]?.value;
  entry.patientName = patient ? displayName(patient) : undefined;
}

/** 検体検査の採取管。今のオーダーの検体グループ全部に到着が付いたら実施済へ。 */
async function labArrivalProgress(specimen: fhir4.Specimen, entry: ScanEntry): Promise<ArrivalProgress> {
  const orderId = specimenOrderIdOf(specimen);
  const context = orderId ? await fetchLabArrivalContext(orderId) : null;
  if (!context) {
    entry.warnings.push("オーダーが見つかりません(削除された可能性)");
    return {};
  }
  const { order, itemRequests, patient, task, specimens } = context;
  setPatient(entry, patient);

  const groups = groupBySpecimen(labOrderItems(order, itemRequests));
  const scannedCode = specimenTypeCodeOf(specimen);
  const group = groups.find((g) => g.specimenCode === scannedCode);
  entry.specimenLabel = group ? specimenGroupLabel(group) : scannedCode || "検体未設定";
  if (!group) entry.warnings.push("オーダーにこの検体はありません(訂正で外れた可能性)");

  const status = labTaskStatus(task);
  if (status === "cancelled") entry.warnings.push("このオーダーは中止されています");

  // 今回の管も織り込む。
  const arrivedCodes = new Set(specimens.filter(specimenArrived).map((s) => specimenTypeCodeOf(s)));
  arrivedCodes.add(scannedCode);
  const allArrived = groups.length > 0 && groups.every((g) => arrivedCodes.has(g.specimenCode));
  if (!allArrived || status !== "accepted") return {};
  return { task: buildLabTaskUpdate(task, order, "completed"), label: "全検体到着 → 実施済" };
}

export function LabArrivalPage() {
  const [entries, setEntries] = useState<FeedEntry[]>([]);
  const [input, setInput] = useState("");
  const [processing, setProcessing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const keyRef = useRef(0);
  const queryClient = useQueryClient();
  const updateArrival = useUpdateLabArrival();

  // 到着を記録したユーザー(Specimen のローカル拡張)。医師アカウント以外では省略。
  const { practitionerId, practitioner } = useCurrentPractitioner();
  const recorder = practitionerId
    ? { practitionerId, display: displayJapaneseName(practitioner?.name) }
    : undefined;

  function pushEntry(entry: ScanEntry) {
    keyRef.current += 1;
    setEntries((prev) => [{ ...entry, key: keyRef.current, time: timeLabel(new Date()) }, ...prev]);
  }

  // 別容器の検査項目(血液培養のボトル)のコード。容器の組み立てに要るので、スキャンの
  // 処理の中で確実に読む(マスタは画面を開いている間ほぼ変わらないのでキャッシュを使う)。
  async function microSeparateCodes() {
    return separateContainerCodes((await queryClient.fetchQuery(microOrderItemsQuery)).items);
  }

  /** 細菌検査の容器。今のオーダーの容器全部に到着が付いたら受付済へ。 */
  async function microArrivalProgress(specimen: fhir4.Specimen, entry: ScanEntry): Promise<ArrivalProgress> {
    const orderId = specimenOrderIdOf(specimen);
    const context = orderId ? await fetchMicroArrivalContext(orderId) : null;
    if (!context) {
      entry.warnings.push("オーダーが見つかりません(削除された可能性)");
      return {};
    }
    setPatient(entry, context.patient);

    const containers = microContainers(context.itemRequests, await microSeparateCodes(), context.containers);
    const key = microContainerKeyOf(specimen);
    const container = containers.find((c) => c.key === key);
    entry.specimenLabel =
      container?.label || specimen.container?.[0]?.description || specimen.type?.text || "検体未設定";
    if (!container) entry.warnings.push("オーダーにこの容器はありません(訂正で外れた可能性)");

    const status = microOrderStatus(context.task, context.reportStatus);
    if (status === "cancelled") entry.warnings.push("このオーダーは中止されています");
    if (!container || status !== "requested" || !allMicroContainersArrived(containers, key)) return {};
    return { task: buildMicroTaskUpdate(context.task, context.order, "accepted"), label: "全容器到着 → 受付済" };
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
    // 病理の容器も同じ番号の体系で刷るので、取り違えて読んだら到着にしない。
    if (isPathoContainerSpecimen(specimen)) {
      pushEntry({ number, kind: "error", message: "病理検査の検体です(病理の受付で読んでください)", warnings: [] });
      return;
    }
    const micro = isMicroContainerSpecimen(specimen);
    // 項目を外して刷り直す前のラベル。到着を書くと取り下げが解けてしまうので記録しない。
    if (micro && specimen.status === "entered-in-error") {
      pushEntry({
        number,
        kind: "error",
        message: "取り下げたラベルです(刷り直したラベルを読んでください)",
        warnings: [],
      });
      return;
    }

    const already = specimenArrived(specimen);
    const entry: ScanEntry = { number, kind: already ? "already" : "arrived", warnings: [] };
    if (already && specimen.receivedTime) {
      entry.message = `${recordedAtLabel(specimen.receivedTime)} に記録済み`;
    }

    const progress = micro
      ? await microArrivalProgress(specimen, entry)
      : await labArrivalProgress(specimen, entry);

    if (!already) {
      // 管の到着と進捗を 1 transaction で書き込む。失敗したら記録されていないので、
      // エラーを見せて再スキャンしてもらう。
      await updateArrival.mutateAsync({ specimen, recorder, task: progress.task });
      entry.progressLabel = progress.label;
    } else if (progress.task) {
      // 二重スキャンでも、前回取りこぼした進捗(全部揃っているのに進んでいない)は回収する。
      await updateArrival.mutateAsync({ task: progress.task });
      entry.progressLabel = progress.label;
    }

    pushEntry(entry);
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

  // 到着の取消で戻す進捗。揃って進めた進捗を 1 つ前へ戻す(検体検査は実施済 → 受付済、
  // 細菌検査は受付済 → 依頼済。結果が付いた細菌検査は検体が届いているので戻さない)。
  async function cancelProgress(specimen: fhir4.Specimen): Promise<fhir4.Task | undefined> {
    const orderId = specimenOrderIdOf(specimen);
    if (isMicroContainerSpecimen(specimen)) {
      const context = await fetchMicroArrivalContext(orderId);
      if (!context?.task || context.reportStatus || context.task.status !== "accepted") return undefined;
      return buildMicroTaskUpdate(context.task, context.order, "requested");
    }
    const context = await fetchLabArrivalContext(orderId);
    if (!context || labTaskStatus(context.task) !== "completed") return undefined;
    return buildLabTaskUpdate(context.task, context.order, "accepted");
  }

  async function handleCancel(entry: FeedEntry) {
    try {
      // 一覧を開いたまま別端末で状態が変わっていることがあるので、管も進捗も引き直す。
      const specimen = await fetchLabelSpecimenByNumber(entry.number);
      if (!specimen) throw new Error("specimen not found");
      await updateArrival.mutateAsync({ specimen, cancel: true, task: await cancelProgress(specimen) });
      setEntries((prev) =>
        prev.map((e) => (e.key === entry.key ? { ...e, cancelled: true } : e)),
      );
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
        検体検査一覧のステータスは「実施済」、細菌検査一覧は「受付済」になります。番号は手入力もできます。
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
  const returnLinkState = useReturnLinkState();
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
              <Link to={`/patients/${entry.patientFhirId}/karte`} state={returnLinkState}>{entry.patientName}</Link>
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
          {entry.progressLabel && !entry.cancelled && (
            <span className="lab-arrival__result lab-arrival__result--completed">{entry.progressLabel}</span>
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
