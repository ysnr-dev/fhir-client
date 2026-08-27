import { useState, type FormEvent } from "react";
import type { Medicine, MedicalMaterial, MedicalProcedure } from "../api/masterClient";
import { useRegisterSurgeryPerform, type SurgeryWorklistRow } from "../api/queries";
import { toDateTimeInput } from "../fhir/clinicalNoteHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import {
  SURGERY_PERFORM_STAFF_ROLE_OPTIONS,
  summarizeSurgeryOrder,
  surgeryOrderItems,
  surgeryStaffRoleDisplay,
  type SurgeryStaffLine,
  type SurgeryStaffRole,
} from "../fhir/surgeryOrderHelpers";
import {
  SURGERY_COUNT_CHECK_OPTIONS,
  SURGERY_OBSERVATION_FIELDS,
  SURGERY_OUTCOME_OPTIONS,
  SURGERY_ROUTE_OPTIONS,
  SURGERY_TIME_FIELDS,
  SURGERY_WOUND_CLASS_OPTIONS,
  buildSurgeryPerformBundle,
  emptySurgeryPerformForm,
  validateSurgeryTimes,
  type SurgeryMaterialLine,
  type SurgeryMedicineLine,
  type SurgeryPerformFormValues,
} from "../fhir/surgeryResultHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { MedicalMaterialSearchModal } from "./MedicalMaterialSearchModal";
import { MedicalProcedureSearchModal } from "./MedicalProcedureSearchModal";
import { MedicineSearchModal } from "./MedicineSearchModal";
import { Modal } from "./Modal";
import { PractitionerSearchModal } from "./PractitionerSearchModal";

// 手術の実施記録。退室後にまとめて 1 回入れる。
//
// 入室は手術一覧の「入室」で Task を進めるだけにしてあり、ここでは入室・退室の時刻を
// 後から記録する。術中のリアルタイム記録(麻酔記録)は別物なので第 3 段階で扱う。
//
// 処置の実施入力(TreatmentPerformModal)と同じ二層構成にしてある。今のところ入力層を
// 使うのはこのモーダルだけだが、将来「即実施」相当が要るときに送信先を差し替えるだけ
// で済むようにしておく。
//
// 実施術式とスタッフは申込の内容を初期値にする。予定どおりならそのまま登録でき、
// 開腹移行・追加術式・当日の応援は差し替えて記録する。

type Adding = "procedure-k" | "procedure-l" | "medicine" | "material" | null;

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

function RemoveRowButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="rp-card__icon-button"
      title="外す"
      aria-label="外す"
      onClick={onClick}
    >
      <TrashIcon />
    </button>
  );
}

interface Props {
  row: SurgeryWorklistRow;
  onClose: () => void;
}

/** 手術一覧の「実施」。入力した内容をその場で登録する。 */
export function SurgeryPerformModal({ row, onClose }: Props) {
  const register = useRegisterSurgeryPerform();

  return (
    <SurgeryPerformInputModal
      row={row}
      submitLabel="実施を登録"
      submitting={register.isPending}
      submitError={register.error}
      onSubmit={(values) =>
        register.mutate(buildSurgeryPerformBundle(values, row.order, row.task), {
          onSuccess: onClose,
        })
      }
      onClose={onClose}
    />
  );
}

interface InputProps {
  row: SurgeryWorklistRow;
  submitLabel: string;
  submitting?: boolean;
  submitError?: unknown;
  onSubmit: (values: SurgeryPerformFormValues) => void;
  onClose: () => void;
}

export function SurgeryPerformInputModal({
  row,
  submitLabel,
  submitting,
  submitError,
  onSubmit,
  onClose,
}: InputProps) {
  const summary = summarizeSurgeryOrder(row.order);
  const orderItems = surgeryOrderItems(row.order, row.itemRequests);

  // 申込の内容を初期値にする。予定どおりならそのまま登録できる。
  const [values, setValues] = useState<SurgeryPerformFormValues>(() => ({
    ...emptySurgeryPerformForm(),
    // 入室は予定入室時刻から始める(実際の入室で直す)。退室は空のまま入れさせる。
    enteredAt: summary.scheduledDate
      ? `${summary.scheduledDate}T${summary.scheduledTime || "00:00"}`
      : toDateTimeInput(new Date()),
    staff: summary.staff,
    // K コードを持たない術式は算定できないので実施行にしない(名称だけ残しても
    // 手技料にならず、実施入力の目的から外れる)。
    procedures: orderItems
      .filter((item) => item.receiptCode)
      .map((item) => ({ code: item.receiptCode, name: item.name })),
  }));
  const [adding, setAdding] = useState<Adding>(null);
  // スタッフを足すときの役割。検索モーダルの職種フィルタもこれで決まる。
  const [staffRole, setStaffRole] = useState<SurgeryStaffRole>("assistant");
  const [addingStaff, setAddingStaff] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  function patch(next: Partial<SurgeryPerformFormValues>) {
    setValues((current) => ({ ...current, ...next }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();

    if (!values.enteredAt || !values.exitedAt) {
      setValidationError("入室時刻と退室時刻を入力してください。");
      return;
    }
    const timeError = validateSurgeryTimes(values);
    if (timeError) {
      setValidationError(timeError);
      return;
    }
    if (values.procedures.length === 0) {
      setValidationError("実施した術式を 1 つ以上入力してください。");
      return;
    }
    if (!values.staff.some((line) => line.role === "surgeon" && line.practitionerId)) {
      setValidationError("執刀医を選択してください。");
      return;
    }
    // カウント不一致は必ず経緯が要る(何が合わなかったかが後から追えないと意味がない)。
    if (values.countCheck === "discrepancy" && !values.comment.trim()) {
      setValidationError("カウントが不一致のときは実施コメントに経緯を記録してください。");
      return;
    }

    setValidationError(null);
    onSubmit(values);
  }

  function addStaff(practitioner: fhir4.Practitioner) {
    const line: SurgeryStaffLine = {
      role: staffRole,
      practitionerId: practitioner.id ?? "",
      practitionerName: practitionerDisplayName(practitioner),
    };
    setAddingStaff(false);
    setValues((current) => {
      // 執刀医・麻酔科医は 1 人。助手・器械出し・外回り・ME は複数入る。
      const single = line.role === "surgeon" || line.role === "anesthetist";
      const rest = single
        ? current.staff.filter((s) => s.role !== line.role)
        : current.staff.filter(
            (s) => !(s.role === line.role && s.practitionerId === line.practitionerId),
          );
      const order = (role: string) =>
        SURGERY_PERFORM_STAFF_ROLE_OPTIONS.findIndex((o) => o.code === role);
      return {
        ...current,
        staff: [...rest, line].sort((a, b) => order(a.role) - order(b.role)),
      };
    });
  }

  // 器械出し・外回りは看護師、それ以外は医師から探すのが既定(変更はモーダル内で可能)。
  const staffRoleFilter =
    staffRole === "scrub-nurse" || staffRole === "circulating-nurse" ? "nurse" : "doctor";

  return (
    <Modal title="実施入力" onClose={onClose} className="modal--lab-order-item">
      {/* fieldset / legend / label / 入力欄のスタイルは .prescription-form 配下にしか
          定義が無いので、申込フォームと同じ class を付けて揃える。実施入力は項目が
          多く(時刻・スタッフ・測定値・記録)、legend でのグループ分けが要る。 */}
      <form className="prescription-form" onSubmit={handleSubmit}>
        {validationError && (
          <div className="error-banner" role="alert">
            <p className="error-banner__line error-banner__line--error">{validationError}</p>
          </div>
        )}

        {/* 取り違え防止のため、入力欄より先に対象を出す(処置と同じ)。 */}
        <p className="rad-perform__items">
          {orderItems.map((item) => item.name).join(" / ") || "術式なし"}
        </p>

        <fieldset className="surgery-perform__times">
          <legend>時刻</legend>
          <label>
            入室
            <input
              type="datetime-local"
              value={values.enteredAt}
              onChange={(e) => patch({ enteredAt: e.target.value })}
              required
            />
          </label>
          {SURGERY_TIME_FIELDS.map((field) => (
            <label key={field.key}>
              {field.label}
              <input
                type="datetime-local"
                value={values.times[field.key] ?? ""}
                onChange={(e) =>
                  patch({ times: { ...values.times, [field.key]: e.target.value } })
                }
              />
            </label>
          ))}
          <label>
            退室
            <input
              type="datetime-local"
              value={values.exitedAt}
              onChange={(e) => patch({ exitedAt: e.target.value })}
              required
            />
          </label>
        </fieldset>

        {/* 実施した術式。申込の術式が初期行で、開腹移行・追加術式・麻酔管理料はここで直す。 */}
        <section className="lab-order-item__section">
          <div className="lab-order-item__section-head">
            <h3>実施術式・麻酔({values.procedures.length})</h3>
            <button
              type="button"
              className="rp-card__compact-button"
              onClick={() => setAdding("procedure-k")}
            >
              + 術式(K)
            </button>
            <button
              type="button"
              className="rp-card__compact-button"
              onClick={() => setAdding("procedure-l")}
            >
              + 麻酔(L)
            </button>
          </div>
          <LineTable
            columns={["名称", "コード"]}
            rows={values.procedures.map((line, index) => ({
              key: `${line.code}-${index}`,
              cells: [line.name, line.code],
              onRemove: () =>
                patch({ procedures: values.procedures.filter((_, i) => i !== index) }),
            }))}
            emptyText="実施した術式を追加してください"
          />
        </section>

        <fieldset>
          <legend>実施スタッフ</legend>
          <div className="surgery-staff">
            {values.staff.map((line) => (
              <span key={`${line.role}-${line.practitionerId}`} className="surgery-staff__chip">
                <span className="surgery-staff__role">{surgeryStaffRoleDisplay(line.role)}</span>
                <span className="surgery-staff__name">{line.practitionerName}</span>
                <button
                  type="button"
                  className="order-select__remove"
                  title="外す"
                  aria-label={`${line.practitionerName} を外す`}
                  onClick={() =>
                    patch({
                      staff: values.staff.filter(
                        (s) => !(s.role === line.role && s.practitionerId === line.practitionerId),
                      ),
                    })
                  }
                >
                  ×
                </button>
              </span>
            ))}
            {values.staff.length === 0 && (
              <span className="order-select__muted">執刀医を選択してください</span>
            )}
          </div>
          <div className="surgery-staff__actions">
            <select
              value={staffRole}
              aria-label="追加するスタッフの役割"
              onChange={(e) => setStaffRole(e.target.value as SurgeryStaffRole)}
            >
              {SURGERY_PERFORM_STAFF_ROLE_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.display}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="rp-card__compact-button"
              onClick={() => setAddingStaff(true)}
            >
              + 追加
            </button>
          </div>
        </fieldset>

        <fieldset>
          <legend>測定値(mL)</legend>
          {SURGERY_OBSERVATION_FIELDS.map((field) => (
            <label key={field.key}>
              {field.label}
              <input
                type="number"
                min={0}
                step={10}
                value={values.observations[field.key] ?? ""}
                onChange={(e) =>
                  patch({ observations: { ...values.observations, [field.key]: e.target.value } })
                }
              />
            </label>
          ))}
        </fieldset>

        <fieldset>
          <legend>記録</legend>
          <label>
            創分類
            <select
              value={values.woundClass}
              onChange={(e) => patch({ woundClass: e.target.value })}
            >
              <option value="">未指定</option>
              {SURGERY_WOUND_CLASS_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.display}
                </option>
              ))}
            </select>
          </label>
          <label>
            ガーゼ・器械カウント
            <select
              value={values.countCheck}
              onChange={(e) => patch({ countCheck: e.target.value })}
            >
              <option value="">未確認</option>
              {SURGERY_COUNT_CHECK_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.display}
                </option>
              ))}
            </select>
          </label>
          <label>
            転帰
            <select value={values.outcome} onChange={(e) => patch({ outcome: e.target.value })}>
              <option value="">未指定</option>
              {SURGERY_OUTCOME_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.display}
                </option>
              ))}
            </select>
          </label>
          <label className="surgery-perform__wide">
            合併症
            <input
              type="text"
              value={values.complication}
              placeholder="無ければ空欄"
              onChange={(e) => patch({ complication: e.target.value })}
            />
          </label>
        </fieldset>

        <section className="lab-order-item__section">
          <div className="lab-order-item__section-head">
            <h3>薬剤({values.medicines.length})</h3>
            <button
              type="button"
              className="rp-card__compact-button"
              onClick={() => setAdding("medicine")}
            >
              + 薬剤
            </button>
          </div>
          <div className="lab-order-item__table-wrap">
            <table className="master-search__table rad-perform__lines">
              <thead>
                <tr>
                  <th>名称</th>
                  <th>使用量</th>
                  <th>投与経路</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {values.medicines.map((line, index) => (
                  <tr key={`${line.medicineCode}-${index}`}>
                    <td>{line.name}</td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={line.dose}
                        aria-label={`${line.name} の使用量`}
                        onChange={(e) =>
                          patch({
                            medicines: replaceAt(values.medicines, index, {
                              ...line,
                              dose: e.target.value,
                            }),
                          })
                        }
                      />
                      {line.unitName}
                    </td>
                    <td>
                      <select
                        value={line.routeCode}
                        aria-label={`${line.name} の投与経路`}
                        onChange={(e) =>
                          patch({
                            medicines: replaceAt(values.medicines, index, {
                              ...line,
                              routeCode: e.target.value,
                            }),
                          })
                        }
                      >
                        <option value="">未指定</option>
                        {SURGERY_ROUTE_OPTIONS.map((option) => (
                          <option key={option.code} value={option.code}>
                            {option.display}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="master-search__actions">
                      <RemoveRowButton
                        onClick={() =>
                          patch({ medicines: values.medicines.filter((_, i) => i !== index) })
                        }
                      />
                    </td>
                  </tr>
                ))}
                {values.medicines.length === 0 && (
                  <tr>
                    <td colSpan={4} className="master-search__empty">
                      使用した薬剤はありません
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="lab-order-item__section">
          <div className="lab-order-item__section-head">
            <h3>使用材料({values.materials.length})</h3>
            <button
              type="button"
              className="rp-card__compact-button"
              onClick={() => setAdding("material")}
            >
              + 材料
            </button>
          </div>
          <div className="lab-order-item__table-wrap">
            <table className="master-search__table rad-perform__lines">
              <thead>
                <tr>
                  <th>名称</th>
                  <th>数量</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {values.materials.map((line, index) => (
                  <tr key={`${line.code}-${index}`}>
                    <td>{line.name}</td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={line.quantity}
                        aria-label={`${line.name} の数量`}
                        onChange={(e) =>
                          patch({
                            materials: replaceAt(values.materials, index, {
                              ...line,
                              quantity: e.target.value,
                            }),
                          })
                        }
                      />
                      {line.unitName}
                    </td>
                    <td className="master-search__actions">
                      <RemoveRowButton
                        onClick={() =>
                          patch({ materials: values.materials.filter((_, i) => i !== index) })
                        }
                      />
                    </td>
                  </tr>
                ))}
                {values.materials.length === 0 && (
                  <tr>
                    <td colSpan={3} className="master-search__empty">
                      使用した材料はありません
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <fieldset className="surgery-comment">
          <legend>実施コメント</legend>
          <textarea
            value={values.comment}
            rows={3}
            onChange={(e) => patch({ comment: e.target.value })}
            aria-label="実施コメント"
          />
        </fieldset>

        <ErrorBanner error={submitError} />

        <div className="lab-order-item__actions">
          <button type="submit" disabled={submitting}>
            {submitting ? "送信中..." : submitLabel}
          </button>
          <button type="button" onClick={onClose}>
            キャンセル
          </button>
        </div>
      </form>

      {/* 検索モーダルは独自の入力を持つため、外側フォームの子孫に置かない
          (form の入れ子は不正で、送信が外へ漏れる)。 */}
      {(adding === "procedure-k" || adding === "procedure-l") && (
        <MedicalProcedureSearchModal
          defaultSection={adding === "procedure-k" ? "K" : "L"}
          onSelect={(procedure: MedicalProcedure) => {
            setAdding(null);
            patch({
              procedures: [
                ...values.procedures,
                { code: procedure.procedure_code, name: procedure.name ?? "" },
              ],
            });
          }}
          onClose={() => setAdding(null)}
        />
      )}

      {adding === "medicine" && (
        <MedicineSearchModal
          title="薬剤を選択"
          onSelect={(medicine: Medicine) => {
            setAdding(null);
            const line: SurgeryMedicineLine = {
              medicineCode: medicine.medicine_code,
              name: medicine.name,
              yjCode: medicine.yj_code ?? "",
              dose: "",
              unitName: medicine.unit_name ?? "",
              routeCode: "",
            };
            patch({ medicines: [...values.medicines, line] });
          }}
          onClose={() => setAdding(null)}
        />
      )}

      {adding === "material" && (
        <MedicalMaterialSearchModal
          onSelect={(material: MedicalMaterial) => {
            setAdding(null);
            const line: SurgeryMaterialLine = {
              code: material.material_code,
              name: material.name ?? material.material_code,
              quantity: "1",
              unitName: material.unit_name ?? "",
            };
            patch({ materials: [...values.materials, line] });
          }}
          onClose={() => setAdding(null)}
        />
      )}

      {addingStaff && (
        <PractitionerSearchModal
          defaultRoleCode={staffRoleFilter}
          onSelect={(practitioner) => addStaff(practitioner)}
          onClose={() => setAddingStaff(false)}
        />
      )}
    </Modal>
  );
}

function replaceAt<T>(list: T[], index: number, next: T): T[] {
  return list.map((item, i) => (i === index ? next : item));
}

// 名称とコードだけを並べる表(処置の実施入力と同じ見せ方)。
function LineTable({
  columns,
  rows,
  emptyText,
}: {
  columns: string[];
  rows: { key: string; cells: string[]; onRemove: () => void }[];
  emptyText: string;
}) {
  return (
    <div className="lab-order-item__table-wrap">
      <table className="master-search__table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              {row.cells.map((cell, index) => (
                <td key={index}>{cell}</td>
              ))}
              <td className="master-search__actions">
                <RemoveRowButton onClick={row.onRemove} />
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length + 1} className="master-search__empty">
                {emptyText}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
