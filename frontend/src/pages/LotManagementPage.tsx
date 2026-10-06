import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useLotRecordSearch, useMissingLotRecords, useRegisterLotNumber } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { LotNumberCell } from "../components/LotNumberCell";
import { Modal } from "../components/Modal";
import { TruncatedNotice } from "../components/TruncatedNotice";
import { lotRecordCsv, type LotRecordRow } from "../fhir/lotManagementHelpers";
import { normalizeLotNumber } from "../fhir/lotNumberHelpers";
import { addDays, today } from "../lib/dates";
import { downloadBlob } from "../lib/download";

// ロット管理(docs/lot-number-design.md)。特定生物由来製品などのロット番号から投与した患者を
// 逆引きする「ロット検索」と、ロット管理の薬でロットが入っていない投与を拾って後から入れる
// 「ロット未入力」。

type Tab = "search" | "missing";

const MISSING_DEFAULT_DAYS = 30;

export function LotManagementPage() {
  const [tab, setTab] = useState<Tab>("search");

  return (
    <div className="page">
      <div className="page__header">
        <h1>ロット管理</h1>
      </div>
      <div className="inpatient-tabs" role="tablist" aria-label="ロット管理の表示切替">
        {(
          [
            { key: "search", label: "ロット検索" },
            { key: "missing", label: "ロット未入力" },
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
      {tab === "search" ? <LotSearchTab /> : <MissingLotTab />}
    </div>
  );
}

function LotSearchTab() {
  const [input, setInput] = useState("");
  const [exact, setExact] = useState(false);
  const [query, setQuery] = useState({ lot: "", exact: false });
  const search = useLotRecordSearch(query.lot, query.exact);
  const rows = search.data?.items ?? [];

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setQuery({ lot: normalizeLotNumber(input), exact });
  }

  return (
    <>
      <form className="patient-search-form" onSubmit={handleSubmit}>
        <label>
          ロット番号
          <input type="text" value={input} autoComplete="off" onChange={(e) => setInput(e.target.value)} />
        </label>
        <label className="dose-conversion__checkbox">
          <input type="checkbox" checked={exact} onChange={(e) => setExact(e.target.checked)} />
          完全一致
        </label>
        <div className="patient-search-form__actions">
          <button type="submit" disabled={!normalizeLotNumber(input)}>
            検索
          </button>
          <button
            type="button"
            disabled={rows.length === 0}
            onClick={() => downloadBlob(lotRecordCsv(rows), `lot_${query.lot}_${today()}.csv`)}
          >
            CSV
          </button>
        </div>
      </form>
      <ErrorBanner error={search.error} />
      <TruncatedNotice show={search.data?.truncated} />
      {query.lot && (
        <LotRecordTable
          rows={rows}
          loading={search.isFetching}
          emptyLabel="該当する投与がありません"
        />
      )}
    </>
  );
}

function MissingLotTab() {
  const [range, setRange] = useState(() => ({ from: addDays(today(), -MISSING_DEFAULT_DAYS), to: today() }));
  const [inputs, setInputs] = useState(range);
  const missing = useMissingLotRecords(range.from, range.to);
  const [entering, setEntering] = useState<LotRecordRow | null>(null);
  const rows = missing.data?.items ?? [];

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setRange(inputs);
  }

  return (
    <>
      <form className="patient-search-form" onSubmit={handleSubmit}>
        <label>
          実施日(から)
          <input type="date" value={inputs.from} onChange={(e) => setInputs({ ...inputs, from: e.target.value })} />
        </label>
        <label>
          実施日(まで)
          <input type="date" value={inputs.to} onChange={(e) => setInputs({ ...inputs, to: e.target.value })} />
        </label>
        <div className="patient-search-form__actions">
          <button type="submit" disabled={!inputs.from || !inputs.to}>
            検索
          </button>
        </div>
      </form>
      <ErrorBanner error={missing.error} />
      <TruncatedNotice show={missing.data?.truncated} />
      <LotRecordTable
        rows={rows}
        loading={missing.isFetching}
        emptyLabel="ロット未入力の投与はありません"
        onEnter={setEntering}
      />
      {entering && <LotEntryModal row={entering} onClose={() => setEntering(null)} />}
    </>
  );
}

function LotRecordTable({
  rows,
  loading,
  emptyLabel,
  onEnter,
}: {
  rows: LotRecordRow[];
  loading: boolean;
  emptyLabel: string;
  /** 渡すと行に「ロット入力」を出す(未入力一覧)。 */
  onEnter?: (row: LotRecordRow) => void;
}) {
  return (
    <>
      <table className="master-search__table lot-management__table">
        <thead>
          <tr>
            <th>実施日時</th>
            <th>患者番号</th>
            <th>氏名</th>
            <th>種別</th>
            <th>医薬品</th>
            <th>量</th>
            {!onEnter && <th>ロット番号</th>}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.administration.id}>
              <td className="lot-management__nowrap">{row.performedAt}</td>
              <td className="lot-management__nowrap">{row.patientNumber || "-"}</td>
              <td className="lot-management__nowrap">{row.patientName || "-"}</td>
              <td className="lot-management__nowrap">{row.kind || "-"}</td>
              <td>{row.medicineName}</td>
              <td className="lot-management__nowrap">{row.dose || "-"}</td>
              {!onEnter && <td className="lot-management__nowrap">{row.lotNumber}</td>}
              <td className="master-search__actions">
                {onEnter && (
                  <button type="button" className="rp-card__compact-button" onClick={() => onEnter(row)}>
                    ロット入力
                  </button>
                )}
                {row.patientId && (
                  <Link className="button rp-card__compact-button" to={`/patients/${row.patientId}/karte`}>
                    カルテ
                  </Link>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && !loading && (
            <tr>
              <td colSpan={onEnter ? 7 : 8} className="master-search__empty">
                {emptyLabel}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {rows.length > 0 && <p className="order-select__muted lab-worklist__count">{rows.length} 件</p>}
    </>
  );
}

function LotEntryModal({ row, onClose }: { row: LotRecordRow; onClose: () => void }) {
  const [lotNumber, setLotNumber] = useState("");
  const register = useRegisterLotNumber();

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const lot = normalizeLotNumber(lotNumber);
    if (!lot) return;
    register.mutate({ administration: row.administration, lotNumber: lot }, { onSuccess: onClose });
  }

  return (
    <Modal title="ロット入力" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <ErrorBanner error={register.error} />
        <dl className="lot-management__summary">
          <dt>実施日時</dt>
          <dd>{row.performedAt}</dd>
          <dt>患者</dt>
          <dd>{`${row.patientNumber} ${row.patientName}`}</dd>
          <dt>医薬品</dt>
          <dd>{`${row.medicineName} ${row.dose}`}</dd>
          <dt>ロット番号</dt>
          <dd>
            <LotNumberCell required value={lotNumber} medicineName={row.medicineName} onChange={setLotNumber} />
          </dd>
        </dl>
        <div className="lab-order-item__actions">
          <button type="submit" disabled={register.isPending || !normalizeLotNumber(lotNumber)}>
            {register.isPending ? "保存中..." : "登録"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
