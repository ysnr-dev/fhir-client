import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  useCancelAdmission,
  useInpatientEncounters,
  useWardGrid,
  useWardOptions,
} from "../api/queries";
import { AdmissionModal } from "../components/AdmissionModal";
import { DischargeModal } from "../components/DischargeModal";
import { ErrorBanner } from "../components/ErrorBanner";
import { RowMenu } from "../components/RowMenu";
import {
  encounterAdmissionDate,
  encounterAttendingId,
  encounterAttendingName,
  encounterDepartmentId,
  encounterDepartmentName,
  encounterNote,
  encounterNurseIds,
  encounterNurseNames,
  encounterPatientId,
} from "../fhir/encounterHelpers";
import { locationDisplayName } from "../fhir/locationHelpers";
import {
  ageWithMonthsLabel,
  displayKana,
  displayName,
  genderLabel,
} from "../fhir/patientHelpers";
import { addDays } from "../fhir/scheduleHelpers";
import { bedDisplayName, bedNumber } from "../fhir/wardHelpers";
import { useKarteLinkState } from "../karteReturn";
import { today } from "../lib/dates";

// 入院患者一覧。病棟を選ぶと、その病棟の病室・ベッドを 1 行 1 床で並べ、
// 埋まっている床には入院中の患者を、空いている床には「患者選択」を出す。
//
// 入院は Encounter(fhir/encounterHelpers.ts)。ベッドの Location と Encounter を
// ベッド id で突き合わせるだけなので、病室・ベッドの側は病棟マスタそのまま。
//
// 選んだ病棟と日付は URL の ?ward= / ?date= に持つ。カルテへ渡す戻り先(karteFrom)は
// 検索文字列を含むので、カルテから戻ったときに同じ病棟・同じ日が開く。
//
// 日付は「その日にベッドを使っていた人」を出すためのもの(退院済みも含む)で、
// 診療科・主治医・担当看護師の絞り込みとは別扱い。日付を変えても空床は出す。

interface InpatientRow {
  room: fhir4.Location;
  bed: fhir4.Location;
  /** 病室セルの rowspan。病室の 2 床目以降は 0(セルを出さない)。 */
  roomRowSpan: number;
  encounter?: fhir4.Encounter;
  patient?: fhir4.Patient;
}

interface Filters {
  departmentId: string;
  practitionerId: string;
  nurseId: string;
}

const emptyFilters: Filters = { departmentId: "", practitionerId: "", nurseId: "" };

/** 参照 id と表示名の組。診療科・主治医の絞り込みの選択肢に使う。 */
interface FilterOption {
  id: string;
  name: string;
}

/**
 * 病室セルの rowspan を「並べる行」から数え直す。絞り込みで同じ病室の行が減ることが
 * あるので、ベッドの総数ではなく実際に出す行数で決める。
 */
function withRoomRowSpans(rows: Omit<InpatientRow, "roomRowSpan">[]): InpatientRow[] {
  return rows.map((row, index) => {
    if (index > 0 && rows[index - 1].room.id === row.room.id) {
      return { ...row, roomRowSpan: 0 };
    }
    let span = 1;
    while (index + span < rows.length && rows[index + span].room.id === row.room.id) span += 1;
    return { ...row, roomRowSpan: span };
  });
}

/**
 * 入院中の Encounter から絞り込みの選択肢を作る。名前順、重複は潰す。
 * 担当看護師のように 1 件の Encounter が複数の候補を持つことがあるので、
 * pick は配列を返す。
 */
function filterOptions(
  encounters: fhir4.Encounter[],
  pick: (encounter: fhir4.Encounter) => { id?: string; name: string }[],
): FilterOption[] {
  const byId = new Map<string, string>();
  for (const encounter of encounters) {
    for (const { id, name } of pick(encounter)) {
      if (id && !byId.has(id)) byId.set(id, name);
    }
  }
  return [...byId]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "ja"));
}

export function InpatientListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const wardId = searchParams.get("ward") ?? "";
  const date = searchParams.get("date") || today();

  // ward と date は URL で一緒に持つので、片方だけ変えるときも他方を残す。
  function setParams(next: { ward?: string; date?: string }, replace = false) {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    setSearchParams(params, { replace });
  }
  const [admissionTarget, setAdmissionTarget] = useState<{
    bed: fhir4.Location;
    roomName: string;
  } | null>(null);
  const [dischargeTarget, setDischargeTarget] = useState<InpatientRow | null>(null);
  const [filters, setFilters] = useState<Filters>(emptyFilters);

  // 列が多く、既定の幅では折り返すのでこの画面だけ幅を広げる
  // (外来患者一覧と同じやり方)。
  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  const wardOptions = useWardOptions();
  const grid = useWardGrid(wardId || undefined);
  const inpatients = useInpatientEncounters(date);
  const cancelAdmission = useCancelAdmission();

  // 病棟が未指定なら先頭の病棟を開く。履歴を汚さないよう replace で書く。
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current || wardId) return;
    const first = wardOptions.wards[0];
    if (!first?.id) return;
    initialized.current = true;
    setParams({ ward: first.id }, true);
    // setParams は searchParams に依存するが、初回に一度だけ動けばよい。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wardId, wardOptions.wards]);

  const byBed = inpatients.data?.byBed;
  const patientsById = inpatients.data?.patientsById;

  const filtering = Boolean(filters.departmentId || filters.practitionerId || filters.nurseId);

  const rows = useMemo<InpatientRow[]>(() => {
    const all = grid.rooms.flatMap((room) => {
      const beds = grid.bedsByRoom.get(room.id ?? "") ?? [];
      return beds.map((bed) => {
        const encounter = bed.id ? byBed?.get(bed.id) : undefined;
        const patientId = encounter ? encounterPatientId(encounter) : undefined;
        return {
          room,
          bed,
          encounter,
          patient: patientId ? patientsById?.get(patientId) : undefined,
        };
      });
    });

    // 診療科・主治医で絞るときは空床を出さない(空床はどちらも持たないので、
    // 残すと「絞ったのに一覧が変わらない」ように見えてしまう)。
    const visible = filtering
      ? all.filter(
          (row) =>
            row.encounter &&
            (!filters.departmentId ||
              encounterDepartmentId(row.encounter) === filters.departmentId) &&
            (!filters.practitionerId ||
              encounterAttendingId(row.encounter) === filters.practitionerId) &&
            (!filters.nurseId || encounterNurseIds(row.encounter).includes(filters.nurseId)),
        )
      : all;

    return withRoomRowSpans(visible);
  }, [grid.rooms, grid.bedsByRoom, byBed, patientsById, filtering, filters]);

  // 選択肢は院内の入院中から作る。病棟を切り替えても選択が消えないよう、
  // 表示中の病棟ではなく全病棟ぶんを見る。
  const departmentOptions = useMemo(
    () =>
      filterOptions(inpatients.data?.encounters ?? [], (e) => [
        { id: encounterDepartmentId(e), name: encounterDepartmentName(e) },
      ]),
    [inpatients.data],
  );
  const practitionerOptions = useMemo(
    () =>
      filterOptions(inpatients.data?.encounters ?? [], (e) => [
        { id: encounterAttendingId(e), name: encounterAttendingName(e) },
      ]),
    [inpatients.data],
  );
  const nurseOptions = useMemo(
    () =>
      filterOptions(inpatients.data?.encounters ?? [], (e) => {
        const ids = encounterNurseIds(e);
        return encounterNurseNames(e).map((name, index) => ({ id: ids[index], name }));
      }),
    [inpatients.data],
  );

  // 二重入院の警告用。どの患者がどの床に居るかを患者 id で引けるようにする。
  const admittedBedLabelByPatientId = useMemo(() => {
    const map = new Map<string, string>();
    for (const encounter of inpatients.data?.encounters ?? []) {
      const patientId = encounterPatientId(encounter);
      const label = encounter.location?.[0]?.location?.display;
      if (patientId && label) map.set(patientId, label);
    }
    return map;
  }, [inpatients.data]);

  function handleCancelAdmission(row: InpatientRow) {
    if (!row.encounter) return;
    const label = row.patient ? displayName(row.patient) : "この患者";
    if (
      !window.confirm(
        `${label} の入院登録を取り消します。誤登録の取り消しなので退院の記録は残りません。よろしいですか?`,
      )
    ) {
      return;
    }
    cancelAdmission.mutate(row.encounter);
  }

  const occupied = rows.filter((row) => row.encounter).length;
  const beds = rows.length;
  const loading = wardOptions.isLoading || grid.isLoading || inpatients.isLoading;

  return (
    <div className="page">
      <div className="page__header">
        <h1>入院患者一覧</h1>
      </div>

      <form className="patient-search-form" onSubmit={(e) => e.preventDefault()}>
        <label>
          病棟
          <select
            value={wardId}
            onChange={(e) => setParams({ ward: e.target.value })}
          >
            <option value="">選択してください</option>
            {wardOptions.wards.map((ward) => (
              <option key={ward.id} value={ward.id}>
                {locationDisplayName(ward)}
              </option>
            ))}
          </select>
        </label>
        <label>
          基準日
          <div className="inpatient__date">
            <button
              type="button"
              onClick={() => setParams({ date: addDays(date, -1) })}
              aria-label="前の日"
            >
              &lt;
            </button>
            <input
              type="date"
              value={date}
              onChange={(e) => setParams({ date: e.target.value || today() })}
            />
            <button
              type="button"
              onClick={() => setParams({ date: addDays(date, 1) })}
              aria-label="次の日"
            >
              &gt;
            </button>
            <button type="button" onClick={() => setParams({ date: today() })} disabled={date === today()}>
              今日
            </button>
          </div>
        </label>
        <label>
          診療科
          <select
            value={filters.departmentId}
            onChange={(e) => setFilters({ ...filters, departmentId: e.target.value })}
          >
            <option value="">すべて</option>
            {departmentOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          主治医
          <select
            value={filters.practitionerId}
            onChange={(e) => setFilters({ ...filters, practitionerId: e.target.value })}
          >
            <option value="">すべて</option>
            {practitionerOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          担当看護師
          <select
            value={filters.nurseId}
            onChange={(e) => setFilters({ ...filters, nurseId: e.target.value })}
          >
            <option value="">すべて</option>
            {nurseOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
        <div className="patient-search-form__actions">
          <button type="button" onClick={() => setFilters(emptyFilters)} disabled={!filtering}>
            クリア
          </button>
        </div>
      </form>

      <ErrorBanner error={wardOptions.error ?? grid.error ?? inpatients.error} />
      <ErrorBanner error={cancelAdmission.error} />

      {inpatients.data?.truncated && (
        <p className="error-banner__line error-banner__line--error" role="status">
          入院中の患者が多いため、一部のみ表示しています。
        </p>
      )}

      {loading ? (
        <p>読み込み中...</p>
      ) : wardOptions.wards.length === 0 ? (
        <p className="patient-table__empty">
          病棟が登録されていません。マスタメンテ &gt; 共通 &gt; 病棟・病室 から登録してください。
        </p>
      ) : !wardId ? (
        <p className="patient-table__empty">病棟を選択してください。</p>
      ) : rows.length === 0 ? (
        <p className="patient-table__empty">
          {filtering
            ? "絞り込みに該当する入院患者がいません。"
            : "この病棟には病室・ベッドが登録されていません。"}
        </p>
      ) : (
        <>
          <div className="inpatient-wrap">
            <table className="patient-table inpatient">
              <thead>
                <tr>
                  <th>病室</th>
                  <th>ベッド</th>
                  <th>患者氏名</th>
                  <th>生年月日</th>
                  <th>性別</th>
                  <th>診療科</th>
                  <th>主治医</th>
                  <th>担当看護師</th>
                  <th>入院日</th>
                  <th>特記事項</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <InpatientTableRow
                    key={row.bed.id}
                    row={row}
                    onSelectPatient={() =>
                      setAdmissionTarget({
                        bed: row.bed,
                        roomName: locationDisplayName(row.room),
                      })
                    }
                    onDischarge={() => setDischargeTarget(row)}
                    onCancelAdmission={() => handleCancelAdmission(row)}
                    cancelling={cancelAdmission.isPending}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <p className="order-select__muted">
            {filtering
              ? `絞り込み結果 ${occupied} 件`
              : `${beds} 床中 ${occupied} 床が在院(空床 ${beds - occupied})`}
          </p>
        </>
      )}

      {admissionTarget && (
        <AdmissionModal
          bed={admissionTarget.bed}
          roomName={admissionTarget.roomName}
          // 過去の日を見ているときに今日で登録すると、登録した本人がその画面に
          // 出てこない。見ている日を入院日の既定にする。
          defaultAdmissionDate={date}
          admittedBedLabelByPatientId={admittedBedLabelByPatientId}
          onClose={() => setAdmissionTarget(null)}
        />
      )}

      {dischargeTarget?.encounter && (
        <DischargeModal
          encounter={dischargeTarget.encounter}
          patient={dischargeTarget.patient}
          bedLabel={bedDisplayName(
            dischargeTarget.bed,
            locationDisplayName(dischargeTarget.room),
          )}
          onClose={() => setDischargeTarget(null)}
        />
      )}
    </div>
  );
}

function InpatientTableRow({
  row,
  onSelectPatient,
  onDischarge,
  onCancelAdmission,
  cancelling,
}: {
  row: InpatientRow;
  onSelectPatient: () => void;
  onDischarge: () => void;
  onCancelAdmission: () => void;
  cancelling: boolean;
}) {
  const karteLinkState = useKarteLinkState();
  const { room, bed, roomRowSpan, encounter, patient } = row;
  const patientId = patient?.id;

  return (
    <tr>
      {roomRowSpan > 0 && (
        <td rowSpan={roomRowSpan} className="inpatient__room">
          {locationDisplayName(room)}
        </td>
      )}
      <td>{bedNumber(bed) ?? bed.name ?? "-"}</td>
      {encounter && patient ? (
        <>
          <td className="inpatient__name">
            {/* カナは列を分けず、氏名の後ろに小さめの括弧書きで添える。 */}
            {displayName(patient)}
            {displayKana(patient) && (
              <span className="inpatient__kana">（{displayKana(patient)}）</span>
            )}
          </td>
          <td>
            {patient.birthDate ?? "-"}
            {patient.birthDate && ageWithMonthsLabel(patient.birthDate) && (
              <span className="inpatient__age">（{ageWithMonthsLabel(patient.birthDate)}）</span>
            )}
          </td>
          <td>{genderLabel(patient.gender)}</td>
          <td>{encounterDepartmentName(encounter)}</td>
          <td>{encounterAttendingName(encounter)}</td>
          <td>{encounterNurseNames(encounter).join("、") || "-"}</td>
          <td>{encounterAdmissionDate(encounter)}</td>
          <td className="inpatient__note">{encounterNote(encounter) || "-"}</td>
          <td className="patient-table__actions">
            {patientId && (
              <Link className="button" to={`/patients/${patientId}/karte`} state={karteLinkState}>
                カルテ
              </Link>
            )}
            {/* 表が横スクロールするので、メニューは escapesClipping で領域の外に出す
                (でないと縁で切れる)。 */}
            <RowMenu
              label={`${patient ? displayName(patient) : "この患者"} の操作`}
              escapesClipping
            >
              <button type="button" className="row-menu__item" onClick={onDischarge}>
                退院
              </button>
              <button
                type="button"
                className="row-menu__item row-menu__item--danger"
                onClick={onCancelAdmission}
                disabled={cancelling}
              >
                入院取消
              </button>
            </RowMenu>
          </td>
        </>
      ) : (
        <>
          <td className="inpatient__empty-bed" colSpan={8}>
            空床
          </td>
          <td className="patient-table__actions">
            <button type="button" onClick={onSelectPatient}>
              患者選択
            </button>
            {/* 空床にも操作メニューを置く予定があるので、その場所を今から空けておく。
                無いと「患者選択」だけ右端まで寄って、入院中の行の「カルテ」と
                縦に揃わない。中身が入るまでは押せないままにする。 */}
            <div className="row-menu">
              <button type="button" className="row-menu__trigger" aria-label="操作" disabled>
                ⋮
              </button>
            </div>
          </td>
        </>
      )}
    </tr>
  );
}
