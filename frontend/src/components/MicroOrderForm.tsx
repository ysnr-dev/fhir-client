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
  specimenLabel,
  type MicroExamPurpose,
  type MicroOrderFormValues,
  type MicroOrderPriority,
  type MicroOrganismRef,
  type MicroSpecimenValues,
} from "../fhir/microOrderHelpers";
import { SETTING_OPTIONS, type PrescriptionSetting } from "../fhir/prescriptionHelpers";
import { useAntimicrobialSuggestions } from "../hooks/useAntimicrobialSuggestions";
import { useConditionOptions } from "../hooks/useConditionOptions";
import { useProblemOptions } from "../hooks/useProblemOptions";
import { useValidationError } from "../hooks/useValidationError";
import { ErrorBanner } from "./ErrorBanner";
import { ProblemSelect } from "./ProblemSelect";

// 細菌検査オーダーの入力フォーム。1 オーダー = 1 検体(血液培養の 2 セット目は
// DO して採取部位を変える運用)。検査項目は 10 項目前後の小マスタなので、
// 検体検査のようなレイアウト(伝票)機能は持たずチェックボックスを直接並べる。
//
// 目的菌は頻用菌(マスタで frequent を付けた菌)をチェックボックスで直接出し、
// それ以外は検索で選ぶ。前投与抗菌薬は「処方から取り込み」で直近の抗菌薬を
// 候補表示し、選んだものを自由編集できるテキストに挿入する。

interface MicroOrderFormProps {
  patientId: string;
  initialValues?: MicroOrderFormValues;
  onSubmit: (values: MicroOrderFormValues) => void;
  submitting: boolean;
  submitError?: unknown;
  submitLabel?: string;
}

export function MicroOrderForm({
  patientId,
  initialValues,
  onSubmit,
  submitting,
  submitError,
  submitLabel = "登録",
}: MicroOrderFormProps) {
  const [values, setValues] = useState<MicroOrderFormValues>(
    initialValues ?? emptyMicroOrderForm(),
  );
  const [validationError, setValidationError, validationErrorRef] = useValidationError();
  const [commentOpen, setCommentOpen] = useState(Boolean(initialValues?.comment));

  const problemOptions = useProblemOptions(patientId);
  const conditionOptions = useConditionOptions(patientId);
  const specimenTypes = useMicroSpecimenTypeOptions();
  const sites = useMicroCollectionSites();
  const methods = useMicroCollectionMethods();
  const orderItems = useMicroOrderItems();

  // 今日オーダーできる検査項目(有効期間内)だけを並べる。
  const activeItems = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return (orderItems.data?.items ?? []).filter(
      (item) =>
        (!item.valid_from || item.valid_from <= today) &&
        (!item.valid_to || item.valid_to >= today),
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

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!values.specimen.typeCode) {
      setValidationError("検体種別を選択してください。");
      return;
    }
    if (!values.specimen.siteCode) {
      setValidationError("採取部位を選択してください。");
      return;
    }
    if (values.items.length === 0) {
      setValidationError("検査項目を 1 つ以上選択してください。");
      return;
    }
    if (!values.startDate) {
      setValidationError("検査日を入力してください。");
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
    <form className="prescription-form" onSubmit={handleSubmit} onKeyDown={handleKeyDown}>
      {validationError && (
        <div className="error-banner" role="alert" ref={validationErrorRef}>
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}
      <ErrorBanner error={submitError} />
      <ErrorBanner
        error={specimenTypes.error ?? sites.error ?? methods.error ?? orderItems.error}
      />

      <fieldset>
        <legend>検査共通</legend>
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
        <label>
          検査日
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
        <label>
          検体種別 *
          <SpecimenTypeSelect
            types={specimenTypes.data?.items ?? []}
            value={values.specimen.typeCode}
            onChange={handleTypeChange}
          />
        </label>
        <label>
          採取部位 *
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
        <legend>検査項目 *</legend>
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
        specimen={values.specimen}
        priorAntimicrobial={values.priorAntimicrobial}
        examPurpose={values.examPurpose}
        conditionOptions={conditionOptions}
        onSpecimenChange={updateSpecimen}
        onChange={update}
      />

      <SelectionSummary values={values} />

      <div className="prescription-form__submit">
        <button type="submit" disabled={submitting}>
          {submitting ? "送信中..." : submitLabel}
        </button>
      </div>
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

// 目的菌。頻用菌はチェックボックスで直接出し、それ以外は検索で選ぶ。
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
  // 頻用に無い菌を検索から選んだら、頻用リストの下に選択済みとして出す
  // (チェックを外す手段が検索欄を開き直すだけにならないように)。
  const frequentCodes = new Set((frequent.data?.items ?? []).map((o) => o.code));
  const extraSelected = organisms.filter((o) => !frequentCodes.has(o.code));

  return (
    <fieldset>
      <legend>目的菌</legend>
      <ErrorBanner error={frequent.error ?? search.error} />
      <ul className="micro-order__checks">
        {frequent.data?.items.map((organism) => (
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
        {extraSelected.map((organism) => (
          <li key={organism.code}>
            <label>
              <input type="checkbox" checked onChange={() => onToggle(organism)} />
              {organism.name}
            </label>
          </li>
        ))}
      </ul>

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
  specimen,
  priorAntimicrobial,
  examPurpose,
  conditionOptions,
  onSpecimenChange,
  onChange,
}: {
  patientId: string;
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
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const suggestions = useAntimicrobialSuggestions(patientId, suggestionsOpen);
  const priorAntimicrobialId = useId();

  // 保存済みの疑い病名が候補に無い(病名を消した)場合も、選択を失わせない。
  const missingCondition =
    Boolean(specimen.reasonConditionId) &&
    !conditionOptions.some((o) => o.conditionId === specimen.reasonConditionId);

  function appendAntimicrobial(label: string) {
    onChange(
      "priorAntimicrobial",
      priorAntimicrobial ? `${priorAntimicrobial}\n${label}` : label,
    );
  }

  return (
    <fieldset>
      <legend>臨床情報</legend>
      <label>
        疑い病名
        <div className="rad-gp__reason">
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

      {/* ラベル行と入力行を分けたグリッド。取り込みボタンは textarea と同じ行に
          置いて天を揃える(ラベルの高さを margin で当て込まない)。 */}
      <div className="micro-order__prior">
        <label htmlFor={priorAntimicrobialId}>前投与抗菌薬</label>
        <textarea
          id={priorAntimicrobialId}
          value={priorAntimicrobial}
          rows={2}
          placeholder="投与中・投与歴のある抗菌薬(薬品名・期間)"
          onChange={(e) => onChange("priorAntimicrobial", e.target.value)}
        />
        <button
          type="button"
          className="micro-order__suggest-toggle"
          onClick={() => setSuggestionsOpen((open) => !open)}
        >
          {suggestionsOpen ? "候補を閉じる" : "処方から取り込み"}
        </button>
        {suggestionsOpen && (
          <div className="micro-order__suggest">
            <ErrorBanner error={suggestions.error} />
            {suggestions.isLoading ? (
              <p className="order-select__muted">処方を確認中...</p>
            ) : (
              <ul className="order-select__search-list">
                {suggestions.data?.map((suggestion) => (
                  <li key={suggestion.label}>
                    <button
                      type="button"
                      className="micro-order__suggest-item"
                      onClick={() => appendAntimicrobial(suggestion.label)}
                    >
                      {suggestion.label}
                    </button>
                  </li>
                ))}
                {suggestions.data && suggestions.data.length === 0 && (
                  <li className="order-select__muted">直近の処方・注射に抗菌薬がありません</li>
                )}
              </ul>
            )}
          </div>
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
