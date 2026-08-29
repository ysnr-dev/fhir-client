import { useEffect, useState, type FormEvent } from "react";
import type { SurgeryItemPayload } from "../api/masterClient";
import {
  useSurgeryCategoryOptions,
  useSurgeryItem,
  useSurgeryItemMutations,
  useSurgeryItemSearch,
  type SurgeryItemFilters,
} from "../api/masterQueries";
import { ErrorBanner } from "../components/ErrorBanner";
import { MedicalProcedureSearchModal } from "../components/MedicalProcedureSearchModal";
import { Modal } from "../components/Modal";
import { TemplateSelect } from "../components/TemplateSelect";
import {
  renderSurgeryCategoryOptions,
  surgeryCategoryName,
  surgeryCategoryPathName,
} from "../components/surgeryCategoryOptions";
import { useQuestionnaireOptions } from "../api/queries";
import { questionnaireCanonical } from "../fhir/questionnaireResponseHelpers";
import {
  SURGERY_ANESTHESIA_METHOD_OPTIONS,
  SURGERY_APPROACH_OPTIONS,
  SURGERY_POSITION_OPTIONS,
  surgeryApproachDisplay,
} from "../fhir/surgeryOrderHelpers";

// 術式マスタ。処置の TreatmentItemPage と同じ作りだが、セット・レイアウト・
// データセット・予約の紐づけは持たず、代わりに申込フォームの初期値になる
// 既定値(所要時間・到達法・体位・麻酔方法)を持つ。
// レセ電算コードは点数表の K 章(手術)から選ぶ。

// 編集フォームの値。input で扱うため数値も文字列で持ち、保存時に payload へ変換する。
interface Draft {
  item_code: string;
  name: string;
  short_name: string;
  name_kana: string;
  valid_from: string;
  valid_to: string;
  receipt_code: string;
  category_code: string;
  default_duration_minutes: string;
  default_approach: string;
  default_position: string;
  // 麻酔方法の既定(複数可)。保存時にカンマ区切りへ畳む。
  default_anesthesia_methods: string[];
  requires_laterality: boolean;
  // 術前指示の既定テンプレート(Questionnaire の canonical)。未設定は空文字。
  preop_template_canonical: string;
  display_order: string;
  note: string;
}

const emptyDraft: Draft = {
  item_code: "",
  name: "",
  short_name: "",
  name_kana: "",
  valid_from: "",
  valid_to: "",
  receipt_code: "",
  category_code: "",
  default_duration_minutes: "",
  default_approach: "",
  default_position: "",
  default_anesthesia_methods: [],
  requires_laterality: false,
  preop_template_canonical: "",
  display_order: "",
  note: "",
};

function toPayload(draft: Draft): SurgeryItemPayload {
  return {
    item_code: draft.item_code,
    name: draft.name,
    short_name: draft.short_name || null,
    name_kana: draft.name_kana || null,
    valid_from: draft.valid_from || null,
    valid_to: draft.valid_to || null,
    receipt_code: draft.receipt_code || null,
    category_code: draft.category_code || null,
    default_duration_minutes: draft.default_duration_minutes
      ? Number(draft.default_duration_minutes)
      : null,
    default_approach: draft.default_approach || null,
    default_position: draft.default_position || null,
    default_anesthesia_methods: draft.default_anesthesia_methods.join(",") || null,
    requires_laterality: draft.requires_laterality,
    preop_template_canonical: draft.preop_template_canonical || null,
    display_order: draft.display_order ? Number(draft.display_order) : null,
    note: draft.note || null,
  };
}

export function SurgeryItemPage() {
  const [inputs, setInputs] = useState<SurgeryItemFilters>({});
  const [filters, setFilters] = useState<SurgeryItemFilters>({});
  const [page, setPage] = useState(1);
  // 編集対象の id。"new" は新規作成モーダル。
  const [editing, setEditing] = useState<number | "new" | null>(null);

  const list = useSurgeryItemSearch(filters, page);
  // 種別は名称を出すのと絞り込みの両方で使うので、木ごと全件を引いておく。
  const categories = useSurgeryCategoryOptions();
  const categoryItems = categories.data?.items ?? [];

  const hasNext = list.data ? page * list.data.per < list.data.total : false;

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    setFilters(inputs);
    setPage(1);
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>術式マスタ</h1>
        <div className="page__header-actions">
          <button type="button" onClick={() => setEditing("new")}>
            術式を追加
          </button>
        </div>
      </div>

      <form className="patient-search-form" onSubmit={handleSearch}>
        <label>
          名称・略称・カナ
          <input
            type="text"
            value={inputs.name ?? ""}
            onChange={(e) => setInputs({ ...inputs, name: e.target.value })}
          />
        </label>
        <label>
          種別
          {/* 上位の分類を選ぶと、配下の分類の術式もまとめて出る(絞り込みは
              サーバー側で配下を展開する)。 */}
          <select
            value={inputs.categoryCode ?? ""}
            onChange={(e) => setInputs({ ...inputs, categoryCode: e.target.value })}
          >
            <option value="">すべて</option>
            {renderSurgeryCategoryOptions(categoryItems)}
          </select>
        </label>
        <label className="dose-conversion__checkbox">
          <input
            type="checkbox"
            checked={inputs.active ?? false}
            onChange={(e) => setInputs({ ...inputs, active: e.target.checked })}
          />
          有効期間内のみ
        </label>
        <div className="patient-search-form__actions">
          <button type="submit">検索</button>
          <button
            type="button"
            onClick={() => {
              setInputs({});
              setFilters({});
              setPage(1);
            }}
          >
            クリア
          </button>
        </div>
      </form>

      <ErrorBanner error={list.error ?? categories.error} />

      <table className="master-search__table">
        <thead>
          <tr>
            <th>コード</th>
            <th>名称</th>
            <th>略称</th>
            <th>種別</th>
            <th>Kコード(レセ電算)</th>
            <th className="rad-item__compact">所要時間</th>
            <th className="rad-item__compact">到達法</th>
            <th className="rad-item__compact">有効期間</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((item) => (
            <tr key={item.id} onClick={() => setEditing(item.id)} className="master-search__row">
              <td>{item.item_code}</td>
              <td>{item.name}</td>
              <td>{item.short_name}</td>
              {/* 末端の分類名だけでは「胃、食道、腸、他」がどこの下か分からないので、
                  上位からの道筋を title に持たせる。 */}
              <td title={surgeryCategoryPathName(categoryItems, item.category_code)}>
                {surgeryCategoryName(categoryItems, item.category_code)}
              </td>
              <td>{item.receipt_procedure_name ?? item.receipt_code}</td>
              <td className="rad-item__compact">
                {item.default_duration_minutes != null && `${item.default_duration_minutes}分`}
              </td>
              <td className="rad-item__compact">
                {surgeryApproachDisplay(item.default_approach ?? "")}
                {/* 既定(任意)は印を出さず、例外の必須だけを目立たせる。 */}
                {item.requires_laterality && (
                  <span className="dose-conversion__badge">左右必須</span>
                )}
              </td>
              <td className="rad-item__compact">
                {(item.valid_from || item.valid_to) &&
                  `${item.valid_from ?? ""}〜${item.valid_to ?? ""}`}
              </td>
            </tr>
          ))}
          {list.data && list.data.items.length === 0 && (
            <tr>
              <td colSpan={8} className="master-search__empty">
                術式がありません
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="master-search__pager">
        <button
          type="button"
          onClick={() => setPage((p) => p - 1)}
          disabled={page <= 1 || list.isFetching}
        >
          前へ
        </button>
        <span>
          {page} ページ目 (全 {list.data?.total ?? 0} 件)
        </span>
        <button
          type="button"
          onClick={() => setPage((p) => p + 1)}
          disabled={!hasNext || list.isFetching}
        >
          次へ
        </button>
      </div>

      {editing !== null && (
        <ItemEditModal
          itemId={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

interface ItemEditModalProps {
  // null は新規作成。
  itemId: number | null;
  onClose: () => void;
}

function ItemEditModal({ itemId, onClose }: ItemEditModalProps) {
  const detail = useSurgeryItem(itemId);
  const mutations = useSurgeryItemMutations();
  const categories = useSurgeryCategoryOptions();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  // レセ電算コードを医科診療行為マスタから選ぶときの表示名。手入力なら空のまま。
  const [receiptName, setReceiptName] = useState("");
  const [searchingProcedure, setSearchingProcedure] = useState(false);

  useEffect(() => {
    if (!detail.data) return;
    const d = detail.data;
    setDraft({
      item_code: d.item_code,
      name: d.name,
      short_name: d.short_name ?? "",
      name_kana: d.name_kana ?? "",
      valid_from: d.valid_from ?? "",
      valid_to: d.valid_to ?? "",
      receipt_code: d.receipt_code ?? "",
      category_code: d.category_code ?? "",
      default_duration_minutes:
        d.default_duration_minutes === null ? "" : String(d.default_duration_minutes),
      default_approach: d.default_approach ?? "",
      default_position: d.default_position ?? "",
      default_anesthesia_methods: (d.default_anesthesia_methods ?? "")
        .split(",")
        .filter(Boolean),
      requires_laterality: d.requires_laterality,
      preop_template_canonical: d.preop_template_canonical ?? "",
      display_order: d.display_order === null ? "" : String(d.display_order),
      note: d.note ?? "",
    });
    setReceiptName(d.receipt_procedure_name ?? "");
  }, [detail.data]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft.name) return;

    const payload = toPayload(draft);
    if (itemId === null) {
      await mutations.create.mutateAsync(payload);
      onClose();
    } else {
      await mutations.update.mutateAsync({ id: itemId, payload });
    }
  }

  async function handleDelete() {
    if (itemId === null || !detail.data) return;
    if (!window.confirm(`${detail.data.name} を削除しますか？`)) return;

    await mutations.remove.mutateAsync(itemId);
    onClose();
  }

  function toggleAnesthesia(code: string) {
    setDraft((prev) => ({
      ...prev,
      default_anesthesia_methods: prev.default_anesthesia_methods.includes(code)
        ? prev.default_anesthesia_methods.filter((c) => c !== code)
        : [...prev.default_anesthesia_methods, code],
    }));
  }

  const saving = mutations.create.isPending || mutations.update.isPending;

  return (
    <Modal
      title={itemId === null ? "術式を追加" : "術式を編集"}
      onClose={onClose}
      className="modal--lab-order-item"
    >
      <form onSubmit={handleSubmit}>
        <div className="lab-order-item__fields">
          <label>
            項目コード
            <input
              type="text"
              value={draft.item_code}
              onChange={(e) => setDraft({ ...draft, item_code: e.target.value })}
              placeholder={itemId === null ? "空欄なら自動採番" : undefined}
              disabled={itemId !== null}
            />
          </label>
          <label>
            名称
            <input
              type="text"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              required
            />
          </label>
          <label>
            略称
            <input
              type="text"
              value={draft.short_name}
              onChange={(e) => setDraft({ ...draft, short_name: e.target.value })}
            />
          </label>
          <label>
            カナ(検索用)
            <input
              type="text"
              value={draft.name_kana}
              onChange={(e) => setDraft({ ...draft, name_kana: e.target.value })}
            />
          </label>
          {/* 種別は入れ子(点数表の「款 → 区分」)。どの段でも選べるが、ふつうは
              いちばん下の区分を選ぶ。 */}
          <label>
            種別
            <select
              value={draft.category_code}
              onChange={(e) => setDraft({ ...draft, category_code: e.target.value })}
            >
              <option value="">未分類</option>
              {renderSurgeryCategoryOptions(categories.data?.items ?? [])}
            </select>
          </label>
          {/* 術式には頻用コード表のような初期データ源が無く、項目は 1 件ずつ手で作る。
              K コードだけは医科診療行為マスタから選べるようにして打ち間違いを減らす
              (直接入力もできる)。 */}
          <label>
            Kコード(レセ電算)
            <input
              type="text"
              value={draft.receipt_code}
              onChange={(e) => {
                setDraft({ ...draft, receipt_code: e.target.value });
                // 手で書き換えたらマスタから引いた名称との対応は切れる。
                setReceiptName("");
              }}
            />
          </label>
        </div>
        <p className="rad-code__summary">
          {receiptName
            ? `診療行為: ${receiptName}`
            : "Kコードは「医科診療行為から選択」でも入れられます。"}
        </p>

        {/* 申込フォームの初期値。術式を選んだ時点でこれらが埋まり、申込時の入力を
            最小にする。申込側で個別に変えられるので、あくまで既定。 */}
        <div className="lab-order-item__fields">
          <label>
            既定の所要時間(分)
            <input
              type="number"
              min={1}
              step={1}
              value={draft.default_duration_minutes}
              onChange={(e) => setDraft({ ...draft, default_duration_minutes: e.target.value })}
            />
          </label>
          <label>
            既定の到達法
            <select
              value={draft.default_approach}
              onChange={(e) => setDraft({ ...draft, default_approach: e.target.value })}
            >
              <option value="">未指定</option>
              {SURGERY_APPROACH_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.display}
                </option>
              ))}
            </select>
          </label>
          <label>
            既定の体位
            <select
              value={draft.default_position}
              onChange={(e) => setDraft({ ...draft, default_position: e.target.value })}
            >
              <option value="">未指定</option>
              {SURGERY_POSITION_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.display}
                </option>
              ))}
            </select>
          </label>
          {/* 左右のある術式だけ印を付ける。申込画面はこの印を見て左右を必須にする。 */}
          <label>
            左右の指定
            <select
              value={draft.requires_laterality ? "true" : "false"}
              onChange={(e) =>
                setDraft({ ...draft, requires_laterality: e.target.value === "true" })
              }
            >
              <option value="false">任意</option>
              <option value="true">必須(左右のある術式)</option>
            </select>
          </label>
        </div>

        <fieldset className="lab-order-item__section">
          <legend>既定の麻酔方法(複数可)</legend>
          <div className="surgery-checkbox-row">
            {SURGERY_ANESTHESIA_METHOD_OPTIONS.map((option) => (
              <label key={option.code} className="dose-conversion__checkbox">
                <input
                  type="checkbox"
                  checked={draft.default_anesthesia_methods.includes(option.code)}
                  onChange={() => toggleAnesthesia(option.code)}
                />
                {option.display}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="lab-order-item__fields">
          <label>
            有効開始日
            <input
              type="date"
              value={draft.valid_from}
              onChange={(e) => setDraft({ ...draft, valid_from: e.target.value })}
            />
          </label>
          <label>
            有効終了日
            <input
              type="date"
              value={draft.valid_to}
              onChange={(e) => setDraft({ ...draft, valid_to: e.target.value })}
            />
          </label>
          <label>
            表示順
            <input
              type="number"
              value={draft.display_order}
              onChange={(e) => setDraft({ ...draft, display_order: e.target.value })}
            />
          </label>
          <label>
            備考
            <input
              type="text"
              value={draft.note}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            />
          </label>
        </div>

        <PreopTemplateDefault
          value={draft.preop_template_canonical}
          onChange={(preop_template_canonical) => setDraft({ ...draft, preop_template_canonical })}
        />

        <ErrorBanner error={detail.error} />
        <ErrorBanner
          error={mutations.create.error ?? mutations.update.error ?? mutations.remove.error}
        />

        <div className="lab-order-item__actions">
          <button type="submit" disabled={saving}>
            保存
          </button>
          <button type="button" onClick={() => setSearchingProcedure(true)}>
            医科診療行為から選択
          </button>
          {itemId !== null && (
            <button type="button" onClick={handleDelete} disabled={mutations.remove.isPending}>
              削除
            </button>
          )}
        </div>
      </form>

      {searchingProcedure && (
        <MedicalProcedureSearchModal
          defaultSection="K"
          onSelect={(procedure) => {
            setSearchingProcedure(false);
            setDraft((prev) => ({
              ...prev,
              receipt_code: procedure.procedure_code,
              // 名称が空のときだけ埋める(手で付けた名前を上書きしない)。
              name: prev.name || (procedure.name ?? ""),
            }));
            setReceiptName(procedure.name ?? "");
          }}
          onClose={() => setSearchingProcedure(false)}
        />
      )}
    </Modal>
  );
}

// 術前指示の既定テンプレート。術式ごとに決めておくもので、申込時に別のものへ変えられる
// (放射線・生理検査・内視鏡の「既定のテンプレート」と同じ扱い)。
//
// マスタは canonical("<url>|<version>")で持ち、TemplateSelect は Questionnaire.id で
// 扱うので相互に変換する。canonical で持つのは、テンプレートを作り直しても指し先が
// 変わらないようにするため。
function PreopTemplateDefault({
  value,
  onChange,
}: {
  value: string;
  onChange: (canonical: string) => void;
}) {
  const templates = useQuestionnaireOptions({ status: "active" });

  const selectedId =
    templates.questionnaires.find((q) => questionnaireCanonical(q) === value)?.id ?? "";

  return (
    <section className="lab-order-item__section lab-order-item__section--tail">
      <div className="lab-order-item__section-head">
        <h3>既定のテンプレート</h3>
      </div>
      <ErrorBanner error={templates.error} />
      <div className="rad-item__templates">
        <TemplateSelect
          label="術前指示"
          questionnaires={templates.questionnaires}
          value={selectedId}
          onChange={(id) => {
            const questionnaire = templates.questionnaires.find((q) => q.id === id);
            onChange(questionnaire ? questionnaireCanonical(questionnaire) : "");
          }}
        />
      </div>
    </section>
  );
}
