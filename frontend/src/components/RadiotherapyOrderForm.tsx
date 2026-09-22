import { useMemo, useState, type FormEvent } from "react";
import {
  radiotherapyDeviceHooks,
  radiotherapyModalityHooks,
  radiotherapyProtocolHooks,
  radiotherapyTechniqueHooks,
  useRadJj1017Catalog,
} from "../api/masterQueries";
import {
  useDepartmentDoctors,
  usePatientConsultOrders,
  useSelfOrganization,
} from "../api/queries";
import { refreshProblemDisplay } from "../fhir/conditionHelpers";
import { summarizeConsultOrder } from "../fhir/consultOrderHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { SETTING_OPTIONS, type PrescriptionSetting } from "../fhir/prescriptionHelpers";
import {
  CONCURRENT_THERAPY_OPTIONS,
  FREE_TEXT_BODY_PART,
  RADIOTHERAPY_INTENT_OPTIONS,
  RADIOTHERAPY_LATERALITY_OPTIONS,
  VOLUME_TYPE_OPTIONS,
  applyRadiotherapyProtocol,
  emptyRadiotherapyOrderForm,
  emptyRadiotherapyPhase,
  emptyRadiotherapyVolume,
  formatDose,
  radiotherapyPhaseLabel,
  radiotherapyTotalDose,
  radiotherapyVolumeTotals,
  validateRadiotherapyOrderForm,
  type RadiotherapyIntent,
  type RadiotherapyOrderFormValues,
  type RadiotherapyPhaseValues,
  type RadiotherapyVolumeValues,
} from "../fhir/radiotherapyOrderHelpers";
import { useBulkStartDate } from "../hooks/useBulkStartDate";
import { useOrderContext } from "../hooks/useOrderContext";
import { useProblemOptions } from "../hooks/useProblemOptions";
import { useValidationError } from "../hooks/useValidationError";
import { makeFieldUpdater } from "../lib/form";
import { ErrorBanner } from "./ErrorBanner";
import { ProblemSelect } from "./ProblemSelect";
import { RadiotherapyPreCheck } from "./RadiotherapyPreCheck";
import { renderJj1017CodeOptions } from "./radItemOptions";

// 放射線治療の治療処方フォーム(docs/radiotherapy-order-design.md §5)。
//
// 書くのは放射線治療医。標的(どこに)と Phase(どの方法で何 Gy を何回)を分けて入れる。
// 1 つの Phase の中で標的ごとに 1 回線量を変えられ(SIB)、Phase を足せば Boost になる。
// 総線量は 1 回線量 × 分割回数の派生値で、入力させない。
//
// 治療プロトコル(施設の定型処方)を選ぶと標的と Phase が展開される。展開後は自由に直せる。
// ビーム・MU・DVH などの治療計画の中身はここでは扱わない(治療計画装置の領域。§1)。

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

interface RadiotherapyOrderFormProps {
  patientId: string;
  initialValues?: RadiotherapyOrderFormValues;
  onSubmit: (values: RadiotherapyOrderFormValues) => void;
  submitting: boolean;
  submitError?: unknown;
  submitLabel?: string;
  /** 編集中のオーダー。安全確認の過去コースから自分を除くのに使う。 */
  editingSrId?: string;
  /** 治療が始まった処方か。照射記録が指す標的・Phase を消せないようにする(§8)。 */
  lockStructure?: boolean;
  bulkStartDate?: string;
  /** セットの内容として入力する(患者と日付に依存する入力を出さず、その検証も外す)。 */
  setMode?: boolean;
  hideSubmit?: boolean;
}

export function RadiotherapyOrderForm({
  patientId,
  initialValues,
  onSubmit,
  submitting,
  submitError,
  submitLabel = "登録",
  editingSrId,
  lockStructure = false,
  bulkStartDate,
  setMode = false,
  hideSubmit = false,
}: RadiotherapyOrderFormProps) {
  const [values, setValues] = useState<RadiotherapyOrderFormValues>(
    initialValues ?? emptyRadiotherapyOrderForm(""),
  );
  const [validationError, setValidationError, validationErrorRef] = useValidationError();
  const [commentOpen, setCommentOpen] = useState(Boolean(initialValues?.comment));

  const problemOptions = useProblemOptions(patientId);
  useBulkStartDate(bulkStartDate, (date) => setValues((v) => ({ ...v, startDate: date })));
  const update = makeFieldUpdater(setValues);

  const protocols = radiotherapyProtocolHooks.useOptions();
  const modalities = radiotherapyModalityHooks.useOptions();
  const techniques = radiotherapyTechniqueHooks.useOptions();
  const devices = radiotherapyDeviceHooks.useOptions();
  const catalog = useRadJj1017Catalog();
  const bodyParts = catalog.data?.body_part ?? [];

  // 担当医の候補は、いま選んでいる診療科(放射線治療科)の医師。
  const context = useOrderContext();
  const { selfOrganizationId } = useSelfOrganization();
  const doctors = useDepartmentDoctors(
    context.departmentId || undefined,
    selfOrganizationId || undefined,
  );

  // 元になった他科依頼の候補。いまの診療科あての依頼を先に並べる。
  const consultOrders = usePatientConsultOrders(setMode ? undefined : patientId);
  const consultOptions = useMemo(() => {
    const rows = (consultOrders.data ?? []).map((sr) => {
      const summary = summarizeConsultOrder(sr);
      const from = [sr.authoredOn?.slice(0, 10), sr.requester?.display].filter(Boolean).join(" ");
      return {
        id: sr.id ?? "",
        mine: summary.targetDepartmentId === context.departmentId,
        label: `${from} → ${summary.targetLabel}${sr.status === "completed" ? "(回答済)" : ""}`,
        purpose: summary.purpose,
      };
    });
    return [...rows.filter((r) => r.mine), ...rows.filter((r) => !r.mine)];
  }, [consultOrders.data, context.departmentId]);
  const selectedConsult = consultOptions.find((o) => o.id === values.consultOrderId);

  function changeProtocol(code: string) {
    const protocol = protocols.items.find((p) => p.code === code);
    if (!protocol) return update("protocol", { code: "", name: "" });
    setValues((v) =>
      applyRadiotherapyProtocol(v, protocol, {
        modalities: modalities.items,
        techniques: techniques.items,
        devices: devices.items,
      }),
    );
  }

  function updateVolume(volumeId: string, patch: Partial<RadiotherapyVolumeValues>) {
    setValues((v) => ({
      ...v,
      volumes: v.volumes.map((x) => (x.volumeId === volumeId ? { ...x, ...patch } : x)),
    }));
  }

  function removeVolume(volumeId: string) {
    setValues((v) => ({
      ...v,
      volumes: v.volumes.filter((x) => x.volumeId !== volumeId),
      phases: v.phases.map((p) => {
        const { [volumeId]: _removed, ...rest } = p.fractionDoses;
        return { ...p, fractionDoses: rest };
      }),
    }));
  }

  function updatePhase(phaseId: string, patch: Partial<RadiotherapyPhaseValues>) {
    setValues((v) => ({
      ...v,
      phases: v.phases.map((x) => (x.phaseId === phaseId ? { ...x, ...patch } : x)),
    }));
  }

  function coded(items: { code: string; name: string }[], code: string) {
    const found = items.find((item) => item.code === code);
    return { code, name: found?.name ?? "" };
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const error = validateRadiotherapyOrderForm(values, { requireDates: !setMode });
    setValidationError(error);
    if (error) return;

    const doctor = doctors.doctors.find((p) => p.id === values.practitionerId);
    onSubmit({
      ...values,
      practitionerName: doctor ? practitionerDisplayName(doctor) : values.practitionerName,
      consultOrderDisplay: selectedConsult?.label ?? values.consultOrderDisplay,
      problem: refreshProblemDisplay(values.problem, problemOptions),
    });
  }

  const totals = radiotherapyVolumeTotals(values);

  return (
    <form className="prescription-form" onSubmit={handleSubmit} noValidate={hideSubmit}>
      {validationError && (
        <div className="error-banner" role="alert" ref={validationErrorRef}>
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}
      <ErrorBanner error={submitError} />

      {!setMode && (
        <RadiotherapyPreCheck
          patientId={patientId}
          volumes={values.volumes}
          excludeSrId={editingSrId}
        />
      )}

      {!setMode && (
        <fieldset>
          <legend>依頼</legend>
          <label>
            元の他科依頼
            <select
              value={values.consultOrderId}
              onChange={(e) => update("consultOrderId", e.target.value)}
            >
              <option value="">（なし）</option>
              {/* 取消された依頼などで候補から外れていても、保存済みの紐付けは残す。 */}
              {values.consultOrderId && !selectedConsult && (
                <option value={values.consultOrderId}>{values.consultOrderDisplay}</option>
              )}
              {consultOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          {selectedConsult?.purpose && (
            <pre className="radiotherapy-order__consult-purpose">{selectedConsult.purpose}</pre>
          )}
        </fieldset>
      )}

      <fieldset>
        <legend>治療コース</legend>
        <label>
          治療プロトコル
          <select value={values.protocol.code} onChange={(e) => changeProtocol(e.target.value)}>
            <option value="">（なし）</option>
            {values.protocol.code && !protocols.items.some((p) => p.code === values.protocol.code) && (
              <option value={values.protocol.code}>{values.protocol.name}</option>
            )}
            {protocols.items.map((p) => (
              <option key={p.code} value={p.code}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          治療目的 *
          <select
            value={values.intent}
            onChange={(e) => update("intent", e.target.value as RadiotherapyIntent)}
            required
          >
            <option value="">選択してください</option>
            {RADIOTHERAPY_INTENT_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.display}
              </option>
            ))}
          </select>
        </label>
        <label>
          コース番号 *
          <input
            type="number"
            min={1}
            step={1}
            value={values.courseNumber}
            onChange={(e) => update("courseNumber", e.target.value)}
            required
          />
        </label>
        {!setMode && (
          <label>
            開始予定日 *
            <input
              type="date"
              value={values.startDate}
              onChange={(e) => update("startDate", e.target.value)}
              required
            />
          </label>
        )}
        <label>
          併用療法
          <select
            value={values.concurrentTherapy}
            onChange={(e) => update("concurrentTherapy", e.target.value)}
          >
            <option value="">選択してください</option>
            {CONCURRENT_THERAPY_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.display}
              </option>
            ))}
          </select>
        </label>
        {!setMode && (
          <>
            <label>
              担当医
              <select
                value={values.practitionerId}
                onChange={(e) => update("practitionerId", e.target.value)}
              >
                <option value="">（処方医）</option>
                {values.practitionerId &&
                  !doctors.doctors.some((p) => p.id === values.practitionerId) && (
                    <option value={values.practitionerId}>{values.practitionerName}</option>
                  )}
                {doctors.doctors.map((p) => (
                  <option key={p.id} value={p.id}>
                    {practitionerDisplayName(p)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              対象プロブレム
              <ProblemSelect
                value={values.problem}
                options={problemOptions}
                onChange={(problem) => update("problem", problem)}
              />
            </label>
          </>
        )}
      </fieldset>

      <fieldset>
        <legend>標的 *</legend>
        {values.volumes.map((volume) => (
          <div key={volume.volumeId} className="radiotherapy-order__card">
            <div className="radiotherapy-order__row">
              <label>
                名称
                <input
                  type="text"
                  value={volume.label}
                  onChange={(e) => updateVolume(volume.volumeId, { label: e.target.value })}
                />
              </label>
              <label>
                種別
                <select
                  value={volume.type}
                  onChange={(e) => updateVolume(volume.volumeId, { type: e.target.value })}
                >
                  <option value=""></option>
                  {VOLUME_TYPE_OPTIONS.map((o) => (
                    <option key={o.code} value={o.code}>
                      {o.display}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="rp-card__icon-button"
                title="標的を削除"
                aria-label="標的を削除"
                disabled={lockStructure || values.volumes.length <= 1}
                onClick={() => removeVolume(volume.volumeId)}
              >
                <TrashIcon />
              </button>
            </div>
            <div className="radiotherapy-order__row">
              <label>
                部位
                <select
                  value={volume.bodyPart.code}
                  onChange={(e) => {
                    const code = e.target.value;
                    // 自由記載は名前だけを持つ。選び直しに備えて入力済みの名前は残す。
                    const name =
                      code === FREE_TEXT_BODY_PART
                        ? volume.bodyPart.name
                        : (bodyParts.find((c) => c.code === code)?.name ?? "");
                    updateVolume(volume.volumeId, { bodyPart: { code, name } });
                  }}
                >
                  <option value="">選択してください</option>
                  {renderJj1017CodeOptions(bodyParts, undefined)}
                  {/* 部品表に無い部位。一覧の末尾に置く。 */}
                  <option value={FREE_TEXT_BODY_PART}>自由記載</option>
                </select>
              </label>
              <label>
                左右
                <select
                  value={volume.laterality}
                  onChange={(e) => updateVolume(volume.volumeId, { laterality: e.target.value })}
                >
                  <option value=""></option>
                  {RADIOTHERAPY_LATERALITY_OPTIONS.map((o) => (
                    <option key={o.code} value={o.code}>
                      {o.display}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {volume.bodyPart.code === FREE_TEXT_BODY_PART && (
              <label>
                部位名
                <input
                  type="text"
                  value={volume.bodyPart.name}
                  onChange={(e) =>
                    updateVolume(volume.volumeId, {
                      bodyPart: { code: FREE_TEXT_BODY_PART, name: e.target.value },
                    })
                  }
                />
              </label>
            )}
            <label>
              補足
              <input
                type="text"
                value={volume.description}
                onChange={(e) => updateVolume(volume.volumeId, { description: e.target.value })}
              />
            </label>
          </div>
        ))}
        <div className="prescription-form__comment-toggle">
          <button
            type="button"
            className="comment-add-button"
            onClick={() =>
              update("volumes", [...values.volumes, emptyRadiotherapyVolume(values.volumes.length)])
            }
          >
            ＋標的
          </button>
        </div>
      </fieldset>

      <fieldset>
        <legend>Phase *</legend>
        {values.phases.map((phase, index) => {
          const fractions = Number(phase.fractions);
          const techniqueChoices = techniques.items.filter(
            (t) =>
              t.modality_codes.length === 0 ||
              !phase.modality.code ||
              t.modality_codes.includes(phase.modality.code),
          );
          const deviceChoices = devices.items.filter(
            (d) =>
              d.modality_codes.length === 0 ||
              !phase.modality.code ||
              d.modality_codes.includes(phase.modality.code),
          );
          return (
            <div key={phase.phaseId} className="radiotherapy-order__card">
              <div className="radiotherapy-order__row">
                <label>
                  名称
                  <input
                    type="text"
                    value={phase.label}
                    placeholder={radiotherapyPhaseLabel(phase, index)}
                    onChange={(e) => updatePhase(phase.phaseId, { label: e.target.value })}
                  />
                </label>
                <button
                  type="button"
                  className="rp-card__icon-button"
                  title="Phase を削除"
                  aria-label="Phase を削除"
                  disabled={lockStructure || values.phases.length <= 1}
                  onClick={() =>
                    update(
                      "phases",
                      values.phases.filter((p) => p.phaseId !== phase.phaseId),
                    )
                  }
                >
                  <TrashIcon />
                </button>
              </div>
              <div className="radiotherapy-order__row">
                <label>
                  モダリティ
                  <select
                    value={phase.modality.code}
                    onChange={(e) =>
                      updatePhase(phase.phaseId, {
                        modality: coded(modalities.items, e.target.value),
                        technique: { code: "", name: "" },
                        device: { code: "", name: "" },
                      })
                    }
                  >
                    <option value="">選択してください</option>
                    {phase.modality.code &&
                      !modalities.items.some((m) => m.code === phase.modality.code) && (
                        <option value={phase.modality.code}>{phase.modality.name}</option>
                      )}
                    {modalities.items.map((m) => (
                      <option key={m.code} value={m.code}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  照射技法
                  <select
                    value={phase.technique.code}
                    onChange={(e) =>
                      updatePhase(phase.phaseId, {
                        technique: coded(techniques.items, e.target.value),
                      })
                    }
                  >
                    <option value="">選択してください</option>
                    {phase.technique.code &&
                      !techniqueChoices.some((t) => t.code === phase.technique.code) && (
                        <option value={phase.technique.code}>{phase.technique.name}</option>
                      )}
                    {techniqueChoices.map((t) => (
                      <option key={t.code} value={t.code}>
                        {t.abbreviation ? `${t.abbreviation} ${t.name}` : t.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="radiotherapy-order__row">
                <label>
                  分割回数
                  <input
                    type="number"
                    min={1}
                    max={99}
                    step={1}
                    value={phase.fractions}
                    onChange={(e) => updatePhase(phase.phaseId, { fractions: e.target.value })}
                  />
                </label>
                <label>
                  週あたり回数
                  <input
                    type="number"
                    min={1}
                    max={14}
                    step={1}
                    value={phase.fractionsPerWeek}
                    onChange={(e) =>
                      updatePhase(phase.phaseId, { fractionsPerWeek: e.target.value })
                    }
                  />
                </label>
                <label>
                  使用予定装置
                  <select
                    value={phase.device.code}
                    onChange={(e) =>
                      updatePhase(phase.phaseId, { device: coded(devices.items, e.target.value) })
                    }
                  >
                    <option value=""></option>
                    {phase.device.code &&
                      !deviceChoices.some((d) => d.code === phase.device.code) && (
                        <option value={phase.device.code}>{phase.device.name}</option>
                      )}
                    {deviceChoices.map((d) => (
                      <option key={d.code} value={d.code}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <table className="master-search__table radiotherapy-order__doses">
                <thead>
                  <tr>
                    <th>標的</th>
                    <th>1回線量(Gy)</th>
                    <th>総線量</th>
                  </tr>
                </thead>
                <tbody>
                  {values.volumes.map((volume) => {
                    const text = phase.fractionDoses[volume.volumeId] ?? "";
                    const dose = Number(text);
                    const valid = text !== "" && dose > 0 && Number.isInteger(fractions) && fractions > 0;
                    return (
                      <tr key={volume.volumeId}>
                        <td>{volume.label}</td>
                        <td>
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={text}
                            aria-label={`${volume.label} の1回線量`}
                            onChange={(e) =>
                              updatePhase(phase.phaseId, {
                                fractionDoses: {
                                  ...phase.fractionDoses,
                                  [volume.volumeId]: e.target.value,
                                },
                              })
                            }
                          />
                        </td>
                        <td>
                          {valid && `${formatDose(radiotherapyTotalDose(dose, fractions))} Gy`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
        <div className="prescription-form__comment-toggle">
          <button
            type="button"
            className="comment-add-button"
            onClick={() => update("phases", [...values.phases, emptyRadiotherapyPhase()])}
          >
            ＋Phase
          </button>
        </div>
        {totals.some((t) => t.doseLabel) && (
          <dl className="radiotherapy-order__totals">
            {totals
              .filter((t) => t.doseLabel)
              .map((t) => (
                <div key={t.volumeId}>
                  <dt>{t.label}</dt>
                  <dd>{t.doseLabel}</dd>
                </div>
              ))}
          </dl>
        )}
      </fieldset>

      <fieldset>
        <legend>依頼共通</legend>
        <label>
          入外区分
          <select
            value={values.setting}
            onChange={(e) => update("setting", e.target.value as PrescriptionSetting)}
          >
            <option value="">選択してください</option>
            {SETTING_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.display}
              </option>
            ))}
          </select>
        </label>
        {commentOpen ? (
          <div className="prescription-form__comment-field">
            <label>
              コメント
              <input
                type="text"
                value={values.comment}
                onChange={(e) => update("comment", e.target.value)}
              />
            </label>
            <button
              type="button"
              className="rp-card__icon-button"
              title="コメントを削除"
              aria-label="コメントを削除"
              onClick={() => {
                setCommentOpen(false);
                update("comment", "");
              }}
            >
              ×
            </button>
          </div>
        ) : (
          <div className="prescription-form__comment-toggle">
            <button
              type="button"
              className="comment-add-button"
              onClick={() => setCommentOpen(true)}
            >
              ＋コメント
            </button>
          </div>
        )}
      </fieldset>

      {!hideSubmit && (
        <div className="prescription-form__actions">
          <button type="submit" disabled={submitting}>
            {submitting ? "保存中..." : submitLabel}
          </button>
        </div>
      )}
    </form>
  );
}
