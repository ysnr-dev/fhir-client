import { useState, type FormEvent } from "react";
import {
  useDoctorOptions,
  useRecordReferralReply,
  useRecordReferralVisit,
  useReferralDocumentCandidates,
  useSaveReferral,
  useSelfDepartments,
} from "../api/queries";
import { departmentDisplayName } from "../fhir/departmentHelpers";
import { organizationDisplayName } from "../fhir/organizationHelpers";
import { displayName, patientNumberOf } from "../fhir/patientHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import {
  emptyReferralForm,
  REFERRAL_KIND_OPTIONS,
  REFERRAL_REPLY_KIND_OPTIONS,
  referralFormOf,
  validateReferralForm,
  type ReferralDirection,
  type ReferralFormValues,
  type ReferralRow,
} from "../fhir/referralHelpers";
import { useOrderContext } from "../hooks/useOrderContext";
import { today } from "../lib/dates";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";
import { OrganizationSearchModal } from "./OrganizationSearchModal";
import { WalkInPatientSearch } from "./WalkInCheckInModal";

// 地域連携の紹介台帳のモーダル(docs/referral-design.md)。登録・編集、受診日の記録、返書の記録。

function patientLabel(patient: fhir4.Patient): string {
  return `${patientNumberOf(patient) ?? ""} ${displayName(patient)}`;
}

/** 患者のファイルから紹介状・提供書・返書を選ぶ欄。 */
function DocumentSelect({
  patientId,
  label,
  documentId,
  documentName,
  onChange,
}: {
  patientId: string;
  label: string;
  documentId: string;
  documentName: string;
  onChange: (documentId: string, documentName: string) => void;
}) {
  const candidates = useReferralDocumentCandidates(patientId);
  const files = candidates.data ?? [];
  // 候補(新しい順の先頭)に無い保存済みの文書も選択肢に残す。
  const missing = documentId && !files.some((file) => file.id === documentId);

  return (
    <label className="referral__wide-field">
      {label}
      <select
        value={documentId}
        onChange={(e) => {
          const file = files.find((f) => f.id === e.target.value);
          onChange(e.target.value, file ? file.title : "");
        }}
      >
        <option value="">(選択しない)</option>
        {missing && <option value={documentId}>{documentName || documentId}</option>}
        {files.map((file) => (
          <option key={file.id} value={file.id}>
            {[file.date, file.categoryName, file.title].filter(Boolean).join(" ")}
          </option>
        ))}
      </select>
    </label>
  );
}

interface ReferralFormModalProps {
  direction: ReferralDirection;
  /** 患者が決まっている場面(カルテ・編集)で渡す。無ければ先に患者を検索して選ぶ。 */
  patient?: fhir4.Patient;
  patientId?: string;
  /** 編集する行。 */
  row?: ReferralRow;
  onClose: () => void;
}

export function ReferralFormModal({ direction, patient: givenPatient, patientId: givenPatientId, row, onClose }: ReferralFormModalProps) {
  // 新規の診療科・担当医は、ヘッダーで選んでいる依頼科・依頼医師を既定にする。
  const orderContext = useOrderContext();
  const [pickedPatient, setPickedPatient] = useState<fhir4.Patient | null>(null);
  const patient = givenPatient ?? row?.patient ?? pickedPatient ?? undefined;
  const patientId = givenPatientId ?? row?.patientId ?? patient?.id ?? "";

  const [values, setValues] = useState<ReferralFormValues>(() =>
    row
      ? referralFormOf(row)
      : {
          ...emptyReferralForm(direction),
          departmentId: orderContext.departmentId,
          departmentName: orderContext.departmentName,
          practitionerId: orderContext.practitionerId,
          practitionerName: orderContext.practitionerName,
        },
  );
  const [validation, setValidation] = useState("");
  const [pickingOrganization, setPickingOrganization] = useState(false);

  const departments = useSelfDepartments();
  const { doctors, error: doctorsError } = useDoctorOptions();
  const save = useSaveReferral();
  const inbound = direction === "inbound";
  const title = `${inbound ? "紹介受" : "紹介"}の${row ? "編集" : "登録"}`;

  function set(patch: Partial<ReferralFormValues>) {
    setValues((current) => ({ ...current, ...patch }));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const failure = validateReferralForm(values);
    setValidation(failure?.message ?? "");
    if (failure || !patientId) return;
    save.mutate({ values, patientId, existing: row?.serviceRequest }, { onSuccess: onClose });
  }

  if (!patientId) {
    return (
      <Modal title={title} onClose={onClose} className="modal--wide">
        <WalkInPatientSearch onSelect={setPickedPatient} />
      </Modal>
    );
  }

  // 一覧に無い(無効になった)担当医も選択肢に残す。
  const doctorMissing = values.practitionerId && !doctors.some((d) => d.id === values.practitionerId);

  return (
    <Modal title={title} onClose={onClose} className="modal--wide">
      <ErrorBanner error={departments.error ?? doctorsError} />
      <ErrorBanner error={save.error} />
      {validation && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{validation}</p>
        </div>
      )}
      {/* カルテから開いたときは患者が画面で決まっているので出さない。 */}
      {patient && (
        <div className="walk-in__patient">
          <span>{patientLabel(patient)}</span>
          {!row && !givenPatient && !givenPatientId && (
            <button type="button" onClick={() => setPickedPatient(null)} disabled={save.isPending}>
              選び直す
            </button>
          )}
        </div>
      )}
      <form className="prescription-form" onSubmit={handleSubmit}>
        <fieldset>
          <label>
            区分
            <select value={values.kind} onChange={(e) => set({ kind: e.target.value })}>
              {REFERRAL_KIND_OPTIONS[direction].map((option) => (
                <option key={option.code} value={option.code}>
                  {option.display}
                </option>
              ))}
            </select>
          </label>
          <label>
            紹介日
            <input type="date" value={values.referralDate} onChange={(e) => set({ referralDate: e.target.value })} />
          </label>
          <label>
            受診予定日
            <input type="date" value={values.plannedDate} onChange={(e) => set({ plannedDate: e.target.value })} />
          </label>
        </fieldset>
        <fieldset>
          <label className="referral__partner">
            {inbound ? "紹介元" : "紹介先"}
            <span className="referral__partner-row">
              <input type="text" value={values.partnerOrganizationName} readOnly />
              <button type="button" onClick={() => setPickingOrganization(true)}>
                選択
              </button>
            </span>
          </label>
          <label>
            {inbound ? "紹介医" : "紹介先医師"}
            <input
              type="text"
              value={values.partnerPractitionerName}
              onChange={(e) => set({ partnerPractitionerName: e.target.value })}
            />
          </label>
        </fieldset>
        <fieldset>
          <label>
            診療科
            <select
              value={values.departmentId}
              onChange={(e) => {
                const department = departments.departments.find((d) => d.id === e.target.value);
                set({
                  departmentId: e.target.value,
                  departmentName: department ? departmentDisplayName(department) : "",
                });
              }}
            >
              <option value=""></option>
              {departments.departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {departmentDisplayName(department)}
                </option>
              ))}
            </select>
          </label>
          <label>
            担当医
            <select
              value={values.practitionerId}
              onChange={(e) => {
                const doctor = doctors.find((d) => d.id === e.target.value);
                set({ practitionerId: e.target.value, practitionerName: doctor ? practitionerDisplayName(doctor) : "" });
              }}
            >
              <option value=""></option>
              {doctorMissing && <option value={values.practitionerId}>{values.practitionerName}</option>}
              {doctors.map((doctor) => (
                <option key={doctor.id} value={doctor.id}>
                  {practitionerDisplayName(doctor)}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
        <fieldset>
          <label className="referral__wide-field">
            紹介目的
            <textarea rows={3} value={values.purpose} onChange={(e) => set({ purpose: e.target.value })} />
          </label>
          <DocumentSelect
            patientId={patientId}
            label={inbound ? "紹介状" : "診療情報提供書"}
            documentId={values.documentId}
            documentName={values.documentName}
            onChange={(documentId, documentName) => set({ documentId, documentName })}
          />
          <label className="referral__wide-field">
            コメント
            <input type="text" value={values.comment} onChange={(e) => set({ comment: e.target.value })} />
          </label>
        </fieldset>
        <div className="prescription-form__submit">
          <button type="submit" disabled={save.isPending}>
            {save.isPending ? "送信中..." : "登録"}
          </button>
        </div>
      </form>
      {pickingOrganization && (
        <OrganizationSearchModal
          excludeSelf
          title={inbound ? "紹介元を選択" : "紹介先を選択"}
          onClose={() => setPickingOrganization(false)}
          onSelect={(organization) => {
            set({
              partnerOrganizationId: organization.id ?? "",
              partnerOrganizationName: organizationDisplayName(organization),
            });
            setPickingOrganization(false);
          }}
        />
      )}
    </Modal>
  );
}

function ReferralSummary({ row }: { row: ReferralRow }) {
  return (
    <dl className="prescription-detail__common">
      {row.patient && (
        <>
          <dt>患者</dt>
          <dd>{patientLabel(row.patient)}</dd>
        </>
      )}
      <dt>{row.direction === "inbound" ? "紹介元" : "紹介先"}</dt>
      <dd>{[row.partnerOrganizationName, row.partnerPractitionerName].filter(Boolean).join(" ")}</dd>
      <dt>紹介日</dt>
      <dd>{row.referralDate}</dd>
    </dl>
  );
}

/** 紹介受の受診日を記録する。 */
export function ReferralVisitModal({ row, onClose }: { row: ReferralRow; onClose: () => void }) {
  const [visitDate, setVisitDate] = useState(row.visitDate || row.plannedDate || today());
  const record = useRecordReferralVisit();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!visitDate) return;
    record.mutate({ row, visitDate }, { onSuccess: onClose });
  }

  return (
    <Modal title="受診の記録" onClose={onClose}>
      <ErrorBanner error={record.error} />
      <ReferralSummary row={row} />
      <form className="prescription-form" onSubmit={handleSubmit}>
        <fieldset>
          <label>
            受診日
            <input type="date" value={visitDate} onChange={(e) => setVisitDate(e.target.value)} required />
          </label>
        </fieldset>
        <div className="prescription-form__submit">
          <button type="submit" disabled={record.isPending}>
            {record.isPending ? "送信中..." : "登録"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** 返書(紹介受は出した報告、紹介は受け取った返書)を記録する。 */
export function ReferralReplyModal({ row, onClose }: { row: ReferralRow; onClose: () => void }) {
  const options = REFERRAL_REPLY_KIND_OPTIONS[row.direction];
  // 紹介受の 1 通目は受診報告、2 通目以降は最終報告を既定にする。
  const [kind, setKind] = useState(
    row.direction === "inbound" && row.replies.length > 0 ? options[options.length - 1].code : options[0].code,
  );
  const [date, setDate] = useState(today());
  const [note, setNote] = useState("");
  const [attached, setAttached] = useState({ id: "", name: "" });
  const record = useRecordReferralReply();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!date) return;
    record.mutate(
      { row, input: { date, kind, note, documentId: attached.id, documentName: attached.name } },
      { onSuccess: onClose },
    );
  }

  return (
    <Modal title="返書の記録" onClose={onClose}>
      <ErrorBanner error={record.error} />
      <ReferralSummary row={row} />
      <form className="prescription-form" onSubmit={handleSubmit}>
        <fieldset>
          <label>
            区分
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {options.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.display}
                </option>
              ))}
            </select>
          </label>
          <label>
            {row.direction === "inbound" ? "送付日" : "受領日"}
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </label>
          <DocumentSelect
            patientId={row.patientId}
            label="文書"
            documentId={attached.id}
            documentName={attached.name}
            onChange={(id, name) => setAttached({ id, name })}
          />
          <label className="referral__wide-field">
            メモ
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        </fieldset>
        <div className="prescription-form__submit">
          <button type="submit" disabled={record.isPending}>
            {record.isPending ? "送信中..." : "登録"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
