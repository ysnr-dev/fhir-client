import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import {
  fetchContainerByLabelNumber,
  fetchPathoReceptionContext,
  useReceivePathoOrder,
  type PathoReceptionContext,
} from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { PatientKana } from "../components/PatientRowCells";
import { isValidLabelNumber } from "../fhir/labSpecimenHelpers";
import { orderContextSummary, orderRequester } from "../fhir/orderHeader";
import { summarizePathoOrder } from "../fhir/pathoOrderHelpers";
import {
  containerKeyOf,
  containerOrderIdOf,
  expectedPathoContainers,
  isPathoContainerSpecimen,
  isRetiredContainer,
  pathoAccessionNumber,
} from "../fhir/pathoReceptionHelpers";
import { pathoTaskStatus, pathoTaskStatusDisplay } from "../fhir/pathoTaskHelpers";
import { displayName, patientNumberOf } from "../fhir/patientHelpers";
import { dateTimeLabel } from "../lib/dates";

// 病理受付(JAHIS 患者安全ガイド 病理編 7.2。docs/patho-order-design.md §4.11)。
//
// 届いた容器のラベルを 1 つずつ読み、オーダーの容器と過不足なく揃ったときだけ「受付」を押せる。
// 最初に読んだラベルのオーダーが照合の対象になり、別のオーダー・別の患者のラベル、取り下げたラベル、
// 検体検査のラベルを読んだら警告して照合には入れない(ガイド 7.2.3「誤った検体ラベルを読み取った時は
// アラートを出す機能が必須」)。病理検査一覧の「受付」から開くと、そのオーダーを照合の対象にして始める。

interface FeedEntry {
  key: number;
  time: string;
  number: string;
  kind: "read" | "info" | "error" | "received";
  message: string;
}

function timeLabel(): string {
  return new Date().toLocaleTimeString("ja-JP", { hour12: false });
}

export function PathoReceptionPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [input, setInput] = useState("");
  const [processing, setProcessing] = useState(false);
  const [context, setContext] = useState<PathoReceptionContext | null>(null);
  const [scanned, setScanned] = useState<ReadonlySet<string>>(new Set());
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [alert, setAlert] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const feedKey = useRef(0);
  const receive = useReceivePathoOrder();

  // 一覧の「受付」から開いたときは、そのオーダーを照合の対象にしておく(ラベルを読むまで受付はできない)。
  const preloadOrderId = searchParams.get("order") ?? "";
  useEffect(() => {
    if (!preloadOrderId) return;
    let alive = true;
    fetchPathoReceptionContext(preloadOrderId)
      .then((loaded) => {
        if (alive) setContext(loaded);
      })
      .catch((error: unknown) => {
        if (alive) setLoadError(error);
      });
    return () => {
      alive = false;
    };
  }, [preloadOrderId]);

  const expected = useMemo(() => (context ? expectedPathoContainers(context.itemRequests) : []), [context]);
  const containerByKey = useMemo(() => {
    const map = new Map<string, fhir4.Specimen>();
    for (const specimen of context?.containers ?? []) {
      if (!isRetiredContainer(specimen)) map.set(containerKeyOf(specimen), specimen);
    }
    return map;
  }, [context]);
  const status = pathoTaskStatus(context?.task);
  const unissued = expected.filter((container) => !containerByKey.has(container.key));
  const readCount = expected.filter((container) => scanned.has(container.key)).length;
  const canReceive =
    Boolean(context) &&
    status === "requested" &&
    expected.length > 0 &&
    unissued.length === 0 &&
    readCount === expected.length;

  function pushEntry(entry: Omit<FeedEntry, "key" | "time">) {
    feedKey.current += 1;
    const next = { ...entry, key: feedKey.current, time: timeLabel() };
    setFeed((current) => [next, ...current].slice(0, 50));
    setAlert(entry.kind === "error" ? entry.message : null);
  }

  function reset() {
    setContext(null);
    setScanned(new Set());
    setAlert(null);
    setLoadError(null);
    if (preloadOrderId) setSearchParams({});
    inputRef.current?.focus();
  }

  async function handleScan(number: string) {
    if (!isValidLabelNumber(number)) {
      pushEntry({ number, kind: "error", message: "番号の形式が正しくありません(読み取りエラーの可能性)" });
      return;
    }
    const specimen = await fetchContainerByLabelNumber(number);
    if (!specimen) {
      pushEntry({ number, kind: "error", message: "この番号の発行記録がありません" });
      return;
    }
    if (!isPathoContainerSpecimen(specimen)) {
      pushEntry({ number, kind: "error", message: "検体検査の検体です(病理のラベルではありません)" });
      return;
    }
    if (isRetiredContainer(specimen)) {
      pushEntry({ number, kind: "error", message: "取り下げられたラベルです(容器数の変更で刷り直されています)" });
      return;
    }

    const orderId = containerOrderIdOf(specimen);
    let current = context;
    if (current && current.order.id !== orderId) {
      const other = await fetchPathoReceptionContext(orderId);
      const samePatient = other?.order.subject?.reference === current.order.subject?.reference;
      const name = other?.patient ? displayName(other.patient) : "";
      pushEntry({
        number,
        kind: "error",
        message: samePatient
          ? "同じ患者の別のオーダーのラベルです(照合中のオーダーには入れません)"
          : `別の患者${name ? `(${name})` : ""}のラベルです`,
      });
      return;
    }
    if (!current) {
      current = await fetchPathoReceptionContext(orderId);
      if (!current) {
        pushEntry({ number, kind: "error", message: "このラベルのオーダーが見つかりません(削除された可能性)" });
        return;
      }
      setContext(current);
    }

    const containers = expectedPathoContainers(current.itemRequests);
    const key = containerKeyOf(specimen);
    const container = containers.find((c) => c.key === key);
    if (!container) {
      pushEntry({ number, kind: "error", message: "オーダーの容器に当たらないラベルです(刷り直し前の可能性)" });
      return;
    }
    const currentStatus = pathoTaskStatus(current.task);
    if (currentStatus === "cancelled") {
      pushEntry({ number, kind: "error", message: "中止されたオーダーです" });
      return;
    }
    if (currentStatus !== "requested") {
      const accession = pathoAccessionNumber(current.order);
      pushEntry({
        number,
        kind: "info",
        message: `受付済のオーダーです${accession ? `(病理受付番号 ${accession})` : ""}`,
      });
      return;
    }
    if (scanned.has(key)) {
      pushEntry({ number, kind: "info", message: `容器 ${container.number}/${containers.length} は読取済みです` });
      return;
    }
    setScanned((previous) => new Set(previous).add(key));
    pushEntry({
      number,
      kind: "read",
      message: `容器 ${container.number}/${containers.length} 検体${container.specimenNumber} ${container.organ}`,
    });
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
      pushEntry({ number, kind: "error", message: "読み取れませんでした(通信エラー)。もう一度読んでください" });
    } finally {
      setProcessing(false);
      inputRef.current?.focus();
    }
  }

  function handleReceive() {
    if (!context || !canReceive) return;
    const containers = expected.flatMap((container) => {
      const specimen = containerByKey.get(container.key);
      return specimen ? [specimen] : [];
    });
    receive.mutate(
      { order: context.order, task: context.task, containers },
      {
        onSuccess: (accession) => {
          const name = context.patient ? displayName(context.patient) : "";
          pushEntry({ number: "", kind: "received", message: `受付しました ${name} 病理受付番号 ${accession}` });
          setContext(null);
          setScanned(new Set());
          if (preloadOrderId) setSearchParams({});
          inputRef.current?.focus();
        },
      },
    );
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>病理受付</h1>
      </div>

      <form className="lab-arrival__scan" onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="ラベルのバーコードを読む(11桁)"
          aria-label="ラベル番号"
          disabled={processing}
        />
        <button type="submit" disabled={processing || !input.trim()}>
          読取
        </button>
      </form>

      {alert && (
        <div className="error-banner patho-reception__alert" role="alert">
          <p className="error-banner__line error-banner__line--error">{alert}</p>
        </div>
      )}
      <ErrorBanner error={loadError} />
      <ErrorBanner error={receive.error} />

      {context && (
        <section className="patho-reception__order">
          <dl className="prescription-detail__common">
            <dt>患者</dt>
            <dd>
              {context.patient ? (
                <>
                  {`${patientNumberOf(context.patient)} ${displayName(context.patient)}`}
                  <PatientKana patient={context.patient} />
                  {` ${context.patient.birthDate ?? ""}`}
                </>
              ) : (
                "-"
              )}
            </dd>
            <dt>検査</dt>
            <dd>
              {[
                summarizePathoOrder(context.order).examCategoryDisplay,
                dateTimeLabel(context.order.occurrenceDateTime),
                orderContextSummary(orderRequester(context.order)),
              ]
                .filter(Boolean)
                .join("  ")}
            </dd>
            <dt>進捗</dt>
            <dd>
              {pathoTaskStatusDisplay(status)}
              {pathoAccessionNumber(context.order) && ` 病理受付番号 ${pathoAccessionNumber(context.order)}`}
            </dd>
          </dl>

          <table className="rp-card__medicines rp-card__medicines--patho patho-reception__containers">
            <thead>
              <tr>
                <th>容器</th>
                <th>検体</th>
                <th>ラベル番号</th>
                <th>照合</th>
              </tr>
            </thead>
            <tbody>
              {expected.map((container) => {
                const specimen = containerByKey.get(container.key);
                const read = scanned.has(container.key);
                return (
                  <tr key={container.key} className={read ? "patho-reception__row--read" : undefined}>
                    <td>{`${container.number}/${expected.length}`}</td>
                    <td>{`検体${container.specimenNumber} ${container.organ}`}</td>
                    <td>{specimen?.accessionIdentifier?.value ?? <span className="patho-reception__pending">ラベル未発行</span>}</td>
                    <td>{read ? "済" : <span className="patho-reception__pending">未</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="patho-reception__actions">
            <span className="patho-reception__count">{`照合 ${readCount}/${expected.length}`}</span>
            <button type="button" disabled={!canReceive || receive.isPending} onClick={handleReceive}>
              {receive.isPending ? "送信中..." : "受付"}
            </button>
            <button type="button" className="rp-card__compact-button" onClick={reset}>
              やり直し
            </button>
          </div>
        </section>
      )}

      <ul className="lab-arrival__feed">
        {feed.map((entry) => (
          <li key={entry.key}>
            <span className="lab-arrival__time order-select__muted">{entry.time}</span>
            {entry.number && <span className="lab-arrival__number">{entry.number}</span>}
            <span
              className={`lab-arrival__result${
                entry.kind === "error"
                  ? " lab-arrival__result--error"
                  : entry.kind === "read"
                    ? " lab-arrival__result--arrived"
                    : entry.kind === "received"
                      ? " lab-arrival__result--completed"
                      : ""
              }`}
            >
              {entry.message}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
