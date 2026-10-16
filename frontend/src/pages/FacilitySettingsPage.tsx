import { useState } from "react";
import { useUpdateFacilitySettings } from "../api/adminQueries";
import {
  useBedWardIndex,
  useFacilitySettings,
  useOrganizationOptions,
  useQuestionnaireOptions,
  useSelfDepartments,
  useWardOptions,
} from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { organizationDisplayName } from "../fhir/organizationHelpers";
import {
  DEFAULT_MEAL_SCHEDULE,
  MEAL_TIMING_OPTIONS,
  type MealScheduleSettings,
} from "../fhir/mealOrderHelpers";
import {
  DEFAULT_NURSING_SCHEDULE,
  isValidTime,
  type NursingScheduleSettings,
} from "../fhir/nursingScheduleHelpers";
import {
  DEFAULT_VITAL_THRESHOLDS,
  VITAL_THRESHOLD_ITEMS,
  type VitalThresholdSettings,
} from "../fhir/vitalHelpers";
import {
  EMPTY_WATER_BALANCE,
  type WaterBalanceSettings,
} from "../fhir/flowsheetWaterBalanceHelpers";
import {
  DEFAULT_MEDICATION_SCHEDULE,
  type MedicationScheduleSettings,
} from "../fhir/medicationScheduleHelpers";
import {
  DEFAULT_DOCUMENT_REMINDER,
  type DocumentReminderSettings,
} from "../fhir/documentDueHelpers";
import {
  DEFAULT_ADMISSION_DOCUMENTS,
  type AdmissionDocumentSettings,
} from "../fhir/admissionDocumentHelpers";
import {
  DEFAULT_NURSING_ACUITY,
  NURSING_ACUITY_FORMS,
  parseAcuityTerm,
  type AcuityEmergencyYearSetting,
  type AcuityUnitSetting,
  type NursingAcuitySettings,
} from "../fhir/nursingAcuityHelpers";
import { ACUITY_CATEGORY_OPTIONS, unitRoomOptions } from "../fhir/nursingAcuityUnitHelpers";
import { DEFAULT_PRESSURE_ULCER, type PressureUlcerSettings } from "../fhir/pressureUlcerHelpers";
import { locationDisplayName } from "../fhir/locationHelpers";
import {
  CATEGORY_OPTIONS,
  DEFAULT_PRESCRIPTION_CATEGORY,
  SETTING_OPTIONS,
  type PrescriptionCategoryDefaults,
} from "../fhir/prescriptionHelpers";
import {
  DEFAULT_RADIOTHERAPY_REVIEW,
  type RadiotherapyReviewSettings,
} from "../fhir/radiotherapyReviewHelpers";
import { useNursingObservationsByManageNos } from "../api/masterQueries";
import {
  DEFAULT_RECEIPT_CODES,
  INJECTION_LABELS,
  NUTRITION_LABELS,
  PATHOLOGY_LABELS,
  REHAB_CATEGORY_KEYS,
  REHAB_CATEGORY_LABELS,
  REHAB_COLUMN_LABELS,
  REHAB_COMMENT_KEYS,
  REHAB_THERAPY_KEYS,
  TRANSFUSION_LABELS,
  receiptCodeValid,
  receiptCodesValid,
  type ReceiptCodeSettings,
  type RehabColumnKey,
} from "../fhir/receiptCodeSettingsHelpers";
import { departmentCode, departmentDisplayName, sortDepartmentsByCode } from "../fhir/departmentHelpers";
import { EMPTY_INTAKE_SETTINGS, type IntakeSettings } from "../fhir/intakeHelpers";
import { questionnaireCanonical } from "../fhir/questionnaireResponseHelpers";
import { NursingItemSearchModal } from "../components/NursingItemSearchModal";
import { CommentCandidates } from "../components/CommentCandidates";
import { radiotherapyTechniqueHooks } from "../api/masterQueries";
import { EMPTY_NURSING_PROFILE, type NursingProfileSettings } from "../fhir/nursingProfileHelpers";
import {
  BULK_VITAL_ITEM_LABELS,
  BULK_VITAL_ITEMS,
  DEFAULT_BULK_VITAL_ENTRY,
  type BulkVitalEntrySettings,
  type BulkVitalItem,
} from "../fhir/bulkVitalHelpers";
import { TrashIcon } from "../components/icons/TrashIcon";
import {
  DEFAULT_EARLY_WARNING,
  EARLY_WARNING_BAND_LABEL,
  EARLY_WARNING_NOTIFY_BANDS,
  type EarlyWarningSettings,
} from "../fhir/earlyWarningHelpers";

// 「どの Organization が自院か」を指定する。本アプリはマルチテナントではなく、
// 診療科・診察室・スタッフは自院のものしか登録しない。他院は診療情報提供書の
// 宛先候補(連携先)として別に登録するため、その区別の基点になる設定。
/** 届出単位の編集行(数値は文字列のまま持ち、保存で数に寄せる)。 */
interface AcuityUnitRow {
  id: string;
  kind: "ward" | "room";
  category: string;
  method: "I" | "II";
  beds: string;
  ratio1: string;
  ratio2: string;
}

/** 救急搬送の件数の年度の編集行。 */
interface AcuityYearRow {
  year: string;
  transports: string;
  admissions: { unitId: string; count: string }[];
}

export function FacilitySettingsPage() {
  const settings = useFacilitySettings();
  const { organizations, isLoading: loadingOrganizations } = useOrganizationOptions();
  const update = useUpdateFacilitySettings();
  // 未保存の選択。読み込み前は undefined にしておき、保存済みの値を初期表示にする。
  const [selected, setSelected] = useState<string | undefined>(undefined);

  const saved = settings.data?.self_organization_id ?? "";
  const value = selected ?? saved;

  // 看護指示の既定時刻。未編集の間は保存済み(未設定なら既定値)を出す。
  const [scheduleDraft, setScheduleDraft] = useState<NursingScheduleSettings | undefined>(undefined);
  const savedSchedule = settings.data?.nursing_schedule ?? DEFAULT_NURSING_SCHEDULE;
  const schedule = scheduleDraft ?? savedSchedule;
  const scheduleValid =
    Object.values(schedule.daily).every((times) => times.every(isValidTime)) &&
    isValidTime(schedule.interval_start);

  function updateDailyTime(count: string, index: number, time: string) {
    setScheduleDraft((prev) => {
      const base = prev ?? savedSchedule;
      const times = [...(base.daily[count] ?? [])];
      times[index] = time;
      return { ...base, daily: { ...base.daily, [count]: times } };
    });
  }

  // 食事の提供時刻。退院・外出泊の時刻から「どの食事まで / どの食事から」を決めるのに使う。
  const [mealDraft, setMealDraft] = useState<MealScheduleSettings | undefined>(undefined);
  const savedMeal = settings.data?.meal_schedule ?? DEFAULT_MEAL_SCHEDULE;
  const mealSchedule = mealDraft ?? savedMeal;
  const mealValid =
    MEAL_TIMING_OPTIONS.every((t) => isValidTime(mealSchedule[t.code])) &&
    mealSchedule.breakfast < mealSchedule.lunch &&
    mealSchedule.lunch < mealSchedule.dinner;

  // 経過表の異常値のしきい値。項目ごとに下限・上限を持ち、空欄はその側を判定しない。
  const [thresholdDraft, setThresholdDraft] = useState<VitalThresholdSettings | undefined>(undefined);
  const savedThresholds = settings.data?.vital_thresholds ?? DEFAULT_VITAL_THRESHOLDS;
  const thresholds = thresholdDraft ?? savedThresholds;
  const thresholdsValid = VITAL_THRESHOLD_ITEMS.every((item) => {
    const { low, high } = thresholds[item.code] ?? {};
    return low == null || high == null || low < high;
  });

  function updateThreshold(code: string, side: "low" | "high", raw: string) {
    setThresholdDraft((prev) => {
      const base = prev ?? savedThresholds;
      const bounds = { ...(base[code] ?? {}) };
      if (raw === "") delete bounds[side];
      else bounds[side] = Number(raw);
      return { ...base, [code]: bounds };
    });
  }

  // 内服の与薬の予定時刻。食事の時刻からのずらしと、就寝前・起床時の時刻。
  const [medicationDraft, setMedicationDraft] = useState<MedicationScheduleSettings | undefined>(
    undefined,
  );
  const savedMedication = settings.data?.medication_schedule ?? DEFAULT_MEDICATION_SCHEDULE;
  const medicationSchedule = medicationDraft ?? savedMedication;
  const medicationValid =
    isValidTime(medicationSchedule.bedtime) &&
    isValidTime(medicationSchedule.wake_time) &&
    [medicationSchedule.before_meal_minutes, medicationSchedule.after_meal_minutes].every(
      (minutes) => Number.isFinite(minutes) && minutes >= 0,
    );

  function updateMedication<K extends keyof MedicationScheduleSettings>(
    key: K,
    value: MedicationScheduleSettings[K],
  ) {
    setMedicationDraft((prev) => ({ ...(prev ?? savedMedication), [key]: value }));
  }

  // 文書作成の督促。退院時サマリーは退院日からこの日数を期限にして通知を作る。
  const [reminderDraft, setReminderDraft] = useState<DocumentReminderSettings | undefined>(undefined);
  const savedReminder = settings.data?.document_reminder ?? DEFAULT_DOCUMENT_REMINDER;
  const reminder = reminderDraft ?? savedReminder;
  const reminderValid =
    Number.isInteger(reminder.discharge_summary_days) && reminder.discharge_summary_days >= 0;

  // 入退院文書の作成状況の対象と期限。入院診療計画書はテンプレートの url(版を問わない)で数える。
  const [admissionDocsDraft, setAdmissionDocsDraft] = useState<AdmissionDocumentSettings | undefined>(undefined);
  const savedAdmissionDocs = settings.data?.admission_documents ?? DEFAULT_ADMISSION_DOCUMENTS;
  const admissionDocs = admissionDocsDraft ?? savedAdmissionDocs;
  const admissionDocsValid = [admissionDocs.admission_plan_days, admissionDocs.nursing_summary_days].every(
    (days) => Number.isInteger(days) && days >= 0,
  );

  // 褥瘡管理の DESIGN-R 評価のテンプレート(url。版を問わない)。
  const [pressureUlcerDraft, setPressureUlcerDraft] = useState<PressureUlcerSettings | undefined>(undefined);
  const savedPressureUlcer = settings.data?.pressure_ulcer ?? DEFAULT_PRESSURE_ULCER;
  const pressureUlcer = pressureUlcerDraft ?? savedPressureUlcer;
  const pressureUlcerValid = /^https?:\/\/[^\s|]+$/.test(pressureUlcer.template);

  // 看護必要度の評価票の版と該当患者の基準。基準は組("A3" "A2+B3" "#A2")を空白区切りで入れる(組の OR)。
  const [acuityDraft, setAcuityDraft] = useState<
    { form: string; ratio1: string; ratio2: string } | undefined
  >(undefined);
  const savedAcuity = settings.data?.nursing_acuity ?? DEFAULT_NURSING_ACUITY;
  const acuityText = acuityDraft ?? {
    form: savedAcuity.form,
    ratio1: savedAcuity.ratio1.join(" "),
    ratio2: savedAcuity.ratio2.join(" "),
  };
  const acuityTerms = (text: string) => text.split(/[\s,、]+/).filter(Boolean);

  // 届出単位(病棟・病室 → 届出区分・評価方式・届出病床数・基準値)。行で編集し、保存では { Location id: 設定 } にする。
  // 数値の空欄はキーを省く(区分の既定を使う)。
  const wardOptions = useWardOptions();
  const bedWards = useBedWardIndex();
  const unitRooms = unitRoomOptions(bedWards.bedWards);
  const [unitsDraft, setUnitsDraft] = useState<AcuityUnitRow[] | undefined>(undefined);
  const unitRows =
    unitsDraft ??
    Object.entries(savedAcuity.units).map(([id, unit]) => ({
      id,
      kind: unit.kind,
      category: unit.category,
      method: unit.method,
      beds: unit.beds === undefined ? "" : String(unit.beds),
      ratio1: unit.ratio1 === undefined ? "" : String(unit.ratio1),
      ratio2: unit.ratio2 === undefined ? "" : String(unit.ratio2),
    }));
  const unitLocationOptions = [
    ...wardOptions.wards.map((ward) => ({ id: ward.id ?? "", kind: "ward" as const, label: locationDisplayName(ward) })),
    ...unitRooms.map((room) => ({ id: room.id, kind: "room" as const, label: `${room.wardName} / ${room.name}` })),
  ];
  const numberOrUndefined = (text: string) => (text.trim() === "" ? undefined : Number(text));
  const unitsValid =
    unitRows.every(
      (row) =>
        row.id &&
        [row.beds, row.ratio1, row.ratio2].every((text) => text.trim() === "" || /^\d+(\.\d+)?$/.test(text.trim())),
    ) && new Set(unitRows.map((row) => row.id)).size === unitRows.length;
  function updateUnit(index: number, patch: Partial<AcuityUnitRow>) {
    setUnitsDraft(unitRows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  // 救急患者応需係数の年度ごとの件数の上書き(記録から数えた値より優先)。
  const [yearsDraft, setYearsDraft] = useState<AcuityYearRow[] | undefined>(undefined);
  const yearRows =
    yearsDraft ??
    Object.entries(savedAcuity.emergency_years)
      .map(([year, value]) => ({
        year,
        transports: value.transports === undefined ? "" : String(value.transports),
        admissions: Object.entries(value.admissions ?? {}).map(([unitId, count]) => ({ unitId, count: String(count) })),
      }))
      .sort((a, b) => a.year.localeCompare(b.year));
  const yearsValid =
    yearRows.every(
      (row) =>
        /^\d{4}$/.test(row.year) &&
        (row.transports.trim() === "" || /^\d+$/.test(row.transports.trim())) &&
        row.admissions.every((a) => a.unitId && /^\d+$/.test(a.count.trim())),
    ) && new Set(yearRows.map((row) => row.year)).size === yearRows.length;
  function updateYear(index: number, patch: Partial<AcuityYearRow>) {
    setYearsDraft(yearRows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  const acuity: NursingAcuitySettings = {
    form: acuityText.form,
    ratio1: acuityTerms(acuityText.ratio1),
    ratio2: acuityTerms(acuityText.ratio2),
    units: Object.fromEntries(
      unitRows.map((row) => {
        const unit: AcuityUnitSetting = { kind: row.kind, category: row.category, method: row.method };
        const beds = numberOrUndefined(row.beds);
        const ratio1 = numberOrUndefined(row.ratio1);
        const ratio2 = numberOrUndefined(row.ratio2);
        if (beds !== undefined) unit.beds = beds;
        if (ratio1 !== undefined) unit.ratio1 = ratio1;
        if (ratio2 !== undefined) unit.ratio2 = ratio2;
        return [row.id, unit];
      }),
    ),
    emergency_years: Object.fromEntries(
      yearRows.map((row) => {
        const year: AcuityEmergencyYearSetting = {};
        const transports = numberOrUndefined(row.transports);
        if (transports !== undefined) year.transports = transports;
        if (row.admissions.length > 0) {
          year.admissions = Object.fromEntries(row.admissions.map((a) => [a.unitId, Number(a.count)]));
        }
        return [row.year, year];
      }),
    ),
  };
  const acuityValid =
    acuity.ratio1.length > 0 &&
    [...acuity.ratio1, ...acuity.ratio2].every((term) => parseAcuityTerm(term) !== null) &&
    unitsValid &&
    yearsValid;

  // 放射線治療の治療中の診察(週次レビュー)の間隔。最後の診察からこの日数を超えたコースを
  // 部門一覧で強調する。
  const [reviewDraft, setReviewDraft] = useState<RadiotherapyReviewSettings | undefined>(undefined);
  const savedReview = settings.data?.radiotherapy_review ?? DEFAULT_RADIOTHERAPY_REVIEW;
  const radiotherapyReview = reviewDraft ?? savedReview;
  const reviewValid =
    Number.isInteger(radiotherapyReview.interval_days) && radiotherapyReview.interval_days >= 1;

  // 早期警告スコア(NEWS2)。有効にするとバイタルの保存で算出し、区分が下限以上なら主治医に通知する。
  const [earlyWarningDraft, setEarlyWarningDraft] = useState<EarlyWarningSettings | undefined>(undefined);

  // Web 問診。既定の質問票(並べた順に答えてもらう)と、診療科ごとの質問票、予約の無いリンクの有効時間。
  const [intakeDraft, setIntakeDraft] = useState<IntakeSettings | undefined>(undefined);
  const intake = intakeDraft ?? settings.data?.intake ?? EMPTY_INTAKE_SETTINGS;
  const [intakeAdding, setIntakeAdding] = useState("");
  const intakeValid = Number.isInteger(intake.expires_hours) && intake.expires_hours >= 1;
  function updateIntakeDepartment(code: string, url: string) {
    const next = { ...intake.by_department };
    if (url) next[code] = [url];
    else delete next[code];
    setIntakeDraft({ ...intake, by_department: next });
  }
  const earlyWarning = earlyWarningDraft ?? settings.data?.early_warning ?? DEFAULT_EARLY_WARNING;

  // 医事会計へ送るレセプト電算コードのうち施設基準で決まるもの。空欄は「送らない」。
  const [receiptCodesDraft, setReceiptCodesDraft] = useState<ReceiptCodeSettings | undefined>(
    undefined,
  );
  const savedReceiptCodes = settings.data?.receipt_codes ?? DEFAULT_RECEIPT_CODES;
  const receiptCodes = receiptCodesDraft ?? savedReceiptCodes;
  const receiptCodesOk = receiptCodesValid(receiptCodes);

  function updateReceiptCode<S extends keyof ReceiptCodeSettings>(
    section: S,
    key: keyof ReceiptCodeSettings[S],
    value: string,
  ) {
    setReceiptCodesDraft((prev) => {
      const base = prev ?? savedReceiptCodes;
      return { ...base, [section]: { ...base[section], [key]: value } };
    });
  }

  function updateRehabCode(
    category: (typeof REHAB_CATEGORY_KEYS)[number],
    therapy: RehabColumnKey,
    value: string,
  ) {
    setReceiptCodesDraft((prev) => {
      const base = prev ?? savedReceiptCodes;
      return {
        ...base,
        rehab: { ...base.rehab, [category]: { ...base.rehab[category], [therapy]: value } },
      };
    });
  }

  // 処方区分の初期値。入外区分ごとに 1 つで、空なら処方フォームは未選択で開く。
  const [categoryDraft, setCategoryDraft] = useState<PrescriptionCategoryDefaults | undefined>(
    undefined,
  );
  const savedCategory = settings.data?.prescription_category ?? DEFAULT_PRESCRIPTION_CATEGORY;
  const prescriptionCategory = categoryDraft ?? savedCategory;

  // 他科依頼の依頼目的テンプレートの既定。依頼先の診療科ごとに 1 つで、未選択の科は保存しない。
  const [consultTemplateDraft, setConsultTemplateDraft] = useState<
    Record<string, string> | undefined
  >(undefined);
  const savedConsultTemplates = settings.data?.consult_default_templates ?? {};
  const consultTemplates = consultTemplateDraft ?? savedConsultTemplates;
  const departments = useSelfDepartments();
  const templateOptions = useQuestionnaireOptions({ status: "active" });

  function updateConsultTemplate(departmentId: string, canonical: string) {
    const next = { ...consultTemplates };
    if (canonical) next[departmentId] = canonical;
    else delete next[departmentId];
    setConsultTemplateDraft(next);
  }

  // 看護プロファイルの区画。テンプレートの url を並べた順が、カルテの区画の順になる。
  const [profileDraft, setProfileDraft] = useState<NursingProfileSettings | undefined>(undefined);
  const nursingProfile = profileDraft ?? settings.data?.nursing_profile ?? EMPTY_NURSING_PROFILE;
  const [profileAdding, setProfileAdding] = useState("");
  // 同じ url の版違いは 1 つにまとめて候補に出す(区画は版を持たない)。
  const profileCandidates = templateOptions.questionnaires.filter(
    (q, index, all) => q.url && all.findIndex((other) => other.url === q.url) === index,
  );
  function profileTitle(url: string): string {
    const q = profileCandidates.find((candidate) => candidate.url === url);
    return q?.title ?? q?.name ?? url;
  }

  function updateProfileTemplates(next: string[]) {
    setProfileDraft({ ...nursingProfile, templates: next });
  }

  function moveProfileTemplate(index: number, delta: number) {
    const next = [...nursingProfile.templates];
    const [moved] = next.splice(index, 1);
    next.splice(index + delta, 0, moved);
    updateProfileTemplates(next);
  }

  // 経過表一括入力の列。並べた順が画面の列の順で、1 列は残す。
  const [bulkDraft, setBulkDraft] = useState<BulkVitalEntrySettings | undefined>(undefined);
  const bulkVitalEntry = bulkDraft ?? settings.data?.bulk_vital_entry ?? DEFAULT_BULK_VITAL_ENTRY;
  const [bulkAdding, setBulkAdding] = useState<BulkVitalItem | "">("");

  function moveBulkItem(index: number, delta: number) {
    const next = [...bulkVitalEntry.items];
    const [moved] = next.splice(index, 1);
    next.splice(index + delta, 0, moved);
    setBulkDraft({ items: next });
  }

  // 水分出納に数える看護観察。管理番号だけを保存し、名前はマスタから引く。
  const [balanceDraft, setBalanceDraft] = useState<WaterBalanceSettings | undefined>(undefined);
  const savedBalance = settings.data?.water_balance ?? EMPTY_WATER_BALANCE;
  const balance = balanceDraft ?? savedBalance;
  // 選択中の項目を選ぶモーダル。開いている側("in" / "out")を持つ。
  const [pickingSide, setPickingSide] = useState<keyof WaterBalanceSettings | null>(null);
  const balanceNames = useNursingObservationsByManageNos([...balance.in, ...balance.out]);

  function addBalanceItem(side: keyof WaterBalanceSettings, manageNo: string) {
    setBalanceDraft((prev) => {
      const base = prev ?? savedBalance;
      if (base[side].includes(manageNo)) return base;
      return { ...base, [side]: [...base[side], manageNo] };
    });
  }

  function removeBalanceItem(side: keyof WaterBalanceSettings, manageNo: string) {
    setBalanceDraft((prev) => {
      const base = prev ?? savedBalance;
      return { ...base, [side]: base[side].filter((code) => code !== manageNo) };
    });
  }

  // DPC の医療機関別係数。適用開始日ごとの行で編集し、保存では { 開始日: 係数 } にする。
  const [coefficientDraft, setCoefficientDraft] = useState<{ from: string; value: string }[] | undefined>(
    undefined,
  );
  const coefficients =
    coefficientDraft ??
    Object.entries(settings.data?.dpc_coefficients ?? {})
      .map(([from, value]) => ({ from, value }))
      .sort((a, b) => a.from.localeCompare(b.from));
  const coefficientsValid =
    coefficients.every((c) => /^\d{4}-\d{2}-\d{2}$/.test(c.from) && /^\d\.\d{1,4}$/.test(c.value)) &&
    new Set(coefficients.map((c) => c.from)).size === coefficients.length;

  function updateCoefficient(index: number, patch: Partial<{ from: string; value: string }>) {
    setCoefficientDraft(coefficients.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!scheduleValid || !mealValid || !thresholdsValid || !medicationValid || !reminderValid) return;
    if (!admissionDocsValid || !acuityValid || !pressureUlcerValid) return;
    if (!reviewValid || !receiptCodesOk || !coefficientsValid || !intakeValid) return;
    update.mutate({
      self_organization_id: value,
      nursing_schedule: schedule,
      meal_schedule: mealSchedule,
      vital_thresholds: thresholds,
      water_balance: balance,
      medication_schedule: medicationSchedule,
      document_reminder: reminder,
      prescription_category: prescriptionCategory,
      consult_default_templates: consultTemplates,
      radiotherapy_review: radiotherapyReview,
      receipt_codes: receiptCodes,
      nursing_profile: nursingProfile,
      bulk_vital_entry: bulkVitalEntry,
      dpc_coefficients: Object.fromEntries(coefficients.map((c) => [c.from, c.value])),
      admission_documents: admissionDocs,
      nursing_acuity: acuity,
      pressure_ulcer: pressureUlcer,
      early_warning: earlyWarning,
      intake,
    });
  }

  // コメントコードの欄には、関係する診療行為コードから引いた候補(コメント関連テーブル)を
  // datalist で添える。listId を渡した欄だけ。
  function receiptCodeInput(
    value: string,
    onChange: (next: string) => void,
    label: string,
    listId?: string,
  ) {
    return (
      <input
        type="text"
        inputMode="numeric"
        maxLength={9}
        value={value}
        onChange={(e) => onChange(e.target.value.trim())}
        aria-label={label}
        aria-invalid={!receiptCodeValid(value)}
        className="facility-settings__code"
        list={listId}
      />
    );
  }

  // 疾患別リハの表(行 = 区分、列 = 療法士またはコメント)。コメントの列には、その行の
  // 療法士のコードに関係するコメントの候補(datalist)を添える。
  function rehabCodeTable(columns: readonly RehabColumnKey[]) {
    return (
      <table className="facility-settings__code-table">
        <thead>
          <tr>
            <th />
            {columns.map((column) => (
              <th key={column}>{REHAB_COLUMN_LABELS[column]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {REHAB_CATEGORY_KEYS.map((category) => (
            <tr key={category}>
              <th scope="row">{REHAB_CATEGORY_LABELS[category]}</th>
              {columns.map((column) => (
                <td key={column}>
                  {receiptCodeInput(
                    receiptCodes.rehab[category][column],
                    (next) => updateRehabCode(category, column, next),
                    `${REHAB_CATEGORY_LABELS[category]} ${REHAB_COLUMN_LABELS[column]} のレセプト電算コード`,
                    (REHAB_COMMENT_KEYS as readonly string[]).includes(column)
                      ? `rehab-comments-${category}`
                      : undefined,
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  // 照射部位コメントの候補は、照射技法マスタに設定した放射線治療管理料のコードから引く。
  const techniques = radiotherapyTechniqueHooks.useList();
  const managementCodes = (techniques.data?.items ?? [])
    .map((t) => t.management_receipt_code ?? "")
    .filter(Boolean);

  return (
    <div className="page">
      <div className="page__header">
        <h1>施設設定</h1>
      </div>
      {(settings.isLoading || loadingOrganizations) && <p>読み込み中...</p>}
      <ErrorBanner error={settings.error} />

      <form className="connection-settings-form" onSubmit={handleSubmit}>
        <label>
          自院の医療機関
          <select value={value} onChange={(e) => setSelected(e.target.value)}>
            <option value="">（未設定）</option>
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organizationDisplayName(organization)}
              </option>
            ))}
          </select>
        </label>

        {/* 看護指示の「1日N回」の既定時刻と「N時間毎」の起点。指示を登録するときの
            初期値で、登録済みの指示には時刻が焼き付いているのでここを変えても動かない。
            普段は触らない設定なので折り畳んでおく。閉じている間はブラウザの必須チェックが
            効かない(非表示の入力にフォーカスできない)ため、required は付けずに
            scheduleValid で保存ボタンを止める。 */}
        <details className="facility-settings__schedule">
          <summary>看護指示の既定時刻</summary>
          <div className="facility-settings__schedule-body">
            {["1", "2", "3", "4"].map((count) => (
              <label key={count}>
                1日{count}回
                <span className="facility-settings__times">
                  {(schedule.daily[count] ?? []).map((time, index) => (
                    <input
                      key={index}
                      type="time"
                      value={time}
                      onChange={(e) => updateDailyTime(count, index, e.target.value)}
                      aria-label={`1日${count}回の ${index + 1} 回目`}
                    />
                  ))}
                </span>
              </label>
            ))}
            <label>
              N時間毎の起点
              <input
                type="time"
                value={schedule.interval_start}
                onChange={(e) =>
                  setScheduleDraft({ ...(scheduleDraft ?? savedSchedule), interval_start: e.target.value })
                }
              />
              <span className="connection-settings-form__field-hint">
                4時間毎ならこの時刻から 4 時間刻みで、その日の予定を組みます。
              </span>
            </label>
          </div>
        </details>

        {/* 食事の提供時刻。退院・外出泊の時刻と突き合わせて「退院日は朝食まで」
            「帰院後は夕食から」を自動で決める。食事オーダーの時刻(08/12/18)は SS-MIX2 の
            コードなので、ここを変えても登録済みのオーダーは動かない。 */}
        <details className="facility-settings__schedule">
          <summary>食事の提供時刻</summary>
          <div className="facility-settings__schedule-body">
            {MEAL_TIMING_OPTIONS.map((timing) => (
              <label key={timing.code}>
                {timing.display}食
                <input
                  type="time"
                  value={mealSchedule[timing.code]}
                  onChange={(e) =>
                    setMealDraft({ ...(mealDraft ?? savedMeal), [timing.code]: e.target.value })
                  }
                />
              </label>
            ))}
            <span className="connection-settings-form__field-hint">
              退院・外出泊の時刻と比べて、その時刻までに出た最後の食事で止め、その時刻以降に
              出る最初の食事から戻します。
            </span>
          </div>
        </details>

        {/* 経過表でバイタルを異常値(H/L)として色付けするしきい値。上限以上で H、下限以下で L。
            空欄はその側を判定しない。表示時に判定するので、変えれば過去の測定にも効く。 */}
        <details className="facility-settings__schedule">
          <summary>バイタルの異常値</summary>
          <div className="facility-settings__schedule-body">
            {VITAL_THRESHOLD_ITEMS.map((item) => (
              <label key={item.code}>
                {item.label}
                <span className="facility-settings__times">
                  <input
                    type="number"
                    step={item.step}
                    value={thresholds[item.code]?.low ?? ""}
                    onChange={(e) => updateThreshold(item.code, "low", e.target.value)}
                    aria-label={`${item.label}の下限`}
                    placeholder="下限"
                  />
                  <input
                    type="number"
                    step={item.step}
                    value={thresholds[item.code]?.high ?? ""}
                    onChange={(e) => updateThreshold(item.code, "high", e.target.value)}
                    aria-label={`${item.label}の上限`}
                    placeholder="上限"
                  />
                </span>
              </label>
            ))}
          </div>
        </details>

        {/* 内服の与薬の予定時刻。処方は「1日3回・食後」までしか持たないので、食事の
            時刻(上の設定)からのずらしと、就寝前・起床時の時刻をここで決める。表示時に
            計算するので、変えれば過去の処方の予定にも効く。 */}
        <details className="facility-settings__schedule">
          <summary>内服の与薬の時刻</summary>
          <div className="facility-settings__schedule-body">
            <label>
              食前・食直前
              <span className="facility-settings__times">
                <input
                  type="number"
                  min={0}
                  step={5}
                  value={medicationSchedule.before_meal_minutes}
                  onChange={(e) => updateMedication("before_meal_minutes", Number(e.target.value))}
                  aria-label="食前の分"
                />
                <span className="facility-settings__unit">分前</span>
              </span>
            </label>
            <label>
              食直後・食後
              <span className="facility-settings__times">
                <input
                  type="number"
                  min={0}
                  step={5}
                  value={medicationSchedule.after_meal_minutes}
                  onChange={(e) => updateMedication("after_meal_minutes", Number(e.target.value))}
                  aria-label="食後の分"
                />
                <span className="facility-settings__unit">分後</span>
              </span>
            </label>
            <label>
              就寝前
              <input
                type="time"
                value={medicationSchedule.bedtime}
                onChange={(e) => updateMedication("bedtime", e.target.value)}
              />
            </label>
            <label>
              起床時
              <input
                type="time"
                value={medicationSchedule.wake_time}
                onChange={(e) => updateMedication("wake_time", e.target.value)}
              />
            </label>
          </div>
        </details>

        {/* 処方区分の初期値。処方フォームを開いたとき・入外区分を選び直したときに入る値で、
            登録済みの処方には区分が焼き付いているのでここを変えても動かない。選択肢は入外区分で
            違う(入院は定期・臨時…、外来は院外・院内)ので、区分ごとに 1 つずつ選ぶ。 */}
        <details className="facility-settings__schedule">
          <summary>処方区分の初期値</summary>
          <div className="facility-settings__schedule-body">
            {SETTING_OPTIONS.map((setting) => (
              <label key={setting.code}>
                {setting.display}
                <select
                  value={prescriptionCategory[setting.code] ?? ""}
                  onChange={(e) =>
                    setCategoryDraft({
                      ...prescriptionCategory,
                      [setting.code]: e.target.value,
                    })
                  }
                >
                  <option value="">（未選択）</option>
                  {CATEGORY_OPTIONS[setting.code].map((o) => (
                    <option key={o.code} value={o.code}>
                      {o.display}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </details>

        {/* 他科依頼の依頼目的テンプレートの既定。依頼先の科を選んだときにテンプレート選択の
            初期値になる(選び直しは妨げない)。 */}
        <details className="facility-settings__schedule">
          <summary>他科依頼の既定テンプレート</summary>
          <div className="facility-settings__schedule-body">
            {sortDepartmentsByCode(departments.departments)
              .filter((department) => Boolean(department.id))
              .map((department) => (
                <label key={department.id}>
                  {departmentDisplayName(department)}
                  <select
                    value={consultTemplates[department.id as string] ?? ""}
                    onChange={(e) => updateConsultTemplate(department.id as string, e.target.value)}
                  >
                    <option value="">（なし）</option>
                    {templateOptions.questionnaires.map((q) => (
                      <option key={q.id} value={questionnaireCanonical(q)}>
                        {q.title ?? q.name ?? q.id}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
          </div>
        </details>

        {/* 文書作成の督促。退院の時点で期限付きの通知 Task を作るので、変えても作成済みの
            通知の期限は動かない。 */}
        <details className="facility-settings__schedule">
          <summary>文書作成の督促</summary>
          <div className="facility-settings__schedule-body">
            <label>
              退院時サマリーの期限
              <span className="facility-settings__times">
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={reminder.discharge_summary_days}
                  onChange={(e) =>
                    setReminderDraft({ ...reminder, discharge_summary_days: Number(e.target.value) })
                  }
                  aria-label="退院時サマリーの期限の日数"
                />
                <span className="facility-settings__unit">日以内(退院日から)</span>
              </span>
            </label>
            {/* ここから下は入退院文書の作成状況(/admission-documents)の判定だけに使う(通知は作らない)。 */}
            <label>
              看護サマリーの期限
              <span className="facility-settings__times">
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={admissionDocs.nursing_summary_days}
                  onChange={(e) =>
                    setAdmissionDocsDraft({ ...admissionDocs, nursing_summary_days: Number(e.target.value) })
                  }
                  aria-label="看護サマリーの期限の日数"
                />
                <span className="facility-settings__unit">日以内(退院日から)</span>
              </span>
            </label>
            <label>
              入院診療計画書のテンプレート
              <select
                value={admissionDocs.admission_plan_template}
                onChange={(e) =>
                  setAdmissionDocsDraft({ ...admissionDocs, admission_plan_template: e.target.value })
                }
              >
                <option value="">（なし）</option>
                {templateOptions.questionnaires
                  .filter((q, index, list) => q.url && list.findIndex((other) => other.url === q.url) === index)
                  .map((q) => (
                    <option key={q.id} value={q.url}>
                      {q.title ?? q.name ?? q.id}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              入院診療計画書の期限
              <span className="facility-settings__times">
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={admissionDocs.admission_plan_days}
                  onChange={(e) =>
                    setAdmissionDocsDraft({ ...admissionDocs, admission_plan_days: Number(e.target.value) })
                  }
                  aria-label="入院診療計画書の期限の日数"
                />
                <span className="facility-settings__unit">日以内(入院日から)</span>
              </span>
            </label>
          </div>
        </details>

        {/* 看護必要度。基準・基準値は表示時の判定だけなので、変えれば過去の評価の集計にも効く。
            評価票と割合1・割合2の基準は届出単位の設定が無い病棟(一般病棟用)に使う。 */}
        <details className="facility-settings__schedule">
          <summary>看護必要度</summary>
          <div className="facility-settings__schedule-body">
            <label>
              評価票
              <select
                value={acuityText.form}
                onChange={(e) => setAcuityDraft({ ...acuityText, form: e.target.value })}
              >
                {NURSING_ACUITY_FORMS.map((form) => (
                  <option key={form.code} value={form.code}>
                    {form.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              割合1の基準
              <input
                type="text"
                value={acuityText.ratio1}
                onChange={(e) => setAcuityDraft({ ...acuityText, ratio1: e.target.value })}
              />
            </label>
            <label>
              割合2の基準
              <input
                type="text"
                value={acuityText.ratio2}
                onChange={(e) => setAcuityDraft({ ...acuityText, ratio2: e.target.value })}
              />
            </label>
            <h3 className="facility-settings__subheading">届出単位</h3>
            <ul className="facility-settings__balance-list facility-settings__acuity-units">
              {unitRows.map((row, index) => (
                <li key={index}>
                  <select
                    value={row.id}
                    onChange={(e) => {
                      const option = unitLocationOptions.find((o) => o.id === e.target.value);
                      updateUnit(index, { id: e.target.value, kind: option?.kind ?? row.kind });
                    }}
                    aria-label="病棟・病室"
                  >
                    <option value="">選択してください</option>
                    {unitLocationOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                    {row.id && !unitLocationOptions.some((o) => o.id === row.id) && (
                      <option value={row.id}>(見つからない Location {row.id})</option>
                    )}
                  </select>
                  <select
                    value={row.category}
                    onChange={(e) => updateUnit(index, { category: e.target.value })}
                    aria-label="届出区分"
                  >
                    <option value="">区分を選択</option>
                    {ACUITY_CATEGORY_OPTIONS.map((option) => (
                      <option key={option.code} value={option.code}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <select
                    value={row.method}
                    onChange={(e) => updateUnit(index, { method: e.target.value as "I" | "II" })}
                    aria-label="評価方式"
                  >
                    <option value="I">Ⅰ</option>
                    <option value="II">Ⅱ</option>
                  </select>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={row.beds}
                    onChange={(e) => updateUnit(index, { beds: e.target.value })}
                    aria-label="届出病床数"
                    placeholder="病床数"
                    className="facility-settings__code"
                  />
                  <input
                    type="text"
                    inputMode="decimal"
                    value={row.ratio1}
                    onChange={(e) => updateUnit(index, { ratio1: e.target.value })}
                    aria-label="割合1の基準値(%)"
                    placeholder="基準値① %"
                    className="facility-settings__code"
                  />
                  <input
                    type="text"
                    inputMode="decimal"
                    value={row.ratio2}
                    onChange={(e) => updateUnit(index, { ratio2: e.target.value })}
                    aria-label="割合2の基準値(%)"
                    placeholder="基準値② %"
                    className="facility-settings__code"
                  />
                  <button
                    type="button"
                    className="rp-card__icon-button"
                    title="届出単位を削除"
                    aria-label="届出単位を削除"
                    onClick={() => setUnitsDraft(unitRows.filter((_, i) => i !== index))}
                  >
                    <TrashIcon />
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="rp-card__compact-button"
              onClick={() =>
                setUnitsDraft([
                  ...unitRows,
                  { id: "", kind: "ward", category: "", method: "I", beds: "", ratio1: "", ratio2: "" },
                ])
              }
            >
              追加
            </button>
            <h3 className="facility-settings__subheading">救急搬送の件数(年度)</h3>
            <ul className="facility-settings__balance-list facility-settings__acuity-years">
              {yearRows.map((row, index) => (
                <li key={index}>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={row.year}
                    onChange={(e) => updateYear(index, { year: e.target.value.trim() })}
                    aria-label="年度"
                    placeholder="年度"
                    className="facility-settings__code"
                  />
                  <input
                    type="text"
                    inputMode="numeric"
                    value={row.transports}
                    onChange={(e) => updateYear(index, { transports: e.target.value })}
                    aria-label="救急搬送受入件数"
                    placeholder="受入件数"
                    className="facility-settings__code"
                  />
                  <span className="facility-settings__acuity-admissions">
                    {row.admissions.map((a, aIndex) => (
                      <span key={aIndex}>
                        <select
                          value={a.unitId}
                          onChange={(e) =>
                            updateYear(index, {
                              admissions: row.admissions.map((x, i) => (i === aIndex ? { ...x, unitId: e.target.value } : x)),
                            })
                          }
                          aria-label="届出単位"
                        >
                          <option value="">単位を選択</option>
                          {unitLocationOptions.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={a.count}
                          onChange={(e) =>
                            updateYear(index, {
                              admissions: row.admissions.map((x, i) => (i === aIndex ? { ...x, count: e.target.value } : x)),
                            })
                          }
                          aria-label="救急搬送からの入院件数"
                          placeholder="入院件数"
                          className="facility-settings__code"
                        />
                        <button
                          type="button"
                          className="rp-card__icon-button"
                          title="入院件数を削除"
                          aria-label="入院件数を削除"
                          onClick={() => updateYear(index, { admissions: row.admissions.filter((_, i) => i !== aIndex) })}
                        >
                          <TrashIcon />
                        </button>
                      </span>
                    ))}
                    <button
                      type="button"
                      className="rp-card__compact-button"
                      onClick={() => updateYear(index, { admissions: [...row.admissions, { unitId: "", count: "" }] })}
                    >
                      入院件数
                    </button>
                  </span>
                  <button
                    type="button"
                    className="rp-card__icon-button"
                    title="年度を削除"
                    aria-label="年度を削除"
                    onClick={() => setYearsDraft(yearRows.filter((_, i) => i !== index))}
                  >
                    <TrashIcon />
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="rp-card__compact-button"
              onClick={() => setYearsDraft([...yearRows, { year: "", transports: "", admissions: [] }])}
            >
              追加
            </button>
          </div>
        </details>

        {/* 褥瘡管理。保有患者・発生率はこのテンプレートの回答から数える(url は版を問わない)。 */}
        <details className="facility-settings__schedule">
          <summary>褥瘡管理</summary>
          <div className="facility-settings__schedule-body">
            <label>
              DESIGN-R 評価のテンプレート
              <select
                value={pressureUlcer.template}
                onChange={(e) => setPressureUlcerDraft({ ...pressureUlcer, template: e.target.value })}
              >
                {[...new Set([pressureUlcer.template, ...templateOptions.questionnaires.map((q) => q.url ?? "").filter(Boolean)])].map((url) => (
                  <option key={url} value={url}>
                    {templateOptions.questionnaires.find((q) => q.url === url)?.title ?? url}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </details>

        {/* 放射線治療の治療中の診察。既定の 7 日は外来放射線照射診療料(B001-2-8。7 日間に
            1 回、算定日に放射線治療医の診察)に合わせた値で、入院の患者や施設の運用に合わせて
            変えられるようにしてある。テンプレートは記入欄の初期値(選び直しは妨げない)。 */}
        <details className="facility-settings__schedule">
          <summary>放射線治療の週次レビュー</summary>
          <div className="facility-settings__schedule-body">
            <label>
              治療中の診察の間隔
              <span className="facility-settings__times">
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={radiotherapyReview.interval_days}
                  onChange={(e) =>
                    setReviewDraft({ ...radiotherapyReview, interval_days: Number(e.target.value) })
                  }
                  aria-label="放射線治療の診察間隔の日数"
                />
                <span className="facility-settings__unit">日以内(最後の診察から)</span>
              </span>
            </label>
            <label>
              週次レビューの既定テンプレート
              <select
                value={radiotherapyReview.template}
                onChange={(e) => setReviewDraft({ ...radiotherapyReview, template: e.target.value })}
              >
                <option value="">（なし）</option>
                {templateOptions.questionnaires.map((q) => (
                  <option key={q.id} value={questionnaireCanonical(q)}>
                    {q.title ?? q.name ?? q.id}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </details>

        {/* 早期警告スコア。算出するのは入院・外来を問わず右ペインと一括入力のバイタル、通知は入院中の
            患者の主治医あて(docs/early-warning-design.md)。 */}
        <details className="facility-settings__schedule">
          <summary>Web 問診</summary>
          <div className="facility-settings__schedule-body">
            <ul className="facility-settings__balance-list facility-settings__profile-list">
              {intake.questionnaires.map((url, index) => (
                <li key={url}>
                  <span>{profileTitle(url)}</span>
                  <button
                    type="button"
                    className="rp-card__icon-button"
                    title="上へ"
                    aria-label={`${profileTitle(url)} を上へ`}
                    disabled={index === 0}
                    onClick={() => {
                      const next = [...intake.questionnaires];
                      [next[index - 1], next[index]] = [next[index], next[index - 1]];
                      setIntakeDraft({ ...intake, questionnaires: next });
                    }}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="rp-card__icon-button"
                    title={`${profileTitle(url)} を削除`}
                    aria-label={`${profileTitle(url)} を削除`}
                    onClick={() =>
                      setIntakeDraft({ ...intake, questionnaires: intake.questionnaires.filter((u) => u !== url) })
                    }
                  >
                    <TrashIcon />
                  </button>
                </li>
              ))}
            </ul>
            <label>
              質問票の追加
              <span className="facility-settings__times">
                <select value={intakeAdding} onChange={(e) => setIntakeAdding(e.target.value)}>
                  <option value="">（選択）</option>
                  {profileCandidates
                    .filter((q) => !intake.questionnaires.includes(q.url as string))
                    .map((q) => (
                      <option key={q.url} value={q.url}>
                        {q.title ?? q.name ?? q.url}
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  className="rp-card__compact-button"
                  disabled={!intakeAdding}
                  onClick={() => {
                    setIntakeDraft({ ...intake, questionnaires: [...intake.questionnaires, intakeAdding] });
                    setIntakeAdding("");
                  }}
                >
                  追加
                </button>
              </span>
            </label>
            {sortDepartmentsByCode(departments.departments)
              .filter((department) => Boolean(departmentCode(department)))
              .map((department) => {
                const code = departmentCode(department);
                return (
                  <label key={code}>
                    {departmentDisplayName(department)}の質問票
                    <select value={intake.by_department[code]?.[0] ?? ""} onChange={(e) => updateIntakeDepartment(code, e.target.value)}>
                      <option value="">（既定）</option>
                      {profileCandidates.map((q) => (
                        <option key={q.url} value={q.url}>
                          {q.title ?? q.name ?? q.url}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              })}
            <label>
              予約の無いリンクの有効時間
              <span className="facility-settings__times">
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={intake.expires_hours}
                  onChange={(e) => setIntakeDraft({ ...intake, expires_hours: Number(e.target.value) })}
                  aria-label="Web 問診のリンクの有効時間"
                />
                <span className="facility-settings__unit">時間</span>
              </span>
            </label>
          </div>
        </details>

        <details className="facility-settings__schedule">
          <summary>早期警告スコア(NEWS2)</summary>
          <div className="facility-settings__schedule-body">
            <label className="connection-settings-form__checkbox">
              <input
                type="checkbox"
                checked={earlyWarning.enabled}
                onChange={(e) => setEarlyWarningDraft({ ...earlyWarning, enabled: e.target.checked })}
              />
              算出と通知を行う
            </label>
            <label>
              主治医に通知する区分
              <select
                value={earlyWarning.notify_band}
                onChange={(e) =>
                  setEarlyWarningDraft({
                    ...earlyWarning,
                    notify_band: e.target.value as EarlyWarningSettings["notify_band"],
                  })
                }
              >
                {EARLY_WARNING_NOTIFY_BANDS.map((band) => (
                  <option key={band} value={band}>
                    {EARLY_WARNING_BAND_LABEL[band]}以上
                  </option>
                ))}
              </select>
            </label>
            <label className="connection-settings-form__checkbox">
              <input
                type="checkbox"
                checked={earlyWarning.show_qsofa}
                onChange={(e) => setEarlyWarningDraft({ ...earlyWarning, show_qsofa: e.target.checked })}
              />
              qSOFA を併記する
            </label>
          </div>
        </details>

        {/* 医事会計へ送るレセプト電算コード。施設基準や届出で決まる 1 施設 1 値のものだけを
            ここに持ち、製品・技法ごとのコードは各マスタの列に持つ。空欄は送らない
            (送信前のプレビューに「送れない項目」として出る)。 */}
        <details className="facility-settings__schedule">
          <summary>医事会計のレセプト電算コード</summary>
          <div className="facility-settings__schedule-body">
            <h3 className="facility-settings__subheading">病理検査(検査区分ごと)</h3>
            {(Object.keys(PATHOLOGY_LABELS) as (keyof ReceiptCodeSettings["pathology"])[]).map(
              (key) => (
                <label key={key}>
                  {PATHOLOGY_LABELS[key]}
                  {receiptCodeInput(
                    receiptCodes.pathology[key],
                    (next) => updateReceiptCode("pathology", key, next),
                    `病理 ${PATHOLOGY_LABELS[key]} のレセプト電算コード`,
                  )}
                </label>
              ),
            )}

            {/* 区分 × 療法士と、区分ごとのコメントは別の表にする。5 列を 1 つの表に並べると
                節の幅(520px)に収まらない。コメントの候補(datalist)は表の外に置く。 */}
            <h3 className="facility-settings__subheading">
              疾患別リハビリテーション料(区分 × 療法士)
            </h3>
            {rehabCodeTable(REHAB_THERAPY_KEYS)}
            <h3 className="facility-settings__subheading">
              疾患別リハビリテーション料に添えるコメント(区分ごと)
            </h3>
            {rehabCodeTable(REHAB_COMMENT_KEYS)}
            {REHAB_CATEGORY_KEYS.map((category) => (
              <CommentCandidates
                key={category}
                id={`rehab-comments-${category}`}
                procedureCodes={REHAB_THERAPY_KEYS.map((t) => receiptCodes.rehab[category][t])}
              />
            ))}

            <h3 className="facility-settings__subheading">栄養食事指導料</h3>
            {(
              Object.keys(NUTRITION_LABELS) as (keyof ReceiptCodeSettings["nutrition_guidance"])[]
            ).map((key) => (
              <label key={key}>
                {NUTRITION_LABELS[key]}
                {receiptCodeInput(
                  receiptCodes.nutrition_guidance[key],
                  (next) => updateReceiptCode("nutrition_guidance", key, next),
                  `栄養食事指導料 ${NUTRITION_LABELS[key]} のレセプト電算コード`,
                )}
              </label>
            ))}

            <h3 className="facility-settings__subheading">放射線治療</h3>
            <label>
              照射部位コメント(830。放射線治療管理料に添える)
              {receiptCodeInput(
                receiptCodes.radiotherapy.site_comment,
                (next) => updateReceiptCode("radiotherapy", "site_comment", next),
                "照射部位コメントのレセプト電算コード",
                "radiotherapy-site-comments",
              )}
            </label>
            <CommentCandidates id="radiotherapy-site-comments" procedureCodes={managementCodes} />

            <h3 className="facility-settings__subheading">輸血の手技</h3>
            {(Object.keys(TRANSFUSION_LABELS) as (keyof ReceiptCodeSettings["transfusion"])[]).map(
              (key) => (
                <label key={key}>
                  {TRANSFUSION_LABELS[key]}
                  {receiptCodeInput(
                    receiptCodes.transfusion[key],
                    (next) => updateReceiptCode("transfusion", key, next),
                    `${TRANSFUSION_LABELS[key]} のレセプト電算コード`,
                  )}
                </label>
              ),
            )}

            <h3 className="facility-settings__subheading">送信時に足す加算</h3>
            <label>
              血液採取(検体検査に血液の検体があるとき)
              {receiptCodeInput(
                receiptCodes.lab.blood_draw,
                (next) => updateReceiptCode("lab", "blood_draw", next),
                "血液採取のレセプト電算コード",
              )}
            </label>
            {(Object.keys(INJECTION_LABELS) as (keyof ReceiptCodeSettings["injection"])[]).map(
              (key) => (
                <label key={key}>
                  {INJECTION_LABELS[key]}(レジメンの注射があるとき)
                  {receiptCodeInput(
                    receiptCodes.injection[key],
                    (next) => updateReceiptCode("injection", key, next),
                    `${INJECTION_LABELS[key]} のレセプト電算コード`,
                  )}
                </label>
              ),
            )}
            {!receiptCodesOk && (
              <p className="facility-settings__error" role="alert">
                レセプト電算コードは 9 桁の数字で入力してください
              </p>
            )}
          </div>
        </details>

        {/* 経過表の水分出納に数える看護観察。同じ名前で単位違いの項目(尿量 mL / g)が
            あるので管理番号で持つ。集計できるのは mL の項目だけなので候補も mL に絞る。 */}
        <details className="facility-settings__schedule">
          <summary>水分出納の対象項目</summary>
          <div className="facility-settings__schedule-body">
            {(["in", "out"] as const).map((side) => (
              <div key={side} className="facility-settings__balance">
                <span className="facility-settings__balance-label">
                  {side === "in" ? "IN（摂取）" : "OUT（排泄）"}
                </span>
                <ul className="facility-settings__balance-list">
                  {balance[side].map((manageNo) => (
                    <li key={manageNo}>
                      <span>{balanceNames.data?.get(manageNo)?.name ?? manageNo}</span>
                      <button
                        type="button"
                        aria-label={`${balanceNames.data?.get(manageNo)?.name ?? manageNo} を削除`}
                        onClick={() => removeBalanceItem(side, manageNo)}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="rp-card__compact-button"
                  onClick={() => setPickingSide(side)}
                >
                  + 項目追加
                </button>
              </div>
            ))}
          </div>
        </details>

        {/* 経過表一括入力(入院患者一覧のケバブメニュー)に出す列。並べた順が列の順。 */}
        <details className="facility-settings__schedule">
          <summary>経過表一括入力の列</summary>
          <div className="facility-settings__schedule-body">
            <ul className="facility-settings__balance-list facility-settings__profile-list">
              {bulkVitalEntry.items.map((item, index) => (
                <li key={item}>
                  <span>{BULK_VITAL_ITEM_LABELS[item]}</span>
                  <button
                    type="button"
                    className="rp-card__icon-button"
                    title="上へ"
                    aria-label={`${BULK_VITAL_ITEM_LABELS[item]} を上へ`}
                    disabled={index === 0}
                    onClick={() => moveBulkItem(index, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="rp-card__icon-button"
                    title="下へ"
                    aria-label={`${BULK_VITAL_ITEM_LABELS[item]} を下へ`}
                    disabled={index === bulkVitalEntry.items.length - 1}
                    onClick={() => moveBulkItem(index, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="rp-card__icon-button"
                    title={`${BULK_VITAL_ITEM_LABELS[item]} を削除`}
                    aria-label={`${BULK_VITAL_ITEM_LABELS[item]} を削除`}
                    disabled={bulkVitalEntry.items.length === 1}
                    onClick={() =>
                      setBulkDraft({ items: bulkVitalEntry.items.filter((i) => i !== item) })
                    }
                  >
                    <TrashIcon />
                  </button>
                </li>
              ))}
            </ul>
            <label>
              列の追加
              <span className="facility-settings__times">
                <select
                  value={bulkAdding}
                  onChange={(e) => setBulkAdding(e.target.value as BulkVitalItem | "")}
                >
                  <option value="">（選択）</option>
                  {BULK_VITAL_ITEMS.filter((item) => !bulkVitalEntry.items.includes(item)).map(
                    (item) => (
                      <option key={item} value={item}>
                        {BULK_VITAL_ITEM_LABELS[item]}
                      </option>
                    ),
                  )}
                </select>
                <button
                  type="button"
                  className="rp-card__compact-button"
                  disabled={!bulkAdding}
                  onClick={() => {
                    if (!bulkAdding) return;
                    setBulkDraft({ items: [...bulkVitalEntry.items, bulkAdding] });
                    setBulkAdding("");
                  }}
                >
                  追加
                </button>
              </span>
            </label>
          </div>
        </details>

        {/* DPC の医療機関別係数。基礎係数・機能評価係数Ⅰ・Ⅱ・救急補正係数などを合わせた値で、
            診断群分類の推定包括額(点数 × 係数 × 10 円)に使う。年度の途中でも変わるので
            適用開始日ごとに持つ。 */}
        <details className="facility-settings__schedule">
          <summary>DPC の医療機関別係数</summary>
          <div className="facility-settings__schedule-body">
            <ul className="facility-settings__balance-list">
              {coefficients.map((c, index) => (
                <li key={index}>
                  <input
                    type="date"
                    value={c.from}
                    onChange={(e) => updateCoefficient(index, { from: e.target.value })}
                    aria-label="適用開始日"
                  />
                  <input
                    type="text"
                    inputMode="decimal"
                    value={c.value}
                    onChange={(e) => updateCoefficient(index, { value: e.target.value.trim() })}
                    aria-label="係数"
                    aria-invalid={!/^\d\.\d{1,4}$/.test(c.value)}
                    className="facility-settings__code"
                  />
                  <button
                    type="button"
                    className="rp-card__icon-button"
                    title="係数を削除"
                    aria-label="係数を削除"
                    onClick={() => setCoefficientDraft(coefficients.filter((_, i) => i !== index))}
                  >
                    <TrashIcon />
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="rp-card__compact-button"
              onClick={() => setCoefficientDraft([...coefficients, { from: "", value: "" }])}
            >
              追加
            </button>
          </div>
        </details>

        {/* 看護プロファイルの区画。並べた順がカルテのタブと右ペインの区画の順になる。値はテンプレートの
            url で、版を上げても設定は直さなくてよい(新しく書く回答は有効な版を使う)。 */}
        <details className="facility-settings__schedule">
          <summary>看護プロファイルの区画</summary>
          <div className="facility-settings__schedule-body">
            <ul className="facility-settings__balance-list facility-settings__profile-list">
              {nursingProfile.templates.map((url, index) => (
                <li key={url}>
                  <span>{profileTitle(url)}</span>
                  <button
                    type="button"
                    className="rp-card__icon-button"
                    title="上へ"
                    aria-label={`${profileTitle(url)} を上へ`}
                    disabled={index === 0}
                    onClick={() => moveProfileTemplate(index, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="rp-card__icon-button"
                    title="下へ"
                    aria-label={`${profileTitle(url)} を下へ`}
                    disabled={index === nursingProfile.templates.length - 1}
                    onClick={() => moveProfileTemplate(index, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="rp-card__icon-button"
                    title={`${profileTitle(url)} を削除`}
                    aria-label={`${profileTitle(url)} を削除`}
                    onClick={() => updateProfileTemplates(nursingProfile.templates.filter((u) => u !== url))}
                  >
                    <TrashIcon />
                  </button>
                </li>
              ))}
            </ul>
            <label>
              区画の追加
              <span className="facility-settings__times">
                <select value={profileAdding} onChange={(e) => setProfileAdding(e.target.value)}>
                  <option value="">（選択）</option>
                  {profileCandidates
                    .filter((q) => !nursingProfile.templates.includes(q.url as string))
                    .map((q) => (
                      <option key={q.url} value={q.url}>
                        {q.title ?? q.name ?? q.url}
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  className="rp-card__compact-button"
                  disabled={!profileAdding}
                  onClick={() => {
                    updateProfileTemplates([...nursingProfile.templates, profileAdding]);
                    setProfileAdding("");
                  }}
                >
                  追加
                </button>
              </span>
            </label>
          </div>
        </details>

        <div className="connection-settings-form__actions">
          <button
            type="submit"
            disabled={
              update.isPending ||
              !scheduleValid ||
              !mealValid ||
              !thresholdsValid ||
              !medicationValid ||
              !reminderValid ||
              !admissionDocsValid ||
              !acuityValid ||
              !pressureUlcerValid
            }
          >
            {update.isPending ? "保存中..." : "保存"}
          </button>
        </div>

        {!scheduleValid && (
          <p className="connection-settings-form__field-hint" role="status">
            「看護指示の既定時刻」に空欄があります。
          </p>
        )}
        {!mealValid && (
          <p className="connection-settings-form__field-hint" role="status">
            「食事の提供時刻」は朝・昼・夕の順に、すべて入れてください。
          </p>
        )}
        {!thresholdsValid && (
          <p className="connection-settings-form__field-hint" role="status">
            「バイタルの異常値」は下限より上限を大きくしてください。
          </p>
        )}

        {!medicationValid && (
          <p className="connection-settings-form__field-hint" role="status">
            「内服の与薬の時刻」は 0 以上の分と、HH:MM の時刻で入れてください。
          </p>
        )}
        {!reviewValid && (
          <p className="connection-settings-form__field-hint" role="status">
            「放射線治療の診察間隔」は 1 以上の日数で入れてください。
          </p>
        )}
        {!reminderValid && (
          <p className="connection-settings-form__field-hint" role="status">
            「文書作成の督促」は 0 以上の日数で入れてください。
          </p>
        )}
        {update.isSuccess && (
          <p className="connection-settings-form__success" role="status">
            施設設定を保存しました
          </p>
        )}
        <ErrorBanner error={update.error} />
      </form>

      {pickingSide && (
        <NursingItemSearchModal
          only="observation"
          onSelect={(item) => {
            if (item?.kind === "observation") addBalanceItem(pickingSide, item.manageNo);
            setPickingSide(null);
          }}
          onClose={() => setPickingSide(null)}
        />
      )}
    </div>
  );
}
