import { makeFieldUpdater } from "../lib/form";
import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import type { LabOrderCandidate } from "../api/queries";
import { useDepartmentList, useMicroOrderDetail } from "../api/queries";
import {
  useFrequentMicroAntimicrobials,
  useFrequentMicroOrganisms,
  useMicroSpecimenTypeOptions,
  useMicroSusceptibilityMethodOptions,
} from "../api/masterQueries";
import type { MicroAntimicrobial, MicroSpecimenType } from "../api/masterClient";
import { microOrderContents, microOrderItemRequests } from "../fhir/microOrderHelpers";
import { serviceRequestsOf } from "../fhir/labOrderHelpers";
import { SETTING_OPTIONS, type LabResultSetting } from "../fhir/labResultHelpers";
import {
  CAUSATIVE_OPTIONS,
  COLONY_COUNT_OPTIONS,
  COMPARATOR_OPTIONS,
  CULTURE_OPTIONS,
  GECKLER_OPTIONS,
  GRADE_OPTIONS,
  MAX_ISOLATES,
  MAX_SUSCEPTIBILITIES,
  MILLER_JONES_OPTIONS,
  PYURIA_METHOD_OPTIONS,
  PYURIA_RESULT_OPTIONS,
  QUANTITY_TYPE_OPTIONS,
  REPORT_STATUS_OPTIONS,
  SIR_OPTIONS,
  emptyIsolate,
  emptyMicroResultForm,
  emptySusceptibility,
  isolateLabel,
  type CodeOption,
  type MicComparator,
  type MicroIsolateValues,
  type MicroReportStatus,
  type MicroResultFormValues,
  type MicroSusceptibilityValues,
  type SirCode,
} from "../fhir/microResultHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { MicroAntimicrobialSearchModal, type AntimicrobialSelection } from "./MicroAntimicrobialSearchModal";
import { MicroOrganismSearchModal } from "./MicroOrganismSearchModal";

interface MicroResultFormProps {
  initialValues?: MicroResultFormValues;
  onSubmit: (values: MicroResultFormValues) => void;
  submitting: boolean;
  submitError?: unknown;
  submitLabel?: string;
  /** 紐付けられる細菌検査オーダー(結果が未登録のもの)。 */
  orderCandidates: LabOrderCandidate[];
  orderCandidatesLoading: boolean;
}

type ModalState =
  | { kind: "organism"; isolateIndex: number }
  | { kind: "drug"; isolateIndex: number; rowIndex: number }
  | null;

function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9L12 4M6.5 6.5v5M9.5 6.5v5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function optionsOf(options: CodeOption[], emptyLabel: string) {
  return (
    <>
      <option value="">{emptyLabel}</option>
      {options.map((o) => (
        <option key={o.code} value={o.code}>
          {o.display}
        </option>
      ))}
    </>
  );
}

// 材料の系統から所見セクションを自動で開くかの判定。JANIS 材料コード表の
// 「系統」(口腔・気道・呼吸器 など)と名称で緩く判定する(外れても手で開けるだけ)。
function isRespiratorySpecimen(type: MicroSpecimenType | undefined, name: string): boolean {
  return Boolean(type?.category?.includes("呼吸器") || name.includes("痰"));
}

function isUrineSpecimen(type: MicroSpecimenType | undefined, name: string): boolean {
  return Boolean(type?.category?.includes("泌尿") || name.includes("尿"));
}

export function MicroResultForm({
  initialValues,
  onSubmit,
  submitting,
  submitError,
  submitLabel = "登録",
  orderCandidates,
  orderCandidatesLoading,
}: MicroResultFormProps) {
  const [values, setValues] = useState<MicroResultFormValues>(
    initialValues ?? emptyMicroResultForm,
  );
  const [validationError, setValidationError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>(null);

  const { departments } = useDepartmentList({});
  const specimenTypes = useMicroSpecimenTypeOptions();
  const frequentOrganisms = useFrequentMicroOrganisms();
  const frequentDrugs = useFrequentMicroAntimicrobials();
  const methods = useMicroSusceptibilityMethodOptions();

  // 画面上でオーダーを選び直したときだけ、オーダーの検体(材料)を転記する
  // (初期表示時の紐付け済みオーダーで、保存済みの材料を上書きしないようにする)。
  const [expandingOrderId, setExpandingOrderId] = useState("");
  const orderDetail = useMicroOrderDetail(expandingOrderId || undefined);

  useEffect(() => {
    if (!expandingOrderId || orderDetail.isLoading) return;
    setExpandingOrderId("");

    const serviceRequests = serviceRequestsOf(orderDetail.data?.data);
    const contents = microOrderContents(
      microOrderItemRequests(serviceRequests, expandingOrderId),
    );
    if (contents.specimen.typeCode) {
      setValues((v) => ({
        ...v,
        specimenTypeCode: contents.specimen.typeCode,
        specimenTypeName: contents.specimen.typeName,
      }));
    }
  }, [expandingOrderId, orderDetail.isLoading, orderDetail.data]);

  // 喀痰品質・膿尿評価の折り畳み。材料の系統で自動開閉し、保存済みの値が
  // あれば編集時に隠れて見落とすことがないよう強制的に開く。
  const specimenType = specimenTypes.data?.items.find(
    (t) => t.code === values.specimenTypeCode,
  );
  const sputumHasValue = Boolean(values.millerJones || values.geckler);
  const pyuriaHasValue = Boolean(values.pyuriaMethod || values.pyuriaResult);
  const [sputumOpen, setSputumOpen] = useState(sputumHasValue);
  const [pyuriaOpen, setPyuriaOpen] = useState(pyuriaHasValue);

  useEffect(() => {
    if (sputumHasValue || isRespiratorySpecimen(specimenType, values.specimenTypeName)) {
      setSputumOpen(true);
    }
    if (pyuriaHasValue || isUrineSpecimen(specimenType, values.specimenTypeName)) {
      setPyuriaOpen(true);
    }
  }, [specimenType, values.specimenTypeName, sputumHasValue, pyuriaHasValue]);

  const update = makeFieldUpdater(setValues);

  function updateIsolate(isolateIndex: number, patch: Partial<MicroIsolateValues>) {
    setValues((v) => ({
      ...v,
      isolates: v.isolates.map((isolate, i) =>
        i === isolateIndex ? { ...isolate, ...patch } : isolate,
      ),
    }));
  }

  function updateSusceptibility(
    isolateIndex: number,
    rowIndex: number,
    patch: Partial<MicroSusceptibilityValues>,
  ) {
    setValues((v) => ({
      ...v,
      isolates: v.isolates.map((isolate, i) =>
        i === isolateIndex
          ? {
              ...isolate,
              susceptibilities: isolate.susceptibilities.map((row, j) =>
                j === rowIndex ? { ...row, ...patch } : row,
              ),
            }
          : isolate,
      ),
    }));
  }

  function addIsolate() {
    setValues((v) => ({ ...v, isolates: [...v.isolates, emptyIsolate()] }));
  }

  function removeIsolate(isolateIndex: number) {
    setValues((v) => ({ ...v, isolates: v.isolates.filter((_, i) => i !== isolateIndex) }));
  }

  // 感受性行の追加。測定法は同じ機器でまとめて測ることが多いので前の行から引き継ぐ。
  function addSusceptibility(isolateIndex: number, drug?: AntimicrobialSelection) {
    setValues((v) => ({
      ...v,
      isolates: v.isolates.map((isolate, i) => {
        if (i !== isolateIndex) return isolate;
        const previous = isolate.susceptibilities[isolate.susceptibilities.length - 1];
        const row = {
          ...emptySusceptibility(),
          methodCode: previous?.methodCode ?? "",
          methodName: previous?.methodName ?? "",
          ...(drug
            ? { drugCode: drug.code, drugName: drug.name, drugAbbreviation: drug.abbreviation }
            : {}),
        };
        return { ...isolate, susceptibilities: [...isolate.susceptibilities, row] };
      }),
    }));
  }

  // 頻用抗菌薬をまとめて感受性行にする(未追加の薬だけ)。パネル一括測定の入力向け。
  function addFrequentDrugs(isolateIndex: number) {
    const drugs = frequentDrugs.data?.items ?? [];
    setValues((v) => ({
      ...v,
      isolates: v.isolates.map((isolate, i) => {
        if (i !== isolateIndex) return isolate;
        const existing = new Set(isolate.susceptibilities.map((row) => row.drugCode));
        const previous = isolate.susceptibilities[isolate.susceptibilities.length - 1];
        const added = drugs
          .filter((drug) => !existing.has(drug.code))
          .slice(0, Math.max(0, MAX_SUSCEPTIBILITIES - isolate.susceptibilities.length))
          .map((drug) => ({
            ...emptySusceptibility(),
            drugCode: drug.code,
            drugName: drug.name,
            drugAbbreviation: drug.abbreviation ?? "",
            methodCode: previous?.methodCode ?? "",
            methodName: previous?.methodName ?? "",
          }));
        return { ...isolate, susceptibilities: [...isolate.susceptibilities, ...added] };
      }),
    }));
  }

  function removeSusceptibility(isolateIndex: number, rowIndex: number) {
    setValues((v) => ({
      ...v,
      isolates: v.isolates.map((isolate, i) =>
        i === isolateIndex
          ? {
              ...isolate,
              susceptibilities: isolate.susceptibilities.filter((_, j) => j !== rowIndex),
            }
          : isolate,
      ),
    }));
  }

  // オーダーを選び直したら、その検体(材料)を転記し直す。診療科はオーダーの
  // 依頼科を採用する(オーダーと違う科の結果にならないよう、紐付けている間は
  // 選び直せない)。
  function handleOrderChange(orderId: string) {
    const candidate = orderCandidates.find((c) => c.id === orderId);
    setValues((v) => ({
      ...v,
      orderId,
      ...(candidate
        ? { departmentId: candidate.departmentId, departmentName: candidate.departmentName }
        : {}),
    }));
    setExpandingOrderId(orderId);
  }

  function handleDepartmentChange(departmentId: string) {
    const department = departments.find((d) => d.id === departmentId);
    setValues((v) => ({
      ...v,
      departmentId,
      departmentName: departmentId ? (department?.name ?? v.departmentName) : "",
    }));
  }

  function handleOrganismSelect(organism: { code: string; name: string }) {
    if (modal?.kind !== "organism") return;
    updateIsolate(modal.isolateIndex, {
      organismCode: organism.code,
      organismName: organism.name,
    });
    setModal(null);
  }

  function handleDrugSelect(drug: AntimicrobialSelection) {
    if (modal?.kind !== "drug") return;
    updateSusceptibility(modal.isolateIndex, modal.rowIndex, {
      drugCode: drug.code,
      drugName: drug.name,
      drugAbbreviation: drug.abbreviation,
    });
    setModal(null);
  }

  function validate(): string | null {
    if (!values.specimenDate) return "検体採取日は必須です。";
    if (!values.setting) return "入外区分は必須です。";
    if (!values.specimenTypeCode) return "材料(検体種別)を選択してください。";

    for (let i = 0; i < values.isolates.length; i++) {
      const isolate = values.isolates[i];
      const label = `分離菌 ${isolateLabel(i)}`;
      if (!isolate.organismCode) return `${label}: 菌名を選択してください。`;
      for (let j = 0; j < isolate.susceptibilities.length; j++) {
        const row = isolate.susceptibilities[j];
        const rowLabel = `${label} 感受性 ${j + 1} 行目`;
        if (!row.drugCode) return `${rowLabel}: 抗菌薬を選択してください。`;
        if (row.mic && Number.isNaN(Number(row.mic))) {
          return `${rowLabel}: MIC は数値で入力してください。`;
        }
        if (row.zone && Number.isNaN(Number(row.zone))) {
          return `${rowLabel}: 阻止円径は数値で入力してください。`;
        }
      }
    }
    return null;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const error = validate();
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);
    onSubmit(values);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    // input 上での Enter による暗黙の form submit を抑止する。
    if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
      e.preventDefault();
    }
  }

  return (
    <form className="prescription-form" onSubmit={handleSubmit} onKeyDown={handleKeyDown}>
      {validationError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}
      <ErrorBanner error={submitError} />
      <ErrorBanner
        error={specimenTypes.error ?? frequentOrganisms.error ?? frequentDrugs.error ?? methods.error}
      />

      <fieldset>
        <legend>検査共通</legend>
        <label>
          入外区分
          <select
            value={values.setting}
            onChange={(e) => update("setting", e.target.value as LabResultSetting)}
          >
            <option value="">選択してください</option>
            {SETTING_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.display}
              </option>
            ))}
          </select>
        </label>
        {/* オーダーに紐付けている間は、オーダーの依頼科を採用するので選び直せない。 */}
        <label>
          診療科
          <select
            value={values.departmentId}
            onChange={(e) => handleDepartmentChange(e.target.value)}
            disabled={Boolean(values.orderId)}
          >
            <option value="">選択してください</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
            {/* マスタの読み込み前や、診療科が削除された場合に選択が空へ化けないようにする。 */}
            {values.departmentId &&
              !departments.some((department) => department.id === values.departmentId) && (
                <option value={values.departmentId}>
                  {values.departmentName || "(削除済みの診療科)"}
                </option>
              )}
          </select>
        </label>
        <label>
          検体採取日
          <input
            type="date"
            value={values.specimenDate}
            onChange={(e) => update("specimenDate", e.target.value)}
          />
        </label>
        {/* 細菌検査は培養に日数がかかるため、塗抹のみの時点では中間報告として保存し、
            培養・感受性の確定後に編集して最終報告へ切り替える運用を想定している。 */}
        <div className="micro-result-form__status" role="radiogroup" aria-label="報告区分">
          報告区分
          {REPORT_STATUS_OPTIONS.map((o) => (
            <label key={o.code} className="micro-result-form__status-option">
              <input
                type="radio"
                name="report-status"
                value={o.code}
                checked={values.reportStatus === o.code}
                onChange={() => update("reportStatus", o.code as MicroReportStatus)}
              />
              {o.display}
            </label>
          ))}
        </div>
        {/*
          元になった細菌検査オーダー。紐付けはオーダー単位で、すでに結果が登録されている
          オーダーは候補に出ない(編集中の結果自身が紐付けているオーダーだけは残る)。
        */}
        <label className="lab-result-form__order">
          細菌検査オーダー
          <select
            value={values.orderId}
            onChange={(e) => handleOrderChange(e.target.value)}
            disabled={orderCandidatesLoading}
          >
            <option value="">紐付けなし</option>
            {orderCandidatesLoading && values.orderId && (
              <option value={values.orderId}>読み込み中...</option>
            )}
            {orderCandidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.label}
              </option>
            ))}
            {/* 紐付け先のオーダーが削除されている場合に、選択が空へ化けないようにする。 */}
            {!orderCandidatesLoading &&
              values.orderId &&
              !orderCandidates.some((candidate) => candidate.id === values.orderId) && (
                <option value={values.orderId}>(削除済みのオーダー)</option>
              )}
          </select>
        </label>
        {expandingOrderId && <p className="lab-result-form__notice">オーダーの検体を転記中...</p>}
        <label>
          材料
          <SpecimenTypeSelect
            types={specimenTypes.data?.items ?? []}
            value={values.specimenTypeCode}
            onChange={(code, name) =>
              setValues((v) => ({ ...v, specimenTypeCode: code, specimenTypeName: name }))
            }
          />
        </label>
      </fieldset>

      <fieldset>
        <legend>検体所見</legend>
        <label>
          培養結果
          <select
            value={values.culture}
            onChange={(e) => update("culture", e.target.value as MicroResultFormValues["culture"])}
          >
            {optionsOf(CULTURE_OPTIONS, "未入力")}
          </select>
        </label>
        <label className="micro-result-form__smear">
          塗抹・鏡検所見
          <textarea
            value={values.smear}
            onChange={(e) => update("smear", e.target.value)}
            rows={3}
            placeholder="グラム染色所見など"
          />
        </label>

        {/* 喀痰品質・膿尿評価は塗抹欄の幅に左右されないよう、常に次の行に並べる。 */}
        <div className="micro-result-form__finding-row">
        <details
          className="micro-result-form__finding-details"
          open={sputumOpen}
          onToggle={(e) => setSputumOpen(e.currentTarget.open)}
        >
          <summary>喀痰品質評価</summary>
          <div className="micro-result-form__finding-grid">
            <label>
              Miller&Jones分類
              <select
                value={values.millerJones}
                onChange={(e) => update("millerJones", e.target.value)}
              >
                {optionsOf(MILLER_JONES_OPTIONS, "未実施")}
              </select>
            </label>
            <label>
              Geckler分類
              <select value={values.geckler} onChange={(e) => update("geckler", e.target.value)}>
                {optionsOf(GECKLER_OPTIONS, "未実施")}
              </select>
            </label>
          </div>
        </details>

        <details
          className="micro-result-form__finding-details"
          open={pyuriaOpen}
          onToggle={(e) => setPyuriaOpen(e.currentTarget.open)}
        >
          <summary>膿尿評価(尿)</summary>
          <div className="micro-result-form__finding-grid">
            <label>
              評価法
              <select
                value={values.pyuriaMethod}
                onChange={(e) => update("pyuriaMethod", e.target.value)}
              >
                {optionsOf(PYURIA_METHOD_OPTIONS, "未実施")}
              </select>
            </label>
            <label>
              評価結果
              <select
                value={values.pyuriaResult}
                onChange={(e) => update("pyuriaResult", e.target.value)}
              >
                {optionsOf(PYURIA_RESULT_OPTIONS, "未選択")}
              </select>
            </label>
          </div>
        </details>
        </div>
      </fieldset>

      {values.isolates.map((isolate, isolateIndex) => (
        <IsolateFieldset
          key={isolateIndex}
          isolate={isolate}
          label={isolateLabel(isolateIndex)}
          frequentOrganisms={frequentOrganisms.data?.items ?? []}
          frequentDrugs={frequentDrugs.data?.items ?? []}
          methods={methods.data?.items ?? []}
          onUpdate={(patch) => updateIsolate(isolateIndex, patch)}
          onRemove={() => removeIsolate(isolateIndex)}
          onOpenOrganismSearch={() => setModal({ kind: "organism", isolateIndex })}
          onUpdateRow={(rowIndex, patch) => updateSusceptibility(isolateIndex, rowIndex, patch)}
          onAddRow={() => addSusceptibility(isolateIndex)}
          onAddFrequentDrugs={() => addFrequentDrugs(isolateIndex)}
          onRemoveRow={(rowIndex) => removeSusceptibility(isolateIndex, rowIndex)}
          onOpenDrugSearch={(rowIndex) => setModal({ kind: "drug", isolateIndex, rowIndex })}
        />
      ))}

      <div className="rp-card__actions">
        <button type="button" onClick={addIsolate} disabled={values.isolates.length >= MAX_ISOLATES}>
          + 分離菌追加
        </button>
        {values.isolates.length >= MAX_ISOLATES && (
          <span className="order-select__muted">分離菌は最大 {MAX_ISOLATES} 株(A〜E)です。</span>
        )}
      </div>

      <div className="prescription-form__submit">
        <button type="submit" disabled={submitting}>
          {submitting ? "送信中..." : submitLabel}
        </button>
      </div>

      {modal?.kind === "organism" && (
        <MicroOrganismSearchModal onSelect={handleOrganismSelect} onClose={() => setModal(null)} />
      )}
      {modal?.kind === "drug" && (
        <MicroAntimicrobialSearchModal onSelect={handleDrugSelect} onClose={() => setModal(null)} />
      )}
    </form>
  );
}

// 材料。JANIS 材料コード表の「系統」ごとにまとめて選びやすくする(オーダー画面と同じ)。
function SpecimenTypeSelect({
  types,
  value,
  onChange,
}: {
  types: MicroSpecimenType[];
  value: string;
  onChange: (code: string, name: string) => void;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, MicroSpecimenType[]>();
    for (const type of types) {
      const key = type.category ?? "その他";
      const list = map.get(key);
      if (list) list.push(type);
      else map.set(key, [type]);
    }
    return Array.from(map.entries());
  }, [types]);
  const known = types.some((type) => type.code === value);

  return (
    <select
      value={value}
      onChange={(e) => {
        const code = e.target.value;
        onChange(code, types.find((type) => type.code === code)?.name ?? "");
      }}
    >
      <option value="">選択してください</option>
      {/* マスタから消えた材料コードの編集時に、選択が空へ化けないようにする。 */}
      {value && !known && <option value={value}>{value} (マスタ未登録)</option>}
      {groups.map(([category, members]) => (
        <optgroup key={category} label={category}>
          {members.map((type) => (
            <option key={type.code} value={type.code}>
              {type.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

// 分離菌 1 株分の入力。菌の情報と、その菌に対する薬剤感受性の表を持つ。
function IsolateFieldset({
  isolate,
  label,
  frequentOrganisms,
  frequentDrugs,
  methods,
  onUpdate,
  onRemove,
  onOpenOrganismSearch,
  onUpdateRow,
  onAddRow,
  onAddFrequentDrugs,
  onRemoveRow,
  onOpenDrugSearch,
}: {
  isolate: MicroIsolateValues;
  label: string;
  frequentOrganisms: { code: string; name: string }[];
  frequentDrugs: MicroAntimicrobial[];
  methods: { code: string; name: string; product_name: string | null }[];
  onUpdate: (patch: Partial<MicroIsolateValues>) => void;
  onRemove: () => void;
  onOpenOrganismSearch: () => void;
  onUpdateRow: (rowIndex: number, patch: Partial<MicroSusceptibilityValues>) => void;
  onAddRow: () => void;
  onAddFrequentDrugs: () => void;
  onRemoveRow: (rowIndex: number) => void;
  onOpenDrugSearch: (rowIndex: number) => void;
}) {
  // 頻用プルダウンで選ぶか、検索モーダルで全件から選ぶ。頻用に無い菌が選択済みの
  // ときは、その菌を選択肢として補って select が空に化けないようにする。
  const organismInFrequent = frequentOrganisms.some((o) => o.code === isolate.organismCode);

  return (
    <fieldset className="rp-card">
      <legend>分離菌 {label}</legend>
      <div className="micro-result-form__isolate-head">
        <label>
          菌名
          <select
            value={isolate.organismCode}
            onChange={(e) => {
              const code = e.target.value;
              const organism = frequentOrganisms.find((o) => o.code === code);
              onUpdate({
                organismCode: code,
                organismName: organism?.name ?? (code === isolate.organismCode ? isolate.organismName : ""),
              });
            }}
          >
            <option value="">選択してください</option>
            {isolate.organismCode && !organismInFrequent && (
              <option value={isolate.organismCode}>{isolate.organismName}</option>
            )}
            {frequentOrganisms.map((organism) => (
              <option key={organism.code} value={organism.code}>
                {organism.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="micro-result-form__search"
          onClick={onOpenOrganismSearch}
        >
          検索
        </button>
        <label>
          菌量
          <select
            value={isolate.quantityType}
            onChange={(e) => onUpdate({ quantityType: e.target.value })}
          >
            {optionsOf(QUANTITY_TYPE_OPTIONS, "未入力")}
          </select>
        </label>
        <label>
          菌数
          <select
            value={isolate.colonyCount}
            onChange={(e) => onUpdate({ colonyCount: e.target.value })}
          >
            {optionsOf(COLONY_COUNT_OPTIONS, "未入力")}
          </select>
        </label>
        <label>
          起炎性
          <select
            value={isolate.causative}
            onChange={(e) =>
              onUpdate({ causative: e.target.value as MicroIsolateValues["causative"] })
            }
          >
            {optionsOf(CAUSATIVE_OPTIONS, "未入力")}
          </select>
        </label>
        <button
          type="button"
          className="rp-card__icon-button micro-result-form__isolate-remove"
          title={`分離菌 ${label} を削除`}
          aria-label={`分離菌 ${label} を削除`}
          onClick={onRemove}
        >
          <TrashIcon />
        </button>
      </div>

      {isolate.susceptibilities.length > 0 && (
        <table className="rp-card__medicines micro-result-form__susceptibility">
          {/* 薬剤名・製品名の長さで列が動かないよう、幅は colgroup で固定する。
              MIC・阻止円は見出し("MIC(µg/mL)" / "阻止円(mm)")が折り返さない幅にする。 */}
          <colgroup>
            <col />
            <col style={{ width: "150px" }} />
            <col style={{ width: "56px" }} />
            <col style={{ width: "94px" }} />
            <col style={{ width: "86px" }} />
            <col style={{ width: "52px" }} />
            <col style={{ width: "72px" }} />
            <col style={{ width: "34px" }} />
          </colgroup>
          <thead>
            <tr>
              <th>抗菌薬</th>
              <th>測定法</th>
              <th>仕切</th>
              <th>MIC(µg/mL)</th>
              <th>阻止円(mm)</th>
              <th>判定</th>
              <th>判定(+)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {isolate.susceptibilities.map((row, rowIndex) => {
              const drugInFrequent = frequentDrugs.some((d) => d.code === row.drugCode);
              return (
                <tr key={rowIndex}>
                  <td>
                    <div className="rp-card__medicine-cell">
                      <select
                        value={row.drugCode}
                        onChange={(e) => {
                          const code = e.target.value;
                          const drug = frequentDrugs.find((d) => d.code === code);
                          onUpdateRow(rowIndex, {
                            drugCode: code,
                            drugName: drug?.name ?? (code === row.drugCode ? row.drugName : ""),
                            drugAbbreviation:
                              drug?.abbreviation ??
                              (code === row.drugCode ? row.drugAbbreviation : ""),
                          });
                        }}
                        aria-label="抗菌薬"
                      >
                        <option value="">選択してください</option>
                        {row.drugCode && !drugInFrequent && (
                          <option value={row.drugCode}>
                            {row.drugAbbreviation || row.drugName}
                          </option>
                        )}
                        {frequentDrugs.map((drug) => (
                          <option key={drug.code} value={drug.code}>
                            {drug.abbreviation ? `${drug.abbreviation} ${drug.name}` : drug.name}
                          </option>
                        ))}
                      </select>
                      <button type="button" onClick={() => onOpenDrugSearch(rowIndex)}>
                        検索
                      </button>
                    </div>
                  </td>
                  <td>
                    <select
                      value={row.methodCode}
                      onChange={(e) => {
                        const code = e.target.value;
                        const method = methods.find((m) => m.code === code);
                        onUpdateRow(rowIndex, {
                          methodCode: code,
                          methodName: method
                            ? [method.name, method.product_name].filter(Boolean).join(" ")
                            : "",
                        });
                      }}
                      aria-label="測定法"
                    >
                      <option value="">未指定</option>
                      {row.methodCode && !methods.some((m) => m.code === row.methodCode) && (
                        <option value={row.methodCode}>{row.methodName || row.methodCode}</option>
                      )}
                      {methods.map((method) => (
                        <option key={method.code} value={method.code}>
                          {[method.name, method.product_name].filter(Boolean).join(" ")}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      value={row.comparator}
                      onChange={(e) =>
                        onUpdateRow(rowIndex, { comparator: e.target.value as MicComparator })
                      }
                      aria-label="仕切法"
                    >
                      {COMPARATOR_OPTIONS.map((o) => (
                        <option key={o.code} value={o.code}>
                          {o.display}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={row.mic}
                      onChange={(e) => onUpdateRow(rowIndex, { mic: e.target.value })}
                      aria-label="MIC"
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      value={row.zone}
                      onChange={(e) => onUpdateRow(rowIndex, { zone: e.target.value })}
                      aria-label="阻止円径"
                    />
                  </td>
                  <td>
                    <select
                      value={row.sir}
                      onChange={(e) => onUpdateRow(rowIndex, { sir: e.target.value as SirCode })}
                      aria-label="S/I/R判定"
                    >
                      <option value=""></option>
                      {SIR_OPTIONS.map((code) => (
                        <option key={code} value={code}>
                          {code}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      value={row.grade}
                      onChange={(e) => onUpdateRow(rowIndex, { grade: e.target.value })}
                      aria-label="判定(+)"
                    >
                      {optionsOf(GRADE_OPTIONS, "")}
                    </select>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="rp-card__icon-button"
                      title="この感受性行を削除"
                      aria-label="この感受性行を削除"
                      onClick={() => onRemoveRow(rowIndex)}
                    >
                      <TrashIcon />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div className="rp-card__actions">
        <button
          type="button"
          onClick={onAddRow}
          disabled={isolate.susceptibilities.length >= MAX_SUSCEPTIBILITIES}
        >
          + 感受性行追加
        </button>
        <button
          type="button"
          onClick={onAddFrequentDrugs}
          disabled={isolate.susceptibilities.length >= MAX_SUSCEPTIBILITIES}
        >
          頻用抗菌薬を一括追加
        </button>
        {isolate.susceptibilities.length >= MAX_SUSCEPTIBILITIES && (
          <span className="order-select__muted">
            感受性は 1 菌あたり最大 {MAX_SUSCEPTIBILITIES} 薬剤です。
          </span>
        )}
      </div>
    </fieldset>
  );
}
