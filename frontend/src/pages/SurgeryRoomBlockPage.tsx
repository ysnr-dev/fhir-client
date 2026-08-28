import { useEffect, useState, type FormEvent } from "react";
import type { SurgeryRoomBlock, SurgeryRoomBlockPayload } from "../api/masterClient";
import { useSurgeryRoomBlockMutations, useSurgeryRoomBlockSearch } from "../api/masterQueries";
import { useLocationOptions, useSelfDepartments } from "../api/queries";
import { departmentCode, departmentDisplayName } from "../fhir/departmentHelpers";
import { locationDisplayName, locationTypeCode } from "../fhir/locationHelpers";
import { WEEKDAY_LABELS } from "../fhir/surgeryConflictHelpers";
import { ErrorBanner } from "../components/ErrorBanner";
import { Modal } from "../components/Modal";

// 手術室のブロックスケジュール(曜日ごとの科割り当て)のマスタ。
//
// 「月曜の第1手術室 9:00-12:00 は外科」という運用上の取り決めを登録しておくと、
// 手術室カレンダーの背景と、申込・日程確定での「割当外の科です」警告に出る。
// **登録を止めるものではない**(割当科が使わない枠を他科へ回す運用が、マスタを
// 触らずに回るようにするため。docs/surgery-calendar-design.md)。

interface Draft {
  location_id: string;
  location_name: string;
  weekday: string;
  start_time: string;
  end_time: string;
  department_code: string;
  department_name: string;
  valid_from: string;
  valid_to: string;
  note: string;
}

const emptyDraft: Draft = {
  location_id: "",
  location_name: "",
  weekday: "1",
  start_time: "09:00",
  end_time: "12:00",
  department_code: "",
  department_name: "",
  valid_from: "",
  valid_to: "",
  note: "",
};

function toPayload(draft: Draft): SurgeryRoomBlockPayload {
  return {
    location_id: draft.location_id,
    location_name: draft.location_name || null,
    weekday: Number(draft.weekday),
    start_time: draft.start_time,
    end_time: draft.end_time,
    department_code: draft.department_code,
    department_name: draft.department_name || null,
    valid_from: draft.valid_from || null,
    valid_to: draft.valid_to || null,
    note: draft.note || null,
  };
}

export function SurgeryRoomBlockPage() {
  const [locationId, setLocationId] = useState("");
  const [weekday, setWeekday] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<SurgeryRoomBlock | "new" | null>(null);

  const rooms = useSurgeryRooms();
  const list = useSurgeryRoomBlockSearch(
    { locationId, weekday: weekday === "" ? undefined : Number(weekday) },
    page,
  );
  const hasNext = list.data ? page * list.data.per < list.data.total : false;

  return (
    <div className="page">
      <div className="page__header">
        <h1>手術室 ブロックスケジュール</h1>
        <div className="page__header-actions">
          <button type="button" onClick={() => setEditing("new")}>
            割り当てを追加
          </button>
        </div>
      </div>

      <p className="rad-code__summary">
        曜日ごとの科割り当て。手術室カレンダーの背景と、申込・日程確定の警告に出ます。
        割当外の科でも登録は止めません(空いている枠を他科へ回す運用のため)。
      </p>

      {/* 絞り込みは即時反映。検索語を打つ欄が無いので送信ボタンは置かない。 */}
      <div className="patient-search-form">
        <label>
          手術室
          <select
            value={locationId}
            onChange={(e) => {
              setLocationId(e.target.value);
              setPage(1);
            }}
          >
            <option value="">すべて</option>
            {rooms.map((room) => (
              <option key={room.id} value={room.id}>
                {locationDisplayName(room)}
              </option>
            ))}
          </select>
        </label>
        <label>
          曜日
          <select
            value={weekday}
            onChange={(e) => {
              setWeekday(e.target.value);
              setPage(1);
            }}
          >
            <option value="">すべて</option>
            {WEEKDAY_LABELS.map((label, index) => (
              <option key={label} value={String(index)}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <ErrorBanner error={list.error} />

      <table className="master-search__table">
        <thead>
          <tr>
            <th>手術室</th>
            <th className="lab-order-item__compact">曜日</th>
            <th className="lab-order-item__compact">時間帯</th>
            <th>診療科</th>
            <th className="lab-order-item__compact">有効期間</th>
            <th>備考</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((block) => (
            <tr key={block.id} onClick={() => setEditing(block)} className="master-search__row">
              <td>{roomLabel(block, rooms)}</td>
              <td className="lab-order-item__compact">{WEEKDAY_LABELS[block.weekday] ?? ""}</td>
              <td className="lab-order-item__compact">
                {block.start_time}〜{block.end_time}
              </td>
              <td>{block.department_name || block.department_code}</td>
              <td className="lab-order-item__compact">
                {[block.valid_from, block.valid_to].some(Boolean)
                  ? `${block.valid_from ?? ""} 〜 ${block.valid_to ?? ""}`
                  : ""}
              </td>
              <td>{block.note}</td>
            </tr>
          ))}
          {list.data && list.data.items.length === 0 && (
            <tr>
              <td colSpan={6} className="master-search__empty">
                割り当てがありません
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
        <BlockEditModal
          block={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

/** 手術室(Location 種別 SU)。 */
function useSurgeryRooms() {
  const locations = useLocationOptions();
  return locations.locations.filter((location) => locationTypeCode(location) === "SU");
}

// 名称は登録時の写しを持っているが、Location 側で改名されていれば今の名前を出す。
function roomLabel(block: SurgeryRoomBlock, rooms: fhir4.Location[]): string {
  const room = rooms.find((location) => location.id === block.location_id);
  return room ? locationDisplayName(room) : block.location_name || block.location_id;
}

interface BlockEditModalProps {
  // null は新規作成。
  block: SurgeryRoomBlock | null;
  onClose: () => void;
}

function BlockEditModal({ block, onClose }: BlockEditModalProps) {
  const mutations = useSurgeryRoomBlockMutations();
  const rooms = useSurgeryRooms();
  const { departments } = useSelfDepartments();
  const [draft, setDraft] = useState<Draft>(emptyDraft);

  useEffect(() => {
    if (!block) return;
    setDraft({
      location_id: block.location_id,
      location_name: block.location_name ?? "",
      weekday: String(block.weekday),
      start_time: block.start_time,
      end_time: block.end_time,
      department_code: block.department_code,
      department_name: block.department_name ?? "",
      valid_from: block.valid_from ?? "",
      valid_to: block.valid_to ?? "",
      note: block.note ?? "",
    });
  }, [block]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft.location_id || !draft.department_code) return;

    if (block === null) {
      await mutations.create.mutateAsync(toPayload(draft));
    } else {
      await mutations.update.mutateAsync({ id: block.id, payload: toPayload(draft) });
    }
    onClose();
  }

  async function handleDelete() {
    if (block === null) return;
    if (!window.confirm("この割り当てを削除しますか？")) return;

    await mutations.remove.mutateAsync(block.id);
    onClose();
  }

  // 手術室・診療科は名称も写して持つ(Location / Organization が消えても
  // 行の意味が読めるようにするため。Schedule.actor.display と同じ考え方)。
  function handleRoomChange(id: string) {
    const room = rooms.find((location) => location.id === id);
    setDraft({
      ...draft,
      location_id: id,
      location_name: room ? locationDisplayName(room) : "",
    });
  }

  function handleDepartmentChange(id: string) {
    const department = departments.find((d) => d.id === id);
    setDraft({
      ...draft,
      department_code: department ? departmentCode(department) : "",
      department_name: department ? departmentDisplayName(department) : "",
    });
  }

  const selectedDepartmentId =
    departments.find((d) => departmentCode(d) === draft.department_code)?.id ?? "";

  return (
    <Modal title={block === null ? "割り当てを追加" : "割り当てを編集"} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="lab-order-item__fields">
          <label>
            手術室
            <select
              value={draft.location_id}
              onChange={(e) => handleRoomChange(e.target.value)}
              required
            >
              <option value="">選択してください</option>
              {/* 登録済みの部屋が候補に無い(削除・種別変更)ときも表示は残す。 */}
              {draft.location_id && !rooms.some((room) => room.id === draft.location_id) && (
                <option value={draft.location_id}>{draft.location_name || draft.location_id}</option>
              )}
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {locationDisplayName(room)}
                </option>
              ))}
            </select>
          </label>
          <label>
            曜日
            <select
              value={draft.weekday}
              onChange={(e) => setDraft({ ...draft, weekday: e.target.value })}
            >
              {WEEKDAY_LABELS.map((label, index) => (
                <option key={label} value={String(index)}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            開始時刻
            <input
              type="time"
              value={draft.start_time}
              onChange={(e) => setDraft({ ...draft, start_time: e.target.value })}
              required
            />
          </label>
          <label>
            終了時刻
            <input
              type="time"
              value={draft.end_time}
              onChange={(e) => setDraft({ ...draft, end_time: e.target.value })}
              required
            />
          </label>
          <label>
            診療科
            <select
              value={selectedDepartmentId}
              onChange={(e) => handleDepartmentChange(e.target.value)}
              required
            >
              <option value="">選択してください</option>
              {/* 自院の診療科から消えたコードも、登録済みの名称で残す。 */}
              {draft.department_code && !selectedDepartmentId && (
                <option value="">{draft.department_name || draft.department_code}</option>
              )}
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {departmentDisplayName(department)}
                </option>
              ))}
            </select>
          </label>
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
            備考
            <input
              type="text"
              value={draft.note}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            />
          </label>
        </div>

        <ErrorBanner
          error={mutations.create.error ?? mutations.update.error ?? mutations.remove.error}
        />

        <div className="lab-order-item__actions">
          <button type="submit" disabled={mutations.create.isPending || mutations.update.isPending}>
            保存
          </button>
          {block !== null && (
            <button type="button" onClick={handleDelete} disabled={mutations.remove.isPending}>
              削除
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
