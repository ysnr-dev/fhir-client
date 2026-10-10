import { useMemo, useState } from "react";
import { useCurrentPractitioner } from "../api/authQueries";
import { useAcuityRecordsForPatients, useSaveAcuity } from "../api/queries";
import {
  acuityColumns,
  acuityCriterionLabel,
  acuityGroupsOf,
  acuityScores,
  acuityStateOptions,
  acuityStateValue,
  acuitySuggestions,
  buildAcuityObservation,
  initialAcuityValues,
  meetsAcuityCriterion,
  parseAcuityObservation,
  withAcuityState,
  type AcuityColumn,
  type AcuityCriteria,
  type AcuityForm,
  type AcuityGroup,
  type AcuityValues,
} from "../fhir/nursingAcuityHelpers";
import type { AcuityUnit } from "../fhir/nursingAcuityUnitHelpers";
import { displayName } from "../fhir/patientHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { referenceId } from "../fhir/shared";
import type { WardInpatient } from "../hooks/useWardInpatients";
import { ErrorBanner } from "./ErrorBanner";
import { NursingAcuityModal } from "./NursingAcuityModal";
import { TruncatedNotice } from "./TruncatedNotice";

// 看護必要度の評価(docs/nursing-acuity-design.md §3)。行 = 届出単位(病棟・病室)の患者、列 = 評価票の項目のグリッドで、
// A・C の項目(A6 は小項目ごと)はセルを押して「あり / なし」を切り替え、B の項目はセレクトで選ぶ
// (介助の実施を掛ける項目は「状態・介助あり / なし」を 1 つのセレクトに並べる)。
//
// 初期値は 1 人ずつのモーダルと同じ(評価済みはその値、未評価は前日の B と実施記録から推した A)。
// 登録するのは行の先頭のチェックを付けた患者だけで、セルを触った行には自動で付く(未評価の患者の
// 初期値を確かめないまま登録しないため)。登録は 1 つの transaction。

const GROUP_LABELS: Record<AcuityGroup, string> = { A: "A", B: "B", C: "C" };

/** 右端の得点の列。r1 / r2 は割合1・割合2の該当。版に無い区分(ICU・HCU 用の C)と使わない割合2は出さない。 */
const SCORE_COLUMNS = [
  { key: "A", label: "A" },
  { key: "B", label: "B" },
  { key: "C", label: "C" },
  { key: "r1", label: "割合1" },
  { key: "r2", label: "割合2" },
] as const;

function scoreColumns(form: AcuityForm, criteria: AcuityCriteria) {
  const groups = acuityGroupsOf(form);
  return SCORE_COLUMNS.filter((c) => {
    if (c.key === "r1") return true;
    if (c.key === "r2") return criteria.ratio2.length > 0;
    return (groups as string[]).includes(c.key);
  });
}

interface Props {
  rows: WardInpatient[];
  /** 患者 id → その日・前日の評価。 */
  byPatient: Map<string, { today?: fhir4.Observation; previous?: fhir4.Observation }>;
  date: string;
  /** 届出単位(評価票の版・基準・評価に焼く病棟 id)。 */
  unit: AcuityUnit;
}

interface RowState {
  row: WardInpatient;
  form: AcuityForm;
  baseline: AcuityValues;
  existing?: fhir4.Observation;
  /** 推した項目のコード → 根拠。 */
  reasons: Map<string, string>;
}

export function NursingAcuityBulkGrid({ rows, byPatient, date, unit }: Props) {
  const records = useAcuityRecordsForPatients(
    rows.map((row) => row.patientId),
    date,
  );
  const save = useSaveAcuity();
  const me = useCurrentPractitioner();
  const settingsForm = unit.form;
  const criteria = unit.criteria;
  const ward = { wardId: unit.id, wardName: unit.name };
  const columns = useMemo(() => acuityColumns(settingsForm), [settingsForm]);
  const groups = acuityGroupsOf(settingsForm).map((group) => ({
    group,
    span: columns.filter((column) => column.group === group).length,
  }));
  const scores = scoreColumns(settingsForm, criteria);

  // 患者ごとの初期値。評価済みはその値、未評価は前日の B と記録から推した A。
  const rowStates = useMemo<RowState[]>(() => {
    // 実施記録・処方は病棟の患者ぶんまとめて引いているので、患者ごとに分けて渡す。
    const ofPatient = <T extends { subject?: fhir4.Reference }>(list: T[] | undefined, patientId: string) =>
      (list ?? []).filter((resource) => referenceId(resource.subject?.reference) === patientId);
    return rows.map((row) => {
      const own = byPatient.get(row.patientId);
      if (own?.today) {
        const parsed = parseAcuityObservation(own.today);
        return { row, form: parsed.form, baseline: parsed.values, existing: own.today, reasons: new Map() };
      }
      const { suggestions } = acuitySuggestions({
        form: settingsForm,
        date,
        encounter: row.encounter,
        procedures: ofPatient(records.data?.procedures, row.patientId),
        administrations: ofPatient(records.data?.administrations, row.patientId),
        prescriptions: ofPatient(records.data?.prescriptions, row.patientId),
        prescriptionItems: ofPatient(records.data?.prescriptionItems, row.patientId),
        acuityCodes: records.data?.acuityCodes ?? [],
      });
      return {
        row,
        form: settingsForm,
        baseline: initialAcuityValues(settingsForm, own?.previous, suggestions),
        reasons: new Map(suggestions.map((s) => [s.code, s.reason])),
      };
    });
  }, [rows, byPatient, records.data, date, settingsForm]);

  // 触った行の入力値と、登録する行。
  const [drafts, setDrafts] = useState<Map<string, AcuityValues>>(new Map());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // マウスの乗っている列(列の key)。行は :hover で塗るので、列はここで覚えて見出しとセルに色を敷く
  // (看護ワークシートと同じ)。
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const hoverClass = (key: string) => (key === hoverKey ? " is-col-hover" : "");
  // 1 人ずつの評価(モーダル)を開いている患者。
  const [openPatientId, setOpenPatientId] = useState<string | null>(null);
  const openState = rowStates.find((state) => state.row.patientId === openPatientId) ?? null;

  /** モーダルで保存した患者は、グリッドで入力途中だった値と登録の対象から外す(保存した値を読み直して出す)。 */
  function discardRow(patientId: string) {
    setDrafts((prev) => {
      const next = new Map(prev);
      next.delete(patientId);
      return next;
    });
    toggleSelected(patientId, false);
  }

  function valuesOf(state: RowState): AcuityValues {
    return drafts.get(state.row.patientId) ?? state.baseline;
  }

  function edit(state: RowState, update: (values: AcuityValues) => AcuityValues) {
    const patientId = state.row.patientId;
    setDrafts((prev) => new Map(prev).set(patientId, update(prev.get(patientId) ?? state.baseline)));
    setSelected((prev) => new Set(prev).add(patientId));
  }

  function toggleSelected(patientId: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(patientId);
      else next.delete(patientId);
      return next;
    });
  }

  function handleSave() {
    const performer =
      me.practitionerId && me.practitioner
        ? { id: me.practitionerId, name: practitionerDisplayName(me.practitioner) }
        : null;
    const observations = rowStates
      .filter((state) => selected.has(state.row.patientId))
      .map((state) =>
        buildAcuityObservation({
          form: state.form,
          values: valuesOf(state),
          patientId: state.row.patientId,
          encounterId: state.row.encounter.id ?? "",
          date,
          ward,
          performer,
          existing: state.existing,
        }),
      );
    if (observations.length === 0) return;
    save.mutate(observations, {
      onSuccess: () => {
        setDrafts(new Map());
        setSelected(new Set());
      },
    });
  }

  const allSelected = rowStates.length > 0 && rowStates.every((state) => selected.has(state.row.patientId));

  if (records.isLoading) return <p>読み込み中...</p>;

  return (
    <>
      <ErrorBanner error={records.error} />
      <ErrorBanner error={save.error} />
      <TruncatedNotice show={records.data?.truncated} />
      <div className="nursing-acuity-bulk__actions">
        <button type="button" onClick={handleSave} disabled={selected.size === 0 || save.isPending}>
          {save.isPending ? "登録中..." : "登録"}
        </button>
      </div>
      <div className="lab-worklist-wrap sticky-table-wrap">
        <table className="sticky-table nursing-acuity-bulk" onMouseLeave={() => setHoverKey(null)}>
          {/* 見出しは 3 段。1 段目は A・B・C の区分、2 段目は項目(縦書き。A6 だけは「6 専門的な治療・処置」を
              小項目の列にまたがって横に置く)、3 段目は A6 の小項目。A6 以外の項目・対象外・得点は 2〜3 段目を
              縦につないで、項目名の上端を揃える。 */}
          {/* 列の幅(table-layout: fixed は 1 行目の見出しから幅を決めるので、列ごとの幅はここで渡す)。
              表は画面の幅いっぱいに広げ、余った幅はこの比で割り振られる。 */}
          <colgroup>
            <col className="nursing-acuity-bulk__col-patient" />
            {columns.map((column) => (
              <col
                key={column.key}
                className={column.kind === "state" ? "nursing-acuity-bulk__col-state" : "nursing-acuity-bulk__col-check"}
              />
            ))}
            <col className="nursing-acuity-bulk__col-check" />
            {scores.map((c) => (
              <col key={c.key} className="nursing-acuity-bulk__col-score" />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th rowSpan={3} className="sticky-table__fix-1 nursing-acuity-bulk__patient">
                <label className="nursing-acuity-bulk__select">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={(e) =>
                      setSelected(e.target.checked ? new Set(rowStates.map((s) => s.row.patientId)) : new Set())
                    }
                    aria-label="すべての患者を登録の対象にする"
                  />
                  患者
                </label>
              </th>
              {groups.map(({ group, span }) => (
                <th key={group} colSpan={span} className={`nursing-acuity-bulk__group nursing-acuity-bulk__group--${group}`}>
                  {GROUP_LABELS[group]}
                </th>
              ))}
              <th className="nursing-acuity-bulk__group" aria-hidden="true"></th>
              <th colSpan={scores.length} className="nursing-acuity-bulk__group">
                得点
              </th>
            </tr>
            <tr>
              {columns.map((column, index) => {
                if (column.parent) {
                  // 小項目の列のまとまりの先頭でだけ、親の項目を列の数ぶん横にまたいで置く。
                  if (columns[index - 1]?.parent?.code === column.parent.code) return null;
                  const span = columns.filter((c) => c.parent?.code === column.parent?.code).length;
                  return (
                    <th
                      key={column.parent.code}
                      colSpan={span}
                      className="nursing-acuity-bulk__parent"
                      title={`${column.group}${column.parent.number} ${column.parent.label}`}
                    >
                      <span className="nursing-acuity-bulk__head-number-inline">{column.parent.number}</span>
                      {column.parent.label}
                    </th>
                  );
                }
                return <HeadCell key={column.key} column={column} rowSpan={2} hoverClass={hoverClass(column.key)} />;
              })}
              <th rowSpan={2} className={`nursing-acuity-bulk__head${hoverClass("excluded")}`}>
                <span className="nursing-acuity-bulk__head-text">対象外</span>
              </th>
              {scores.map((c) => (
                <th
                  key={c.key}
                  rowSpan={2}
                  className={`nursing-acuity-bulk__score-head${hoverClass(c.key)}`}
                  // 割合1・割合2は該当患者の基準を吹き出しに出す。
                  title={criterionTitle(c.key, criteria)}
                >
                  {c.label}
                </th>
              ))}
            </tr>
            <tr>
              {columns
                .filter((column) => column.parent)
                .map((column) => (
                  <HeadCell key={column.key} column={column} sub hoverClass={hoverClass(column.key)} />
                ))}
            </tr>
          </thead>
          <tbody>
            {rowStates.map((state) => {
              const values = valuesOf(state);
              const rowScores = values.excluded ? null : acuityScores(state.form, values);
              const r1 = rowScores ? meetsAcuityCriterion(rowScores, criteria.ratio1, values.checks) : null;
              const r2 = rowScores ? meetsAcuityCriterion(rowScores, criteria.ratio2, values.checks) : null;
              const patientId = state.row.patientId;
              const dirty = drafts.has(patientId);
              return (
                <tr
                  key={patientId}
                  className={[
                    values.excluded ? "nursing-acuity-bulk__row--excluded" : "",
                    !state.existing && !dirty ? "nursing-acuity-bulk__row--initial" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <th className="sticky-table__fix-1 nursing-acuity-bulk__patient" onMouseEnter={() => setHoverKey(null)}>
                    <span className="nursing-acuity-bulk__select">
                      <input
                        type="checkbox"
                        checked={selected.has(patientId)}
                        onChange={(e) => toggleSelected(patientId, e.target.checked)}
                        aria-label={`${state.row.patient ? displayName(state.row.patient) : patientId} を登録の対象にする`}
                      />
                      {/* 氏名を押すと 1 人ずつの評価(対象外の理由・手術の目安・前日複写など)を開く。 */}
                      <button
                        type="button"
                        className="nursing-acuity-bulk__name"
                        onClick={() => setOpenPatientId(patientId)}
                      >
                        {state.row.patient ? displayName(state.row.patient) : patientId}
                      </button>
                    </span>
                    <span className="nursing-acuity-bulk__status">
                      {state.row.bedLabel.split(" ")[0]} ・ {dirty ? "変更あり" : state.existing ? "評価済" : "未評価"}
                    </span>
                  </th>
                  {columns.map((column) => (
                    <Cell
                      key={column.key}
                      hover={column.key === hoverKey}
                      onHover={() => setHoverKey(column.key)}
                      column={column}
                      values={values}
                      reason={state.reasons.get(column.code)}
                      disabled={values.excluded}
                      onChange={(update) => edit(state, update)}
                    />
                  ))}
                  <td
                    className={`nursing-acuity-bulk__cell${hoverClass("excluded")}`}
                    onMouseEnter={() => setHoverKey("excluded")}
                  >
                    <button
                      type="button"
                      className={`nursing-acuity-bulk__toggle${values.excluded ? " is-on" : ""}`}
                      aria-pressed={values.excluded}
                      title="対象外"
                      onClick={() => edit(state, (v) => ({ ...v, excluded: !v.excluded }))}
                    >
                      {values.excluded ? "●" : ""}
                    </button>
                  </td>
                  {scores.map((c) => {
                    const met = c.key === "r1" ? r1 : c.key === "r2" ? r2 : null;
                    const value =
                      c.key === "r1" || c.key === "r2"
                        ? met ? <span className="nursing-acuity__met">該当</span> : "-"
                        : (rowScores?.[c.key as AcuityGroup] ?? "-");
                    return (
                      <td
                        key={c.key}
                        className={`nursing-acuity-bulk__score${hoverClass(c.key)}`}
                        onMouseEnter={() => setHoverKey(c.key)}
                      >
                        {value}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {rowStates.length === 0 && (
              <tr>
                <td colSpan={columns.length + 2 + scores.length} className="master-search__empty">
                  この日に居る患者はいません。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {openState && (
        <NursingAcuityModal
          patientId={openState.row.patientId}
          patientName={openState.row.patient ? displayName(openState.row.patient) : openState.row.patientId}
          encounter={openState.row.encounter}
          date={date}
          unit={unit}
          existing={openState.existing}
          previous={byPatient.get(openState.row.patientId)?.previous}
          onSaved={() => discardRow(openState.row.patientId)}
          onClose={() => setOpenPatientId(null)}
        />
      )}
    </>
  );
}

/** 割合1・割合2の見出しの吹き出し(該当患者の基準)。それ以外の列は無し。 */
function criterionTitle(key: string, criteria: AcuityCriteria): string | undefined {
  if (key === "r1") return `割合1: ${acuityCriterionLabel(criteria.ratio1)}`;
  if (key === "r2") return `割合2: ${acuityCriterionLabel(criteria.ratio2)}`;
  return undefined;
}

/** 項目の列見出し(縦書き。先頭に項目番号、A6 の小項目は丸数字)。 */
function HeadCell({
  column,
  rowSpan,
  sub,
  hoverClass,
}: {
  column: AcuityColumn;
  rowSpan?: number;
  sub?: boolean;
  hoverClass: string;
}) {
  return (
    <th
      rowSpan={rowSpan}
      className={[
        "nursing-acuity-bulk__head",
        `nursing-acuity-bulk__head--${column.kind}`,
        sub ? "nursing-acuity-bulk__head--sub" : "",
      ]
        .filter(Boolean)
        .join(" ") + hoverClass}
      title={column.title}
    >
      <span className="nursing-acuity-bulk__head-text">
        <span className="nursing-acuity-bulk__head-number">{column.number}</span>
        {column.header}
      </span>
    </th>
  );
}

/** グリッドの 1 セル。A・C は押して「あり」を切り替え、B はセレクト。 */
function Cell({
  hover,
  onHover,
  column,
  values,
  reason,
  disabled,
  onChange,
}: {
  hover: boolean;
  onHover: () => void;
  column: AcuityColumn;
  values: AcuityValues;
  reason: string | undefined;
  disabled: boolean;
  onChange: (update: (values: AcuityValues) => AcuityValues) => void;
}) {
  if (column.kind === "state" && column.stateItem) {
    const item = column.stateItem;
    return (
      <td
        className={`nursing-acuity-bulk__cell nursing-acuity-bulk__cell--state${hover ? " is-col-hover" : ""}`}
        onMouseEnter={onHover}
      >
        <select
          value={acuityStateValue(item, values)}
          disabled={disabled}
          onChange={(e) => onChange((v) => withAcuityState(item, v, e.target.value))}
          aria-label={column.title}
          title={column.title}
        >
          {acuityStateOptions(item).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </td>
    );
  }
  const on = values.checks.includes(column.code);
  return (
    <td className={`nursing-acuity-bulk__cell${hover ? " is-col-hover" : ""}`} onMouseEnter={onHover}>
      <button
        type="button"
        className={`nursing-acuity-bulk__toggle${on ? " is-on" : ""}${on && reason ? " is-suggested" : ""}`}
        aria-pressed={on}
        disabled={disabled}
        title={reason ? `${column.title}\n記録: ${reason}` : column.title}
        onClick={() =>
          onChange((v) => ({
            ...v,
            checks: on ? v.checks.filter((c) => c !== column.code) : [...v.checks, column.code],
          }))
        }
      >
        {on ? "●" : ""}
      </button>
    </td>
  );
}
