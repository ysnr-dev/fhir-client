import { useMemo, useState, type KeyboardEvent } from "react";
import {
  useAdmitPatient,
  useBedWardIndex,
  useInpatientEncounters,
  usePatientSearch,
  usePractitionerOptions,
  useSelfDepartments,
  useWardOptions,
  type PatientSearchParams,
} from "../api/queries";
import { departmentDisplayName } from "../fhir/departmentHelpers";
import {
  ADMISSION_STATUS,
  buildAdmissionEncounter,
  encounterBedId,
  encounterPatientId,
  validateAdmissionForm,
  type AdmissionFormValues,
} from "../fhir/encounterHelpers";
import { locationDisplayName } from "../fhir/locationHelpers";
import { SETTING_OPTIONS } from "../fhir/shared";
import { displayKana, displayName } from "../fhir/patientHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { bedDisplayName } from "../fhir/wardHelpers";
import { today } from "../lib/dates";
import { makeFieldUpdater } from "../lib/form";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";
import { NursePicker } from "./NursePicker";
import { Pagination } from "./Pagination";
import { PatientKana, PatientProfileCells, PatientProfileHeadCells } from "./PatientRowCells";

// 空きベッドへの入院登録。患者を選ぶまでは検索、選んだら診療科・主治医・担当看護師・
// 入院日・特記事項を添えて登録する二段構え(当日受付モーダルと同じ形)。

interface AdmissionModalProps {
  bed: fhir4.Location;
  roomName: string;
  /** 入院日の既定値。一覧で見ている日を渡す。 */
  defaultAdmissionDate?: string;
  /** 患者 id -> 既に入院しているベッドの表示名。二重入院の警告に使う。 */
  admittedBedLabelByPatientId: Map<string, string>;
  onClose: () => void;
}

export function AdmissionModal({
  bed,
  roomName,
  defaultAdmissionDate,
  admittedBedLabelByPatientId,
  onClose,
}: AdmissionModalProps) {
  const [patient, setPatient] = useState<fhir4.Patient | null>(null);
  const [values, setValues] = useState<AdmissionFormValues>({
    departmentId: "",
    practitionerId: "",
    nurseIds: [],
    admissionDate: defaultAdmissionDate || today(),
    note: "",
  });
  const [validationError, setValidationError] = useState<string | null>(null);

  const departments = useSelfDepartments();
  const practitioners = usePractitionerOptions();
  const admit = useAdmitPatient();

  const update = makeFieldUpdater(setValues);
  const bedLabel = bedDisplayName(bed, roomName);

  function handleSubmit() {
    if (!patient?.id || !bed.id) return;

    const error = validateAdmissionForm(values);
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);

    // 転床やデータ修正の途中ということもあるので、止めずに確認だけする。
    const admittedBed = admittedBedLabelByPatientId.get(patient.id);
    if (admittedBed) {
      const label = displayName(patient);
      if (!window.confirm(`${label} は既に入院しています(${admittedBed})。このまま入院登録しますか?`)) {
        return;
      }
    }

    const department = departments.departments.find((d) => d.id === values.departmentId);
    const practitioner = practitioners.practitioners.find((p) => p.id === values.practitionerId);
    const nurses = values.nurseIds
      .map((id) => practitioners.practitioners.find((p) => p.id === id))
      .filter((p): p is fhir4.Practitioner => Boolean(p?.id))
      .map((p) => ({ id: p.id as string, name: practitionerDisplayName(p) }));

    const encounter = buildAdmissionEncounter(
      patient,
      {
        bedId: bed.id,
        bedLabel,
        departmentName: department ? departmentDisplayName(department) : "",
        practitionerName: practitioner ? practitionerDisplayName(practitioner) : "",
        nurses,
      },
      values,
    );
    admit.mutate(encounter, { onSuccess: onClose });
  }

  return (
    <Modal title={`入院登録 - ${bedLabel}`} onClose={onClose} className="modal--wide">
      <ErrorBanner error={departments.error ?? practitioners.error} />
      <ErrorBanner error={admit.error} />
      {validationError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}

      {patient ? (
        <div className="walk-in">
          <div className="walk-in__patient">
            <span>{patient.identifier?.[0]?.value ?? "-"}</span>
            <span>{displayName(patient)}</span>
            <button type="button" onClick={() => setPatient(null)} disabled={admit.isPending}>
              選び直す
            </button>
          </div>

          <div className="walk-in__fields">
            <label>
              入院先
              <input type="text" value={bedLabel} readOnly />
            </label>
            <label>
              診療科(必須)
              <select
                value={values.departmentId}
                onChange={(e) => update("departmentId", e.target.value)}
              >
                <option value="">未指定</option>
                {departments.departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {departmentDisplayName(department)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              主治医
              <select
                value={values.practitionerId}
                onChange={(e) => update("practitionerId", e.target.value)}
              >
                <option value="">未指定</option>
                {practitioners.practitioners.map((practitioner) => (
                  <option key={practitioner.id} value={practitioner.id}>
                    {practitionerDisplayName(practitioner)}
                  </option>
                ))}
              </select>
            </label>
            <NursePicker
              practitioners={practitioners.practitioners}
              nurseIds={values.nurseIds}
              onChange={(nurseIds) => update("nurseIds", nurseIds)}
            />

            <label>
              入院日(必須)
              <input
                type="date"
                value={values.admissionDate}
                onChange={(e) => update("admissionDate", e.target.value)}
              />
            </label>
            <label className="admission__note">
              特記事項
              <textarea
                rows={2}
                value={values.note}
                onChange={(e) => update("note", e.target.value)}
              />
            </label>
          </div>

          <div className="walk-in__actions">
            <button type="button" onClick={handleSubmit} disabled={admit.isPending}>
              {admit.isPending ? "登録中..." : "入院登録"}
            </button>
            <button type="button" onClick={onClose} disabled={admit.isPending}>
              キャンセル
            </button>
          </div>
        </div>
      ) : (
        <AdmissionPatientSearch onSelect={setPatient} />
      )}
    </Modal>
  );
}

// 入院予定モーダル・手術オーダー登録モーダルでも同じ検索を使うのでエクスポートする。
//
// 出す列は部門業務の各ワークリストと同じ並び(患者番号 → 氏名(カナ) → 生年月日(年齢)
// → 性別)にそろえる。同じ患者を別の画面で見ても同じ形で読めるようにするため、
// 氏名のカナと生年月日・性別は共通のセル(PatientRowCells)を使う。
//
// ［提案］**入外区分と入院病棟でも絞れる**ようにする。手術・処置の申込は「あの病棟の
// あの人」で探すことが多く、患者番号も氏名もうろ覚えのまま開く場面があるため。
//
// ［実装］入院(または病棟)を選ぶと**引き元が変わる**。患者検索(usePatientSearch)は上流で
// ページングするので、返ってきた 1 ページを間引くと件数も次ページも嘘になる。入院で
// 絞るときは在院患者(useInpatientEncounters。患者も _include 済み)から作り、患者番号・
// 氏名はその中で絞る —— 在院ぶんは手元で絞りきれる数に収まる。
//
// ［実装］**外来だけは間引きになる**。「入院していない」は上流に問い合わせようが無く
// (FHIR に否定の検索は無い)、在院患者の集合から作ることもできない。検索結果から入院中を
// 落とす形にして、件数が合わなくなるぶんは注記で断る。
export function AdmissionPatientSearch({ onSelect }: { onSelect: (patient: fhir4.Patient) => void }) {
  const [inputs, setInputs] = useState<PatientSearchParams>({ name: "", identifier: "" });
  const [search, setSearch] = useState<PatientSearchParams>({});
  // 入外区分・病棟はセレクトなので押した瞬間に効かせる(ワークリストの絞り込みと同じ)。
  const [setting, setSetting] = useState("");
  const [wardId, setWardId] = useState("");
  const [offset, setOffset] = useState(0);

  const wards = useWardOptions();
  const bedWards = useBedWardIndex();
  // 入院病棟の列は病棟を選んでいなくても出すので、在院患者は常に読む
  // (入院患者一覧と同じ queryKey なので、そちらを見た後なら読み直しは起きない)。
  const inpatients = useInpatientEncounters(today());

  // 病棟を選んでいるなら入院で絞っているのと同じ。どちらでも在院患者から作る。
  const fromInpatients = setting === "inpatient" || Boolean(wardId);
  const outpatientOnly = setting === "outpatient";
  const { bundle, total, count, hasPrevious, hasNext, isFetching, error } = usePatientSearch(
    search,
    offset,
  );

  /** 患者 id -> 入院病棟。退院済み(finished)は今の病棟ではないので入れない。 */
  const wardByPatient = useMemo(() => {
    const map = new Map<string, { wardId: string; wardName: string }>();
    for (const encounter of inpatients.data?.encounters ?? []) {
      if (encounter.status !== ADMISSION_STATUS) continue;
      const patientId = encounterPatientId(encounter);
      const bedId = encounterBedId(encounter);
      if (!patientId || !bedId) continue;
      const ward = bedWards.bedWards.get(bedId);
      if (ward) map.set(patientId, ward);
    }
    return map;
  }, [inpatients.data, bedWards.bedWards]);

  const searchedPatients =
    bundle?.entry?.map((e) => e.resource).filter((r): r is fhir4.Patient => Boolean(r)) ?? [];

  // 入院で絞っているときの一覧。在院患者を病棟・患者番号・氏名で絞る。
  const inpatientRows = useMemo(() => {
    if (!fromInpatients) return [];
    const patientsById = inpatients.data?.patientsById;
    const identifier = (search.identifier ?? "").trim().toLowerCase();
    const name = (search.name ?? "").trim().toLowerCase();
    const list: fhir4.Patient[] = [];
    for (const [patientId, ward] of wardByPatient) {
      if (wardId && ward.wardId !== wardId) continue;
      const patient = patientsById?.get(patientId);
      if (!patient) continue;
      if (identifier && !(patient.identifier?.[0]?.value ?? "").toLowerCase().includes(identifier)) {
        continue;
      }
      // 上流の name 検索と同じく、漢字・カナのどちらに当たっても拾う。
      if (name && !patientText(patient).includes(name)) continue;
      list.push(patient);
    }
    return list.sort((a, b) =>
      (a.identifier?.[0]?.value ?? "").localeCompare(b.identifier?.[0]?.value ?? "", "ja"),
    );
  }, [fromInpatients, wardId, wardByPatient, inpatients.data, search.identifier, search.name]);

  // 外来だけは検索結果から入院中を落とす(上に書いた理由で引き元を変えられない)。
  const outpatientRows = searchedPatients.filter(
    (patient) => !(patient.id && wardByPatient.has(patient.id)),
  );
  const excludedCount = searchedPatients.length - outpatientRows.length;

  const patients = fromInpatients
    ? inpatientRows
    : outpatientOnly
      ? outpatientRows
      : searchedPatients;
  const loading = fromInpatients ? inpatients.isLoading || bedWards.isLoading : isFetching;

  function runSearch() {
    setSearch(inputs);
    setOffset(0);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      runSearch();
    }
  }

  return (
    <>
      {/* 患者番号・氏名・入外区分・入院病棟・検索を 1 行に収める(縦に積むと表が押し下がる)。 */}
      <div className="master-search__form master-search__form--row">
        <label>
          患者番号
          <input
            type="text"
            value={inputs.identifier}
            onChange={(e) => setInputs({ ...inputs, identifier: e.target.value })}
            onKeyDown={handleKeyDown}
          />
        </label>
        <label>
          氏名(漢字・カナ部分一致)
          <input
            type="text"
            value={inputs.name}
            onChange={(e) => setInputs({ ...inputs, name: e.target.value })}
            onKeyDown={handleKeyDown}
          />
        </label>
        <label>
          入外区分
          <select
            value={setting}
            onChange={(e) => {
              setSetting(e.target.value);
              // 外来に病棟は無い。選び残しが効いたままにならないよう外す。
              if (e.target.value === "outpatient") setWardId("");
              setOffset(0);
            }}
          >
            <option value="">すべて</option>
            {SETTING_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.display}
              </option>
            ))}
          </select>
        </label>
        <label>
          入院病棟
          <select
            value={wardId}
            disabled={outpatientOnly}
            onChange={(e) => {
              setWardId(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">すべて</option>
            {wards.wards.map((ward) => (
              <option key={ward.id} value={ward.id}>
                {locationDisplayName(ward)}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={runSearch} disabled={loading}>
          検索
        </button>
      </div>

      <ErrorBanner error={error} />
      <ErrorBanner error={wards.error} />
      <ErrorBanner error={bedWards.error} />
      <ErrorBanner error={inpatients.error} />

      {/* 在院患者は上限ページまでしか読まない。欠けているなら黙って隠さない。 */}
      {fromInpatients && inpatients.data?.truncated && (
        <p className="surgery-day-schedule__warn" role="status">
          入院が多いため一部しか読めていません。ここに出ていない患者がいる可能性があります。
        </p>
      )}

      <div className="master-search__table-wrap">
        <table className="master-search__table">
          <thead>
            <tr>
              <th>患者番号</th>
              <th>患者氏名</th>
              <PatientProfileHeadCells />
              <th>入院病棟</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {patients.map((patient) => (
              <tr key={patient.id}>
                <td>{patient.identifier?.[0]?.value ?? "-"}</td>
                <td>
                  {displayName(patient)}
                  <PatientKana patient={patient} />
                </td>
                <PatientProfileCells patient={patient} />
                <td>{(patient.id && wardByPatient.get(patient.id)?.wardName) || "-"}</td>
                <td className="master-search__actions">
                  <button type="button" onClick={() => onSelect(patient)}>
                    選択
                  </button>
                </td>
              </tr>
            ))}
            {!loading && patients.length === 0 && (
              <tr>
                <td colSpan={6} className="master-search__empty">
                  該当する患者がいません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {fromInpatients ? (
        // 在院ぶんは全件を 1 画面に出すのでページ送りは無い。件数だけ出す。
        <p className="master-search__count">{patients.length} 件</p>
      ) : (
        <>
          {/* 外来は検索結果からの間引きなので、ページ送りの件数と行数がずれる。
              黙ってずらさず、落とした件数をその場で断る。 */}
          {outpatientOnly && excludedCount > 0 && (
            <p className="master-search__count">
              入院中の {excludedCount} 件をこのページから除いています
            </p>
          )}
          <Pagination
            offset={offset}
            count={count}
            total={total}
            hasPrevious={hasPrevious}
            hasNext={hasNext}
            onPrevious={() => setOffset((o) => Math.max(0, o - count))}
            onNext={() => setOffset((o) => o + count)}
          />
        </>
      )}
    </>
  );
}

/** 氏名とカナをつないだ小文字の 1 本。病棟で絞ったときの手元の部分一致に使う。 */
function patientText(patient: fhir4.Patient): string {
  return `${displayName(patient)} ${displayKana(patient)}`.toLowerCase();
}
