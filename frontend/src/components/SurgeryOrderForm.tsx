import { makeFieldUpdater } from "../lib/form";
import { useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import type { SurgeryItem } from "../api/masterClient";
import { useSurgeryItemsByCodes } from "../api/masterQueries";
import { useLocationOptions, useSelfDepartments } from "../api/queries";
import { refreshProblemDisplay } from "../fhir/conditionHelpers";
import { departmentDisplayName } from "../fhir/departmentHelpers";
import { locationDisplayName, locationTypeCode } from "../fhir/locationHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { SETTING_OPTIONS, type PrescriptionSetting } from "../fhir/prescriptionHelpers";
import {
  SURGERY_ANESTHESIA_MANAGEMENT_OPTIONS,
  SURGERY_ANESTHESIA_METHOD_OPTIONS,
  SURGERY_APPROACH_OPTIONS,
  SURGERY_BLOOD_PREPARATION_OPTIONS,
  SURGERY_CONSENT_OPTIONS,
  SURGERY_EQUIPMENT_OPTIONS,
  SURGERY_LATERALITY_OPTIONS,
  SURGERY_POSITION_OPTIONS,
  SURGERY_PRIORITY_OPTIONS,
  SURGERY_SPECIMEN_PLAN_OPTIONS,
  SURGERY_STAFF_ROLE_OPTIONS,
  emptySurgeryOrderForm,
  type SurgeryOrderFormValues,
  type SurgeryOrderItemLine,
  type SurgeryStaffLine,
  type SurgeryStaffRole,
} from "../fhir/surgeryOrderHelpers";
import {
  questionnaireResponsePlainText,
  type TemplateBinding,
} from "../fhir/questionnaireResponseHelpers";
import { useProblemOptions } from "../hooks/useProblemOptions";
import { useSurgeryConflictCheck } from "../hooks/useSurgeryConflictCheck";
import { ConditionPickerModal } from "./ConditionPickerModal";
import { ErrorBanner } from "./ErrorBanner";
import { PractitionerSearchModal } from "./PractitionerSearchModal";
import { ProblemSelect } from "./ProblemSelect";
import { SurgeryItemSearchModal } from "./SurgeryItemSearchModal";
import { SurgeryConflictConfirmModal } from "./SurgeryConflictConfirmModal";
import { SurgeryRoomDaySchedule } from "./SurgeryRoomDaySchedule";
import { TemplateEntryModal } from "./TemplateEntryModal";
import { TemplateSchemaImages } from "./SchemaImageGallery";

// 手術オーダー(申込)の入力フォーム。既存 4 種のオーダーと骨格は同じだが、
// 伝票レイアウトのタブは持たず、術式は検索モーダルから選ぶ。
//
// - 1 オーダー = 手術 1 件。術式は主・副で複数選べ、先頭が主術式。
// - ヘッダの入力が厚い(日程・手術室・体位・スタッフ・麻酔・輸血準備・機器・
//   検体提出予定・同意)。術式マスタの既定値(所要時間・到達法・体位・麻酔方法)を
//   最初の術式を選んだ時点でヘッダに写し、申込時の入力を最小にする。
// - 第 1 段階では実施記録・予約枠を持たないため、即実施・予約の UI は無い。
//   手術室の確保は日時 + 手術室の指定のみで、重複は手術一覧で目視する。

interface SurgeryOrderFormProps {
  patientId: string;
  /** 編集で開いているオーダーの id。その日の予定から自分自身を外すのに使う。 */
  orderId?: string;
  initialValues?: SurgeryOrderFormValues;
  onSubmit: (values: SurgeryOrderFormValues) => void;
  submitting: boolean;
  submitError?: unknown;
  submitLabel?: string;
}

function ArrowUpIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        d="M8 13V3.5M8 3.5L4 7.5M8 3.5l4 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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

export function SurgeryOrderForm({
  patientId,
  orderId,
  initialValues,
  onSubmit,
  submitting,
  submitError,
  submitLabel = "登録",
}: SurgeryOrderFormProps) {
  const [values, setValues] = useState<SurgeryOrderFormValues>(
    initialValues ?? emptySurgeryOrderForm(),
  );
  const [validationError, setValidationError] = useState<string | null>(null);
  const conflictCheck = useSurgeryConflictCheck();
  // 術式検索・スタッフ選択・術前診断の各モーダル。
  const [searchingItem, setSearchingItem] = useState(false);
  const [staffTarget, setStaffTarget] = useState<SurgeryStaffRole | null>(null);
  // 術前診断の選択モーダルを開いている術式(項目コード)。
  const [conditionTarget, setConditionTarget] = useState<string | null>(null);
  // 術前指示のテンプレート記入モーダルを開いているか。
  const [preopTemplateOpen, setPreopTemplateOpen] = useState(false);

  const problemOptions = useProblemOptions(patientId);
  // 左右が必須かどうかは術式マスタが決める。保存済みのオーダーを開いたときは明細から
  // 復元できないので、選択中の術式コードから今のマスタを引き直す(処置の groupable と
  // 同じ扱い)。マスタから消えた術式は任意のままにする。
  const selectedCodes = useMemo(() => values.items.map((item) => item.code), [values.items]);
  const catalog = useSurgeryItemsByCodes(selectedCodes);
  const requiresLaterality = useMemo(
    () =>
      new Set(
        (catalog.data?.items ?? [])
          .filter((item) => item.requires_laterality)
          .map((item) => item.item_code),
      ),
    [catalog.data],
  );
  // 術前指示の既定テンプレートは主術式の術式マスタが持つ。副術式は見ない
  // (1 オーダー = 1 手術で、指示は手術全体に 1 つだから)。
  const preopTemplateCanonical = values.items[0]
    ? ((catalog.data?.items ?? []).find((item) => item.item_code === values.items[0].code)
        ?.preop_template_canonical ?? "")
    : "";
  const departments = useSelfDepartments();
  // 手術室。院内の部屋(Location)のうち種別が手術室のものだけを出す。
  const locations = useLocationOptions();
  const rooms = locations.locations.filter((location) => locationTypeCode(location) === "SU");

  const update = makeFieldUpdater(setValues);

  function updateItem(code: string, patch: Partial<SurgeryOrderItemLine>) {
    setValues((current) => ({
      ...current,
      items: current.items.map((line) => (line.code === code ? { ...line, ...patch } : line)),
    }));
  }

  // 術式を追加。マスタの写し(名称・略称・Kコード・既定の到達法)を行にする。
  // ヘッダの所要時間・体位・麻酔方法は、まだ入力が無ければマスタの既定値で埋める
  // (2 件目以降の術式では上書きしない。主術式の既定を優先する)。
  function addItem(item: SurgeryItem) {
    setSearchingItem(false);
    setValues((current) => {
      if (current.items.some((line) => line.code === item.item_code)) return current;
      const line: SurgeryOrderItemLine = {
        id: "",
        code: item.item_code,
        name: item.name,
        shortName: item.short_name ?? "",
        receiptCode: item.receipt_code ?? "",
        bodySiteText: "",
        laterality: "",
        approach: item.default_approach ?? "",
        reasonConditionId: "",
        reasonName: "",
      };
      return {
        ...current,
        items: [...current.items, line],
        durationMinutes:
          current.durationMinutes ||
          (item.default_duration_minutes != null ? String(item.default_duration_minutes) : ""),
        position: current.position || (item.default_position ?? ""),
        anesthesiaMethods:
          current.anesthesiaMethods.length > 0
            ? current.anesthesiaMethods
            : (item.default_anesthesia_methods ?? "").split(",").filter(Boolean),
      };
    });
  }

  function removeItem(code: string) {
    setValues((current) => ({
      ...current,
      items: current.items.filter((line) => line.code !== code),
    }));
  }

  // 並びの入れ替え。先頭が主術式なので、上へ動かす操作だけで足りる。
  function moveItemUp(code: string) {
    setValues((current) => {
      const index = current.items.findIndex((line) => line.code === code);
      if (index <= 0) return current;
      const items = [...current.items];
      [items[index - 1], items[index]] = [items[index], items[index - 1]];
      return { ...current, items };
    });
  }

  function addStaff(role: SurgeryStaffRole, practitioner: fhir4.Practitioner) {
    const line: SurgeryStaffLine = {
      role,
      practitionerId: practitioner.id ?? "",
      practitionerName: practitionerDisplayName(practitioner),
    };
    setValues((current) => {
      // 執刀医・麻酔科医は 1 人。選び直したら置き換える。助手は複数入る(同じ人は二重に入れない)。
      const rest =
        role === "assistant"
          ? current.staff.filter(
              (s) => !(s.role === role && s.practitionerId === line.practitionerId),
            )
          : current.staff.filter((s) => s.role !== role);
      // 役割の並びは 執刀医 → 助手 → 麻酔科医 に揃える。
      const ordered = [...rest, line].sort(
        (a, b) =>
          SURGERY_STAFF_ROLE_OPTIONS.findIndex((o) => o.code === a.role) -
          SURGERY_STAFF_ROLE_OPTIONS.findIndex((o) => o.code === b.role),
      );
      return { ...current, staff: ordered };
    });
  }

  function removeStaff(line: SurgeryStaffLine) {
    setValues((current) => ({
      ...current,
      staff: current.staff.filter(
        (s) => !(s.role === line.role && s.practitionerId === line.practitionerId),
      ),
    }));
  }

  function toggleIn(list: string[], code: string): string[] {
    return list.includes(code) ? list.filter((c) => c !== code) : [...list, code];
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (values.items.length === 0) {
      setValidationError("術式を 1 つ以上選択してください。");
      return;
    }
    // 予定手術日は任意(希望日)。日程は手術部が確定するので、未定のまま申し込める。
    // 時刻だけ入れて日付が無いのは矛盾するのでここで弾く(所要時間・手術室は
    // 日付が無くても「希望」として意味があるので許す)。
    if (!values.scheduledDate && values.scheduledTime) {
      setValidationError("入室予定時刻を入れる場合は予定手術日も入力してください。");
      return;
    }
    // 左右の取り違え防止。左右のある術式(マスタで印を付けたもの)は必ず選ばせる。
    const withoutLaterality = values.items.find(
      (item) => requiresLaterality.has(item.code) && !item.laterality,
    );
    if (withoutLaterality) {
      setValidationError(`「${withoutLaterality.name}」の左右を選択してください。`);
      return;
    }
    if (!values.staff.some((line) => line.role === "surgeon")) {
      setValidationError("執刀医を選択してください。");
      return;
    }
    // 麻酔科管理なのに麻酔科医が居ない申込は、麻酔科側で誰が診るか分からない。
    if (
      values.anesthesiaManagement === "anesthesiologist" &&
      !values.staff.some((line) => line.role === "anesthetist")
    ) {
      setValidationError("麻酔科管理の場合は麻酔科医を選択してください。");
      return;
    }

    setValidationError(null);

    // 同じ手術室・同じ時間帯に他の手術が入っていないかを、登録の直前に一覧を
    // 引き直して確かめる。重なっていれば確認モーダルを挟み、承知で登録された
    // ときだけ通す(docs/surgery-calendar-design.md)。
    const clear = await conflictCheck.check({
      date: values.scheduledDate,
      time: values.scheduledTime,
      durationMinutes: values.durationMinutes,
      roomId: values.roomId,
      roomName: values.roomName,
      excludeOrderId: orderId,
    });
    if (clear) save();
  }

  function save() {
    onSubmit({
      ...values,
      problem: refreshProblemDisplay(values.problem, problemOptions),
    });
  }

  function handleKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    // input 上での Enter による暗黙の form submit を抑止する(処方・注射と同じ)。
    if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
      e.preventDefault();
    }
  }

  const needsBloodUnits =
    values.bloodPreparation === "crossmatch" || values.bloodPreparation === "autologous";

  return (
    <>
      <form className="prescription-form" onSubmit={handleSubmit} onKeyDown={handleKeyDown}>
        {validationError && (
          <div className="error-banner" role="alert">
            <p className="error-banner__line error-banner__line--error">{validationError}</p>
          </div>
        )}
        <ErrorBanner error={submitError} />
        <ErrorBanner error={departments.error ?? locations.error} />

        <fieldset>
          <legend>手術共通</legend>
          <label>
            対象プロブレム
            <ProblemSelect
              value={values.problem}
              options={problemOptions}
              onChange={(problem) => update("problem", problem)}
            />
          </label>
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
          <label>
            予定区分
            <select
              value={values.priority}
              onChange={(e) =>
                update("priority", e.target.value as SurgeryOrderFormValues["priority"])
              }
            >
              {SURGERY_PRIORITY_OPTIONS.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.display}
                </option>
              ))}
            </select>
          </label>
          {/* 執刀科。依頼科(画面ヘッダーの依頼)と別れうるので別に選ぶ。 */}
          <label>
            執刀科
            <select
              value={values.surgicalDepartmentId}
              onChange={(e) => {
                const department = (departments.departments ?? []).find(
                  (d) => d.id === e.target.value,
                );
                setValues((current) => ({
                  ...current,
                  surgicalDepartmentId: e.target.value,
                  surgicalDepartmentName: department ? departmentDisplayName(department) : "",
                }));
              }}
            >
              <option value="">選択してください</option>
              {(departments.departments ?? []).map((department) => (
                <option key={department.id} value={department.id}>
                  {departmentDisplayName(department)}
                </option>
              ))}
            </select>
          </label>
        </fieldset>

        {/* 日程と手術室。第 1 段階は枠(Slot)を持たず、日時と部屋の指定だけ。
            同じ部屋・同じ時間帯の重なりは、入力の下に出すその日の予定で確かめる
            (日程を入れた/変えた瞬間が、重なりの生まれる唯一の場面)。 */}
        <fieldset>
          <legend>日程・手術室</legend>
          <label>
            予定手術日(希望)
            <input
              type="date"
              value={values.scheduledDate}
              onChange={(e) => update("scheduledDate", e.target.value)}
            />
          </label>
          <label>
            入室予定時刻
            <input
              type="time"
              value={values.scheduledTime}
              onChange={(e) => update("scheduledTime", e.target.value)}
            />
          </label>
          <label>
            予定所要時間(分)
            <input
              type="number"
              min={1}
              step={1}
              value={values.durationMinutes}
              onChange={(e) => update("durationMinutes", e.target.value)}
            />
          </label>
          <label>
            手術室
            <select
              value={values.roomId}
              onChange={(e) => {
                const room = rooms.find((location) => location.id === e.target.value);
                setValues((current) => ({
                  ...current,
                  roomId: e.target.value,
                  roomName: room ? locationDisplayName(room) : "",
                }));
              }}
            >
              <option value="">未定</option>
              {/* 保存済みの手術室が候補に無い(削除・種別変更)ときも表示だけは残す。 */}
              {values.roomId && !rooms.some((room) => room.id === values.roomId) && (
                <option value={values.roomId}>{values.roomName || values.roomId}</option>
              )}
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {locationDisplayName(room)}
                </option>
              ))}
            </select>
          </label>
          <SurgeryRoomDaySchedule
            date={values.scheduledDate}
            roomId={values.roomId}
            roomName={values.roomName}
            time={values.scheduledTime}
            durationMinutes={values.durationMinutes}
            excludeOrderId={orderId}
            departmentId={values.surgicalDepartmentId}
          />
        </fieldset>

        {/* 術式。先頭が主術式で、DPC・手術記録の見出しになる。 */}
        <section className="order-select__preview">
          <div className="lab-order-item__section-head">
            <h3>術式({values.items.length})</h3>
            <button
              type="button"
              className="rp-card__compact-button"
              onClick={() => setSearchingItem(true)}
            >
              + 術式追加
            </button>
          </div>
          {values.items.length === 0 && (
            <p className="order-select__muted">術式を選択してください</p>
          )}
          {/* 1 枚 = 術式 1 つ。見出しは放射線・生理の GP と同じ「枠 + 見出し行」で出す
              (fieldset の legend は枠線に食い込んで読みにくい)。 */}
          {values.items.map((item, index) => (
            <div key={item.code} className="rad-gp">
              <div className="rad-gp__head">
                <span className="rad-gp__number">{index === 0 ? "主" : `副${index}`}</span>
                <span className="rad-gp__name">{item.name}</span>
                <span className="order-select__muted">
                  {item.receiptCode ? `Kコード: ${item.receiptCode}` : "Kコード未設定"}
                </span>
                <span className="surgery-gp__actions">
                  {index > 0 && (
                    <button
                      type="button"
                      className="rp-card__icon-button"
                      title="1 つ上へ"
                      aria-label={`${item.name} を 1 つ上へ`}
                      onClick={() => moveItemUp(item.code)}
                    >
                      <ArrowUpIcon />
                    </button>
                  )}
                  <button
                    type="button"
                    className="rp-card__icon-button"
                    title="外す"
                    aria-label={`${item.name} を外す`}
                    onClick={() => removeItem(item.code)}
                  >
                    <TrashIcon />
                  </button>
                </span>
              </div>
              <div className="rad-gp__fields">
                <label>
                  部位
                  <input
                    type="text"
                    value={item.bodySiteText}
                    placeholder="術式名で足りない部分を補う"
                    onChange={(e) => updateItem(item.code, { bodySiteText: e.target.value })}
                  />
                </label>
                {/* 左右。取り違え防止のため、左右のある術式ではマスタの印で必須にする。 */}
                <label>
                  左右{requiresLaterality.has(item.code) && "(必須)"}
                  <select
                    value={item.laterality}
                    onChange={(e) => updateItem(item.code, { laterality: e.target.value })}
                  >
                    <option value="">指定なし</option>
                    {SURGERY_LATERALITY_OPTIONS.map((o) => (
                      <option key={o.code} value={o.code}>
                        {o.display}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  到達法
                  <select
                    value={item.approach}
                    onChange={(e) => updateItem(item.code, { approach: e.target.value })}
                  >
                    <option value="">未指定</option>
                    {SURGERY_APPROACH_OPTIONS.map((o) => (
                      <option key={o.code} value={o.code}>
                        {o.display}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  術前診断
                  <div className="rad-gp__reason">
                    <input
                      type="text"
                      value={item.reasonName}
                      placeholder="病名を直接入力"
                      // 手で書き換えたら登録病名との紐付けは外す(別の文言になるため)。
                      onChange={(e) =>
                        updateItem(item.code, {
                          reasonName: e.target.value,
                          reasonConditionId: "",
                        })
                      }
                      aria-label="術前診断"
                    />
                    <div className="rad-gp__reason-actions">
                      <button
                        type="button"
                        onClick={() => setConditionTarget(item.code)}
                        title="登録されている病名から選ぶ"
                      >
                        病名
                      </button>
                    </div>
                  </div>
                </label>
              </div>
            </div>
          ))}
        </section>

        {/* スタッフ。役割ごとに医療従事者検索から選ぶ。器械出し・外回りなどの
            実施メンバーは実施記録(第 2 段階)で扱い、申込では 3 役だけを聞く。 */}
        <fieldset>
          <legend>スタッフ</legend>
          <div className="surgery-staff">
            {values.staff.map((line) => (
              <span key={`${line.role}-${line.practitionerId}`} className="surgery-staff__chip">
                <span className="surgery-staff__role">
                  {SURGERY_STAFF_ROLE_OPTIONS.find((o) => o.code === line.role)?.display}
                </span>
                <span className="surgery-staff__name">{line.practitionerName}</span>
                {/* 担当看護師のチップ(NursePicker)と同じ × 。ゴミ箱アイコンは
                    チップの中では大きすぎる。 */}
                <button
                  type="button"
                  className="order-select__remove"
                  title="外す"
                  aria-label={`${line.practitionerName} を外す`}
                  onClick={() => removeStaff(line)}
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
            <button
              type="button"
              className="rp-card__compact-button"
              onClick={() => setStaffTarget("surgeon")}
            >
              + 執刀医
            </button>
            <button
              type="button"
              className="rp-card__compact-button"
              onClick={() => setStaffTarget("assistant")}
            >
              + 助手
            </button>
            <button
              type="button"
              className="rp-card__compact-button"
              onClick={() => setStaffTarget("anesthetist")}
            >
              + 麻酔科医
            </button>
          </div>
        </fieldset>

        <fieldset>
          <legend>麻酔</legend>
          <div className="surgery-checkbox-row">
            {SURGERY_ANESTHESIA_METHOD_OPTIONS.map((option) => (
              <label key={option.code} className="dose-conversion__checkbox">
                <input
                  type="checkbox"
                  checked={values.anesthesiaMethods.includes(option.code)}
                  onChange={() =>
                    update("anesthesiaMethods", toggleIn(values.anesthesiaMethods, option.code))
                  }
                />
                {option.display}
              </label>
            ))}
          </div>
          <label>
            管理区分
            <select
              value={values.anesthesiaManagement}
              onChange={(e) => update("anesthesiaManagement", e.target.value)}
            >
              <option value="">未指定</option>
              {SURGERY_ANESTHESIA_MANAGEMENT_OPTIONS.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.display}
                </option>
              ))}
            </select>
          </label>
        </fieldset>

        <fieldset>
          <legend>準備</legend>
          <label>
            輸血準備
            <select
              value={values.bloodPreparation}
              onChange={(e) => update("bloodPreparation", e.target.value)}
            >
              <option value="">未指定</option>
              {SURGERY_BLOOD_PREPARATION_OPTIONS.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.display}
                </option>
              ))}
            </select>
          </label>
          {needsBloodUnits && (
            <label>
              単位数
              <input
                type="number"
                min={1}
                step={1}
                value={values.bloodPreparationUnits}
                onChange={(e) => update("bloodPreparationUnits", e.target.value)}
              />
            </label>
          )}
          <label>
            予定出血量(mL)
            <input
              type="number"
              min={0}
              step={10}
              value={values.estimatedBloodLoss}
              onChange={(e) => update("estimatedBloodLoss", e.target.value)}
            />
          </label>
          <label>
            手術体位
            <select
              value={values.position}
              onChange={(e) => update("position", e.target.value)}
            >
              <option value="">未指定</option>
              {SURGERY_POSITION_OPTIONS.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.display}
                </option>
              ))}
            </select>
          </label>
          <div className="surgery-checkbox-group">
            <span className="surgery-checkbox-group__label">特殊機器</span>
            <div className="surgery-checkbox-row">
              {SURGERY_EQUIPMENT_OPTIONS.map((option) => (
                <label key={option.code} className="dose-conversion__checkbox">
                  <input
                    type="checkbox"
                    checked={values.equipment.includes(option.code)}
                    onChange={() => update("equipment", toggleIn(values.equipment, option.code))}
                  />
                  {option.display}
                </label>
              ))}
            </div>
            {values.equipment.includes("other") && (
              <input
                type="text"
                value={values.equipmentOther}
                placeholder="その他の機器名"
                onChange={(e) => update("equipmentOther", e.target.value)}
                aria-label="その他の機器名"
              />
            )}
          </div>
          <div className="surgery-checkbox-group">
            <span className="surgery-checkbox-group__label">検体提出予定</span>
            <div className="surgery-checkbox-row">
              {SURGERY_SPECIMEN_PLAN_OPTIONS.map((option) => (
                <label key={option.code} className="dose-conversion__checkbox">
                  <input
                    type="checkbox"
                    checked={values.specimenPlans.includes(option.code)}
                    onChange={() =>
                      update("specimenPlans", toggleIn(values.specimenPlans, option.code))
                    }
                  />
                  {option.display}
                </label>
              ))}
            </div>
          </div>
        </fieldset>

        {/* 同意書の取得状況。チェックだけで、書面そのものは持たない(帳票は将来)。 */}
        <fieldset>
          <legend>同意書(取得済みにチェック)</legend>
          <div className="surgery-checkbox-row">
            {SURGERY_CONSENT_OPTIONS.map((option) => (
              <label key={option.code} className="dose-conversion__checkbox">
                <input
                  type="checkbox"
                  checked={values.consents.includes(option.code)}
                  onChange={() => update("consents", toggleIn(values.consents, option.code))}
                />
                {option.display}
              </label>
            ))}
          </div>
        </fieldset>

        {/* 術前指示。宛先が病棟(絶飲食・休薬・前投薬・除毛・予防抗菌薬)で、手術部への
            申し送り(特記)とは読む人が違うので欄を分けている。テンプレートの既定は
            主術式の術式マスタが持つ。 */}
        <fieldset className="surgery-comment">
          <legend>術前指示</legend>
          <TemplateTextField
            label="術前指示"
            value={values.preopInstruction}
            template={values.preopInstructionTemplate}
            onChange={(preopInstruction) => update("preopInstruction", preopInstruction)}
            onOpenTemplate={() => setPreopTemplateOpen(true)}
            onClearTemplate={() => update("preopInstructionTemplate", null)}
          />
        </fieldset>

        <fieldset className="surgery-comment">
          <legend>特記・申し送り</legend>
          <textarea
            value={values.comment}
            rows={4}
            onChange={(e) => update("comment", e.target.value)}
            aria-label="特記・申し送り"
          />
        </fieldset>

        <div className="prescription-form__submit">
          <button type="submit" disabled={submitting || conflictCheck.checking}>
            {submitting ? "送信中..." : conflictCheck.checking ? "確認中..." : submitLabel}
          </button>
        </div>
      </form>

      {/* 各モーダルは独自の入力を持つため、外側フォームの子孫に置かない
          (form の入れ子は不正で、送信が外へ漏れる)。 */}
      {conflictCheck.conflict && (
        <SurgeryConflictConfirmModal
          rows={conflictCheck.conflict.rows}
          plannedLabel={conflictCheck.conflict.plannedLabel}
          truncated={conflictCheck.conflict.truncated}
          unknown={conflictCheck.conflict.unknown}
          submitting={submitting}
          onConfirm={() => {
            conflictCheck.dismiss();
            save();
          }}
          onCancel={conflictCheck.dismiss}
        />
      )}

      {searchingItem && (
        <SurgeryItemSearchModal
          excludeCodes={values.items.map((item) => item.code)}
          onSelect={addItem}
          onClose={() => setSearchingItem(false)}
        />
      )}

      {staffTarget && (
        <PractitionerSearchModal
          // 執刀医・助手は医師から選ぶ。麻酔科医も職種は医師(麻酔科は診療科)。
          defaultRoleCode="doctor"
          onSelect={(practitioner) => {
            addStaff(staffTarget, practitioner);
            setStaffTarget(null);
          }}
          onClose={() => setStaffTarget(null)}
        />
      )}

      {preopTemplateOpen && (
        <TemplateEntryModal
          patientId={patientId}
          draft={values.preopInstructionTemplate?.draft ?? null}
          responseId={values.preopInstructionTemplate?.responseId ?? null}
          defaultCanonical={preopTemplateCanonical || undefined}
          onSubmit={(draft) => {
            // 保存済みの回答を再編集した場合は同じ id へ書き戻す(id は保存時に使う)。
            const binding: TemplateBinding = {
              responseId: values.preopInstructionTemplate?.responseId ?? null,
              draft,
            };
            setValues((current) => ({
              ...current,
              preopInstruction: questionnaireResponsePlainText(draft.questionnaire, draft.response),
              preopInstructionTemplate: binding,
            }));
            setPreopTemplateOpen(false);
          }}
          onClose={() => setPreopTemplateOpen(false)}
        />
      )}

      {conditionTarget && (
        <ConditionPickerModal
          patientId={patientId}
          title="術前診断を選択"
          onSelect={({ conditionId, name }) => {
            updateItem(conditionTarget, { reasonConditionId: conditionId, reasonName: name });
            setConditionTarget(null);
          }}
          onClose={() => setConditionTarget(null)}
        />
      )}
    </>
  );
}

// テンプレートからも直接入力もできる欄。テンプレートから記載した場合は、回答との
// 食い違いを防ぐため直接編集は不可にし、直すときはテンプレート画面を開き直す
// (放射線・生理検査・内視鏡の特別指示と同じ扱い)。
//
// 「解除」でテンプレートとの紐付けを外すと、記載された文言を残したまま直接入力へ戻せる。
// 保存すると、参照が外れた記入内容(QuestionnaireResponse)はオーダーの更新と同じ
// transaction で削除される。
function TemplateTextField({
  label,
  value,
  template,
  onChange,
  onOpenTemplate,
  onClearTemplate,
}: {
  label: string;
  value: string;
  template: TemplateBinding | null;
  onChange: (value: string) => void;
  onOpenTemplate: () => void;
  onClearTemplate: () => void;
}) {
  const fromTemplate = Boolean(template);

  return (
    <>
      {/* 親の fieldset は flex なので、明示しないと欄が内容幅で止まる。 */}
      <div className="rad-gp__template-field surgery-comment__template">
        <textarea
          rows={6}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          readOnly={fromTemplate}
          aria-label={label}
          title={
            fromTemplate
              ? "テンプレートから記載した内容です。テンプレート編集から直します"
              : undefined
          }
        />
        <div className="rad-gp__template-actions">
          <button
            type="button"
            onClick={onOpenTemplate}
            title={
              fromTemplate ? `${label}をテンプレートから直す` : `${label}をテンプレートから記入`
            }
          >
            {fromTemplate ? "テンプレート編集" : "テンプレート"}
          </button>
          {fromTemplate && (
            <button
              type="button"
              onClick={onClearTemplate}
              title="テンプレートとの紐付けを外して直接入力に戻す(記載された文言は残る)"
            >
              解除
            </button>
          )}
        </div>
      </div>
      {/* 記入内容にシェーマ画像があれば、平文の「あり」の印だけでは何を描いたか
          分からないので、入力中もサムネイルを出す(登録後の表示と同じ見せ方)。 */}
      <TemplateSchemaImages template={template} />
    </>
  );
}
