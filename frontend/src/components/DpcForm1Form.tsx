import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useDpcMdc6, useDpcStem7Codes } from "../api/masterQueries";
import { useKarteConditions } from "../api/queries";
import {
  fetchDpcStem7Codes,
  normalizeDpcKCode,
  singleDpcStem7,
  type Disease,
  type DpcStem7Code,
  type MedicalProcedure,
} from "../api/masterClient";
import { DISEASE_SUFFIX_OPTIONS } from "../fhir/dpcForm1/records/clinical";
import { icdMatches } from "../fhir/dpcForm1/rules";
import {
  DPC1_SECTION_LABELS,
  type Dpc1FieldDef,
  type Dpc1Option,
  type Dpc1PayloadNo,
  type Dpc1RecordDef,
  type Dpc1Row,
  type Dpc1Section,
  type Dpc1Values,
} from "../fhir/dpcForm1/types";
import {
  dpc1DiagnosisRowOfCondition,
  dpc1DiagnosisRowOfDisease,
  draftDpcForm1,
  fromDpcDate,
  toDpcDate,
  type DpcForm1Sources,
} from "../fhir/dpcForm1Draft";
import {
  buildDpc1Context,
  dpc1DiagnosisIcds,
  dpc1FieldRequired,
  dpc1FieldVisible,
  dpc1RecordRequired,
  emptyDpc1Row,
  splitDpc1Composite,
} from "../fhir/dpcForm1Helpers";
import {
  encounterAdmissionDate,
  encounterDepartmentName,
  encounterDischargeDate,
} from "../fhir/encounterHelpers";
import { today } from "../lib/dates";
import { ConditionPickerModal } from "./ConditionPickerModal";
import { scrollIntoViewVisibly } from "../lib/scroll";
import { DiseaseSearchModal } from "./DiseaseSearchModal";
import { ErrorBanner } from "./ErrorBanner";
import { MedicalProcedureSearchModal } from "./MedicalProcedureSearchModal";
import { TrashIcon } from "./icons/TrashIcon";

// DPC 様式1 の入力フォーム(登録・編集共用)。画面は定義表(fhir/dpcForm1)から作る。
// 必須のレコードは最初から出し、条件を満たさないレコードは「項目を追加」で開く。
// 病名と手術だけは、登録病名・病名マスタ・診療行為マスタから選ぶボタンを足す。
// 手術基幹コード(STEM7)は、点数表コードの対応表に候補があれば選択式にする。

const SECTIONS = Object.keys(DPC1_SECTION_LABELS) as Dpc1Section[];

const SURGERY_RECORD = "A007010";
const SURGERY_K_CODE: Dpc1PayloadNo = 2;
const SURGERY_STEM7: Dpc1PayloadNo = 3;

// composite でまだ選んでいない部品の桁を埋める文字。選択肢に無い値なので、
// 確定時の検証で「すべての項目を選択してください」になる。
const UNSELECTED = "_";

/** 病名・手術を選ぶモーダルの行き先(どのレコードの何行目か)。 */
interface PickTarget {
  kind: "condition" | "disease" | "procedure";
  code: string;
  index: number;
}

interface DpcForm1FormProps {
  patientId: string;
  encounter: fhir4.Encounter;
  defs: Dpc1RecordDef[];
  initialValues: Dpc1Values;
  /** 入院時の年齢。 */
  age: number | null;
  /** 集め直すための情報。読み込み中は undefined。 */
  sources?: DpcForm1Sources;
  /** 確定済みの編集。下書きには戻せないので、保存は検証つきの「更新」だけにする。 */
  finalized: boolean;
  /** mdc6ByIcd は入力中の病名の診断群分類(必須条件の評価に使ったものと同じ)。 */
  onSubmit: (values: Dpc1Values, finalize: boolean, mdc6ByIcd: Record<string, string[]>) => void;
  submitting: boolean;
  submitError?: unknown;
  validationErrors: string[];
  /** 入力中の値(保存前)。診断群分類の判定に渡す。 */
  onValuesChange?: (values: Dpc1Values) => void;
}

export function DpcForm1Form({
  patientId,
  encounter,
  defs,
  initialValues,
  age,
  sources,
  finalized,
  onSubmit,
  submitting,
  submitError,
  validationErrors,
  onValuesChange,
}: DpcForm1FormProps) {
  const [values, setValues] = useState<Dpc1Values>(initialValues);
  useEffect(() => onValuesChange?.(values), [values, onValuesChange]);
  const [pick, setPick] = useState<PickTarget | null>(null);
  const [adding, setAdding] = useState("");

  // 検証エラーはフォームの先頭に出る。確定ボタンは一番下にあるので、出たら見える位置へ送る。
  const errorRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (validationErrors.length) scrollIntoViewVisibly(errorRef.current);
  }, [validationErrors]);

  const conditions = useKarteConditions(patientId);
  const mdc6 = useDpcMdc6(dpc1DiagnosisIcds(values));
  const stem7 = useDpcStem7Codes(
    (values.records[SURGERY_RECORD] ?? []).map((row) => row.p[SURGERY_K_CODE] ?? ""),
  );
  const ctx = useMemo(
    () => buildDpc1Context({ values, age, mdc6ByIcd: mdc6.data ?? {} }),
    [values, age, mdc6.data],
  );

  function setRows(code: string, rows: Dpc1Row[] | null) {
    setValues((v) => {
      const records = { ...v.records };
      if (rows) records[code] = rows;
      else delete records[code];
      return { ...v, records };
    });
  }

  /**
   * いつも出しておくレコード。必須のものに加えて、併存症・続発症・手術は「ある場合に入力」
   * でも毎回確かめる項目なので、行が無くても見出しと「行追加」を出す。
   */
  const alwaysShown = (def: Dpc1RecordDef): boolean =>
    dpc1RecordRequired(def, ctx) || Boolean(def.repeat && def.custom);

  /** 画面に出す行。必須なのにまだ行が無いレコードは、空の 1 行を出す。 */
  function rowsOf(def: Dpc1RecordDef): Dpc1Row[] {
    const rows = values.records[def.code] ?? [];
    if (rows.length || (def.repeat && !dpc1RecordRequired(def, ctx))) return rows;
    return [emptyDpc1Row()];
  }

  function setPayload(def: Dpc1RecordDef, index: number, payload: Dpc1PayloadNo, value: string) {
    const rows = rowsOf(def).map((row, i) => {
      if (i !== index) return row;
      const p = { ...row.p };
      if (value) p[payload] = value;
      else delete p[payload];
      return { ...row, p };
    });
    setRows(def.code, rows);
  }

  function replaceRow(code: string, index: number, next: Dpc1Row) {
    const def = defs.find((d) => d.code === code);
    if (!def) return;
    setRows(
      code,
      rowsOf(def).map((row, i) => (i === index ? next : row)),
    );
  }

  function handlePickedCondition(conditionId: string) {
    const condition = conditions.conditions.find((c) => c.id === conditionId);
    if (pick && condition) replaceRow(pick.code, pick.index, dpc1DiagnosisRowOfCondition(condition));
    setPick(null);
  }

  function handlePickedDisease(disease: Disease) {
    if (pick) replaceRow(pick.code, pick.index, dpc1DiagnosisRowOfDisease(disease));
    setPick(null);
  }

  function handlePickedProcedure(procedure: MedicalProcedure) {
    if (pick) {
      const def = defs.find((d) => d.code === pick.code);
      const current = def ? rowsOf(def)[pick.index] : undefined;
      const kCode = procedure.k_code ?? "";
      // 手術基幹コードは点数表コードで決まるので、術式を選び直したら空にして引き直す。
      const p = { ...current?.p, 2: kCode, 9: procedure.name ?? "" };
      delete p[SURGERY_STEM7];
      replaceRow(pick.code, pick.index, { p });
      if (kCode) void fillSingleStem7(pick.code, pick.index, kCode);
    }
    setPick(null);
  }

  /** 対応表の候補が 1 つなら、その行の手術基幹コードに入れる(点数表コードが変わっていなければ)。 */
  async function fillSingleStem7(code: string, index: number, kCode: string) {
    const single = singleDpcStem7(await fetchDpcStem7Codes([kCode]).catch(() => []));
    if (!single) return;
    setValues((v) => {
      const rows = v.records[code];
      const row = rows?.[index];
      if (!row || row.p[SURGERY_K_CODE] !== kCode || row.p[SURGERY_STEM7]) return v;
      const next = rows.map((r, i) => (i === index ? { ...r, p: { ...r.p, [SURGERY_STEM7]: single } } : r));
      return { ...v, records: { ...v.records, [code]: next } };
    });
  }

  /** 主傷病と同じ病名を、入院契機・医療資源の欄にも入れる。 */
  function copyMainDiagnosis() {
    const main = values.records.A006010?.[0];
    if (!main) return;
    setValues((v) => ({
      ...v,
      records: {
        ...v.records,
        A006020: [{ ...main, p: { ...main.p } }],
        // 病名付加コード(ペイロード 3)は医療資源の欄だけが持つので、入力済みなら残す。
        A006030: [
          {
            ...main,
            p: v.records.A006030?.[0]?.p[3]
              ? { ...main.p, 3: v.records.A006030[0].p[3] }
              : { ...main.p },
          },
        ],
      },
    }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit(values, true, mdc6.data ?? {});
  }

  // 病名の診断群分類を引いている間は、必須の項目がまだ決まらないので保存させない。
  const busy = submitting || mdc6.isFetching;

  const isShown = (def: Dpc1RecordDef) => alwaysShown(def) || Boolean(values.records[def.code]?.length);
  const hidden = defs.filter((def) => !isShown(def));

  return (
    <>
      <form className="patient-form dpc-form1" onSubmit={handleSubmit}>
        <ErrorBanner error={submitError} />
        <ErrorBanner error={conditions.error ?? mdc6.error ?? stem7.error} />
        {validationErrors.length > 0 && (
          <div className="error-banner" role="alert" ref={errorRef}>
            {validationErrors.map((message) => (
              <p key={message} className="error-banner__line error-banner__line--error">
                {message}
              </p>
            ))}
          </div>
        )}

        <dl className="prescription-detail__common">
          <dt>入院日</dt>
          <dd>{encounterAdmissionDate(encounter)}</dd>
          <dt>退院日</dt>
          <dd>{encounterDischargeDate(encounter)}</dd>
          <dt>診療科</dt>
          <dd>{encounterDepartmentName(encounter)}</dd>
          <dt>施設コード</dt>
          <dd>{values.header.facility || "-"}</dd>
          <dt>データ識別番号</dt>
          <dd>{values.header.dataId || "-"}</dd>
        </dl>

        {SECTIONS.map((section) => {
          const shown = defs.filter((def) => def.section === section && isShown(def));
          if (!shown.length) return null;
          return (
            <fieldset key={section} className="dpc-form1__section">
              <legend>{DPC1_SECTION_LABELS[section]}</legend>
              {shown.map((def) => {
                const rows = rowsOf(def);
                return (
                  <div key={def.code} className="dpc-form1__record">
                    <div className="dpc-form1__record-head">
                      <span className="dpc-form1__record-name">{recordLabel(def)}</span>
                      {def.code === "A006010" && (
                        <button
                          type="button"
                          className="rp-card__compact-button"
                          onClick={copyMainDiagnosis}
                        >
                          入院契機・医療資源へ複写
                        </button>
                      )}
                      {def.repeat && rows.length < def.repeat.max && (
                        <button
                          type="button"
                          className="rp-card__compact-button"
                          onClick={() => setRows(def.code, [...rows, emptyDpc1Row()])}
                        >
                          + 行追加
                        </button>
                      )}
                      {!alwaysShown(def) && !def.repeat && (
                        <RemoveButton
                          label={`${recordLabel(def) || def.name}を外す`}
                          onClick={() => setRows(def.code, null)}
                        />
                      )}
                    </div>
                    {rows.map((row, index) => (
                      <div key={index} className="dpc-form1__row">
                        {def.custom === "diagnosis" && (
                          <div className="dpc-form1__picks">
                            <button
                              type="button"
                              className="rp-card__compact-button"
                              onClick={() => setPick({ kind: "condition", code: def.code, index })}
                            >
                              登録病名から
                            </button>
                            <button
                              type="button"
                              className="rp-card__compact-button"
                              onClick={() => setPick({ kind: "disease", code: def.code, index })}
                            >
                              マスタ検索
                            </button>
                          </div>
                        )}
                        {def.custom === "surgery" && (
                          <div className="dpc-form1__picks">
                            <button
                              type="button"
                              className="rp-card__compact-button"
                              onClick={() => setPick({ kind: "procedure", code: def.code, index })}
                            >
                              マスタ検索
                            </button>
                          </div>
                        )}
                        {def.fields
                          .filter((field) => dpc1FieldVisible(def, field, ctx, index))
                          .map((field) => (
                            <FieldInput
                              key={field.payload}
                              field={fieldFor(def, field, row, stem7.data ?? {})}
                              required={dpc1FieldRequired(def, field, ctx, index)}
                              value={row.p[field.payload] ?? ""}
                              onChange={(value) => setPayload(def, index, field.payload, value)}
                            />
                          ))}
                        {def.repeat && (
                          <span className="dpc-form1__remove">
                            <RemoveButton
                              label="この行を削除"
                              onClick={() => {
                                const rest = rows.filter((_, i) => i !== index);
                                setRows(def.code, rest.length ? rest : null);
                              }}
                            />
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })}
            </fieldset>
          );
        })}

        {hidden.length > 0 && (
          <div className="dpc-form1__add">
            <label>
              項目を追加
              <select value={adding} onChange={(e) => setAdding(e.target.value)}>
                <option value="">選択してください</option>
                {hidden.map((def) => (
                  <option key={def.code} value={def.code}>
                    {DPC1_SECTION_LABELS[def.section]} / {recordLabel(def) || def.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="rp-card__compact-button"
              disabled={!adding}
              onClick={() => {
                setRows(adding, [emptyDpc1Row()]);
                setAdding("");
              }}
            >
              追加
            </button>
          </div>
        )}

        <div className="prescription-form__submit">
          <button
            type="button"
            disabled={!sources || submitting}
            onClick={() => sources && setValues((v) => draftDpcForm1(sources, today(), v))}
          >
            集め直す
          </button>
          {!finalized && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onSubmit(values, false, mdc6.data ?? {})}
            >
              下書き保存
            </button>
          )}
          <button type="submit" disabled={busy}>
            {submitting ? "送信中..." : finalized ? "更新" : "確定"}
          </button>
        </div>
      </form>

      {/* モーダルは form の外に置く(中に置くと、モーダル内の操作で外側が送信される)。 */}
      {pick?.kind === "condition" && (
        <ConditionPickerModal
          patientId={patientId}
          onSelect={({ conditionId }) => handlePickedCondition(conditionId)}
          onClose={() => setPick(null)}
        />
      )}
      {pick?.kind === "disease" && (
        <DiseaseSearchModal onSelect={handlePickedDisease} onClose={() => setPick(null)} />
      )}
      {pick?.kind === "procedure" && (
        <MedicalProcedureSearchModal
          defaultSection="K"
          onSelect={handlePickedProcedure}
          onClose={() => setPick(null)}
        />
      )}
    </>
  );
}

/**
 * レコードの見出し。定義表の名称は「患者プロファイル/褥瘡」のように区画の名前から始まる
 * ものがあるので、区画(fieldset の見出し)と重なる部分は出さない。
 */
function recordLabel(def: Dpc1RecordDef): string {
  const section = DPC1_SECTION_LABELS[def.section];
  if (def.name === section) return "";
  return def.name.startsWith(`${section}/`) ? def.name.slice(section.length + 1) : def.name;
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="rp-card__icon-button"
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      <TrashIcon />
    </button>
  );
}

/**
 * 画面に出すときの欄の定義。病名付加コードは、その行の ICD-10 で使える区分が決まるので、
 * 選択式に差し替える。手術基幹コードは、その行の点数表コードの候補があれば選択式にする
 * (使い分けは注意点に書かれている)。
 */
function fieldFor(
  def: Dpc1RecordDef,
  field: Dpc1FieldDef,
  row: Dpc1Row,
  stem7ByKCode: Record<string, DpcStem7Code[]>,
): Dpc1FieldDef {
  if (def.code === SURGERY_RECORD && field.payload === SURGERY_STEM7) {
    const candidates = stem7ByKCode[normalizeDpcKCode(row.p[SURGERY_K_CODE] ?? "")] ?? [];
    if (!candidates.length) return field;
    const options = candidates
      .filter((c, i) => candidates.findIndex((other) => other.stem7 === c.stem7) === i)
      .map((c) => ({ code: c.stem7, label: c.note ?? "" }));
    return { ...field, kind: "select", options };
  }
  if (def.code !== "A006030" || field.payload !== 3) return field;
  const icd = row.p[2] ?? "";
  const options = DISEASE_SUFFIX_OPTIONS.find((entry) => icdMatches(icd, entry.patterns))?.options;
  return options ? { ...field, kind: "select", options } : field;
}

function FieldInput({
  field,
  required,
  value,
  onChange,
}: {
  field: Dpc1FieldDef;
  required: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  const label = required ? `${field.label}(必須)` : field.label;
  const special = field.specials?.find((s) => s.code === value);

  if (field.kind === "composite") {
    return (
      <CompositeInput label={label} field={field} value={value} onChange={onChange} />
    );
  }

  return (
    <label
      className={
        field.kind === "text" && !field.maxLength && !field.pattern
          ? "dpc-form1__field dpc-form1__field--wide"
          : "dpc-form1__field"
      }
    >
      {label}
      <span className="dpc-form1__control">
        {!special && <ValueInput field={field} value={value} onChange={onChange} />}
        {field.specials && (
          <select value={special?.code ?? ""} onChange={(e) => onChange(e.target.value)}>
            <option value="">{special ? "値を入力" : "-"}</option>
            {field.specials.map((s) => (
              <option key={s.code} value={s.code}>
                {s.label}
              </option>
            ))}
          </select>
        )}
      </span>
    </label>
  );
}

function ValueInput({
  field,
  value,
  onChange,
}: {
  field: Dpc1FieldDef;
  value: string;
  onChange: (value: string) => void;
}) {
  switch (field.kind) {
    case "date":
      return (
        <input
          type="date"
          value={fromDpcDate(value)}
          onChange={(e) => onChange(toDpcDate(e.target.value))}
        />
      );
    case "select":
      return (
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">未選択</option>
          {optionsWithCurrent(field.options ?? [], value).map((option) => (
            <option key={option.code} value={option.code}>
              {option.code} {option.label}
            </option>
          ))}
        </select>
      );
    case "digits":
    case "number":
      return (
        <input
          type="text"
          inputMode="numeric"
          value={value}
          maxLength={field.digits ?? field.maxLength}
          onChange={(e) => onChange(e.target.value.trim())}
        />
      );
    case "decimal1":
      return (
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value.trim())}
        />
      );
    default:
      return <input type="text" value={value} onChange={(e) => onChange(e.target.value)} />;
  }
}

/** 保存済みの値が選択肢に無いとき(定義表が変わったなど)も、値を消さずに出す。 */
function optionsWithCurrent(options: Dpc1Option[], value: string): Dpc1Option[] {
  return !value || options.some((o) => o.code === value)
    ? options
    : [...options, { code: value, label: "" }];
}

function CompositeInput({
  label,
  field,
  value,
  onChange,
}: {
  label: string;
  field: Dpc1FieldDef;
  value: string;
  onChange: (value: string) => void;
}) {
  const parts = field.parts ?? [];
  const lengths = parts.map((part) => part.options[0]?.code.length ?? 1);
  const blank = (i: number) => UNSELECTED.repeat(lengths[i]);
  const codes = splitDpc1Composite(field, value) ?? parts.map((_, i) => blank(i));

  function setPart(index: number, code: string) {
    const next = codes.map((c, i) => (i === index ? code || blank(i) : c));
    // どの部品も選んでいなければ未入力に戻す(必須の検証が「未入力」として働くように)。
    onChange(next.every((c, i) => c === blank(i)) ? "" : next.join(""));
  }

  return (
    <div className="dpc-form1__composite">
      <span className="dpc-form1__composite-label">{label}</span>
      <div className="dpc-form1__composite-parts">
        {parts.map((part, index) => (
          <label key={part.label}>
            {part.label}
            <select
              value={codes[index] === blank(index) ? "" : codes[index]}
              onChange={(e) => setPart(index, e.target.value)}
            >
              <option value="">未選択</option>
              {part.options.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.code} {option.label}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </div>
  );
}
