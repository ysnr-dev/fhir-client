import { useState, type ComponentType } from "react";
import type {
  Disease,
  EndoscopyItem,
  LabOrderItem,
  LabResultItem,
  Medicine,
  PhysioItem,
  RadItem,
  SurgeryItem,
  TreatmentItem,
} from "../../api/masterClient";
import { useMedicineTypeOptions } from "../../api/masterQueries";
import { useSelfDepartments, useWardOptions } from "../../api/queries";
import { DISEASE_KEY_NUMBER_SYSTEM } from "../../fhir/conditionHelpers";
import { departmentDisplayName, sortDepartmentsByCode } from "../../fhir/departmentHelpers";
import { ENDOSCOPY_ORDER_ITEM_SYSTEM } from "../../fhir/endoscopyOrderHelpers";
import { EXTRACT_ORDER_KINDS, extractOrderKindOf } from "../../fhir/extractKinds";
import {
  ADMISSION_DATE_MODES,
  CLINICAL_STATUS_OPTIONS,
  EXTRACT_ORDER_STAGES,
  EXTRACT_ORDER_TYPES,
  EXTRACT_VALUE_OPS,
  expandIcd10,
  type AdmissionDateMode,
  type ExtractCode,
  type ExtractDrugClass,
  type ExtractKind,
  type ExtractLeaf,
  type ExtractOrderStage,
  type ExtractOrderType,
  type ExtractPeriod,
  type ExtractValueOp,
} from "../../fhir/extractQueryHelpers";
import { LAB_ORDER_ITEM_SYSTEM } from "../../fhir/labOrderHelpers";
import { RESULT_ITEM_SYSTEM } from "../../fhir/labResultHelpers";
import { locationDisplayName } from "../../fhir/locationHelpers";
import type { OrderKind } from "../../fhir/orderKinds";
import { PHYSIO_ORDER_ITEM_SYSTEM } from "../../fhir/physioOrderHelpers";
import { MEDICINE_CODE_SYSTEM } from "../../fhir/prescriptionHelpers";
import { RAD_ORDER_ITEM_SYSTEM } from "../../fhir/radOrderHelpers";
import { LOINC_SYSTEM } from "../../fhir/shared";
import { SURGERY_ORDER_ITEM_SYSTEM } from "../../fhir/surgeryOrderHelpers";
import { TREATMENT_ORDER_ITEM_SYSTEM } from "../../fhir/treatmentOrderHelpers";
import { VITAL_MEASURES } from "../../fhir/vitalHelpers";
import { DiseaseSearchModal } from "../DiseaseSearchModal";
import { EndoscopyItemSearchModal } from "../EndoscopyItemSearchModal";
import { LabOrderItemSearchModal } from "../LabOrderItemSearchModal";
import { LabResultItemSearchModal } from "../LabResultItemSearchModal";
import { MedicineSearchModal } from "../MedicineSearchModal";
import { PhysioItemSearchModal } from "../PhysioItemSearchModal";
import { RadItemSearchModal } from "../RadItemSearchModal";
import { SurgeryItemSearchModal } from "../SurgeryItemSearchModal";
import { TreatmentItemSearchModal } from "../TreatmentItemSearchModal";

interface Props {
  leaf: ExtractLeaf;
  onChange: (leaf: ExtractLeaf) => void;
}

/** 条件の種類ごとの入力欄。 */
export function ExtractLeafFields({ leaf, onChange }: Props) {
  const Fields = KIND_FIELDS[leaf.kind];
  return <Fields leaf={leaf} patch={(next) => onChange({ ...leaf, ...next })} />;
}

type FieldsProps = { leaf: ExtractLeaf; patch: Patch };

// 種類ごとの入力欄の対応表(種類の定義は fhir/extractKinds.ts)。
const KIND_FIELDS: Record<ExtractKind, ComponentType<FieldsProps>> = {
  patient: PatientFields,
  condition: ({ leaf, patch }) => (
    <>
      <ConditionCodes leaf={leaf} patch={patch} />
      <div className="extract-leaf__row">
        <CheckGroup
          label="状態"
          options={CLINICAL_STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          values={leaf.clinical_status ?? []}
          onChange={(clinical_status) => patch({ clinical_status })}
        />
        <label className="extract-field">
          日付
          <select
            value={leaf.date_field ?? "onset"}
            onChange={(e) => patch({ date_field: e.target.value as "recorded" | "onset" })}
          >
            <option value="onset">開始日</option>
            <option value="recorded">登録日</option>
          </select>
        </label>
        <PeriodFields period={leaf.period} optional onChange={(period) => patch({ period })} />
        <MinCountField leaf={leaf} patch={patch} />
      </div>
    </>
  ),
  observation: ({ leaf, patch }) => (
    <>
      <ObservationCodes leaf={leaf} patch={patch} />
      <div className="extract-leaf__row">
        <ValueFields leaf={leaf} patch={patch} />
        <PeriodFields period={leaf.period} optional onChange={(period) => patch({ period })} />
        <MinCountField leaf={leaf} patch={patch} />
      </div>
    </>
  ),
  medication: ({ leaf, patch }) => (
    <>
      <MedicationCodes leaf={leaf} patch={patch} />
      <div className="extract-leaf__row">
        <label className="extract-field">
          区分
          <select
            value={leaf.order_type ?? ""}
            onChange={(e) => patch({ order_type: (e.target.value || undefined) as ExtractOrderType | undefined })}
          >
            <option value="">処方・注射</option>
            {EXTRACT_ORDER_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <PeriodFields period={leaf.period} optional onChange={(period) => patch({ period })} />
        <MinCountField leaf={leaf} patch={patch} />
      </div>
    </>
  ),
  order: OrderFields,
  admission: AdmissionFields,
  outpatient: ({ leaf, patch }) => (
    <div className="extract-leaf__row">
      <PeriodFields period={leaf.period} onChange={(period) => patch({ period })} />
      <MinCountField leaf={leaf} patch={patch} />
    </div>
  ),
};

/** 期間内に何件以上あれば該当とするか(既定 1)。 */
function MinCountField({ leaf, patch }: { leaf: ExtractLeaf; patch: Patch }) {
  return (
    <label className="extract-field">
      件数(以上)
      <input
        type="number"
        min={1}
        max={999}
        step={1}
        className="extract-field__number"
        value={leaf.min_count ?? 1}
        onChange={(e) => {
          const count = numberOrNull(e.target.value);
          patch({ min_count: count === null || count <= 1 ? undefined : Math.floor(count) });
        }}
      />
    </label>
  );
}

type Patch = (next: Partial<ExtractLeaf>) => void;

function numberOrNull(value: string): number | null {
  if (value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function PatientFields({ leaf, patch }: { leaf: ExtractLeaf; patch: Patch }) {
  const age = leaf.age ?? {};
  return (
    <div className="extract-leaf__row">
      <CheckGroup
        label="性別"
        options={[
          { value: "male", label: "男性" },
          { value: "female", label: "女性" },
        ]}
        values={leaf.gender ?? []}
        onChange={(gender) => patch({ gender })}
      />
      <label className="extract-field">
        年齢(以上)
        <input
          type="number"
          min={0}
          max={150}
          className="extract-field__number"
          value={age.min ?? ""}
          onChange={(e) => patch({ age: { ...age, min: numberOrNull(e.target.value) } })}
        />
      </label>
      <label className="extract-field">
        年齢(以下)
        <input
          type="number"
          min={0}
          max={150}
          className="extract-field__number"
          value={age.max ?? ""}
          onChange={(e) => patch({ age: { ...age, max: numberOrNull(e.target.value) } })}
        />
      </label>
    </div>
  );
}

function CodeChips({ codes, onChange }: { codes: ExtractCode[]; onChange: (codes: ExtractCode[]) => void }) {
  if (codes.length === 0) return null;
  return (
    <span className="extract-chips">
      {codes.map((code) => (
        <span key={`${code.system}|${code.code}`} className="extract-chip">
          {code.display || code.code}
          <button
            type="button"
            className="extract-chip__remove"
            aria-label={`${code.display || code.code} を外す`}
            onClick={() => onChange(codes.filter((c) => c !== code))}
          >
            ×
          </button>
        </span>
      ))}
    </span>
  );
}

function addCodes(current: ExtractCode[], added: ExtractCode[]): ExtractCode[] {
  const keys = new Set(current.map((c) => `${c.system}|${c.code}`));
  return [...current, ...added.filter((c) => !keys.has(`${c.system}|${c.code}`))];
}

function ConditionCodes({ leaf, patch }: { leaf: ExtractLeaf; patch: Patch }) {
  const [picking, setPicking] = useState(false);
  const [icd10, setIcd10] = useState("");
  const codes = leaf.codes ?? [];
  return (
    <div className="extract-leaf__row">
      <button type="button" className="rp-card__compact-button" onClick={() => setPicking(true)}>
        病名
      </button>
      <label className="extract-field extract-field--inline">
        ICD10
        <input
          type="text"
          className="extract-field__code"
          value={icd10}
          onChange={(e) => setIcd10(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            patch({ codes: addCodes(codes, expandIcd10(icd10)) });
            setIcd10("");
          }}
        />
      </label>
      <button
        type="button"
        className="rp-card__compact-button"
        disabled={expandIcd10(icd10).length === 0}
        onClick={() => {
          patch({ codes: addCodes(codes, expandIcd10(icd10)) });
          setIcd10("");
        }}
      >
        追加
      </button>
      <CodeChips codes={codes} onChange={(next) => patch({ codes: next })} />
      {picking && (
        <DiseaseSearchModal
          onSelect={(disease: Disease) => {
            patch({
              codes: addCodes(codes, [
                { system: DISEASE_KEY_NUMBER_SYSTEM, code: disease.management_number, display: disease.name },
              ]),
            });
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}

function ObservationCodes({ leaf, patch }: { leaf: ExtractLeaf; patch: Patch }) {
  const [picking, setPicking] = useState(false);
  const codes = leaf.codes ?? [];
  return (
    <div className="extract-leaf__row">
      <button type="button" className="rp-card__compact-button" onClick={() => setPicking(true)}>
        検査
      </button>
      <select
        aria-label="バイタル"
        value=""
        onChange={(e) => {
          const measure = VITAL_MEASURES.find((m) => m.code === e.target.value);
          if (measure) patch({ codes: addCodes(codes, [{ system: LOINC_SYSTEM, code: measure.code, display: measure.label }]) });
        }}
      >
        <option value="">バイタル</option>
        {VITAL_MEASURES.map((m) => (
          <option key={m.code} value={m.code}>
            {m.label}
          </option>
        ))}
      </select>
      <CodeChips codes={codes} onChange={(next) => patch({ codes: next })} />
      {picking && (
        <LabResultItemSearchModal
          onSelect={(item: LabResultItem) => {
            patch({
              codes: addCodes(codes, [
                { system: RESULT_ITEM_SYSTEM, code: item.result_item_code, display: item.short_name || item.name },
              ]),
            });
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}

function MedicationCodes({ leaf, patch }: { leaf: ExtractLeaf; patch: Patch }) {
  const [picking, setPicking] = useState(false);
  const [classCode, setClassCode] = useState("");
  const types = useMedicineTypeOptions(true);
  const codes = leaf.codes ?? [];
  const classes = leaf.drug_classes ?? [];

  const addClass = (drugClass: ExtractDrugClass) => {
    if (!/^\d{2,4}$/.test(drugClass.code) || classes.some((c) => c.code === drugClass.code)) return;
    patch({ drug_classes: [...classes, drugClass] });
  };

  return (
    <div className="extract-leaf__row">
      <button type="button" className="rp-card__compact-button" onClick={() => setPicking(true)}>
        薬剤
      </button>
      <select
        aria-label="薬効分類"
        className="extract-field__class"
        value=""
        onChange={(e) => {
          const type = types.data?.find((t) => t.code === e.target.value);
          if (type) addClass({ code: type.code, name: type.name ?? undefined });
        }}
      >
        <option value="">薬効分類</option>
        {(types.data ?? []).map((t) => (
          <option key={t.id} value={t.code}>
            {`${t.code} ${t.name ?? ""}`}
          </option>
        ))}
      </select>
      <label className="extract-field extract-field--inline">
        分類コード
        <input
          type="text"
          inputMode="numeric"
          className="extract-field__code"
          value={classCode}
          onChange={(e) => setClassCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
        />
      </label>
      <button
        type="button"
        className="rp-card__compact-button"
        disabled={classCode.length < 2}
        onClick={() => {
          const name = types.data?.find((t) => t.code === classCode)?.name ?? undefined;
          addClass({ code: classCode, name });
          setClassCode("");
        }}
      >
        追加
      </button>
      {classes.length > 0 && (
        <span className="extract-chips">
          {classes.map((drugClass) => (
            <span key={drugClass.code} className="extract-chip extract-chip--class">
              {drugClass.name ? `${drugClass.code} ${drugClass.name}` : `薬効 ${drugClass.code}`}
              <button
                type="button"
                className="extract-chip__remove"
                aria-label={`薬効 ${drugClass.code} を外す`}
                onClick={() => patch({ drug_classes: classes.filter((c) => c !== drugClass) })}
              >
                ×
              </button>
            </span>
          ))}
        </span>
      )}
      <CodeChips codes={codes} onChange={(next) => patch({ codes: next })} />
      {picking && (
        <MedicineSearchModal
          onSelect={(medicine: Medicine) => {
            patch({
              codes: addCodes(codes, [
                { system: MEDICINE_CODE_SYSTEM, code: medicine.medicine_code, display: medicine.name },
              ]),
            });
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}

function ValueFields({ leaf, patch }: { leaf: ExtractLeaf; patch: Patch }) {
  const value = leaf.value;
  return (
    <span className="extract-field-group">
      <label className="extract-field">
        値
        <input
          type="number"
          step="any"
          className="extract-field__number"
          value={value?.value ?? ""}
          onChange={(e) => {
            const number = numberOrNull(e.target.value);
            patch({ value: number === null ? null : { op: value?.op ?? "ge", value: number } });
          }}
        />
      </label>
      <select
        aria-label="値の比較"
        value={value?.op ?? "ge"}
        disabled={!value}
        onChange={(e) => value && patch({ value: { ...value, op: e.target.value as ExtractValueOp } })}
      >
        {EXTRACT_VALUE_OPS.map((op) => (
          <option key={op.value} value={op.value}>
            {op.label}
          </option>
        ))}
      </select>
    </span>
  );
}

function AdmissionFields({ leaf, patch }: { leaf: ExtractLeaf; patch: Patch }) {
  const { wards } = useWardOptions();
  return (
    <div className="extract-leaf__row">
      <select
        aria-label="入院の見方"
        value={leaf.date_mode ?? "overlap"}
        onChange={(e) => patch({ date_mode: e.target.value as AdmissionDateMode })}
      >
        {ADMISSION_DATE_MODES.map((mode) => (
          <option key={mode.value} value={mode.value}>
            {mode.label}
          </option>
        ))}
      </select>
      <PeriodFields period={leaf.period} onChange={(period) => patch({ period })} />
      <MinCountField leaf={leaf} patch={patch} />
      <DepartmentField leaf={leaf} patch={patch} />
      <label className="extract-field">
        病棟
        <select
          value={leaf.ward_id ?? ""}
          onChange={(e) => {
            const ward = wards.find((w) => w.id === e.target.value);
            patch({ ward_id: ward?.id || undefined, ward_name: ward ? locationDisplayName(ward) : undefined });
          }}
        >
          <option value="">すべて</option>
          {wards.map((w) => (
            <option key={w.id} value={w.id}>
              {locationDisplayName(w)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function DepartmentField({ leaf, patch }: FieldsProps) {
  const { departments } = useSelfDepartments();
  const options = sortDepartmentsByCode(departments).filter((d) => d.id);
  return (
    <label className="extract-field">
      診療科
      <select
        value={leaf.department_id ?? ""}
        onChange={(e) => {
          const department = options.find((d) => d.id === e.target.value);
          patch({
            department_id: department?.id || undefined,
            department_name: department ? departmentDisplayName(department) : undefined,
          });
        }}
      >
        <option value="">すべて</option>
        {options.map((d) => (
          <option key={d.id} value={d.id}>
            {departmentDisplayName(d)}
          </option>
        ))}
      </select>
    </label>
  );
}

type ItemPicker = ComponentType<{ onPick: (code: ExtractCode) => void; onClose: () => void }>;

// 項目で絞れる部門オーダー(明細の ServiceRequest の code に項目マスタのコードを持つ種別)。
const ORDER_ITEM_PICKERS: Partial<Record<OrderKind, ItemPicker>> = {
  "lab-order": ({ onPick, onClose }) => (
    <LabOrderItemSearchModal
      onSelect={(item: LabOrderItem) =>
        onPick({ system: LAB_ORDER_ITEM_SYSTEM, code: item.order_item_code, display: item.short_name || item.name })
      }
      onClose={onClose}
    />
  ),
  "rad-order": ({ onPick, onClose }) => (
    <RadItemSearchModal
      onSelect={(item: RadItem) =>
        onPick({ system: RAD_ORDER_ITEM_SYSTEM, code: item.item_code, display: item.short_name || item.name })
      }
      onClose={onClose}
    />
  ),
  "physio-order": ({ onPick, onClose }) => (
    <PhysioItemSearchModal
      onSelect={(item: PhysioItem) =>
        onPick({ system: PHYSIO_ORDER_ITEM_SYSTEM, code: item.item_code, display: item.short_name || item.name })
      }
      onClose={onClose}
    />
  ),
  "endoscopy-order": ({ onPick, onClose }) => (
    <EndoscopyItemSearchModal
      onSelect={(item: EndoscopyItem) =>
        onPick({ system: ENDOSCOPY_ORDER_ITEM_SYSTEM, code: item.item_code, display: item.short_name || item.name })
      }
      onClose={onClose}
    />
  ),
  "treatment-order": ({ onPick, onClose }) => (
    <TreatmentItemSearchModal
      onSelect={(item: TreatmentItem) =>
        onPick({ system: TREATMENT_ORDER_ITEM_SYSTEM, code: item.item_code, display: item.short_name || item.name })
      }
      onClose={onClose}
    />
  ),
  "surgery-order": ({ onPick, onClose }) => (
    <SurgeryItemSearchModal
      onSelect={(item: SurgeryItem) =>
        onPick({ system: SURGERY_ORDER_ITEM_SYSTEM, code: item.item_code, display: item.short_name || item.name })
      }
      onClose={onClose}
    />
  ),
};

function OrderFields({ leaf, patch }: FieldsProps) {
  const [picking, setPicking] = useState(false);
  const kind = extractOrderKindOf(leaf.order_kind);
  const stage = leaf.stage ?? "ordered";
  const codes = leaf.codes ?? [];
  const Picker = kind && stage === "ordered" ? ORDER_ITEM_PICKERS[kind.kind] : undefined;
  return (
    <>
      <div className="extract-leaf__row">
        <label className="extract-field">
          種別
          <select
            value={leaf.order_kind ?? ""}
            onChange={(e) => {
              const next = extractOrderKindOf(e.target.value);
              // 項目は種別ごとのコード体系なので、種別を変えたら外す。
              patch({
                order_kind: e.target.value,
                codes: [],
                stage: next?.performed ? stage : "ordered",
              });
            }}
          >
            {EXTRACT_ORDER_KINDS.map((k) => (
              <option key={k.code} value={k.code}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className="extract-field">
          区分
          <select
            value={stage}
            onChange={(e) => {
              const next = e.target.value as ExtractOrderStage;
              patch({ stage: next, ...(next === "performed" ? { codes: [] } : {}) });
            }}
          >
            {EXTRACT_ORDER_STAGES.map((s) => (
              <option key={s.value} value={s.value} disabled={s.value === "performed" && !kind?.performed}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        {Picker && (
          <button type="button" className="rp-card__compact-button" onClick={() => setPicking(true)}>
            項目
          </button>
        )}
        <CodeChips codes={codes} onChange={(next) => patch({ codes: next })} />
      </div>
      <div className="extract-leaf__row">
        <PeriodFields period={leaf.period} optional onChange={(period) => patch({ period })} />
        <MinCountField leaf={leaf} patch={patch} />
        <DepartmentField leaf={leaf} patch={patch} />
      </div>
      {Picker && picking && (
        <Picker
          onPick={(code) => {
            patch({ codes: addCodes(codes, [code]) });
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  );
}

export function CheckGroup({
  label,
  options,
  values,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  values: string[];
  onChange: (values: string[]) => void;
}) {
  return (
    <span className="extract-checks" role="group" aria-label={label}>
      <span className="extract-checks__label">{label}</span>
      {options.map((option) => (
        <label key={option.value} className="extract-checks__item">
          <input
            type="checkbox"
            checked={values.includes(option.value)}
            onChange={(e) =>
              onChange(e.target.checked ? [...values, option.value] : values.filter((v) => v !== option.value))
            }
          />
          {option.label}
        </label>
      ))}
    </span>
  );
}

/** 期間。直近 N 日(定点観測で日付を直さずに済む)か日付の範囲。optional なら指定なしも選べる。 */
export function PeriodFields({
  period,
  optional = false,
  onChange,
}: {
  period: ExtractPeriod | null | undefined;
  optional?: boolean;
  onChange: (period: ExtractPeriod | null) => void;
}) {
  const mode = period?.mode ?? "none";
  return (
    <span className="extract-field-group">
      <label className="extract-field">
        期間
        <select
          value={mode}
          onChange={(e) => {
            const next = e.target.value;
            if (next === "none") onChange(null);
            else if (next === "relative") onChange({ mode: "relative", days: period?.days ?? 30 });
            else onChange({ mode: "absolute", from: period?.from, to: period?.to });
          }}
        >
          {optional && <option value="none">指定なし</option>}
          <option value="relative">直近</option>
          <option value="absolute">日付</option>
        </select>
      </label>
      {period?.mode === "relative" && (
        <label className="extract-field extract-field--inline">
          <input
            type="number"
            min={1}
            max={3650}
            className="extract-field__number"
            aria-label="日数"
            value={period.days ?? ""}
            onChange={(e) => onChange({ mode: "relative", days: numberOrNull(e.target.value) ?? undefined })}
          />
          日
        </label>
      )}
      {period?.mode === "absolute" && (
        <>
          <input
            type="date"
            aria-label="期間の開始"
            value={period.from ?? ""}
            onChange={(e) => onChange({ ...period, from: e.target.value || undefined })}
          />
          <span>〜</span>
          <input
            type="date"
            aria-label="期間の終了"
            value={period.to ?? ""}
            onChange={(e) => onChange({ ...period, to: e.target.value || undefined })}
          />
        </>
      )}
    </span>
  );
}
