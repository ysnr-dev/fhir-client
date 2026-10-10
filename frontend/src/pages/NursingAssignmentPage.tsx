import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useCurrentPractitioner } from "../api/authQueries";
import type { NursingAssignment } from "../api/masterClient";
import { useReplaceNursingAssignments, useWardNursingAssignments } from "../api/masterQueries";
import { useNurseOptions, useWardOptions } from "../api/queries";
import { DateStepper } from "../components/DateStepper";
import { ErrorBanner } from "../components/ErrorBanner";
import { PatientKana } from "../components/PatientRowCells";
import { RowMenu } from "../components/RowMenu";
import { TruncatedNotice } from "../components/TruncatedNotice";
import { encounterNurseIds, encounterNurseNames, nurseParticipants } from "../fhir/encounterHelpers";
import { displayJapaneseName } from "../fhir/humanName";
import { locationDisplayName } from "../fhir/locationHelpers";
import { SHIFT_OPTIONS, type ShiftCode } from "../fhir/nursingScheduleHelpers";
import { displayName } from "../fhir/patientHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { addDays } from "../fhir/scheduleHelpers";
import { useWardInpatients } from "../hooks/useWardInpatients";
import { today } from "../lib/dates";
import { useReturnLinkState } from "../returnTo";

// 業務分担。病棟の 1 日を勤務帯(日勤・準夜・深夜)ごとに、患者 1 人に看護師 1 人を割り付ける。
// 割り付けは backend の nursing_assignments に持ち(病棟 × 日 × 勤務帯をまとめて置き換える)、
// 看護ワークシートの「担当」とホームの担当患者が読む。
//
// 入院の担当看護師(Encounter.participant)は入院期間を通した受け持ちで、こちらはその日の勤務の
// 受け持ち。担当看護師は「担当看護師で埋める」の初期値にだけ使う。

/** 編集中の割り付け。`${shift}:${patientId}` → 看護師の Practitioner.id。 */
type Draft = Map<string, string>;

function cellKey(shift: ShiftCode, patientId: string): string {
  return `${shift}:${patientId}`;
}

function draftOf(assignments: NursingAssignment[]): Draft {
  return new Map(assignments.map((a) => [cellKey(a.shift, a.patient_id), a.practitioner_id]));
}

export function NursingAssignmentPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const wardId = searchParams.get("ward") ?? "";
  const date = searchParams.get("date") || today();
  const returnLinkState = useReturnLinkState();

  const wardOptions = useWardOptions();
  const inpatients = useWardInpatients(date, wardId || undefined);
  const nurseOptions = useNurseOptions();
  const assignments = useWardNursingAssignments(wardId || undefined, date);
  const previous = useWardNursingAssignments(wardId || undefined, addDays(date, -1));
  const replace = useReplaceNursingAssignments();
  const me = useCurrentPractitioner();

  // 勤務帯の列が並ぶのでこの画面だけ幅を広げる(他の病棟の一覧と同じ)。
  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  // 保存前の編集。null のあいだは保存済みの割り付けをそのまま出す。
  const [draft, setDraft] = useState<Draft | null>(null);
  useEffect(() => setDraft(null), [wardId, date]);

  function setParams(next: Record<string, string>, replaceHistory = false) {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    setSearchParams(params, { replace: replaceHistory });
  }

  // 病棟が未指定なら先頭の病棟を開く(指示簿と同じ)。
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current || wardId) return;
    const first = wardOptions.wards[0];
    if (!first?.id) return;
    initialized.current = true;
    setParams({ ward: first.id }, true);
    // 初回に一度だけ動けばよい。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wardId, wardOptions.wards]);

  const saved = useMemo(() => draftOf(assignments.data ?? []), [assignments.data]);
  const current = draft ?? saved;
  const dirty = draft !== null;

  // 選択肢の看護師。看護職のロールを持たない入院の担当看護師や、割り付け済みでロールから
  // 外れた人も、選んだ値の名前を出せるよう足しておく。
  const nurses = useMemo(() => {
    const list = nurseOptions.nurses.map((p) => ({ id: p.id ?? "", name: practitionerDisplayName(p) }));
    const known = new Set(list.map((n) => n.id));
    const add = (id: string | undefined, name: string | undefined | null) => {
      if (!id || known.has(id)) return;
      known.add(id);
      list.push({ id, name: name || id });
    };
    for (const row of inpatients.rows) {
      for (const participant of nurseParticipants(row.encounter)) {
        add(participant.individual?.reference?.split("/").pop(), participant.individual?.display);
      }
    }
    for (const a of assignments.data ?? []) add(a.practitioner_id, a.practitioner_name);
    return list;
  }, [nurseOptions.nurses, inpatients.rows, assignments.data]);
  const nurseName = (id: string) => nurses.find((n) => n.id === id)?.name ?? id;

  function edit(update: (next: Draft) => void) {
    const next = new Map(current);
    update(next);
    setDraft(next);
  }

  function setCell(shift: ShiftCode, patientId: string, practitionerId: string) {
    edit((next) => {
      if (practitionerId) next.set(cellKey(shift, patientId), practitionerId);
      else next.delete(cellKey(shift, patientId));
    });
  }

  /** 空いている枠を入院の担当看護師(先頭の 1 人)で埋める。 */
  function fillFromPrimary(shift: ShiftCode) {
    edit((next) => {
      for (const row of inpatients.rows) {
        const key = cellKey(shift, row.patientId);
        const primary = encounterNurseIds(row.encounter)[0];
        if (!next.has(key) && primary) next.set(key, primary);
      }
    });
  }

  function clearShift(shift: ShiftCode) {
    edit((next) => {
      for (const row of inpatients.rows) next.delete(cellKey(shift, row.patientId));
    });
  }

  /** 前日の割り付けを、今日もこの病棟に居る患者の分だけ写す(空いている枠だけ)。 */
  function copyPrevious() {
    edit((next) => {
      for (const a of previous.data ?? []) {
        const key = cellKey(a.shift, a.patient_id);
        if (!next.has(key) && inpatients.rows.some((row) => row.patientId === a.patient_id)) {
          next.set(key, a.practitioner_id);
        }
      }
    });
  }

  function save() {
    const patientIds = new Set(inpatients.rows.map((row) => row.patientId));
    const items = [...current.entries()]
      .map(([key, practitionerId]) => {
        const [shift, patientId] = key.split(":") as [ShiftCode, string];
        return { shift, patient_id: patientId, practitioner_id: practitionerId, practitioner_name: nurseName(practitionerId) };
      })
      // 病棟を出た患者の割り付けは残さない。
      .filter((item) => patientIds.has(item.patient_id));
    replace.mutate(
      {
        ward_id: wardId,
        assigned_on: date,
        shifts: SHIFT_OPTIONS.map((o) => o.code),
        items,
        assigned_by_name: me.practitioner ? displayJapaneseName(me.practitioner.name) : undefined,
      },
      { onSuccess: () => setDraft(null) },
    );
  }

  // 勤務帯ごとの看護師別の受け持ち人数。
  const counts = useMemo(() => {
    const byShift = new Map<ShiftCode, Map<string, number>>();
    const patientIds = new Set(inpatients.rows.map((row) => row.patientId));
    for (const [key, practitionerId] of current) {
      const [shift, patientId] = key.split(":") as [ShiftCode, string];
      if (!patientIds.has(patientId)) continue;
      const map = byShift.get(shift) ?? new Map<string, number>();
      map.set(practitionerId, (map.get(practitionerId) ?? 0) + 1);
      byShift.set(shift, map);
    }
    return byShift;
  }, [current, inpatients.rows]);

  return (
    <div className="page">
      <div className="page__header">
        <h1>業務分担</h1>
        <div className="page__header-actions">
          <Link className="button" to={`/nursing-worksheet?ward=${wardId}&date=${date}`}>
            ワークシート
          </Link>
        </div>
      </div>

      <form className="patient-search-form" onSubmit={(e: FormEvent) => e.preventDefault()}>
        <label>
          日付
          <DateStepper value={date} onChange={(value) => value && setParams({ date: value })} />
        </label>
        <label>
          病棟
          <select value={wardId} onChange={(e) => setParams({ ward: e.target.value })}>
            {wardOptions.wards.map((ward) => (
              <option key={ward.id} value={ward.id}>
                {locationDisplayName(ward)}
              </option>
            ))}
          </select>
        </label>
        <div className="patient-search-form__actions">
          <button type="button" onClick={copyPrevious} disabled={!previous.data?.length}>
            前日複写
          </button>
          <button type="button" onClick={() => setDraft(null)} disabled={!dirty || replace.isPending}>
            取消
          </button>
          <button type="button" onClick={save} disabled={!dirty || !wardId || replace.isPending}>
            保存
          </button>
        </div>
      </form>

      <ErrorBanner error={wardOptions.error} />
      <ErrorBanner error={inpatients.error} />
      <ErrorBanner error={nurseOptions.error} />
      <ErrorBanner error={assignments.error} />
      <ErrorBanner error={replace.error} />
      <TruncatedNotice show={inpatients.truncated} />

      {!wardId ? (
        <p className="patient-table__empty">病棟を選んでください。</p>
      ) : inpatients.isLoading || assignments.isLoading ? (
        <p>読み込み中...</p>
      ) : (
        <>
          <div className="lab-worklist-wrap">
            <table className="lab-worklist nursing-assignment">
              <thead>
                <tr>
                  <th className="lab-worklist__compact">病室</th>
                  <th>患者</th>
                  <th className="lab-worklist__compact">担当看護師</th>
                  {SHIFT_OPTIONS.map((option) => (
                    <th key={option.code} className="nursing-assignment__shift">
                      {option.display}
                      <RowMenu label={`${option.display}の操作`} escapesClipping>
                        <button
                          type="button"
                          className="row-menu__item"
                          onClick={() => fillFromPrimary(option.code)}
                        >
                          担当看護師で埋める
                        </button>
                        <button
                          type="button"
                          className="row-menu__item"
                          onClick={() => clearShift(option.code)}
                        >
                          クリア
                        </button>
                      </RowMenu>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {inpatients.rows.map((row) => (
                  <tr key={row.patientId}>
                    <td className="lab-worklist__compact">{row.bedLabel}</td>
                    <td>
                      {row.patient ? (
                        <>
                          <Link to={`/patients/${row.patientId}/karte`} state={returnLinkState}>
                            {displayName(row.patient)}
                          </Link>
                          <PatientKana patient={row.patient} />
                        </>
                      ) : (
                        row.patientId
                      )}
                    </td>
                    <td className="lab-worklist__compact">
                      {encounterNurseNames(row.encounter).join("、")}
                    </td>
                    {SHIFT_OPTIONS.map((option) => {
                      const value = current.get(cellKey(option.code, row.patientId)) ?? "";
                      const changed = dirty && value !== (saved.get(cellKey(option.code, row.patientId)) ?? "");
                      return (
                        <td key={option.code} className="nursing-assignment__shift">
                          <select
                            className={changed ? "nursing-assignment__changed" : undefined}
                            value={value}
                            onChange={(e) => setCell(option.code, row.patientId, e.target.value)}
                            aria-label={`${row.patient ? displayName(row.patient) : row.patientId} の${option.display}`}
                          >
                            <option value="">-</option>
                            {nurses.map((nurse) => (
                              <option key={nurse.id} value={nurse.id}>
                                {nurse.name}
                              </option>
                            ))}
                          </select>
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {inpatients.rows.length === 0 && (
                  <tr>
                    <td colSpan={3 + SHIFT_OPTIONS.length} className="master-search__empty">
                      この日に病棟に居る患者はいません。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <dl className="nursing-assignment__counts">
            {SHIFT_OPTIONS.map((option) => {
              const map = counts.get(option.code);
              return (
                <div key={option.code}>
                  <dt>{option.display}</dt>
                  <dd>
                    {map && map.size > 0
                      ? [...map.entries()]
                          .sort((a, b) => b[1] - a[1])
                          .map(([id, count]) => `${nurseName(id)} ${count}名`)
                          .join("、")
                      : "-"}
                  </dd>
                </div>
              );
            })}
          </dl>
        </>
      )}
    </div>
  );
}
