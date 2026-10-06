import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useCurrentPractitioner } from "../api/authQueries";
import { useFastingDietCodes } from "../api/masterQueries";
import {
  useBulkVitalContext,
  useFacilitySettings,
  useInpatientEncounters,
  useSaveBulkVitals,
  useVitalThresholds,
  useWardGrid,
  useWardOptions,
} from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { TruncatedNotice } from "../components/TruncatedNotice";
import {
  BULK_VITAL_ITEM_LABELS,
  DEFAULT_BULK_VITAL_ENTRY,
  DIASTOLIC_CODE,
  SYSTOLIC_CODE,
  buildBulkVitalBundle,
  bulkMealCellsByPatient,
  bulkVitalRowError,
  isBulkRowDirty,
  isSingleVitalItem,
  latestHeightsByPatient,
  mealDietCodes,
  mealExistingInput,
  mealTimingAt,
  singleVitalColumn,
  type BulkMealCell,
  type BulkVitalField,
  type BulkVitalInput,
  type BulkVitalItem,
  type BulkVitalRow,
} from "../fhir/bulkVitalHelpers";
import { encounterPatientId } from "../fhir/encounterHelpers";
import { MEAL_INTAKE_ROWS, MEAL_INTAKE_STEPS, mealIntakeSlotLabel } from "../fhir/flowsheetMealHelpers";
import { interpretationClass } from "../fhir/labResultHelpers";
import { locationDisplayName } from "../fhir/locationHelpers";
import { MEAL_TIMING_OPTIONS, type MealTiming } from "../fhir/mealOrderHelpers";
import { displayName } from "../fhir/patientHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { vitalInterpretationOf, type VitalThresholdSettings } from "../fhir/vitalHelpers";
import { nowDateTimeInput } from "../lib/dates";

// 経過表一括入力。病棟の入院中の患者を病室順に 1 行ずつ並べ、同じ測定日時でバイタル・体重・
// 食事摂取量をまとめて登録する(fhir/bulkVitalHelpers.ts)。出す列は施設設定で選ぶ。
//
// 値を入れた行だけを登録する。食事は記録済みの値を初期値に出し、変えた行だけを書く。

const EMPTY_INPUT: BulkVitalInput = {
  systolic: "",
  diastolic: "",
  temperature: "",
  pulse: "",
  spo2: "",
  respiration: "",
  weight: "",
  staple: "",
  side: "",
};

interface PatientRow {
  key: string;
  roomName: string;
  bedName: string;
  patientId: string;
  patientName: string;
  encounter: fhir4.Encounter;
}

export function BulkVitalEntryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const wardId = searchParams.get("ward") ?? "";
  const [measuredAt, setMeasuredAt] = useState(nowDateTimeInput);
  const [timing, setTiming] = useState<MealTiming>(() => mealTimingAt(nowDateTimeInput().slice(11, 16)));
  // 患者ごとに手で入れた値。食事の欄は入れていなければ記録済みの値を出す。
  const [edits, setEdits] = useState<Map<string, Partial<BulkVitalInput>>>(new Map());
  const [savedCount, setSavedCount] = useState<number | null>(null);

  const date = measuredAt.slice(0, 10);
  const wardOptions = useWardOptions();
  const grid = useWardGrid(wardId || undefined);
  const inpatients = useInpatientEncounters(date);
  const facility = useFacilitySettings();
  const items = facility.data?.bulk_vital_entry.items ?? DEFAULT_BULK_VITAL_ENTRY.items;
  const thresholds = useVitalThresholds();
  const { practitionerId, practitioner } = useCurrentPractitioner();
  const save = useSaveBulkVitals();

  // 列が多いのでこの画面だけ幅を広げる(他の病棟の一覧と同じ)。
  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  // 病棟が未指定なら先頭の病棟を開く(入院患者一覧と同じ)。
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current || wardId) return;
    const first = wardOptions.wards[0];
    if (!first?.id) return;
    initialized.current = true;
    setSearchParams({ ward: first.id }, { replace: true });
  }, [wardId, wardOptions.wards, setSearchParams]);

  const rows = useMemo<PatientRow[]>(() => {
    const byBed = inpatients.data?.byBed;
    const patientsById = inpatients.data?.patientsById;
    return grid.rooms.flatMap((room) =>
      (grid.bedsByRoom.get(room.id ?? "") ?? []).flatMap((bed) => {
        const encounter = bed.id ? byBed?.get(bed.id) : undefined;
        const patientId = encounter ? encounterPatientId(encounter) : undefined;
        if (!encounter || !patientId) return [];
        const patient = patientsById?.get(patientId);
        return [
          {
            key: `${bed.id}/${patientId}`,
            roomName: locationDisplayName(room),
            bedName: locationDisplayName(bed),
            patientId,
            patientName: patient ? displayName(patient) : "(患者不明)",
            encounter,
          },
        ];
      }),
    );
  }, [grid.rooms, grid.bedsByRoom, inpatients.data]);

  const patientIds = useMemo(() => rows.map((row) => row.patientId), [rows]);
  const context = useBulkVitalContext(patientIds, date);
  const mealEnabled = items.includes("meal");
  const dietCodes = mealDietCodes(context.data?.mealOrders ?? []);
  const fasting = useFastingDietCodes(dietCodes);
  const mealReady = !mealEnabled || (context.isSuccess && (dietCodes.length === 0 || fasting.isSuccess));

  const mealCells = useMemo(
    () =>
      context.data && mealEnabled
        ? bulkMealCellsByPatient({
            orders: context.data.mealOrders,
            observations: context.data.mealObservations,
            date,
            timing,
            fastingDietCodes: fasting.data ?? new Set<string>(),
          })
        : new Map<string, BulkMealCell>(),
    [context.data, mealEnabled, date, timing, fasting.data],
  );
  const heights = useMemo(
    () => latestHeightsByPatient(context.data?.heights ?? []),
    [context.data],
  );

  function inputOf(patientId: string): BulkVitalInput {
    const cell = mealCells.get(patientId);
    return {
      ...EMPTY_INPUT,
      staple: mealExistingInput(cell, "staple"),
      side: mealExistingInput(cell, "side"),
      ...edits.get(patientId),
    };
  }

  function updateInput(patientId: string, field: BulkVitalField, value: string) {
    setSavedCount(null);
    setEdits((prev) => new Map(prev).set(patientId, { ...prev.get(patientId), [field]: value }));
  }

  // 食事の欄は日と時間帯で指す食事が変わるので、手で入れた値を捨てて記録済みの値に戻す。
  function discardMealEdits() {
    setEdits((prev) => {
      const next = new Map<string, Partial<BulkVitalInput>>();
      for (const [patientId, edit] of prev) {
        const { staple: _staple, side: _side, ...rest } = edit;
        next.set(patientId, rest);
      }
      return next;
    });
  }

  function changeMeasuredAt(value: string) {
    if (value.slice(0, 10) !== date) discardMealEdits();
    setMeasuredAt(value);
  }

  function changeTiming(value: MealTiming) {
    discardMealEdits();
    setTiming(value);
  }

  const dirtyRows = rows.filter((row) => isBulkRowDirty(inputOf(row.patientId), mealCells.get(row.patientId)));
  const hasError = dirtyRows.some((row) => bulkVitalRowError(inputOf(row.patientId)) !== null);

  function handleSave() {
    if (!measuredAt || dirtyRows.length === 0 || hasError || !mealReady) return;
    const bundleRows: BulkVitalRow[] = dirtyRows.map((row) => ({
      patientId: row.patientId,
      encounter: { reference: `Encounter/${row.encounter.id}` },
      input: inputOf(row.patientId),
      meal: mealCells.get(row.patientId),
      fallbackHeightCm: heights.get(row.patientId),
    }));
    const bundle = buildBulkVitalBundle({
      measuredAt,
      rows: bundleRows,
      performer: practitionerId
        ? { id: practitionerId, name: practitioner ? practitionerDisplayName(practitioner) : "" }
        : null,
    });
    if ((bundle.entry ?? []).length === 0) return;
    save.mutate(bundle, {
      onSuccess: () => {
        setSavedCount(bundleRows.length);
        setEdits(new Map());
      },
    });
  }

  const loading = grid.isLoading || inpatients.isLoading;

  return (
    <div className="page">
      <div className="page__header">
        <h1>経過表一括入力</h1>
        <div className="page__header-actions">
          <Link className="button" to={wardId ? `/inpatients?ward=${wardId}` : "/inpatients"}>
            入院患者一覧
          </Link>
        </div>
      </div>

      <form className="patient-search-form" onSubmit={(e: FormEvent) => e.preventDefault()}>
        <label>
          病棟
          <select
            value={wardId}
            onChange={(e) => {
              setEdits(new Map());
              setSearchParams({ ward: e.target.value });
            }}
          >
            {wardOptions.wards.map((ward) => (
              <option key={ward.id} value={ward.id}>
                {locationDisplayName(ward)}
              </option>
            ))}
          </select>
        </label>
        <label>
          測定日時
          <input
            type="datetime-local"
            value={measuredAt}
            onChange={(e) => changeMeasuredAt(e.target.value)}
          />
        </label>
        {mealEnabled && (
          <label>
            食事
            <select value={timing} onChange={(e) => changeTiming(e.target.value as MealTiming)}>
              {MEAL_TIMING_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.display}
                </option>
              ))}
            </select>
          </label>
        )}
      </form>

      <ErrorBanner error={wardOptions.error ?? grid.error ?? inpatients.error} />
      <ErrorBanner error={context.error ?? fasting.error} />
      <ErrorBanner error={save.error} />
      <TruncatedNotice show={inpatients.data?.truncated} />

      {!wardId ? (
        <p className="patient-table__empty">病棟を選んでください。</p>
      ) : loading ? (
        <p>読み込み中...</p>
      ) : rows.length === 0 ? (
        <p className="patient-table__empty">入院中の患者がいません。</p>
      ) : (
        <>
          <div className="lab-worklist-wrap">
            <table className="lab-worklist bulk-vital">
              <thead>
                <tr>
                  <th className="lab-worklist__compact">病室</th>
                  <th>患者</th>
                  {items.map((item) => (
                    <th key={item} className="bulk-vital__head">
                      {item === "meal"
                        ? `${BULK_VITAL_ITEM_LABELS.meal}(${MEAL_TIMING_OPTIONS.find((o) => o.code === timing)?.display})`
                        : BULK_VITAL_ITEM_LABELS[item]}
                      {isSingleVitalItem(item) && (
                        <span className="bulk-vital__unit">{singleVitalColumn(item).unit}</span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const input = inputOf(row.patientId);
                  const cell = mealCells.get(row.patientId);
                  const dirty = isBulkRowDirty(input, cell);
                  const error = dirty ? bulkVitalRowError(input) : null;
                  const rowClass = [
                    dirty ? "bulk-vital__row--dirty" : "",
                    error ? "bulk-vital__row--has-error" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  // エラーは行の下に表の幅いっぱいで出す(列に置くと文言の長さで他の列の幅が変わる)。
                  return (
                    <Fragment key={row.key}>
                      <tr className={rowClass || undefined}>
                        <td className="lab-worklist__compact">
                          {row.roomName} {row.bedName}
                        </td>
                        <td>{row.patientName}</td>
                        {items.map((item) => (
                          <td key={item}>
                            <ItemInputs
                              item={item}
                              input={input}
                              cell={cell}
                              mealReady={mealReady}
                              thresholds={thresholds}
                              label={row.patientName}
                              onChange={(field, value) => updateInput(row.patientId, field, value)}
                            />
                          </td>
                        ))}
                      </tr>
                      {error && (
                        <tr className="bulk-vital__error-row">
                          <td></td>
                          <td colSpan={items.length + 1} className="bulk-vital__error" role="alert">
                            {error}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="bulk-vital__actions">
            <button
              type="button"
              onClick={handleSave}
              disabled={
                !measuredAt || dirtyRows.length === 0 || hasError || !mealReady || save.isPending
              }
            >
              {save.isPending ? "登録中..." : `登録(${dirtyRows.length} 人)`}
            </button>
            {savedCount !== null && (
              <span className="connection-settings-form__success" role="status">
                {savedCount} 人分を登録しました
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ItemInputs({
  item,
  input,
  cell,
  mealReady,
  thresholds,
  label,
  onChange,
}: {
  item: BulkVitalItem;
  input: BulkVitalInput;
  cell: BulkMealCell | undefined;
  mealReady: boolean;
  thresholds: VitalThresholdSettings;
  label: string;
  onChange: (field: BulkVitalField, value: string) => void;
}) {
  if (item === "blood_pressure") {
    return (
      <span className="bulk-vital__pair">
        <NumberInput
          value={input.systolic}
          step="1"
          className={flagClass(SYSTOLIC_CODE, input.systolic, thresholds)}
          label={`${label} の収縮期血圧`}
          onChange={(value) => onChange("systolic", value)}
        />
        /
        <NumberInput
          value={input.diastolic}
          step="1"
          className={flagClass(DIASTOLIC_CODE, input.diastolic, thresholds)}
          label={`${label} の拡張期血圧`}
          onChange={(value) => onChange("diastolic", value)}
        />
      </span>
    );
  }

  if (item === "meal") {
    // 食事オーダーの無い食事・食止め・欠食には記録する枠が無い。
    if (!mealReady) return <span className="bulk-vital__none">…</span>;
    if (!cell) return <span className="bulk-vital__none">-</span>;
    return (
      <span className="bulk-vital__pair" title={mealIntakeSlotLabel(cell.slot)}>
        {MEAL_INTAKE_ROWS.map((row) => (
          <label key={row.kind} className="bulk-vital__meal">
            {row.label}
            <select
              value={input[row.kind]}
              onChange={(e) => onChange(row.kind, e.target.value)}
              aria-label={`${label} の食事摂取量（${row.label}）`}
            >
              <option value=""></option>
              {MEAL_INTAKE_STEPS.map((step) => (
                <option key={step} value={step}>
                  {step}
                </option>
              ))}
            </select>
          </label>
        ))}
      </span>
    );
  }

  const column = singleVitalColumn(item);
  return (
    <NumberInput
      value={input[item]}
      step={column.step}
      className={flagClass(column.code, input[item], thresholds)}
      label={`${label} の${BULK_VITAL_ITEM_LABELS[item]}`}
      onChange={(value) => onChange(item, value)}
    />
  );
}

function NumberInput({
  value,
  step,
  className,
  label,
  onChange,
}: {
  value: string;
  step: string;
  className: string;
  label: string;
  onChange: (value: string) => void;
}) {
  return (
    <input
      type="number"
      inputMode="decimal"
      step={step}
      value={value}
      className={className}
      aria-label={label}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** 入力中の値がしきい値を外れていれば、経過表と同じ H/L の色を付ける。 */
function flagClass(code: string, raw: string, thresholds: VitalThresholdSettings): string {
  const value = Number(raw);
  const flag = raw.trim() && Number.isFinite(value) ? vitalInterpretationOf(code, value, thresholds) : "";
  return interpretationClass(flag, "bulk-vital__input");
}
