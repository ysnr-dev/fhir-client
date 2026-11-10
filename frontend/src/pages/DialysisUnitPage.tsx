import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useDialysisShifts, useDialysisUnits, useGenerateDialysisSlots, useSaveDialysisUnit } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import {
  MAX_DIALYSIS_BED_ADD,
  MAX_DIALYSIS_SLOT_MONTHS,
  activeDialysisBeds,
  buildAddDialysisBedsBundle,
  buildDialysisBedUpdateBundle,
  buildDialysisUnit,
  buildDialysisUnitUpdateBundle,
  dialysisBedLabel,
  type DialysisUnitGroup,
} from "../fhir/dialysisUnitHelpers";
import { addDays, addMonths, today } from "../lib/dates";

// 透析室の設定(docs/dialysis-order-design.md §5.1)。透析室とベッド(Location)、ベッドごとの枠表(Schedule)を
// 作り、シフト(施設設定)から日 × シフトの枠(Slot)を生成する。ベッド 20 台を 1 台ずつ登録させないための画面。
//
// 無効にしたベッドは枠を作らず、ボードにも出さない。消す操作は置かない(予約と実施がベッドを指している)。

export function DialysisUnitPage() {
  const units = useDialysisUnits();
  const save = useSaveDialysisUnit();
  const [newUnitName, setNewUnitName] = useState("");

  const groups = units.data?.groups ?? [];
  const schedulesByBedId = units.data?.schedulesByBedId ?? new Map<string, fhir4.Schedule>();

  function handleAddUnit(e: FormEvent) {
    e.preventDefault();
    if (!newUnitName.trim()) return;
    save.mutate(
      {
        resourceType: "Bundle",
        type: "transaction",
        entry: [{ resource: buildDialysisUnit(newUnitName), request: { method: "POST", url: "Location" } }],
      },
      { onSuccess: () => setNewUnitName("") },
    );
  }

  return (
    <div className="page dialysis-unit">
      <div className="page__header">
        <h1>透析室の設定</h1>
        <div className="page__header-actions">
          <Link to="/dialysis-worklist" className="button">
            透析一覧
          </Link>
        </div>
      </div>

      <ErrorBanner error={units.error} />
      <ErrorBanner error={save.error} />

      <form className="patient-search-form" onSubmit={handleAddUnit}>
        <label>
          透析室名
          <input type="text" value={newUnitName} onChange={(e) => setNewUnitName(e.target.value)} />
        </label>
        <div className="patient-search-form__actions">
          <button type="submit" disabled={!newUnitName.trim() || save.isPending}>
            透析室追加
          </button>
        </div>
      </form>

      {units.isLoading ? (
        <p>読み込み中...</p>
      ) : groups.length === 0 ? (
        <p className="patient-table__empty">透析室が登録されていません</p>
      ) : (
        groups.map((group) => (
          <UnitSection
            key={group.unit.id}
            group={group}
            schedulesByBedId={schedulesByBedId}
            pending={save.isPending}
            onSave={(bundle) => save.mutate(bundle)}
          />
        ))
      )}

      {groups.length > 0 && (
        <SlotGenerateSection
          schedules={activeDialysisBeds(groups, schedulesByBedId).flatMap((entry) =>
            entry.schedule && entry.schedule.active !== false ? [entry.schedule] : [],
          )}
        />
      )}
    </div>
  );
}

function UnitSection({
  group,
  schedulesByBedId,
  pending,
  onSave,
}: {
  group: DialysisUnitGroup;
  schedulesByBedId: ReadonlyMap<string, fhir4.Schedule>;
  pending: boolean;
  onSave: (bundle: fhir4.Bundle) => void;
}) {
  const { unit, beds } = group;
  const [name, setName] = useState(unit.name ?? "");
  const [active, setActive] = useState(unit.status !== "inactive");
  const [addCount, setAddCount] = useState("1");
  const changed = name.trim() !== (unit.name ?? "") || active !== (unit.status !== "inactive");
  const count = Number(addCount);
  const validCount = Number.isInteger(count) && count >= 1 && count <= MAX_DIALYSIS_BED_ADD;

  return (
    <section className="dialysis-unit__section">
      <div className="patient-search-form">
        <label>
          透析室名
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="dose-conversion__checkbox dialysis-unit__active">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          有効
        </label>
        <div className="patient-search-form__actions">
          <button
            type="button"
            disabled={!changed || !name.trim() || pending}
            onClick={() => onSave(buildDialysisUnitUpdateBundle(unit, beds, schedulesByBedId, { name, active }))}
          >
            保存
          </button>
        </div>
        <label>
          追加台数
          <input
            type="number"
            min={1}
            max={MAX_DIALYSIS_BED_ADD}
            value={addCount}
            onChange={(e) => setAddCount(e.target.value)}
            className="dialysis-unit__count"
          />
        </label>
        <div className="patient-search-form__actions">
          <button
            type="button"
            disabled={!validCount || pending}
            onClick={() => onSave(buildAddDialysisBedsBundle(unit, beds, count))}
          >
            ベッド追加
          </button>
        </div>
      </div>

      <table className="master-search__table dialysis-unit__beds">
        <thead>
          <tr>
            <th>ベッド</th>
            <th className="rad-item__compact">有効</th>
            <th className="rad-item__compact">枠表</th>
            <th className="rad-item__compact"></th>
          </tr>
        </thead>
        <tbody>
          {beds.map((bed) => (
            <BedRow
              key={bed.id}
              bed={bed}
              schedule={schedulesByBedId.get(bed.id ?? "")}
              unitName={unit.name ?? ""}
              pending={pending}
              onSave={onSave}
            />
          ))}
          {beds.length === 0 && (
            <tr>
              <td colSpan={4} className="master-search__empty">
                ベッドがありません
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

function BedRow({
  bed,
  schedule,
  unitName,
  pending,
  onSave,
}: {
  bed: fhir4.Location;
  schedule?: fhir4.Schedule;
  unitName: string;
  pending: boolean;
  onSave: (bundle: fhir4.Bundle) => void;
}) {
  const [name, setName] = useState(dialysisBedLabel(bed));
  const [active, setActive] = useState(bed.status !== "inactive");
  // 枠表を持たないベッドは、保存で枠表を作る。
  const changed = name.trim() !== dialysisBedLabel(bed) || active !== (bed.status !== "inactive") || !schedule;

  return (
    <tr>
      <td>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="ベッド名"
          className="dialysis-unit__bed-name"
        />
      </td>
      <td className="rad-item__compact">
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
          aria-label={`${dialysisBedLabel(bed)} を有効にする`}
        />
      </td>
      <td className="rad-item__compact">
        {schedule?.id ? <Link to={`/schedules/${schedule.id}/slots`}>予約枠カレンダー</Link> : "-"}
      </td>
      <td className="rad-item__compact">
        <button
          type="button"
          className="rp-card__compact-button"
          disabled={!changed || !name.trim() || pending}
          onClick={() => onSave(buildDialysisBedUpdateBundle(bed, schedule, unitName, { name, active }))}
        >
          保存
        </button>
      </td>
    </tr>
  );
}

function SlotGenerateSection({ schedules }: { schedules: fhir4.Schedule[] }) {
  const shifts = useDialysisShifts();
  const generate = useGenerateDialysisSlots();
  const [from, setFrom] = useState(today);
  const [months, setMonths] = useState("1");
  const [message, setMessage] = useState("");
  const monthCount = Number(months);
  const validMonths = Number.isInteger(monthCount) && monthCount >= 1 && monthCount <= MAX_DIALYSIS_SLOT_MONTHS;
  const to = from && validMonths ? addDays(addMonths(from, monthCount), -1) : "";

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!from || !to || schedules.length === 0) return;
    setMessage("");
    generate.mutate(
      { schedules, shifts, from, to },
      { onSuccess: (created) => setMessage(`${created} 件の枠を生成しました。`) },
    );
  }

  return (
    <section className="dialysis-unit__section">
      <h2 className="dialysis-unit__title">枠の生成</h2>
      <p className="order-select__muted">
        {shifts.map((shift) => `${shift.label} ${shift.start}〜${shift.end}`).join(" / ")} / 有効なベッド {schedules.length} 台
        {to && ` / ${from}〜${to}`}
      </p>
      <ErrorBanner error={generate.error} />
      {message && (
        <p className="order-select__muted" role="status">
          {message}
        </p>
      )}
      <form className="patient-search-form" onSubmit={handleSubmit}>
        <label>
          開始日
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} required />
        </label>
        <label>
          月数
          <input
            type="number"
            min={1}
            max={MAX_DIALYSIS_SLOT_MONTHS}
            value={months}
            onChange={(e) => setMonths(e.target.value)}
            className="dialysis-unit__count"
          />
        </label>
        <div className="patient-search-form__actions">
          <button type="submit" disabled={!to || schedules.length === 0 || generate.isPending}>
            {generate.isPending ? "生成中..." : "生成"}
          </button>
        </div>
      </form>
    </section>
  );
}
