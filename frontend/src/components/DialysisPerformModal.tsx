import { useState, type FormEvent } from "react";
import { useCurrentPractitioner } from "../api/authQueries";
import type { MedicalMaterial, MedicalProcedure, Medicine } from "../api/masterClient";
import { useLotRequiredCodes } from "../api/masterQueries";
import { useDialysisPerform, useLatestDryWeight } from "../api/queries";
import { bloodPurifierKindForRow, bloodPurifierLabel } from "../fhir/bloodPurifierHelpers";
import { dialysisOrderModality, summarizeDialysisOrder, type DialysisModality } from "../fhir/dialysisOrderHelpers";
import {
  DIALYSIS_ROUTE_OPTIONS,
  buildDialysisFinishBundle,
  buildDialysisStartBundle,
  dialysisActualMinutes,
  dialysisMinutesLabel,
  dialysisSessionDisplay,
  initialDialysisPerformForm,
  validateDialysisPerformForm,
  type DialysisPerformFormValues,
  type DialysisPerformStage,
  type DialysisSession,
  type DryWeight,
} from "../fhir/dialysisResultHelpers";
import { duplicateLotIndexes } from "../fhir/lotNumberHelpers";
import { displayName } from "../fhir/patientHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { replaceAt } from "../lib/arrays";
import { nowDateTimeInput, shortDate } from "../lib/dates";
import { BloodPurifierSearchModal } from "./BloodPurifierSearchModal";
import { ErrorBanner } from "./ErrorBanner";
import { LotColumnHeading, LotNumberCell } from "./LotNumberCell";
import { MedicalMaterialSearchModal } from "./MedicalMaterialSearchModal";
import { MedicalProcedureSearchModal } from "./MedicalProcedureSearchModal";
import { MedicineSearchModal } from "./MedicineSearchModal";
import { Modal } from "./Modal";
import { RemoveRowButton } from "./RemoveRowButton";

// 透析の実施入力(docs/dialysis-order-design.md §6)。入室はボードのボタンだけで済むので、ここは開始と終了。
//
// - 開始 … 開始時刻と透析前の体重・血圧。ドライウェイトとの差(目標除水)を並べて見せる。
// - 終了 … 終了時刻と透析後の測定値・薬剤・器材・追加の手技、ドライウェイトの見直し。
//   入室・開始を飛ばして後から一度に記録するときは、透析前の欄もここで入れる。
//
// 透析条件(QB・QD・血液浄化器・抗凝固薬)はオーダーを初期値にし、実際に行った値に直せる。

interface Props {
  stage: DialysisPerformStage;
  order: fhir4.ServiceRequest;
  patient?: fhir4.Patient;
  /** ベッドの予約。ベッドサイドは無し。 */
  appointment?: fhir4.Appointment;
  /** 入室・開始済みの回。 */
  session?: DialysisSession;
  /** 「ベッド 3 / 午前」など、どの枠の実施かの表示。 */
  placeLabel?: string;
  onClose: () => void;
}

export function DialysisPerformModal(props: Props) {
  const patientId = props.order.subject?.reference?.split("/").pop();
  const dryWeight = useLatestDryWeight(patientId);
  const title = `透析の${props.stage === "start" ? "開始" : "終了"}${props.patient ? ` - ${displayName(props.patient)}` : ""}`;

  if (dryWeight.isLoading) {
    return (
      <Modal title={title} onClose={props.onClose}>
        <p>読み込み中...</p>
      </Modal>
    );
  }
  return <PerformForm {...props} title={title} dryWeight={dryWeight.data ?? null} dryWeightError={dryWeight.error} />;
}

type Picking = { kind: "purifier"; row: number } | { kind: "medicine" } | { kind: "material" } | { kind: "procedure" };

function PerformForm({
  stage,
  order,
  appointment,
  session,
  placeLabel,
  onClose,
  title,
  dryWeight,
  dryWeightError,
}: Props & { title: string; dryWeight: DryWeight | null; dryWeightError: unknown }) {
  const { practitionerId, practitioner } = useCurrentPractitioner();
  const perform = useDialysisPerform();
  const [values, setValues] = useState<DialysisPerformFormValues>(() =>
    initialDialysisPerformForm(order, session, appointment, dryWeight, nowDateTimeInput()),
  );
  // 除水量は体重の差を初期値にし、手で直したらそれ以降は追いかけない。
  const [ultrafiltrationEdited, setUltrafiltrationEdited] = useState(false);
  const [picking, setPicking] = useState<Picking | null>(null);
  const [error, setError] = useState("");

  const summary = summarizeDialysisOrder(order);
  const modality = dialysisOrderModality(order) as DialysisModality | "";
  const recorded = session ? dialysisSessionDisplay(session) : undefined;
  const preWeightRecorded = recorded?.preWeight != null;
  const preBpRecorded = Boolean(recorded?.preBp);
  const finish = stage === "finish";

  const lotCodes = useLotRequiredCodes(values.medicines.map((line) => line.medicineCode));
  const showLot = values.medicines.some((line) => lotCodes.has(line.medicineCode) || line.lotNumber);
  const missingLot = values.medicines.some((line) => lotCodes.has(line.medicineCode) && !line.lotNumber?.trim());
  const duplicateLots = duplicateLotIndexes(
    values.medicines.map((line) => ({ code: line.medicineCode, lotNumber: line.lotNumber })),
  );

  function patch(next: Partial<DialysisPerformFormValues>) {
    setValues((prev) => {
      const merged = { ...prev, ...next };
      if (!ultrafiltrationEdited && ("preWeight" in next || "postWeight" in next)) {
        const pre = Number(merged.preWeight);
        const post = Number(merged.postWeight);
        merged.ultrafiltration =
          merged.preWeight && merged.postWeight && Number.isFinite(pre - post)
            ? String(Math.round((pre - post) * 100) / 100)
            : "";
      }
      return merged;
    });
  }

  // 終了では見直し中のドライウェイトで出す。
  const targetDryWeight = finish ? Number(values.dryWeight) : dryWeight?.value;
  const targetUltrafiltration =
    values.preWeight && targetDryWeight && (!finish || values.dryWeight)
      ? Math.round((Number(values.preWeight) - targetDryWeight) * 100) / 100
      : null;
  const actualMinutes = dialysisActualMinutes(values.startAt, values.endAt);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const message = validateDialysisPerformForm(values, stage);
    if (message) {
      setError(message);
      return;
    }
    if (duplicateLots.size > 0) return;
    setError("");
    const ctx = {
      order,
      appointment,
      session,
      performer: practitionerId
        ? { id: practitionerId, name: practitioner ? practitionerDisplayName(practitioner) : "" }
        : null,
    };
    const bundle = finish ? buildDialysisFinishBundle(ctx, values, dryWeight) : buildDialysisStartBundle(ctx, values);
    perform.mutate(bundle, { onSuccess: onClose });
  }

  const numberInput = (key: keyof DialysisPerformFormValues, label: string, options: { step?: string; disabled?: boolean } = {}) => (
    <input
      type="number"
      className="dialysis-perform__number"
      step={options.step ?? "0.1"}
      min="0"
      aria-label={label}
      value={values[key] as string}
      disabled={options.disabled}
      onChange={(e) => {
        if (key === "ultrafiltration") setUltrafiltrationEdited(true);
        patch({ [key]: e.target.value });
      }}
    />
  );

  const bloodPressure = (timing: "pre" | "post", disabled = false) => {
    const systolic = timing === "pre" ? "preSystolic" : "postSystolic";
    const diastolic = timing === "pre" ? "preDiastolic" : "postDiastolic";
    const label = timing === "pre" ? "透析前血圧" : "透析後血圧";
    return (
      <label>
        {label}
        <span className="dialysis-perform__pair">
          {numberInput(systolic, `${label} 収縮期`, { step: "1", disabled })}/
          {numberInput(diastolic, `${label} 拡張期`, { step: "1", disabled })}
          mmHg
        </span>
      </label>
    );
  };

  return (
    <Modal title={title} onClose={onClose} className={finish ? "modal--lab-order-item" : undefined}>
      <form onSubmit={handleSubmit}>
        {error && (
          <div className="error-banner" role="alert">
            <p className="error-banner__line error-banner__line--error">{error}</p>
          </div>
        )}
        <ErrorBanner error={dryWeightError} />

        <p className="rad-perform__items">
          <span className="rad-perform__items-label">透析内容</span>
          {[summary.modalityDisplay, placeLabel, summary.conditionLabel].filter(Boolean).join(" / ")}
        </p>

        <div className="lab-order-item__fields">
          <label>
            開始時刻
            <input
              type="datetime-local"
              value={values.startAt}
              onChange={(e) => patch({ startAt: e.target.value })}
              required
            />
          </label>
          {finish && (
            <>
              <label>
                終了時刻
                <input
                  type="datetime-local"
                  value={values.endAt}
                  onChange={(e) => patch({ endAt: e.target.value })}
                  required
                />
              </label>
              <label>
                実透析時間
                <input type="text" value={dialysisMinutesLabel(actualMinutes ?? undefined) || "-"} readOnly disabled />
              </label>
            </>
          )}
          <label>
            担当
            <input
              type="text"
              value={practitioner ? practitionerDisplayName(practitioner) : "(未設定)"}
              readOnly
              disabled
            />
          </label>
        </div>

        <div className="lab-order-item__fields">
          <label>
            透析前体重
            <span className="dialysis-perform__pair">
              {numberInput("preWeight", "透析前体重", { disabled: finish && preWeightRecorded })}kg
            </span>
          </label>
          {bloodPressure("pre", finish && preBpRecorded)}
          <label>
            ドライウェイト
            {finish ? (
              <span className="dialysis-perform__pair">{numberInput("dryWeight", "ドライウェイト")}kg</span>
            ) : (
              <input
                type="text"
                value={dryWeight ? `${dryWeight.value}kg(${shortDate(dryWeight.date)})` : "-"}
                readOnly
                disabled
              />
            )}
          </label>
          <label>
            目標除水
            <input
              type="text"
              value={targetUltrafiltration !== null ? `${targetUltrafiltration}kg` : "-"}
              readOnly
              disabled
            />
          </label>
        </div>

        {finish && (
          <>
            <div className="lab-order-item__fields">
              <label>
                透析後体重
                <span className="dialysis-perform__pair">{numberInput("postWeight", "透析後体重")}kg</span>
              </label>
              <label>
                除水量
                <span className="dialysis-perform__pair">{numberInput("ultrafiltration", "除水量", { step: "0.01" })}L</span>
              </label>
              {bloodPressure("post")}
              <label>
                QB
                <span className="dialysis-perform__pair">{numberInput("qb", "QB", { step: "1" })}mL/min</span>
              </label>
              <label>
                QD
                <span className="dialysis-perform__pair">{numberInput("qd", "QD", { step: "1" })}mL/min</span>
              </label>
            </div>

            <section className="lab-order-item__section">
              <div className="lab-order-item__section-head">
                <h3>血液浄化器</h3>
                <button type="button" onClick={() => setPicking({ kind: "purifier", row: values.purifiers.length })}>
                  浄化器追加
                </button>
              </div>
              <div className="lab-order-item__table-wrap">
                <table className="master-search__table rad-perform__lines">
                  <thead>
                    <tr>
                      <th>名称</th>
                      <th className="rad-item__compact">数量</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {values.purifiers.map((line, index) => (
                      <tr key={`${line.code}-${index}`}>
                        <td>
                          {line.name}
                          <span className="lab-order-item__code">{line.code}</span>
                        </td>
                        <td className="rad-item__compact">
                          <input
                            type="number"
                            className="rad-quantity-input"
                            step="1"
                            min="0"
                            value={line.quantity}
                            onChange={(e) =>
                              patch({ purifiers: replaceAt(values.purifiers, index, { ...line, quantity: e.target.value }) })
                            }
                          />
                          本
                        </td>
                        <td className="master-search__actions">
                          <RemoveRowButton
                            title={`${line.name}を削除`}
                            onClick={() => patch({ purifiers: values.purifiers.filter((_, i) => i !== index) })}
                          />
                        </td>
                      </tr>
                    ))}
                    {values.purifiers.length === 0 && (
                      <tr>
                        <td colSpan={3} className="master-search__empty">
                          血液浄化器の記録はありません
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="lab-order-item__section">
              <div className="lab-order-item__section-head">
                <h3>薬剤</h3>
                <button type="button" onClick={() => setPicking({ kind: "medicine" })}>
                  薬剤追加
                </button>
              </div>
              <div className="lab-order-item__table-wrap">
                <table className="master-search__table rad-perform__lines">
                  <thead>
                    <tr>
                      <th>名称</th>
                      <th className="rad-item__compact">使用量</th>
                      <th className="rad-item__compact">経路</th>
                      {showLot && (
                        <th className="rad-item__compact lot-number-column">
                          <LotColumnHeading missing={missingLot} />
                        </th>
                      )}
                      <th className="rad-item__compact">算定</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {values.medicines.map((line, index) => (
                      <tr key={`${line.medicineCode}-${index}`}>
                        <td>
                          {line.name}
                          <span className="lab-order-item__code">{line.medicineCode}</span>
                        </td>
                        <td className="rad-item__compact">
                          <input
                            type="number"
                            className="rad-quantity-input"
                            step="0.01"
                            min="0"
                            value={line.dose}
                            onChange={(e) =>
                              patch({ medicines: replaceAt(values.medicines, index, { ...line, dose: e.target.value }) })
                            }
                          />
                          {line.unitName}
                        </td>
                        <td className="rad-item__compact">
                          <select
                            className="rad-route-select"
                            value={line.routeCode}
                            onChange={(e) =>
                              patch({
                                medicines: replaceAt(values.medicines, index, { ...line, routeCode: e.target.value }),
                              })
                            }
                          >
                            <option value="">未指定</option>
                            {DIALYSIS_ROUTE_OPTIONS.map((option) => (
                              <option key={option.code} value={option.code}>
                                {option.display}
                              </option>
                            ))}
                          </select>
                        </td>
                        {showLot && (
                          <td className="rad-item__compact lot-number-column">
                            <LotNumberCell
                              required={lotCodes.has(line.medicineCode)}
                              value={line.lotNumber ?? ""}
                              medicineName={line.name}
                              duplicate={duplicateLots.has(index)}
                              onChange={(lotNumber) =>
                                patch({ medicines: replaceAt(values.medicines, index, { ...line, lotNumber }) })
                              }
                            />
                          </td>
                        )}
                        <td className="rad-item__compact">
                          {/* 人工腎臓の所定点数に含まれる薬剤(透析液・抗凝固薬・ESA など)は外す。 */}
                          <input
                            type="checkbox"
                            aria-label={`${line.name}を算定する`}
                            checked={!line.bundled}
                            onChange={(e) =>
                              patch({
                                medicines: replaceAt(values.medicines, index, { ...line, bundled: !e.target.checked }),
                              })
                            }
                          />
                        </td>
                        <td className="master-search__actions">
                          <RemoveRowButton
                            title={`${line.name}を削除`}
                            onClick={() => patch({ medicines: values.medicines.filter((_, i) => i !== index) })}
                          />
                        </td>
                      </tr>
                    ))}
                    {values.medicines.length === 0 && (
                      <tr>
                        <td colSpan={showLot ? 6 : 5} className="master-search__empty">
                          薬剤の使用はありません
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="lab-order-item__section">
              <div className="lab-order-item__section-head">
                <h3>使用器材</h3>
                <button type="button" onClick={() => setPicking({ kind: "material" })}>
                  器材追加
                </button>
              </div>
              <div className="lab-order-item__table-wrap">
                <table className="master-search__table rad-perform__lines">
                  <thead>
                    <tr>
                      <th>名称</th>
                      <th className="rad-item__compact">数量</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {values.materials.map((line, index) => (
                      <tr key={`${line.code}-${index}`}>
                        <td>
                          {line.name}
                          <span className="lab-order-item__code">{line.code}</span>
                        </td>
                        <td className="rad-item__compact">
                          <input
                            type="number"
                            className="rad-quantity-input"
                            step="0.01"
                            min="0"
                            value={line.quantity}
                            onChange={(e) =>
                              patch({ materials: replaceAt(values.materials, index, { ...line, quantity: e.target.value }) })
                            }
                          />
                          {line.unitName}
                        </td>
                        <td className="master-search__actions">
                          <RemoveRowButton
                            title={`${line.name}を削除`}
                            onClick={() => patch({ materials: values.materials.filter((_, i) => i !== index) })}
                          />
                        </td>
                      </tr>
                    ))}
                    {values.materials.length === 0 && (
                      <tr>
                        <td colSpan={3} className="master-search__empty">
                          器材の使用はありません
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="lab-order-item__section">
              <div className="lab-order-item__section-head">
                <h3>追加の手技</h3>
                <button type="button" onClick={() => setPicking({ kind: "procedure" })}>
                  診療行為追加
                </button>
              </div>
              <div className="lab-order-item__table-wrap">
                <table className="master-search__table rad-perform__lines">
                  <thead>
                    <tr>
                      <th>名称</th>
                      <th>コード</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {values.procedures.map((line, index) => (
                      <tr key={`${line.code}-${index}`}>
                        <td>{line.name}</td>
                        <td>{line.code}</td>
                        <td className="master-search__actions">
                          <RemoveRowButton
                            title={`${line.name}を削除`}
                            onClick={() => patch({ procedures: values.procedures.filter((_, i) => i !== index) })}
                          />
                        </td>
                      </tr>
                    ))}
                    {values.procedures.length === 0 && (
                      <tr>
                        <td colSpan={3} className="master-search__empty">
                          追加の手技はありません
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <label className="rad-perform__comment">
              実施コメント
              <textarea value={values.comment} onChange={(e) => patch({ comment: e.target.value })} rows={2} />
            </label>
          </>
        )}

        <ErrorBanner error={perform.error} />

        <div className="lab-order-item__actions">
          <button type="submit" disabled={perform.isPending}>
            {perform.isPending ? "登録中..." : finish ? "終了" : "開始"}
          </button>
          <button type="button" onClick={onClose} disabled={perform.isPending}>
            キャンセル
          </button>
        </div>
      </form>

      {picking?.kind === "purifier" && (
        <BloodPurifierSearchModal
          initialKind={bloodPurifierKindForRow(modality, picking.row)}
          onSelect={(purifier) => {
            patch({
              purifiers: [
                ...values.purifiers,
                { code: purifier.purifier_code, name: bloodPurifierLabel(purifier), quantity: "1" },
              ],
            });
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      )}
      {picking?.kind === "medicine" && (
        <MedicineSearchModal
          title="薬剤を選択"
          onSelect={(m: Medicine) => {
            patch({
              medicines: [
                ...values.medicines,
                {
                  medicineCode: m.medicine_code,
                  yjCode: m.yj_code ?? "",
                  name: m.name ?? m.medicine_code,
                  dose: "",
                  unitName: m.unit_name ?? "",
                  routeCode: "IV",
                  bundled: false,
                },
              ],
            });
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      )}
      {picking?.kind === "material" && (
        <MedicalMaterialSearchModal
          onSelect={(m: MedicalMaterial) => {
            patch({
              materials: [
                ...values.materials,
                { code: m.material_code, name: m.name ?? m.material_code, quantity: "1", unitName: m.unit_name ?? "" },
              ],
            });
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      )}
      {picking?.kind === "procedure" && (
        <MedicalProcedureSearchModal
          defaultSection="J"
          onSelect={(p: MedicalProcedure) => {
            patch({ procedures: [...values.procedures, { code: p.procedure_code, name: p.name ?? p.procedure_code }] });
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      )}
    </Modal>
  );
}

