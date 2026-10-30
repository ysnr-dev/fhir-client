import { useState, type FormEvent } from "react";
import type { Holiday, HolidayKind } from "../api/masterClient";
import { useHolidayMutations, useHolidayYear } from "../api/masterQueries";
import { ErrorBanner } from "../components/ErrorBanner";
import { MasterBackLink } from "../components/MasterBackLink";
import { Modal } from "../components/Modal";
import { addDays, today, WEEKDAY_LABELS, weekdayOf } from "../lib/dates";

// 祝日・休診日マスタ。国民の祝日はマスタ取込(内閣府 CSV)で入れ替わり、
// 施設の休診日(年末年始・創立記念日など)はここで 1 日ずつ登録する。
// カレンダーの色分けと、予約枠の生成・放射線治療の予定の割り付けが読む。

const KIND_LABELS: Record<HolidayKind, string> = { national: "祝日", facility: "休診日" };

export function HolidayPage() {
  const [year, setYear] = useState(() => Number(today().slice(0, 4)));
  const [editing, setEditing] = useState<Holiday | "new" | null>(null);
  const list = useHolidayYear(year);

  return (
    <div className="page">
      <div className="page__header">
        <h1>祝日・休診日</h1>
        <div className="page__header-actions">
          <button type="button" onClick={() => setEditing("new")}>
            休診日追加
          </button>
          <MasterBackLink />
        </div>
      </div>

      <div className="holiday-master__year">
        <button type="button" onClick={() => setYear(year - 1)} aria-label="前の年">
          ◀
        </button>
        <span>{year} 年</span>
        <button type="button" onClick={() => setYear(year + 1)} aria-label="次の年">
          ▶
        </button>
      </div>

      <ErrorBanner error={list.error} />

      <table className="master-search__table">
        <thead>
          <tr>
            <th className="rad-item__compact">日付</th>
            <th>名称</th>
            <th className="rad-item__compact">区分</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.map((item) => (
            <tr key={item.id} className="master-search__row" onClick={() => setEditing(item)}>
              <td className="rad-item__compact">
                {item.holiday_date}({WEEKDAY_LABELS[weekdayOf(item.holiday_date) ?? 0]})
              </td>
              <td>{item.name}</td>
              <td className="rad-item__compact">{KIND_LABELS[item.kind]}</td>
            </tr>
          ))}
          {list.data && list.data.length === 0 && (
            <tr>
              <td colSpan={3} className="master-search__empty">
                {year} 年の祝日・休診日がありません
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {editing !== null && (
        <HolidayEditModal
          item={editing === "new" ? null : editing}
          year={year}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

interface HolidayEditModalProps {
  // null は休診日の新規登録。
  item: Holiday | null;
  year: number;
  onClose: () => void;
}

function HolidayEditModal({ item, year, onClose }: HolidayEditModalProps) {
  const mutations = useHolidayMutations();
  const initialDate = item?.holiday_date ?? `${year}-12-29`;
  const [draft, setDraft] = useState({ from: initialDate, to: item ? initialDate : "", name: item?.name ?? "" });
  const [validationError, setValidationError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const name = draft.name.trim();
    if (!name || !draft.from) return;

    if (item !== null) {
      await mutations.update.mutateAsync({ id: item.id, payload: { name } });
      onClose();
      return;
    }

    const to = draft.to || draft.from;
    if (to < draft.from) {
      setValidationError("終了日は開始日以降にしてください。");
      return;
    }
    const payloads = [];
    for (let date = draft.from; date <= to; date = addDays(date, 1)) {
      payloads.push({ holiday_date: date, name, kind: "facility" as const });
    }
    if (payloads.length > 31) {
      setValidationError("一度に登録できるのは 31 日までです。");
      return;
    }
    setValidationError(null);
    await mutations.create.mutateAsync(payloads);
    onClose();
  }

  async function handleDelete() {
    if (item === null) return;
    if (!window.confirm(`${item.holiday_date} ${item.name} を削除しますか？`)) return;
    await mutations.remove.mutateAsync(item.id);
    onClose();
  }

  return (
    <Modal title={item === null ? "休診日を追加" : `${KIND_LABELS[item.kind]}を編集`} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {validationError && (
          <div className="error-banner" role="alert">
            <p className="error-banner__line error-banner__line--error">{validationError}</p>
          </div>
        )}
        <div className="lab-order-item__fields">
          {item === null ? (
            <>
              <label>
                開始日
                <input
                  type="date"
                  value={draft.from}
                  onChange={(e) => setDraft({ ...draft, from: e.target.value })}
                  required
                />
              </label>
              <label>
                終了日
                <input
                  type="date"
                  value={draft.to}
                  onChange={(e) => setDraft({ ...draft, to: e.target.value })}
                />
              </label>
            </>
          ) : (
            <label>
              日付
              <input type="date" value={draft.from} disabled />
            </label>
          )}
          <label>
            名称
            <input
              type="text"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              required
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
          {item !== null && (
            <button type="button" onClick={handleDelete} disabled={mutations.remove.isPending}>
              削除
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
