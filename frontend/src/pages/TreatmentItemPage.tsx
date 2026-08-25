import { useEffect, useState, type FormEvent } from "react";
import type { TreatmentItemDetail, TreatmentItemPayload } from "../api/masterClient";
import {
  useTreatmentDatasetOptions,
  useTreatmentItem,
  useTreatmentItemMutations,
  useTreatmentItemSearch,
  useTreatmentSetItemMutations,
  type TreatmentItemFilters,
} from "../api/masterQueries";
import { useScheduleOptions } from "../api/queries";
import { scheduleSummary } from "../fhir/scheduleHelpers";
import { ErrorBanner } from "../components/ErrorBanner";
import { MedicalProcedureSearchModal } from "../components/MedicalProcedureSearchModal";
import { Modal } from "../components/Modal";
import { TreatmentItemSearchModal } from "../components/TreatmentItemSearchModal";
import { KIND_LABELS } from "../components/treatmentItemOptions";

// 処置オーダー項目マスタ。生理検査の PhysioItemPage と同じ作りだが、分類軸
// (検査種別)と検査目的・特別指示の既定テンプレートは持たない。

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

// 編集フォームの値。input で扱うため全て文字列で持ち、保存時に payload へ変換する。
interface Draft {
  item_code: string;
  name: string;
  short_name: string;
  name_kana: string;
  kind: string;
  // 他の処置項目と同じオーダーにまとめられるか。false は単独オーダー。
  groupable: boolean;
  valid_from: string;
  valid_to: string;
  receipt_code: string;
  display_order: string;
  note: string;
  // 実施入力をする項目か。false なら一覧の「実施」でそのまま実施済にする。
  requires_perform_input: boolean;
  // 実施入力の初期明細になるデータセット。1項目1つ。
  dataset_code: string;
  // 予約必須の項目か。true なら処置予約を押さえてからオーダーする(必ず単独)。
  requires_appointment: boolean;
  // 所要時間(分)。予約で消費する枠数の計算に使う。
  duration_minutes: string;
  // 予約を取る先の枠表(FHIR Schedule の id)。予約必須の項目だけが持つ。
  appointment_schedule_id: string;
}

const emptyDraft: Draft = {
  item_code: "",
  name: "",
  short_name: "",
  name_kana: "",
  kind: "single",
  groupable: true,
  valid_from: "",
  valid_to: "",
  receipt_code: "",
  display_order: "",
  note: "",
  requires_perform_input: true,
  dataset_code: "",
  requires_appointment: false,
  duration_minutes: "",
  appointment_schedule_id: "",
};

function toPayload(draft: Draft): TreatmentItemPayload {
  return {
    item_code: draft.item_code,
    name: draft.name,
    short_name: draft.short_name || null,
    name_kana: draft.name_kana || null,
    kind: draft.kind,
    groupable: draft.groupable,
    valid_from: draft.valid_from || null,
    valid_to: draft.valid_to || null,
    receipt_code: draft.receipt_code || null,
    display_order: draft.display_order ? Number(draft.display_order) : null,
    note: draft.note || null,
    requires_perform_input: draft.requires_perform_input,
    // 実施入力をしない項目は初期明細も持たない。
    dataset_code: (draft.requires_perform_input && draft.dataset_code) || null,
    requires_appointment: draft.requires_appointment,
    duration_minutes: draft.duration_minutes ? Number(draft.duration_minutes) : null,
    // 予約枠の紐づけは予約必須の項目だけが持つ(backend 側でも同じ規則で落とす)。
    appointment_schedule_id:
      (draft.requires_appointment && draft.appointment_schedule_id) || null,
  };
}

export function TreatmentItemPage() {
  const [inputs, setInputs] = useState<TreatmentItemFilters>({});
  const [filters, setFilters] = useState<TreatmentItemFilters>({});
  const [page, setPage] = useState(1);
  // 編集対象の id。"new" は新規作成モーダル。
  const [editing, setEditing] = useState<number | "new" | null>(null);

  const list = useTreatmentItemSearch(filters, page);

  const hasNext = list.data ? page * list.data.per < list.data.total : false;

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    setFilters(inputs);
    setPage(1);
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>処置オーダー項目マスタ</h1>
        <div className="page__header-actions">
          <button type="button" onClick={() => setEditing("new")}>
            項目を追加
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
          区分
          <select
            value={inputs.kind ?? ""}
            onChange={(e) => setInputs({ ...inputs, kind: e.target.value })}
          >
            <option value="">すべて</option>
            <option value="single">単項目</option>
            <option value="set">セット</option>
          </select>
        </label>
        <label>
          オーダー単位
          <select
            value={inputs.groupable ?? ""}
            onChange={(e) => setInputs({ ...inputs, groupable: e.target.value })}
          >
            <option value="">すべて</option>
            <option value="true">グループ化</option>
            <option value="false">単独</option>
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

      <ErrorBanner error={list.error} />

      <table className="master-search__table">
        <thead>
          <tr>
            <th>コード</th>
            <th>名称</th>
            <th>略称</th>
            <th className="rad-item__compact">区分</th>
            <th>レセ電算</th>
            <th className="rad-item__compact">有効期間</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((item) => (
            <tr key={item.id} onClick={() => setEditing(item.id)} className="master-search__row">
              <td>{item.item_code}</td>
              <td>{item.name}</td>
              <td>{item.short_name}</td>
              <td className="rad-item__compact">
                {KIND_LABELS[item.kind] ?? item.kind}
                {/* 単独オーダーは 1 オーダー 1 処置項目になる。既定(グループ化)は
                    印を出さず、例外だけを目立たせる。予約必須も同じ扱い。 */}
                {!item.groupable && <span className="dose-conversion__badge">単独</span>}
                {item.requires_appointment && (
                  <span className="dose-conversion__badge">予約</span>
                )}
              </td>
              <td>{item.receipt_procedure_name ?? item.receipt_code}</td>
              <td className="rad-item__compact">
                {(item.valid_from || item.valid_to) &&
                  `${item.valid_from ?? ""}〜${item.valid_to ?? ""}`}
              </td>
            </tr>
          ))}
          {list.data && list.data.items.length === 0 && (
            <tr>
              <td colSpan={6} className="master-search__empty">
                処置オーダー項目がありません
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
  const detail = useTreatmentItem(itemId);
  const mutations = useTreatmentItemMutations();
  // 予約必須の項目に紐づける枠表の候補。処置予約の枠表だけを出す。
  const { schedules: examSchedules } = useScheduleOptions({ scheduleType: "exam" });
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
      kind: d.kind,
      groupable: d.groupable,
      valid_from: d.valid_from ?? "",
      valid_to: d.valid_to ?? "",
      receipt_code: d.receipt_code ?? "",
      display_order: d.display_order === null ? "" : String(d.display_order),
      note: d.note ?? "",
      requires_perform_input: d.requires_perform_input,
      dataset_code: d.dataset_code ?? "",
      requires_appointment: d.requires_appointment,
      duration_minutes: d.duration_minutes === null ? "" : String(d.duration_minutes),
      appointment_schedule_id: d.appointment_schedule_id ?? "",
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
    const message =
      detail.data.kind === "set"
        ? `${detail.data.name} を削除しますか？（セット構成も削除されます）`
        : `${detail.data.name} を削除しますか？`;
    if (!window.confirm(message)) return;

    await mutations.remove.mutateAsync(itemId);
    onClose();
  }

  const saving = mutations.create.isPending || mutations.update.isPending;
  const isSet = draft.kind === "set";

  return (
    <Modal
      title={itemId === null ? "処置オーダー項目を追加" : "処置オーダー項目を編集"}
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
          <label>
            区分
            <select
              value={draft.kind}
              onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
            >
              <option value="single">単項目</option>
              <option value="set">セット</option>
            </select>
          </label>
          {/* 人工透析など 1 件に時間を要する項目は、処置室の枠を 1 件ずつ押さえる
              必要があるため単独にする。オーダー画面では他の項目と一緒に選べるが、
              登録時にこの項目だけの別オーダーへ分けられる。
              予約必須の項目は予約(枠)ごとにオーダーが立つので単独に固定する。 */}
          <label>
            オーダー単位
            <select
              value={draft.groupable ? "true" : "false"}
              onChange={(e) => setDraft({ ...draft, groupable: e.target.value === "true" })}
              disabled={draft.requires_appointment}
            >
              <option value="true">グループ化(他の項目と同一オーダー可)</option>
              <option value="false">単独(1オーダー1処置項目)</option>
            </select>
          </label>
          <label>
            予約
            <select
              value={draft.requires_appointment ? "true" : "false"}
              onChange={(e) => {
                const requiresAppointment = e.target.value === "true";
                // 予約必須は必ず単独オーダー(backend でも検証される)。
                setDraft({
                  ...draft,
                  requires_appointment: requiresAppointment,
                  groupable: requiresAppointment ? false : draft.groupable,
                });
              }}
            >
              <option value="false">不要</option>
              <option value="true">必須</option>
            </select>
          </label>
          <label>
            所要時間(分)
            <input
              type="number"
              min={1}
              step={1}
              value={draft.duration_minutes}
              onChange={(e) => setDraft({ ...draft, duration_minutes: e.target.value })}
              placeholder="未設定は1枠"
            />
          </label>
          {/* 予約を取る先の枠表。人工透析の項目なら透析室の枠、のように紐づけておくと、
              オーダー画面の予約モーダルでその枠表が最初から選ばれる。 */}
          <label>
            予約枠
            <select
              value={draft.requires_appointment ? draft.appointment_schedule_id : ""}
              onChange={(e) => setDraft({ ...draft, appointment_schedule_id: e.target.value })}
              disabled={!draft.requires_appointment}
            >
              <option value="">未指定(オーダー時に選ぶ)</option>
              {examSchedules.map((schedule) => (
                <option key={schedule.id} value={schedule.id}>
                  {scheduleSummary(schedule)}
                </option>
              ))}
            </select>
          </label>
        </div>

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
          {/* 処置には頻用コード表のような初期データ源が無く、項目は 1 件ずつ
              手で作る。レセ電算コードだけは医科診療行為マスタから選べるようにして
              打ち間違いを減らす(直接入力もできる)。 */}
          <label>
            レセ電算コード
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
        <p className="rad-code__summary">
          {receiptName ? `診療行為: ${receiptName}` : "レセ電算コードは「医科診療行為から選択」でも入れられます。"}
        </p>

        {/* 実施入力をしない項目(とるだけのもの)は、一覧の「実施」で
            そのまま実施済になる。初期明細も持たないのでデータセットは選べない。 */}
        <div className="lab-order-item__fields">
          <label>
            実施入力有無
            <select
              value={draft.requires_perform_input ? "true" : "false"}
              onChange={(e) =>
                setDraft({ ...draft, requires_perform_input: e.target.value === "true" })
              }
            >
              <option value="true">あり</option>
              <option value="false">なし</option>
            </select>
          </label>
          <DatasetSelect
            value={draft.requires_perform_input ? draft.dataset_code : ""}
            savedName={detail.data?.dataset_name ?? null}
            disabled={!draft.requires_perform_input}
            onChange={(dataset_code) => setDraft((prev) => ({ ...prev, dataset_code }))}
          />
        </div>

        {isSet && (
          <p className="rad-code__summary">
            セットは処置そのものではありません。構成する単項目を下で登録してください。
          </p>
        )}

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

      {itemId !== null && isSet && detail.data && (
        <SetItemsEditor setItemCode={detail.data.item_code} setItems={detail.data.set_items} />
      )}

      {searchingProcedure && (
        <MedicalProcedureSearchModal
          defaultSection="J"
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

// 実施入力の初期明細になるデータセット。1項目に1つで、実施入力モーダルは
// オーダーに載っている処置項目のデータセットの明細をまとめて初期表示する。
function DatasetSelect({
  value,
  savedName,
  disabled,
  onChange,
}: {
  value: string;
  /** 保存済みの選択に対する名称。運用期間切れなどで候補に出ないときの表示に使う。 */
  savedName: string | null;
  disabled: boolean;
  onChange: (datasetCode: string) => void;
}) {
  const datasets = useTreatmentDatasetOptions();
  const options = datasets.data?.items ?? [];
  const missing = value && !options.some((dataset) => dataset.dataset_code === value);

  return (
    <label>
      実施入力データセット
      <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <option value="">なし</option>
        {missing && (
          <option value={value}>
            {savedName ?? value}({value})
          </option>
        )}
        {options.map((dataset) => (
          <option key={dataset.id} value={dataset.dataset_code}>
            {dataset.name}({dataset.dataset_code})
          </option>
        ))}
      </select>
    </label>
  );
}

interface SetItemsEditorProps {
  setItemCode: string;
  setItems: TreatmentItemDetail["set_items"];
}

function SetItemsEditor({ setItemCode, setItems }: SetItemsEditorProps) {
  const mutations = useTreatmentSetItemMutations();
  const [adding, setAdding] = useState(false);
  // 目当ての項目が分かっているときはその場で足せるよう、打った語を名称・略称・カナの
  // どちらにも当てる。一覧を見ながら探すときは「項目を追加」の検索モーダルを使う。
  const [query, setQuery] = useState("");
  const searching = query.trim().length > 0;
  const candidates = useTreatmentItemSearch({ keyword: query }, 1, searching);

  // 自分自身と既に入っている項目は選べない(モーダル側で印を付ける)。
  const excludeCodes = [setItemCode, ...setItems.map((m) => m.member_item_code)];
  const excluded = new Set(excludeCodes);

  async function handleAdd(memberItemCode: string) {
    setAdding(false);
    setQuery("");
    await mutations.create.mutateAsync({
      set_item_code: setItemCode,
      member_item_code: memberItemCode,
    });
  }

  return (
    <section className="lab-order-item__section">
      <div className="lab-order-item__section-head">
        <h3>セット構成</h3>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="名称・略称・カナで検索"
        />
        <button type="button" onClick={() => setAdding(true)}>
          項目を追加
        </button>
      </div>

      {searching && (
        <ul className="lab-order-item__candidates">
          {candidates.data?.items
            .filter((item) => !excluded.has(item.item_code))
            .map((item) => (
              <li key={item.id}>
                <button type="button" onClick={() => handleAdd(item.item_code)}>
                  {item.name}
                  <span className="lab-order-item__code">{item.item_code}</span>
                </button>
              </li>
            ))}
        </ul>
      )}

      <ErrorBanner error={mutations.create.error ?? mutations.remove.error} />

      <div className="lab-order-item__table-wrap">
        <table className="master-search__table">
          <thead>
            <tr>
              <th>構成項目</th>
              <th>コード</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {setItems.map((member) => (
              <tr key={member.id}>
                <td>{member.member_name ?? member.member_item_code}</td>
                <td>{member.member_item_code}</td>
                <td className="master-search__actions">
                  <button
                    type="button"
                    className="rp-card__icon-button"
                    title="外す"
                    aria-label="外す"
                    onClick={() => mutations.remove.mutate(member.id)}
                  >
                    <TrashIcon />
                  </button>
                </td>
              </tr>
            ))}
            {setItems.length === 0 && (
              <tr>
                <td colSpan={3} className="master-search__empty">
                  構成項目がありません。名称で検索するか「項目を追加」から選んでください。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {adding && (
        <TreatmentItemSearchModal
          title="セットに追加する項目を選択"
          excludeCodes={excludeCodes}
          onSelect={(item) => handleAdd(item.item_code)}
          onClose={() => setAdding(false)}
        />
      )}
    </section>
  );
}
