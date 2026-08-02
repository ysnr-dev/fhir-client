import { useState, type FormEvent } from "react";
import {
  useCreateMedicineDoseConversion,
  useDeleteMedicineDoseConversion,
  useGenerateMedicineDoseConversions,
  useMedicineDoseConversionSearch,
  useUnmappedMedicineSearch,
  useUpdateMedicineDoseConversion,
  type MedicineDoseConversionFilters,
} from "../api/masterQueries";
import type { MedicineDoseConversion, UnmappedMedicine } from "../api/masterClient";
import { ErrorBanner } from "../components/ErrorBanner";
import { dosageFormLabel } from "../fhir/medicineHelpers";

// 導出根拠の表示名。値は backend の Master::MedicineDoseConversion::SOURCES と対応する。
const SOURCE_LABELS: Record<string, string> = {
  explicit: "規格の力価",
  from_percent: "濃度%から算出",
  volume: "規格の容量",
  identity: "製剤量と同一",
  manual: "手動登録",
};

const DOSAGE_FORM_OPTIONS = [
  { value: "1", label: "内用薬" },
  { value: "4", label: "注射薬" },
  { value: "6", label: "外用薬" },
  { value: "8", label: "歯科用薬剤" },
  { value: "3", label: "その他" },
];

const emptyFilters: MedicineDoseConversionFilters = {
  name: "",
  source: "",
  dosageForm: "",
  needsReview: false,
};

type Tab = "mapped" | "unmapped";

interface Draft {
  factor: string;
  note: string;
}

export function MedicineDoseConversionPage() {
  const [tab, setTab] = useState<Tab>("mapped");
  const [inputs, setInputs] = useState<MedicineDoseConversionFilters>(emptyFilters);
  const [filters, setFilters] = useState<MedicineDoseConversionFilters>(emptyFilters);
  const [page, setPage] = useState(1);
  // 編集中の値。未編集の行はサーバーの値をそのまま表示する。
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  // 未紐付け一覧で入力中の新規換算（医薬品コードごと）。
  const [additions, setAdditions] = useState<Record<string, Draft & { fromUnit: string }>>({});

  const mapped = useMedicineDoseConversionSearch(filters, tab === "mapped" ? page : 1);
  const unmapped = useUnmappedMedicineSearch(filters, page, tab === "unmapped");
  const generate = useGenerateMedicineDoseConversions();
  const create = useCreateMedicineDoseConversion();
  const update = useUpdateMedicineDoseConversion();
  const remove = useDeleteMedicineDoseConversion();

  const data = tab === "mapped" ? mapped.data : unmapped.data;
  const isFetching = tab === "mapped" ? mapped.isFetching : unmapped.isFetching;
  const busy = generate.isPending || create.isPending || update.isPending || remove.isPending;
  const hasNext = data ? page * data.per < data.total : false;

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    setFilters(inputs);
    setPage(1);
  }

  function handleReset() {
    setInputs(emptyFilters);
    setFilters(emptyFilters);
    setPage(1);
  }

  function switchTab(next: Tab) {
    setTab(next);
    setPage(1);
    setDrafts({});
    setAdditions({});
  }

  function draftFor(row: MedicineDoseConversion): Draft {
    return drafts[row.id] ?? { factor: row.factor, note: row.note ?? "" };
  }

  function setDraft(id: number, patch: Partial<Draft>, current: Draft) {
    setDrafts((prev) => ({ ...prev, [id]: { ...current, ...patch } }));
  }

  function isDirty(row: MedicineDoseConversion) {
    const draft = drafts[row.id];
    if (!draft) return false;
    return draft.factor !== row.factor || draft.note !== (row.note ?? "");
  }

  async function handleSave(row: MedicineDoseConversion) {
    const draft = draftFor(row);
    const factor = Number(draft.factor);
    if (!Number.isFinite(factor) || factor <= 0) return;

    await update.mutateAsync({ id: row.id, payload: { factor, note: draft.note || null } });
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[row.id];
      return next;
    });
  }

  function handleDelete(row: MedicineDoseConversion) {
    if (!window.confirm(`${row.medicine_name ?? row.medicine_code} の ${row.from_unit} 換算を削除しますか？`))
      return;
    remove.mutate(row.id);
  }

  function additionFor(medicine: UnmappedMedicine) {
    return additions[medicine.medicine_code] ?? { fromUnit: "", factor: "", note: "" };
  }

  async function handleAdd(medicine: UnmappedMedicine) {
    const addition = additionFor(medicine);
    const factor = Number(addition.factor);
    if (!addition.fromUnit || !Number.isFinite(factor) || factor <= 0) return;

    await create.mutateAsync({
      medicine_code: medicine.medicine_code,
      from_unit: addition.fromUnit,
      factor,
      to_unit: medicine.unit_name,
    });
    setAdditions((prev) => {
      const next = { ...prev };
      delete next[medicine.medicine_code];
      return next;
    });
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>投与量換算マスタ</h1>
        <button type="button" onClick={() => generate.mutate()} disabled={busy}>
          {generate.isPending ? "作成中..." : "未紐付けを一括作成"}
        </button>
      </div>

      <p className="dose-conversion__lead">
        HOTコードマスタの規格単位から、入力単位ごとの換算係数を作ります。入力値 ÷ 係数 =
        医薬品マスタの単位での数量です（例: 係数 20 / 換算先「管」なら 20mL が 1管）。
        一括作成は換算行を1件も持たない医薬品だけが対象で、既存の行は上書きしません。
      </p>

      {generate.isSuccess && (
        <p className="master-import-form__success" role="status">
          {generate.data.created} 件の換算を作成しました（対象医薬品 {generate.data.medicines} 件 /
          作成済みのためスキップ {generate.data.skipped} 件 / 規格を読み取れず未紐付けのまま{" "}
          {generate.data.unmapped} 件 / 要確認 {generate.data.needs_review} 件）
        </p>
      )}

      <div className="dose-conversion__tabs">
        <button
          type="button"
          className={tab === "mapped" ? "dose-conversion__tab is-active" : "dose-conversion__tab"}
          onClick={() => switchTab("mapped")}
        >
          換算一覧
        </button>
        <button
          type="button"
          className={tab === "unmapped" ? "dose-conversion__tab is-active" : "dose-conversion__tab"}
          onClick={() => switchTab("unmapped")}
        >
          未紐付けの医薬品
        </button>
      </div>

      <form className="patient-search-form" onSubmit={handleSearch}>
        <label>
          医薬品名(部分一致)
          <input
            type="text"
            value={inputs.name ?? ""}
            onChange={(e) => setInputs({ ...inputs, name: e.target.value })}
          />
        </label>
        <label>
          剤形
          <select
            value={inputs.dosageForm ?? ""}
            onChange={(e) => setInputs({ ...inputs, dosageForm: e.target.value })}
          >
            <option value="">すべて</option>
            {DOSAGE_FORM_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {tab === "mapped" && (
          <>
            <label>
              導出根拠
              <select
                value={inputs.source ?? ""}
                onChange={(e) => setInputs({ ...inputs, source: e.target.value })}
              >
                <option value="">すべて</option>
                {Object.entries(SOURCE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="dose-conversion__checkbox">
              <input
                type="checkbox"
                checked={inputs.needsReview ?? false}
                onChange={(e) => setInputs({ ...inputs, needsReview: e.target.checked })}
              />
              要確認のみ
            </label>
          </>
        )}
        <div className="patient-search-form__actions">
          <button type="submit">検索</button>
          <button type="button" onClick={handleReset}>
            クリア
          </button>
        </div>
      </form>

      <ErrorBanner error={mapped.error ?? unmapped.error} />
      <ErrorBanner error={generate.error} />
      <ErrorBanner error={create.error} />
      <ErrorBanner error={update.error} />
      <ErrorBanner error={remove.error} />

      <table className="master-search__table dose-conversion__table">
        {tab === "mapped" ? (
          <>
            <thead>
              <tr>
                <th>医薬品名</th>
                <th>剤形</th>
                <th>規格単位</th>
                <th>入力単位</th>
                <th>係数</th>
                <th>換算先</th>
                <th>導出根拠</th>
                <th>備考</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {mapped.data?.items.map((row) => {
                const draft = draftFor(row);
                return (
                  <tr key={row.id} className={row.needs_review ? "dose-conversion__row--review" : ""}>
                    <td>
                      {row.medicine_name ?? row.medicine_code}
                      {row.needs_review && <span className="dose-conversion__badge">要確認</span>}
                    </td>
                    <td>{dosageFormLabel(row.dosage_form)}</td>
                    <td>{row.standard_unit ?? "-"}</td>
                    <td>{row.from_unit}</td>
                    <td>
                      <input
                        type="number"
                        step="any"
                        min="0"
                        className="dose-conversion__factor"
                        value={draft.factor}
                        onChange={(e) => setDraft(row.id, { factor: e.target.value }, draft)}
                      />
                    </td>
                    <td>{row.to_unit}</td>
                    <td>{SOURCE_LABELS[row.source] ?? row.source}</td>
                    <td>
                      <input
                        type="text"
                        value={draft.note}
                        onChange={(e) => setDraft(row.id, { note: e.target.value }, draft)}
                      />
                    </td>
                    <td className="master-search__actions">
                      <button
                        type="button"
                        onClick={() => handleSave(row)}
                        disabled={busy || !isDirty(row)}
                      >
                        保存
                      </button>
                      <button type="button" onClick={() => handleDelete(row)} disabled={busy}>
                        削除
                      </button>
                    </td>
                  </tr>
                );
              })}
              {mapped.data && mapped.data.items.length === 0 && (
                <tr>
                  <td colSpan={9} className="master-search__empty">
                    該当する換算がありません
                  </td>
                </tr>
              )}
            </tbody>
          </>
        ) : (
          <>
            <thead>
              <tr>
                <th>医薬品名</th>
                <th>剤形</th>
                <th>規格単位</th>
                <th>マスタ単位</th>
                <th>入力単位</th>
                <th>係数</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {unmapped.data?.items.map((medicine) => {
                const addition = additionFor(medicine);
                const ready = Boolean(addition.fromUnit) && Number(addition.factor) > 0;
                return (
                  <tr key={medicine.id}>
                    <td>{medicine.name}</td>
                    <td>{dosageFormLabel(medicine.dosage_form)}</td>
                    <td>{medicine.standard_unit ?? "-"}</td>
                    <td>{medicine.unit_name ?? "-"}</td>
                    <td>
                      <input
                        type="text"
                        className="dose-conversion__from-unit"
                        placeholder="mg"
                        value={addition.fromUnit}
                        onChange={(e) =>
                          setAdditions((prev) => ({
                            ...prev,
                            [medicine.medicine_code]: { ...addition, fromUnit: e.target.value },
                          }))
                        }
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="any"
                        min="0"
                        className="dose-conversion__factor"
                        value={addition.factor}
                        onChange={(e) =>
                          setAdditions((prev) => ({
                            ...prev,
                            [medicine.medicine_code]: { ...addition, factor: e.target.value },
                          }))
                        }
                      />
                    </td>
                    <td className="master-search__actions">
                      <button type="button" onClick={() => handleAdd(medicine)} disabled={busy || !ready}>
                        換算を追加
                      </button>
                    </td>
                  </tr>
                );
              })}
              {unmapped.data && unmapped.data.items.length === 0 && (
                <tr>
                  <td colSpan={7} className="master-search__empty">
                    未紐付けの医薬品はありません
                  </td>
                </tr>
              )}
            </tbody>
          </>
        )}
      </table>

      <div className="master-search__pager">
        <button type="button" onClick={() => setPage((p) => p - 1)} disabled={page <= 1 || isFetching}>
          前へ
        </button>
        <span>
          {page} ページ目 (全 {data?.total ?? 0} 件)
        </span>
        <button type="button" onClick={() => setPage((p) => p + 1)} disabled={!hasNext || isFetching}>
          次へ
        </button>
      </div>
    </div>
  );
}
