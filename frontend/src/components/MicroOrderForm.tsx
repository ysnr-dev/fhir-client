import { today } from "../lib/dates";
import { makeFieldUpdater } from "../lib/form";
import { useId, useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  useFrequentMicroOrganisms,
  useMicroCollectionMethods,
  useMicroCollectionSites,
  useMicroOrderItems,
  useMicroOrganismSearch,
  useMicroSpecimenTypeOptions,
} from "../api/masterQueries";
import type { MicroOrderItem, MicroSpecimenType } from "../api/masterClient";
import { refreshProblemDisplay } from "../fhir/conditionHelpers";
import {
  EXAM_PURPOSE_OPTIONS,
  LATERALITY_OPTIONS,
  PRIORITY_OPTIONS,
  emptyMicroOrderForm,
  groupOrganisms,
  specimenLabel,
  type MicroExamPurpose,
  type MicroOrderFormValues,
  type MicroOrderPriority,
  type MicroOrganismRef,
  type MicroSpecimenValues,
} from "../fhir/microOrderHelpers";
import { SETTING_OPTIONS, type PrescriptionSetting } from "../fhir/prescriptionHelpers";
import { useConditionOptions } from "../hooks/useConditionOptions";
import { useBulkStartDate } from "../hooks/useBulkStartDate";
import { useProblemOptions } from "../hooks/useProblemOptions";
import { useValidationError } from "../hooks/useValidationError";
import type { ValidationFailure } from "../lib/validation";
import { AntimicrobialImportModal } from "./AntimicrobialImportModal";
import { ErrorBanner } from "./ErrorBanner";
import { shownValidationError, useFieldAlert } from "./FieldAlert";
import { ProblemSelect } from "./ProblemSelect";

// 細菌検査オーダーの入力フォーム。1 オーダー = 1 検体(血液培養の 2 セット目は
// DO して採取部位を変える運用)。検査項目は 10 項目前後の小マスタなので、
// 検体検査のようなレイアウト(伝票)機能は持たずチェックボックスを直接並べる。
//
// 目的菌は頻用菌(マスタで frequent を付けた菌)を分類ごとにチェックボックスで直接出し、
// それ以外は検索で選ぶ。前投与抗菌薬は「処方取込」のモーダルで期間内の抗菌薬を
// 選び、自由編集できるテキストに追記する。

/** 必須チェックで弾いた項目の鍵。ラベルの印(FieldAlert)の宛先になる。 */
type MicroField = "specimenType" | "specimenSite" | "items" | "startDate";

/**
 * 登録前の入力検証。最初に落ちた項目と文言を返す(無ければ null)。
 * 登録時に弾くのと、弾いた項目が直されたかを表示側で見るのとで同じ規則を使う。
 */
function findValidationFailure(
  values: MicroOrderFormValues,
  setMode: boolean,
): ValidationFailure<MicroField> | null {
  if (!values.specimen.typeCode) {
    return { field: "specimenType", message: "検体種別を選択してください。" };
  }
  if (!values.specimen.siteCode) {
    return { field: "specimenSite", message: "採取部位を選択してください。" };
  }
  if (values.items.length === 0) {
    return { field: "items", message: "検査項目を 1 つ以上選択してください。" };
  }
  // セットの内容としての入力では検査日を持たない(適用時に入れる)。
  if (!setMode && !values.startDate) {
    return { field: "startDate", message: "検査日を入力してください。" };
  }
  return null;
}

interface MicroOrderFormProps {
  patientId: string;
  initialValues?: MicroOrderFormValues;
  onSubmit: (values: MicroOrderFormValues) => void;
  submitting: boolean;
  submitError?: unknown;
  submitLabel?: string;
  /** オーダーセットの適用日。外から開始日をまとめて入れるときに渡す。 */
  bulkStartDate?: string;
  /** セットの内容として入力する(患者と日付に依存する入力を出さず、その検証も外す)。 */
  setMode?: boolean;
  /** 送信ボタンを出さない(積んだフォームを外から一括 submit する画面で使う)。 */
  hideSubmit?: boolean;
}

export function MicroOrderForm({
  patientId,
  initialValues,
  onSubmit,
  submitting,
  submitError,
  submitLabel = "登録",
  bulkStartDate,
  setMode = false,
  hideSubmit = false,
}: MicroOrderFormProps) {
  const [values, setValues] = useState<MicroOrderFormValues>(
    initialValues ?? emptyMicroOrderForm(),
  );
  const [validationError, setValidationError, validationErrorRef, invalidField] =
    useValidationError<MicroField>();
  const [commentOpen, setCommentOpen] = useState(Boolean(initialValues?.comment));

  const problemOptions = useProblemOptions(patientId);
  const conditionOptions = useConditionOptions(patientId);
  useBulkStartDate(bulkStartDate, (date) => setValues((v) => ({ ...v, startDate: date })));
  const specimenTypes = useMicroSpecimenTypeOptions();
  const sites = useMicroCollectionSites();
  const methods = useMicroCollectionMethods();
  const orderItems = useMicroOrderItems();

  // 今日オーダーできる検査項目(有効期間内)だけを並べる。
  const activeItems = useMemo(() => {
    const date = today();
    return (orderItems.data?.items ?? []).filter(
      (item) =>
        (!item.valid_from || item.valid_from <= date) &&
        (!item.valid_to || item.valid_to >= date),
    );
  }, [orderItems.data]);

  const update = makeFieldUpdater(setValues);

  function updateSpecimen(patch: Partial<MicroSpecimenValues>) {
    setValues((v) => ({ ...v, specimen: { ...v.specimen, ...patch } }));
  }

  const selectedSite = sites.data?.items.find((site) => site.code === values.specimen.siteCode);
  const lateralityEnabled = Boolean(selectedSite?.laterality_applicable);

  function handleTypeChange(code: string) {
    const type = specimenTypes.data?.items.find((t) => t.code === code);
    updateSpecimen({ typeCode: code, typeName: type?.name ?? "" });
  }

  function handleSiteChange(code: string) {
    const site = sites.data?.items.find((s) => s.code === code);
    updateSpecimen({
      siteCode: code,
      siteName: site?.name ?? "",
      // 左右を持たない部位に変えたら左右指定も外す。
      lateralityCode: site?.laterality_applicable ? values.specimen.lateralityCode : "",
    });
  }

  function handleMethodChange(code: string) {
    const method = methods.data?.items.find((m) => m.code === code);
    updateSpecimen({ methodCode: code, methodName: method?.name ?? "" });
  }

  function toggleItem(item: MicroOrderItem) {
    setValues((current) => {
      const selected = current.items.some((line) => line.code === item.item_code);
      return {
        ...current,
        items: selected
          ? current.items.filter((line) => line.code !== item.item_code)
          : [
              ...current.items,
              // 画面で足した項目は登録時に採番されるので id を持たない。
              { id: "", code: item.item_code, name: item.name, shortName: item.short_name ?? "" },
            ],
      };
    });
  }

  function toggleOrganism(organism: MicroOrganismRef) {
    setValues((current) => {
      const selected = current.specimen.organisms.some((o) => o.code === organism.code);
      return {
        ...current,
        specimen: {
          ...current.specimen,
          organisms: selected
            ? current.specimen.organisms.filter((o) => o.code !== organism.code)
            : [...current.specimen.organisms, organism],
        },
      };
    });
  }

  // 弾いた項目が直されたら(同じ規則が通るようになったら)、バナーと印を消す。
  const liveFailure = useMemo(() => findValidationFailure(values, setMode), [values, setMode]);
  const shownError = shownValidationError(validationError, invalidField, liveFailure);
  const fieldAlert = useFieldAlert<MicroField>(invalidField, shownError);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const failure = findValidationFailure(values, setMode);
    if (failure) {
      setValidationError(failure.message, failure.field);
      return;
    }
    setValidationError(null);
    onSubmit({ ...values, problem: refreshProblemDisplay(values.problem, problemOptions) });
  }

  function handleKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    // input 上での Enter による暗黙の form submit を抑止する(他オーダーと同じ)。
    if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
      e.preventDefault();
    }
  }

  const selectedItemCodes = new Set(values.items.map((item) => item.code));

  return (
    <form
      className="prescription-form"
      onSubmit={handleSubmit}
      onKeyDown={handleKeyDown}
      noValidate={hideSubmit}
    >
      {shownError && (
        <div className="error-banner" role="alert" ref={validationErrorRef}>
          <p className="error-banner__line error-banner__line--error">{shownError}</p>
        </div>
      )}
      <ErrorBanner error={submitError} />
      <ErrorBanner
        error={specimenTypes.error ?? sites.error ?? methods.error ?? orderItems.error}
      />

      <fieldset>
        <legend>検査共通</legend>
        {!setMode && (
          <label>
            対象プロブレム
            <ProblemSelect
              value={values.problem}
              options={problemOptions}
              onChange={(problem) => update("problem", problem)}
            />
          </label>
        )}
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
          至急区分
          <select
            value={values.priority}
            onChange={(e) => update("priority", e.target.value as MicroOrderPriority)}
          >
            {PRIORITY_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.display}
              </option>
            ))}
          </select>
        </label>
        <label className={fieldAlert.className("startDate")}>
          {fieldAlert.label("startDate", "検査日")}
          <input
            type="date"
            value={values.startDate}
            onChange={(e) => update("startDate", e.target.value)}
          />
        </label>
        {commentOpen ? (
          <div className="prescription-form__comment-field">
            <label>
              依頼コメント
              <input
                type="text"
                value={values.comment}
                onChange={(e) => update("comment", e.target.value)}
              />
            </label>
            <button
              type="button"
              className="rp-card__icon-button"
              title="依頼コメントを削除"
              aria-label="依頼コメントを削除"
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
            <button type="button" className="comment-add-button" onClick={() => setCommentOpen(true)}>
              ＋依頼コメント
            </button>
          </div>
        )}
      </fieldset>

      <fieldset>
        <legend>検体</legend>
        <label className={fieldAlert.className("specimenType")}>
          {fieldAlert.label("specimenType", "検体種別 *")}
          <SpecimenTypeSelect
            types={specimenTypes.data?.items ?? []}
            value={values.specimen.typeCode}
            onChange={handleTypeChange}
          />
        </label>
        <label className={fieldAlert.className("specimenSite")}>
          {fieldAlert.label("specimenSite", "採取部位 *")}
          <select
            value={values.specimen.siteCode}
            onChange={(e) => handleSiteChange(e.target.value)}
          >
            <option value="">選択してください</option>
            {sites.data?.items.map((site) => (
              <option key={site.code} value={site.code}>
                {site.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          左右
          <select
            value={values.specimen.lateralityCode}
            onChange={(e) => updateSpecimen({ lateralityCode: e.target.value })}
            disabled={!lateralityEnabled}
            title={lateralityEnabled ? undefined : "この部位は左右の指定がありません"}
          >
            <option value="">指定なし</option>
            {LATERALITY_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.display}
              </option>
            ))}
          </select>
        </label>
        <label>
          採取方法
          <select
            value={values.specimen.methodCode}
            onChange={(e) => handleMethodChange(e.target.value)}
          >
            <option value="">選択してください</option>
            {methods.data?.items.map((method) => (
              <option key={method.code} value={method.code}>
                {method.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          採取予定日時
          <input
            type="datetime-local"
            value={values.specimen.collectionDateTime}
            onChange={(e) => updateSpecimen({ collectionDateTime: e.target.value })}
          />
        </label>
      </fieldset>

      <fieldset>
        <legend>{fieldAlert.label("items", "検査項目 *")}</legend>
        <ul className="micro-order__checks">
          {activeItems.map((item) => (
            <li key={item.item_code}>
              <label>
                <input
                  type="checkbox"
                  checked={selectedItemCodes.has(item.item_code)}
                  onChange={() => toggleItem(item)}
                />
                {item.name}
              </label>
            </li>
          ))}
          {orderItems.data && activeItems.length === 0 && (
            <li className="order-select__muted">
              検査項目マスタが未登録です(db:seed で初期投入できます)
            </li>
          )}
        </ul>
      </fieldset>

      <OrganismFieldset organisms={values.specimen.organisms} onToggle={toggleOrganism} />

      <ClinicalInfoFieldset
        patientId={patientId}
        setMode={setMode}
        specimen={values.specimen}
        priorAntimicrobial={values.priorAntimicrobial}
        examPurpose={values.examPurpose}
        conditionOptions={conditionOptions}
        onSpecimenChange={updateSpecimen}
        onChange={update}
      />

      <SelectionSummary values={values} />

      {!hideSubmit && (
        <div className="prescription-form__submit">
          <button type="submit" disabled={submitting}>
            {submitting ? "送信中..." : submitLabel}
          </button>
        </div>
      )}
    </form>
  );
}

// 検体種別。JANIS 材料コード表の「系統」ごとにまとめて選びやすくする。
function SpecimenTypeSelect({
  types,
  value,
  onChange,
}: {
  types: MicroSpecimenType[];
  value: string;
  onChange: (code: string) => void;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, MicroSpecimenType[]>();
    for (const type of types) {
      const key = type.category ?? "その他";
      const list = map.get(key);
      if (list) list.push(type);
      else map.set(key, [type]);
    }
    return Array.from(map.entries());
  }, [types]);

  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">選択してください</option>
      {groups.map(([category, members]) => (
        <optgroup key={category} label={category}>
          {members.map((type) => (
            <option key={type.code} value={type.code}>
              {type.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

// 目的菌。頻用菌は分類ごとの行にチェックボックスで直接出し、それ以外は検索で選ぶ。
function OrganismFieldset({
  organisms,
  onToggle,
}: {
  organisms: MicroOrganismRef[];
  onToggle: (organism: MicroOrganismRef) => void;
}) {
  const frequent = useFrequentMicroOrganisms();
  const [name, setName] = useState("");
  const [page, setPage] = useState(1);
  const search = useMicroOrganismSearch({ name }, page);
  const searching = name.trim().length > 0;

  const selectedCodes = new Set(organisms.map((o) => o.code));
  // 頻用に無い菌を検索から選んだら、頻用菌と同じ分類の行に並べる
  // (チェックを外す手段が検索欄を開き直すだけにならないように)。
  const frequentItems = (frequent.data?.items ?? []).map((o) => ({ code: o.code, name: o.name }));
  const frequentCodes = new Set(frequentItems.map((o) => o.code));
  const groups = groupOrganisms([
    ...frequentItems,
    ...organisms.filter((o) => !frequentCodes.has(o.code)),
  ]);

  return (
    <fieldset>
      <legend>目的菌</legend>
      <ErrorBanner error={frequent.error ?? search.error} />
      <div className="micro-order__organisms">
        {groups.map((group) => (
          <div key={group.label} className="micro-order__organism-group">
            <span className="micro-order__organism-group-label">{group.label}</span>
            <ul>
              {group.organisms.map((organism) => (
                <li key={organism.code}>
                  <label>
                    <input
                      type="checkbox"
                      checked={selectedCodes.has(organism.code)}
                      onChange={() => onToggle(organism)}
                    />
                    <span>{organism.name}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="order-select__search">
        <input
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setPage(1);
          }}
          placeholder="その他の菌を検索(JANIS 病原体コード表)"
        />
        {searching && (
          <>
            <ul className="order-select__search-list">
              {search.data?.items.map((organism) => (
                <li key={organism.code}>
                  <label>
                    <input
                      type="checkbox"
                      checked={selectedCodes.has(organism.code)}
                      onChange={() => onToggle({ code: organism.code, name: organism.name })}
                    />
                    {organism.name}
                  </label>
                </li>
              ))}
              {search.data && search.data.items.length === 0 && (
                <li className="order-select__muted">該当する菌がありません</li>
              )}
            </ul>
            <div className="master-search__pager">
              <button
                type="button"
                onClick={() => setPage((p) => p - 1)}
                disabled={page <= 1 || search.isFetching}
              >
                前へ
              </button>
              <span>
                {page} ページ目 (全 {search.data?.total ?? 0} 件)
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => p + 1)}
                disabled={
                  !(search.data && page * search.data.per < search.data.total) || search.isFetching
                }
              >
                次へ
              </button>
            </div>
          </>
        )}
      </div>
    </fieldset>
  );
}

// 臨床情報。疑い病名は登録病名のプルダウンから選ぶか直接入力する。
function ClinicalInfoFieldset({
  patientId,
  setMode,
  specimen,
  priorAntimicrobial,
  examPurpose,
  conditionOptions,
  onSpecimenChange,
  onChange,
}: {
  patientId: string;
  /** セットの内容としての入力(登録病名の候補と処方からの抗菌薬候補は出さない)。 */
  setMode: boolean;
  specimen: MicroSpecimenValues;
  priorAntimicrobial: string;
  examPurpose: MicroExamPurpose;
  conditionOptions: { conditionId: string; display: string }[];
  onSpecimenChange: (patch: Partial<MicroSpecimenValues>) => void;
  onChange: <K extends keyof MicroOrderFormValues>(
    key: K,
    value: MicroOrderFormValues[K],
  ) => void;
}) {
  const [importOpen, setImportOpen] = useState(false);
  const priorAntimicrobialId = useId();

  // 保存済みの疑い病名が候補に無い(病名を消した)場合も、選択を失わせない。
  const missingCondition =
    Boolean(specimen.reasonConditionId) &&
    !conditionOptions.some((o) => o.conditionId === specimen.reasonConditionId);

  // 既に書いてある行は重ねない。
  function appendAntimicrobials(lines: string[]) {
    const existing = new Set(priorAntimicrobial.split("\n").map((line) => line.trim()));
    const added = lines.filter((line) => !existing.has(line));
    if (added.length === 0) return;
    onChange("priorAntimicrobial", [priorAntimicrobial, ...added].filter(Boolean).join("\n"));
  }

  return (
    <fieldset>
      <legend>臨床情報</legend>
      <label className="micro-order__wide">
        疑い病名
        <div className="rad-gp__reason micro-order__reason">
          {!setMode && (
          <select
            value={specimen.reasonConditionId}
            onChange={(e) => {
              const conditionId = e.target.value;
              const option = conditionOptions.find((o) => o.conditionId === conditionId);
              onSpecimenChange({
                reasonConditionId: conditionId,
                // 選び直したら病名も入れ替える。直接入力に戻したときは文字列を残す。
                reasonName: option ? option.display : specimen.reasonName,
              });
            }}
            aria-label="登録病名から選ぶ"
          >
            <option value="">(直接入力)</option>
            {conditionOptions.map((option) => (
              <option key={option.conditionId} value={option.conditionId}>
                {option.display}
              </option>
            ))}
            {missingCondition && (
              <option value={specimen.reasonConditionId}>
                {specimen.reasonName || "(不明)"} (削除済み)
              </option>
            )}
          </select>
          )}
          <input
            type="text"
            value={specimen.reasonName}
            placeholder="病名を直接入力"
            // 手で書き換えたら登録病名との紐付けは外す(別の文言になるため)。
            onChange={(e) =>
              onSpecimenChange({ reasonName: e.target.value, reasonConditionId: "" })
            }
            aria-label="疑い病名"
          />
        </div>
      </label>

      {/* ラベル行と入力行を分けたグリッド。取込ボタンは textarea と同じ行に
          置いて天を揃える(ラベルの高さを margin で当て込まない)。 */}
      <div className="micro-order__prior micro-order__wide">
        <label htmlFor={priorAntimicrobialId}>前投与抗菌薬</label>
        <textarea
          id={priorAntimicrobialId}
          value={priorAntimicrobial}
          rows={3}
          placeholder="投与中・投与歴のある抗菌薬(薬品名・期間)"
          onChange={(e) => onChange("priorAntimicrobial", e.target.value)}
        />
        {!setMode && (
          <button
            type="button"
            className="rp-card__compact-button"
            onClick={() => setImportOpen(true)}
          >
            処方取込
          </button>
        )}
        {importOpen && (
          <AntimicrobialImportModal
            patientId={patientId}
            onAppend={appendAntimicrobials}
            onClose={() => setImportOpen(false)}
          />
        )}
      </div>

      <label>
        検査目的
        <select
          value={examPurpose}
          onChange={(e) => onChange("examPurpose", e.target.value as MicroExamPurpose)}
        >
          <option value="">未指定</option>
          {EXAM_PURPOSE_OPTIONS.map((o) => (
            <option key={o.code} value={o.code}>
              {o.display}
            </option>
          ))}
        </select>
      </label>
    </fieldset>
  );
}

// 選択中の内容の確認。検体の見出し + 検査項目 + 目的菌。
function SelectionSummary({ values }: { values: MicroOrderFormValues }) {
  return (
    <section className="order-select__preview">
      <h3>選択中({values.items.length})</h3>
      {values.items.length === 0 ? (
        <p className="order-select__muted">検査項目を選択してください</p>
      ) : (
        <div className="order-select__group">
          <h4>GP1 {specimenLabel(values.specimen)}</h4>
          <ul>
            {values.items.map((item) => (
              <li key={item.code}>{item.name}</li>
            ))}
          </ul>
          {values.specimen.organisms.length > 0 && (
            <p className="order-select__muted">
              目的菌: {values.specimen.organisms.map((o) => o.name).join(", ")}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
