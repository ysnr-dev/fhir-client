import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { Disease, PathwaySetting, PathwayStatus } from "../api/masterClient";
import { usePathway, usePathwayMutations } from "../api/masterQueries";
import { usePractitionerOptions, useSelfDepartments } from "../api/queries";
import { DiseaseSearchModal } from "../components/DiseaseSearchModal";
import { ErrorBanner } from "../components/ErrorBanner";
import { NursingItemSearchModal } from "../components/NursingItemSearchModal";
import { PathwayEventCard, TrashIcon } from "../components/PathwayEventCard";
import { PathwayOverviewTable } from "../components/PathwayOverviewTable";
import { PathwayTaskTemplateModal } from "../components/PathwayTaskTemplateModal";
import { departmentCode, departmentDisplayName } from "../fhir/departmentHelpers";
import {
  ASSESSMENT_CATEGORY_SUGGESTIONS,
  defaultOrderTypeOfTask,
  PATHWAY_SETTING_OPTIONS,
  PATHWAY_STATUS_OPTIONS,
  copyEventDraft,
  draftFromPathway,
  emptyEventDraft,
  emptyPathwayDraft,
  eventDayOf,
  newDraftKey,
  nextDayNumber,
  operationalPayloadFromDraft,
  overviewRows,
  payloadFromDraft,
  previousDayNumber,
  sortEventsByDay,
  validatePathwayDraft,
  type PathwayDraft,
  type PathwayEventDraft,
  type PathwayOatUnitDraft,
  type PathwayTaskTemplate,
} from "../fhir/pathwayHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { useValidationError } from "../hooks/useValidationError";
import { makeFieldUpdater } from "../lib/form";

// クリニカルパス(施設パス)定義の登録・編集。1 パス 1 ページで、本体と子(対象病名・病日・
// OAT ユニット・観察項目・タスク)をローカルの draft に持ち、「保存」で 1 リクエストにまとめる。
// 病名・看護観察の検索モーダルとオーダー雛形のモーダルを開くので、外側は <form> にしない
// (Modal は非ポータルで、入れ子の form が外側の submit を誘発する)。
// 設計は docs/clinical-pathway-design.md。

type Picker =
  | { kind: "disease" }
  | { kind: "nursing"; eventKey: number; unitKey: number; assessmentKey: number }
  | { kind: "template"; eventKey: number; unitKey: number; taskKey: number }
  | null;

export function PathwayEditorPage() {
  const { pathwayId } = useParams<{ pathwayId: string }>();
  const navigate = useNavigate();
  const isNew = pathwayId === undefined;
  const detail = usePathway(isNew ? null : pathwayId);
  const mutations = usePathwayMutations();
  const { departments } = useSelfDepartments();
  const { practitioners } = usePractitionerOptions();

  const [draft, setDraft] = useState<PathwayDraft>(emptyPathwayDraft);
  // 同じ id の再取得(フォーカス復帰など)で入力中の draft を上書きしないよう、id が変わったときだけ作り直す。
  const [loadedId, setLoadedId] = useState<number | null>(null);
  const [validationError, setValidationError, validationErrorRef] = useValidationError();
  const [picker, setPicker] = useState<Picker>(null);
  const update = makeFieldUpdater(setDraft);

  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  useEffect(() => {
    if (!detail.data || detail.data.id === loadedId) return;
    setDraft(draftFromPathway(detail.data));
    setLoadedId(detail.data.id);
    setValidationError(null);
  }, [detail.data, loadedId, setValidationError]);

  const savedId = detail.data?.id ?? null;
  // 保存済みの状態で判定する(画面で状態を変えただけでは凍結は解けない)。
  const frozen = detail.data ? detail.data.status !== "draft" : false;
  const statusOptions = frozen
    ? PATHWAY_STATUS_OPTIONS.filter((o) => o.code !== "draft")
    : PATHWAY_STATUS_OPTIONS;
  const approver = practitioners.find((p) => p.id === draft.approvedBy);
  const approverName = approver ? practitionerDisplayName(approver) : draft.approvedBy;
  const saving = mutations.create.isPending || mutations.update.isPending;

  async function handleSave() {
    const message = frozen ? null : validatePathwayDraft(draft);
    setValidationError(message);
    if (message) return;

    const payload = frozen ? operationalPayloadFromDraft(draft) : payloadFromDraft(draft);
    if (savedId === null) {
      const created = await mutations.create.mutateAsync(payload);
      navigate(`/pathways/${created.id}`, { replace: true });
    } else {
      const updated = await mutations.update.mutateAsync({ id: savedId, payload });
      setDraft(draftFromPathway(updated));
    }
  }

  async function handleCopy() {
    if (savedId === null) return;
    const copied = await mutations.copy.mutateAsync({ id: savedId });
    navigate(`/pathways/${copied.id}`);
  }

  async function handleDelete() {
    if (savedId === null) return;
    if (!window.confirm(`${draft.name} を削除しますか？（病日・アウトカム・タスクもすべて削除されます）`)) return;
    await mutations.remove.mutateAsync(savedId);
    navigate("/pathways");
  }

  function handleDepartmentChange(id: string) {
    const department = departments.find((d) => d.id === id);
    setDraft({
      ...draft,
      departmentCode: department ? departmentCode(department) : "",
      departmentName: department ? departmentDisplayName(department) : "",
    });
  }
  const selectedDepartmentId = departments.find((d) => departmentCode(d) === draft.departmentCode)?.id ?? "";

  // ---- 病日の更新 ----

  function updateEvent(eventKey: number, patch: Partial<PathwayEventDraft>) {
    setDraft((prev) => ({
      ...prev,
      events: prev.events.map((e) => (e.key === eventKey ? { ...e, ...patch } : e)),
    }));
  }

  function updateUnit(eventKey: number, unitKey: number, patch: Partial<PathwayOatUnitDraft>) {
    setDraft((prev) => ({
      ...prev,
      events: prev.events.map((e) =>
        e.key === eventKey
          ? { ...e, oatUnits: e.oatUnits.map((u) => (u.key === unitKey ? { ...u, ...patch } : u)) }
          : e,
      ),
    }));
  }

  function addEvent(day: number) {
    setDraft((prev) => ({ ...prev, events: sortEventsByDay([...prev.events, emptyEventDraft(day)]) }));
  }

  function copyEvent(event: PathwayEventDraft) {
    setDraft((prev) => ({
      ...prev,
      events: sortEventsByDay([...prev.events, copyEventDraft(event, nextDayNumber(prev.events))]),
    }));
  }

  function removeEvent(event: PathwayEventDraft) {
    const day = eventDayOf(event);
    const label = day === null ? "この病日" : `病日 ${day}`;
    if (event.oatUnits.length > 0 && !window.confirm(`${label} を削除しますか？（OAT ユニット ${event.oatUnits.length} 件も消えます）`)) {
      return;
    }
    setDraft((prev) => ({ ...prev, events: prev.events.filter((e) => e.key !== event.key) }));
  }

  function findTask(p: Extract<Picker, { kind: "template" }>) {
    const event = draft.events.find((e) => e.key === p.eventKey);
    const unit = event?.oatUnits.find((u) => u.key === p.unitKey);
    return unit?.tasks.find((t) => t.key === p.taskKey) ?? null;
  }

  function commitTemplate(p: Extract<Picker, { kind: "template" }>, template: PathwayTaskTemplate) {
    const event = draft.events.find((e) => e.key === p.eventKey);
    const unit = event?.oatUnits.find((u) => u.key === p.unitKey);
    if (!event || !unit) return;
    updateUnit(event.key, unit.key, {
      tasks: unit.tasks.map((t) => (t.key === p.taskKey ? { ...t, template } : t)),
    });
    setPicker(null);
  }

  const templateTask = picker?.kind === "template" ? findTask(picker) : null;
  const overview = overviewRows(draft);

  if (!isNew && detail.isPending) {
    return (
      <div className="page">
        <p>読み込み中…</p>
      </div>
    );
  }

  return (
    <div className="page pathway-editor regimen-editor">
      <div className="page__header">
        <h1>{isNew ? "パスを追加" : "パスを編集"}</h1>
        <div className="page__header-actions">
          <Link to="/pathways" className="button">
            一覧へ戻る
          </Link>
        </div>
      </div>

      {validationError && (
        <div className="error-banner" role="alert" ref={validationErrorRef}>
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}
      <ErrorBanner error={detail.error} />
      <ErrorBanner
        error={mutations.create.error ?? mutations.update.error ?? mutations.copy.error ?? mutations.remove.error}
      />

      {frozen && (
        <p className="regimen-check__summary regimen-check__summary--out">
          {`${draft.status === "retired" ? "廃止" : "承認済"}のパスは内容を変更できません。直すときは「複製」して新しいパスとして作り、承認してから、こちらを廃止にします。`}
        </p>
      )}
      {draft.copiedFromCode && (
        <p className="injection-scope__note">
          {`複製元: `}
          <Link to={`/pathways/${draft.copiedFromCode}`}>{draft.copiedFromCode}</Link>
        </p>
      )}

      <datalist id="pathway-assessment-categories">
        {ASSESSMENT_CATEGORY_SUGGESTIONS.map((s) => (
          <option key={s.code} value={s.code}>
            {s.display}
          </option>
        ))}
      </datalist>

      {/* 内容は承認済・廃止で凍結する。 */}
      <fieldset className="regimen-editor__content" disabled={frozen}>
        {/* ---- 基本情報 ---- */}
        <section className="lab-order-item__section">
          <div className="lab-order-item__section-head">
            <h3>基本情報</h3>
          </div>
          <div className="lab-order-item__fields">
            <label>
              パスコード
              <input
                type="text"
                value={draft.pathwayCode}
                onChange={(e) => update("pathwayCode", e.target.value)}
                placeholder={isNew ? "空欄なら自動採番" : undefined}
                disabled={!isNew}
              />
            </label>
            <label>
              パス名
              <input
                type="text"
                className="regimen-editor__name"
                value={draft.name}
                onChange={(e) => update("name", e.target.value)}
              />
            </label>
            <label>
              略称
              <input type="text" value={draft.shortName} onChange={(e) => update("shortName", e.target.value)} />
            </label>
            <label>
              カナ(検索用)
              <input type="text" value={draft.nameKana} onChange={(e) => update("nameKana", e.target.value)} />
            </label>
            <label>
              診療科
              <select value={selectedDepartmentId} onChange={(e) => handleDepartmentChange(e.target.value)}>
                <option value="">未指定</option>
                {draft.departmentCode && !selectedDepartmentId && (
                  <option value="">{draft.departmentName || draft.departmentCode}</option>
                )}
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {departmentDisplayName(d)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              版
              <input
                type="text"
                className="regimen-editor__unit-input"
                value={draft.version}
                onChange={(e) => update("version", e.target.value)}
              />
            </label>
            <label>
              入外
              <select value={draft.setting} onChange={(e) => update("setting", e.target.value as PathwaySetting)}>
                {PATHWAY_SETTING_OPTIONS.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.display}
                  </option>
                ))}
              </select>
            </label>
            <label>
              パス予定日数
              <input
                type="number"
                min={1}
                className="regimen-editor__num-input"
                value={draft.scheduledDays}
                onChange={(e) => update("scheduledDays", e.target.value)}
              />
            </label>
            <label>
              元ひな型パス
              <input
                type="text"
                className="regimen-editor__name"
                value={draft.protocolBase}
                onChange={(e) => update("protocolBase", e.target.value)}
              />
            </label>
          </div>
          <div className="regimen-editor__texts">
            <label>
              適応基準
              <textarea
                rows={3}
                value={draft.adaptiveCriteria}
                onChange={(e) => update("adaptiveCriteria", e.target.value)}
              />
            </label>
            <label>
              備考
              <textarea rows={2} value={draft.note} onChange={(e) => update("note", e.target.value)} />
            </label>
          </div>
        </section>

        {/* ---- 対象病名 ---- */}
        <section className="lab-order-item__section">
          <div className="lab-order-item__section-head">
            <h3>対象病名</h3>
          </div>
          {draft.indications.length > 0 && (
            <table className="master-search__table regimen-editor__rows">
              <thead>
                <tr>
                  <th>病名</th>
                  <th className="rad-item__compact">ICD10</th>
                  <th className="rad-item__compact">管理番号</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {draft.indications.map((i) => (
                  <tr key={i.key}>
                    <td>{i.name}</td>
                    <td className="rad-item__compact">{i.icd10}</td>
                    <td className="rad-item__compact">{i.managementNumber}</td>
                    <td className="pathway-rows__tools">
                      <button
                        type="button"
                        className="rp-card__icon-button"
                        onClick={() =>
                          update(
                            "indications",
                            draft.indications.filter((x) => x.key !== i.key),
                          )
                        }
                        aria-label="削除"
                      >
                        <TrashIcon />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="lab-order-item__actions">
            <button type="button" onClick={() => setPicker({ kind: "disease" })}>
              ＋ 病名
            </button>
          </div>
        </section>

        {/* ---- 病日 ---- */}
        <section className="lab-order-item__section">
          <div className="lab-order-item__section-head">
            <h3>病日</h3>
          </div>
          {draft.events.map((event) => (
            <PathwayEventCard
              key={event.key}
              event={event}
              onChange={(patch) => updateEvent(event.key, patch)}
              onDayCommit={() => update("events", sortEventsByDay(draft.events))}
              onCopy={() => copyEvent(event)}
              onRemove={() => removeEvent(event)}
              onPickNursingObservation={(unitKey, assessmentKey) =>
                setPicker({ kind: "nursing", eventKey: event.key, unitKey, assessmentKey })
              }
              onEditTemplate={(unitKey, taskKey) =>
                setPicker({ kind: "template", eventKey: event.key, unitKey, taskKey })
              }
            />
          ))}
          <div className="lab-order-item__actions">
            <button type="button" onClick={() => addEvent(nextDayNumber(draft.events))}>
              ＋ 病日
            </button>
            <button type="button" onClick={() => addEvent(previousDayNumber(draft.events))}>
              ＋ 入院前日
            </button>
          </div>
        </section>

        <PathwayOverviewTable rows={overview} />
      </fieldset>

      {/* ---- 運用(凍結中も動かせる) ---- */}
      <section className="lab-order-item__section">
        <div className="lab-order-item__section-head">
          <h3>運用</h3>
        </div>
        <div className="lab-order-item__fields">
          <label>
            状態
            <select value={draft.status} onChange={(e) => update("status", e.target.value as PathwayStatus)}>
              {statusOptions.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.display}
                </option>
              ))}
            </select>
          </label>
          <div className="regimen-editor__derived">
            承認
            <strong>{draft.approvedOn ? `${draft.approvedOn}${approverName ? ` / ${approverName}` : ""}` : "—"}</strong>
          </div>
          <label>
            有効開始日
            <input type="date" value={draft.validFrom} onChange={(e) => update("validFrom", e.target.value)} />
          </label>
          <label>
            有効終了日
            <input type="date" value={draft.validTo} onChange={(e) => update("validTo", e.target.value)} />
          </label>
          <label>
            表示順
            <input
              type="number"
              className="regimen-editor__num-input"
              value={draft.displayOrder}
              onChange={(e) => update("displayOrder", e.target.value)}
            />
          </label>
        </div>
      </section>

      <div className="lab-order-item__actions regimen-editor__footer">
        <button type="button" onClick={handleSave} disabled={saving}>
          保存
        </button>
        {savedId !== null && (
          <>
            <button type="button" onClick={handleCopy} disabled={mutations.copy.isPending}>
              複製
            </button>
            {!frozen && (
              <button type="button" onClick={handleDelete} disabled={mutations.remove.isPending}>
                削除
              </button>
            )}
          </>
        )}
      </div>

      {picker?.kind === "disease" && (
        <DiseaseSearchModal
          onSelect={(disease: Disease) => {
            setPicker(null);
            if (draft.indications.some((i) => i.managementNumber === disease.management_number)) return;
            update("indications", [
              ...draft.indications,
              {
                key: newDraftKey(),
                managementNumber: disease.management_number,
                name: disease.name,
                icd10: disease.icd10_2013 ?? "",
              },
            ]);
          }}
          onClose={() => setPicker(null)}
        />
      )}
      {picker?.kind === "nursing" && (
        <NursingItemSearchModal
          only="observation"
          onSelect={(item, display) => {
            const p = picker;
            setPicker(null);
            if (!item || item.kind !== "observation") return;
            const event = draft.events.find((e) => e.key === p.eventKey);
            const unit = event?.oatUnits.find((u) => u.key === p.unitKey);
            if (!event || !unit) return;
            updateUnit(event.key, unit.key, {
              assessments: unit.assessments.map((a) =>
                a.key === p.assessmentKey
                  ? { ...a, nursingObservationManageNo: item.manageNo, name: a.name.trim() || display }
                  : a,
              ),
            });
          }}
          onClose={() => setPicker(null)}
        />
      )}
      {picker?.kind === "template" && templateTask && (
        <PathwayTaskTemplateModal
          taskName={templateTask.name}
          template={templateTask.template}
          defaultOrderType={defaultOrderTypeOfTask(templateTask.categoryLv1, templateTask.categoryLv2)}
          setting={draft.setting}
          onCommit={(template) => commitTemplate(picker, template)}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}
