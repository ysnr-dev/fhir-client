import { makeFieldUpdater } from "../lib/form";
import { lazy, Suspense, useState, type FormEvent, type KeyboardEvent } from "react";
import { fetchSchema } from "../api/masterClient";
import { useFrequentPathoOrgans, usePathoCollectionMethods } from "../api/masterQueries";
import { refreshProblemDisplay } from "../fhir/conditionHelpers";
import {
  EXAM_CATEGORY_OPTIONS,
  LATERALITY_OPTIONS,
  PRIORITY_OPTIONS,
  defaultSpecimenTypeFor,
  emptyPathoOrderForm,
  emptyPathoSpecimen,
  isCytologyCategory,
  specimenTypeOptionsFor,
  type PathoExamCategory,
  type PathoOrderFormValues,
  pathoSchemaImageRefs,
  type PathoOrderPriority,
  type PathoSpecimenValues,
} from "../fhir/pathoOrderHelpers";
import { SETTING_OPTIONS, type PrescriptionSetting } from "../fhir/prescriptionHelpers";
import {
  questionnaireResponsePlainText,
  type TemplateBinding,
} from "../fhir/questionnaireResponseHelpers";
import { useProblemOptions } from "../hooks/useProblemOptions";
import { ErrorBanner } from "./ErrorBanner";
import { PathoOrganSearchModal } from "./PathoOrganSearchModal";
import { ProblemSelect } from "./ProblemSelect";
import { SchemaImageGallery, TemplateSchemaImages } from "./SchemaImageGallery";
import { SchemaPickerModal } from "./SchemaPickerModal";
import { TemplateEntryModal } from "./TemplateEntryModal";

// ペイントモーダル(fabric.js)は重いので、開くまで読み込まない(診療記録と同じ)。
const SchemaPaintModal = lazy(() => import("./SchemaPaintModal"));

// 病理検査オーダーの入力フォーム。
//
// 細菌検査と違い、検体は 1 オーダーに複数持てる可変リストにする。多部位の生検
// (胃前庭部と胃体部を別容器で提出する、など)が病理では普通で、それを 1 件の依頼として
// 出すため(docs/patho-order-design.md §5.1)。
//
// 検査区分(組織診 / 細胞診 / 術中迅速)は 1 オーダーに 1 つ。区分を変えると
// 選べる検体タイプが変わるので、既に入れた検体の検体タイプもその場で補正する。
// 術中迅速は手術室で結果を待つ検査なので、選ぶと至急区分を自動で「至急」にし、
// 手術室番号の欄を出す。
//
// 臨床経過・所見はテンプレート(Questionnaire)からも書ける。放射線・手術と同じ作りで、
// 記入内容の正本は QuestionnaireResponse、欄に出るのはその平文の写し。
//
// シェーマ(JAHIS AP-031)はシェーママスタの臓器図を台紙に選んで描く。病理は
// オーダーごとに臓器が変わるため、テンプレートに台紙を固定する持ち方ではなく
// 診療記録と同じ「マスタから台紙を選ぶ」方式にしている。

interface PathoOrderFormProps {
  patientId: string;
  initialValues?: PathoOrderFormValues;
  onSubmit: (values: PathoOrderFormValues) => void;
  submitting: boolean;
  submitError?: unknown;
  submitLabel?: string;
}

export function PathoOrderForm({
  patientId,
  initialValues,
  onSubmit,
  submitting,
  submitError,
  submitLabel = "登録",
}: PathoOrderFormProps) {
  const [values, setValues] = useState<PathoOrderFormValues>(
    initialValues ?? emptyPathoOrderForm(),
  );
  const [validationError, setValidationError] = useState<string | null>(null);
  const [commentOpen, setCommentOpen] = useState(Boolean(initialValues?.comment));
  const [templateOpen, setTemplateOpen] = useState(false);
  // シェーマ: 台紙をマスタから選ぶ → その台紙を背景にペイントする、の 2 段。
  const [schemaPickOpen, setSchemaPickOpen] = useState(false);
  const [schemaPaint, setSchemaPaint] = useState<{ name: string; background: string } | null>(null);

  const problemOptions = useProblemOptions(patientId);
  const methods = usePathoCollectionMethods();

  const update = makeFieldUpdater(setValues);
  const isCytology = isCytologyCategory(values.examCategory);
  const isFrozenSection = values.examCategory === "N003";

  function updateSpecimen(index: number, patch: Partial<PathoSpecimenValues>) {
    setValues((v) => ({
      ...v,
      specimens: v.specimens.map((specimen, i) =>
        i === index ? { ...specimen, ...patch } : specimen,
      ),
    }));
  }

  function addSpecimen() {
    setValues((v) => ({
      ...v,
      specimens: [...v.specimens, emptyPathoSpecimen(v.examCategory)],
    }));
  }

  function removeSpecimen(index: number) {
    setValues((v) => ({
      ...v,
      // 検体が 0 件のオーダーは意味を成さないので、最後の 1 件は消させない。
      specimens: v.specimens.length <= 1 ? v.specimens : v.specimens.filter((_, i) => i !== index),
    }));
  }

  function handleExamCategoryChange(code: PathoExamCategory) {
    setValues((v) => {
      const allowed = specimenTypeOptionsFor(code);
      const fallback = defaultSpecimenTypeFor(code);
      return {
        ...v,
        examCategory: code,
        // 術中迅速は結果を待つ検査なので既定で至急にする(手で戻せる)。
        priority: code === "N003" ? "urgent" : v.priority,
        // 術中迅速から離れたら手術室番号は不要になる。
        operatingRoom: code === "N003" ? v.operatingRoom : "",
        // 区分に合わない検体タイプ(組織診の「生検」で細胞診に切り替えた等)を補正する。
        specimens: v.specimens.map((specimen) =>
          allowed.some((o) => o.code === specimen.typeCode)
            ? specimen
            : { ...specimen, typeCode: fallback.code, typeName: fallback.display },
        ),
      };
    });
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!values.authoredDate) {
      setValidationError("依頼日を入力してください。");
      return;
    }
    if (!values.collectionDateTime) {
      setValidationError("採取(予定)日時を入力してください。");
      return;
    }
    const missing = values.specimens.findIndex((specimen) => !specimen.organCode);
    if (missing >= 0) {
      setValidationError(`検体${missing + 1}の臓器・検査材料を選択してください。`);
      return;
    }
    setValidationError(null);
    onSubmit({ ...values, problem: refreshProblemDisplay(values.problem, problemOptions) });
  }

  // シェーマ選択 → 台紙(image)を取得してペイントへ進む(診療記録と同じ流れ)。
  async function pickSchema(schemaId: number) {
    try {
      const detail = await fetchSchema(schemaId);
      setSchemaPaint({ name: detail.name, background: detail.image });
      setSchemaPickOpen(false);
    } catch (e) {
      setValidationError(e instanceof Error ? e.message : "シェーマを取得できませんでした。");
    }
  }

  // ペイント完了。描いたばかりの画像は Binary がまだ無いので dataURL のまま持ち、
  // 登録時にオーダーと同じ transaction で Binary にする。
  function addSchema(dataUrl: string) {
    if (!schemaPaint) return;
    setValues((v) => ({
      ...v,
      schemas: [...v.schemas, { binaryId: "", dataUrl, name: schemaPaint.name }],
    }));
    setSchemaPaint(null);
  }

  function removeSchema(index: number) {
    setValues((v) => ({ ...v, schemas: v.schemas.filter((_, i) => i !== index) }));
  }

  function handleKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    // input 上での Enter による暗黙の form submit を抑止する(他オーダーと同じ)。
    if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
      e.preventDefault();
    }
  }

  return (
    <>
      <form className="prescription-form" onSubmit={handleSubmit} onKeyDown={handleKeyDown}>
      {validationError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}
      <ErrorBanner error={submitError} />
      <ErrorBanner error={methods.error} />

      <fieldset>
        <legend>検査共通</legend>
        <label>
          検査区分 *
          <select
            value={values.examCategory}
            onChange={(e) => handleExamCategoryChange(e.target.value as PathoExamCategory)}
          >
            {EXAM_CATEGORY_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.display}
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
            onChange={(e) => update("priority", e.target.value as PathoOrderPriority)}
          >
            {PRIORITY_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.display}
              </option>
            ))}
          </select>
        </label>
        <label>
          依頼日
          <input
            type="date"
            value={values.authoredDate}
            onChange={(e) => update("authoredDate", e.target.value)}
          />
        </label>
        <label>
          採取(予定)日時 *
          <input
            type="datetime-local"
            value={values.collectionDateTime}
            onChange={(e) => update("collectionDateTime", e.target.value)}
          />
        </label>
        <label>
          報告希望日
          <input
            type="date"
            value={values.reportDueDate}
            onChange={(e) => update("reportDueDate", e.target.value)}
          />
        </label>
        {isFrozenSection && (
          <label>
            手術室番号
            <input
              type="text"
              value={values.operatingRoom}
              onChange={(e) => update("operatingRoom", e.target.value)}
            />
          </label>
        )}
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
            <button
              type="button"
              className="comment-add-button"
              onClick={() => setCommentOpen(true)}
            >
              ＋依頼コメント
            </button>
          </div>
        )}
      </fieldset>

      <fieldset>
        <legend>検体 *</legend>
        <ul className="patho-order__specimens">
          {values.specimens.map((specimen, index) => (
            <SpecimenCard
              // 検体は並べ替えず、追加・削除しかしないので index を鍵にしてよい。
              key={index}
              index={index}
              specimen={specimen}
              examCategory={values.examCategory}
              methods={methods.data?.items ?? []}
              removable={values.specimens.length > 1}
              onChange={(patch) => updateSpecimen(index, patch)}
              onRemove={() => removeSpecimen(index)}
            />
          ))}
        </ul>
        <div className="patho-order__specimen-add">
          <button type="button" className="comment-add-button" onClick={addSpecimen}>
            ＋検体を追加
          </button>
        </div>
      </fieldset>

      <fieldset>
        <legend>臨床情報</legend>
        <TemplateTextField
          label="臨床経過・所見"
          value={values.clinicalInfo}
          template={values.clinicalInfoTemplate}
          placeholder={
            isCytology
              ? "月経周期・ホルモン療法など、判定に関わる情報"
              : "現病歴・治療歴・内視鏡所見など、診断に関わる情報"
          }
          onChange={(clinicalInfo) => update("clinicalInfo", clinicalInfo)}
          onOpenTemplate={() => setTemplateOpen(true)}
          onClearTemplate={() => update("clinicalInfoTemplate", null)}
        />
      </fieldset>

      <fieldset>
        <legend>シェーマ</legend>
        <div className="patho-order__schemas">
          {values.schemas.length > 0 && (
            <SchemaImageGallery refs={pathoSchemaImageRefs(values.schemas)} />
          )}
          <div className="patho-order__schema-actions">
            <button type="button" onClick={() => setSchemaPickOpen(true)}>
              ＋シェーマを追加
            </button>
            {values.schemas.map((schema, index) => (
              <button
                key={index}
                type="button"
                onClick={() => removeSchema(index)}
                title={`${schema.name || "シェーマ"}を外す`}
              >
                {`${index + 1}枚目を外す`}
              </button>
            ))}
          </div>
        </div>
      </fieldset>

      <div className="prescription-form__submit">
        <button type="submit" disabled={submitting}>
          {submitting ? "送信中..." : submitLabel}
        </button>
      </div>
      </form>

      {/* 各モーダルは独自の入力を持つため、外側フォームの子孫に置かない
          (form の入れ子は不正で、送信が外へ漏れる)。 */}
      {templateOpen && (
        <TemplateEntryModal
          patientId={patientId}
          draft={values.clinicalInfoTemplate?.draft ?? null}
          responseId={values.clinicalInfoTemplate?.responseId ?? null}
          onSubmit={(draft) => {
            // 保存済みの回答を再編集した場合は同じ id へ書き戻す(id は保存時に使う)。
            const binding: TemplateBinding = {
              responseId: values.clinicalInfoTemplate?.responseId ?? null,
              draft,
            };
            setValues((current) => ({
              ...current,
              clinicalInfo: questionnaireResponsePlainText(draft.questionnaire, draft.response),
              clinicalInfoTemplate: binding,
            }));
            setTemplateOpen(false);
          }}
          onClose={() => setTemplateOpen(false)}
        />
      )}

      {schemaPickOpen && (
        <SchemaPickerModal
          onSelect={(schemaId) => void pickSchema(schemaId)}
          onClose={() => setSchemaPickOpen(false)}
        />
      )}
      {schemaPaint && (
        <Suspense fallback={null}>
          <SchemaPaintModal
            title={`シェーマ: ${schemaPaint.name}`}
            backgroundDataUrl={schemaPaint.background}
            saveLabel="オーダーに添付"
            onSave={addSchema}
            onClose={() => setSchemaPaint(null)}
          />
        </Suspense>
      )}
    </>
  );
}

// テンプレートから書ける自由文の欄。放射線・手術と同じ作りで、テンプレート紐付き中は
// 直接編集させない(回答と本文が食い違うため)。「解除」は紐付けだけ外し、文言は残す。
function TemplateTextField({
  label,
  value,
  template,
  placeholder,
  onChange,
  onOpenTemplate,
  onClearTemplate,
}: {
  label: string;
  value: string;
  template: TemplateBinding | null;
  placeholder?: string;
  onChange: (value: string) => void;
  onOpenTemplate: () => void;
  onClearTemplate: () => void;
}) {
  const fromTemplate = Boolean(template);

  return (
    <>
      {/* 親の fieldset は flex なので、明示しないと欄が内容幅で止まる。 */}
      <div className="rad-gp__template-field patho-long-text">
        <textarea
          rows={4}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          readOnly={fromTemplate}
          aria-label={label}
          placeholder={fromTemplate ? undefined : placeholder}
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

// 検体 1 件ぶんの入力。臓器は頻用臓器のボタンと検索モーダルの 2 通りで選ぶ
// (LPATHO003 は約 530 件あり、セレクトで全件を並べると探せないため)。
function SpecimenCard({
  index,
  specimen,
  examCategory,
  methods,
  removable,
  onChange,
  onRemove,
}: {
  index: number;
  specimen: PathoSpecimenValues;
  examCategory: string;
  methods: { code: string; name: string }[];
  removable: boolean;
  onChange: (patch: Partial<PathoSpecimenValues>) => void;
  onRemove: () => void;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const frequent = useFrequentPathoOrgans();
  const typeOptions = specimenTypeOptionsFor(examCategory);

  return (
    <li className="patho-order__specimen">
      <div className="patho-order__specimen-head">
        <span className="patho-order__specimen-number">検体{index + 1}</span>
        {removable && (
          <button
            type="button"
            className="rp-card__icon-button"
            title="この検体を削除"
            aria-label={`検体${index + 1}を削除`}
            onClick={onRemove}
          >
            ×
          </button>
        )}
      </div>

      {/* 臓器の検索欄と頻用ボタンはひと組。横並びにしても離れないよう同じ入れ物に置く。 */}
      <div className="patho-order__organ-group">
        <label>
          臓器・検査材料 *
          <div className="patho-order__organ">
            <input
              type="text"
              readOnly
              value={specimen.organName}
              placeholder="未選択"
              aria-label={`検体${index + 1}の臓器・検査材料`}
            />
            <button type="button" onClick={() => setSearchOpen(true)}>
              検索
            </button>
          </div>
        </label>

        {/* 頻用臓器(マスタで frequent を付けたもの)は検索せずに押して選べる。 */}
        {(frequent.data?.items.length ?? 0) > 0 && (
          <ul className="patho-order__frequent">
            {frequent.data?.items.map((organ) => (
              <li key={organ.code}>
                <button
                  type="button"
                  className={
                    specimen.organCode === organ.code
                      ? "patho-order__frequent-button patho-order__frequent-button--selected"
                      : "patho-order__frequent-button"
                  }
                  onClick={() => onChange({ organCode: organ.code, organName: organ.name })}
                >
                  {organ.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <label>
        検体タイプ
        <select
          value={specimen.typeCode}
          onChange={(e) => {
            const option = typeOptions.find((o) => o.code === e.target.value);
            onChange({ typeCode: e.target.value, typeName: option?.display ?? "" });
          }}
        >
          {typeOptions.map((o) => (
            <option key={o.code} value={o.code}>
              {o.display}
            </option>
          ))}
        </select>
      </label>

      <label>
        左右
        <select
          value={specimen.lateralityCode}
          onChange={(e) => onChange({ lateralityCode: e.target.value })}
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
        採取法
        <select
          value={specimen.methodCode}
          onChange={(e) => {
            const method = methods.find((m) => m.code === e.target.value);
            onChange({ methodCode: e.target.value, methodName: method?.name ?? "" });
          }}
        >
          <option value="">選択してください</option>
          {methods.map((method) => (
            <option key={method.code} value={method.code}>
              {method.name}
            </option>
          ))}
        </select>
      </label>

      <label className="patho-order__note">
        補足(部位の詳細・肉眼的性状)
        <input
          type="text"
          value={specimen.note}
          onChange={(e) => onChange({ note: e.target.value })}
        />
      </label>

      {searchOpen && (
        <PathoOrganSearchModal
          onSelect={(organ) => {
            onChange({ organCode: organ.code, organName: organ.name });
            setSearchOpen(false);
          }}
          onClose={() => setSearchOpen(false)}
        />
      )}
    </li>
  );
}
