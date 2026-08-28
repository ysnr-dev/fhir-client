import { useState } from "react";
import { Link } from "react-router-dom";
import { useKarteLinkState } from "../karteReturn";
import { useSurgeryUnscheduledList, type SurgeryWorklistRow } from "../api/queries";
import { ageWithMonthsLabel, displayName, genderLabel } from "../fhir/patientHelpers";
import { summarizeSurgeryOrder, surgeryOrderItems } from "../fhir/surgeryOrderHelpers";
import { isSurgeryMovable, rangeLabel, roomDayRows, timeRange } from "../fhir/surgeryConflictHelpers";
import { surgeryTaskStatus, surgeryTaskStatusDisplay } from "../fhir/surgeryTaskHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { PatientKana } from "./PatientRowCells";
import { RowMenu } from "./RowMenu";
import { SurgeryScheduleModal } from "./SurgeryScheduleModal";

// 手術室カレンダーの右ペイン。**格子に置けない手術**を集めて、そこから格子へ
// ドラッグして日程を決められるようにする(docs/surgery-calendar-design.md §2.5)。
//
// カレンダー導入時は「時刻・手術室が未定」を格子の下に箇条書きで出していたが、
// 落とし先の格子から遠く、掴んで動かす相手にもなっていなかった。左右に分けて
// **待ち行列 → 格子** の向きに揃える。
//
// 出す 3 組は「なぜ置けないか」で分かれる。
//   日付未定 … 予定手術日が無い申込(occurrence:missing)。日ビュー・週ビュー共通で、
//              見ている日/週に関係なく全件出す(手術部が組む相手そのもの)。
//   部屋未定 … 見ている範囲に日付はあるが手術室が決まっていない。
//   時間未定 … 手術室はあるが入室時刻が無い。**日ビューだけ**に出す —— 週ビューの
//              セルは 1 日ぶんの箱で時刻を要らないため、格子の中に置けている。

interface Props {
  /** 日ビューか週ビューか。時間未定を出すかと、落とし先の案内が変わる。 */
  mode: "day" | "week";
  /**
   * 見ている範囲(日ビューはその日、週ビューは 7 日ぶん)のオーダー。
   * 中止を除いたものを渡す想定だが、ここでも roomDayRows で落とす。
   */
  rangeRows: SurgeryWorklistRow[];
  onCardPointerDown: (row: SurgeryWorklistRow, event: React.PointerEvent) => void;
  /** 申込内容そのものを直す(カルテと同じ編集フォームを開く)。 */
  onEdit: (row: SurgeryWorklistRow) => void;
  /** 掴んでいるカード。元の位置は薄く出す。 */
  draggingOrderId?: string;
}

export function SurgeryPendingPanel({
  mode,
  rangeRows,
  onCardPointerDown,
  onEdit,
  draggingOrderId,
}: Props) {
  // 日程未定は一覧タブと同じクエリ(queryKey が同じなので読み直しは起きない)。
  const unscheduled = useSurgeryUnscheduledList();
  // ドラッグを使わずに日程を入れる経路。一覧タブの「日程を確定」と同じモーダル。
  const [scheduling, setScheduling] = useState<SurgeryWorklistRow | null>(null);

  const dateless = roomDayRows(unscheduled.data?.rows ?? [], {});
  const placeable = roomDayRows(rangeRows, {});
  const roomless = placeable.filter((row) => !summarizeSurgeryOrder(row.order).roomId);
  const timeless =
    mode === "day"
      ? placeable.filter((row) => {
          const summary = summarizeSurgeryOrder(row.order);
          return Boolean(summary.roomId) && !timeRange(summary.scheduledTime, null);
        })
      : [];

  const total = dateless.length + roomless.length + timeless.length;

  return (
    <aside className="surgery-pending">
      <div className="surgery-pending__head">
        <span className="surgery-pending__title">未確定</span>
        <span className="surgery-pending__count">{total} 件</span>
      </div>

      <ErrorBanner error={unscheduled.error} />

      {unscheduled.isLoading && dateless.length === 0 ? (
        <p className="order-select__muted">読み込み中...</p>
      ) : total === 0 ? (
        <p className="surgery-pending__empty">未確定の手術はありません。</p>
      ) : (
        <>
          <PendingGroup
            title="日付未定"
            rows={dateless}
            kind="dateless"
            onCardPointerDown={onCardPointerDown}
            onSchedule={setScheduling}
            onEdit={onEdit}
            draggingOrderId={draggingOrderId}
          />
          <PendingGroup
            title="部屋未定"
            rows={roomless}
            kind="roomless"
            onCardPointerDown={onCardPointerDown}
            onSchedule={setScheduling}
            onEdit={onEdit}
            draggingOrderId={draggingOrderId}
          />
          {/* 週ビューでは空配列を渡しているので、この組は出ない。 */}
          <PendingGroup
            title="時間未定"
            rows={timeless}
            kind="timeless"
            onCardPointerDown={onCardPointerDown}
            onSchedule={setScheduling}
            onEdit={onEdit}
            draggingOrderId={draggingOrderId}
          />
        </>
      )}

      {scheduling && (
        <SurgeryScheduleModal row={scheduling} onClose={() => setScheduling(null)} />
      )}
    </aside>
  );
}

type PendingKind = "dateless" | "roomless" | "timeless";

function PendingGroup({
  title,
  rows,
  kind,
  onCardPointerDown,
  onSchedule,
  onEdit,
  draggingOrderId,
}: {
  title: string;
  rows: SurgeryWorklistRow[];
  kind: PendingKind;
  onCardPointerDown: (row: SurgeryWorklistRow, event: React.PointerEvent) => void;
  onSchedule: (row: SurgeryWorklistRow) => void;
  onEdit: (row: SurgeryWorklistRow) => void;
  draggingOrderId?: string;
}) {
  // 空の組は出さない(3 つの見出しが常に並ぶと、何が残っているのかが読みにくい)。
  if (rows.length === 0) return null;

  return (
    <section className="surgery-pending__group">
      <h3 className="surgery-pending__group-head">
        {title}
        <span className="surgery-pending__group-count">{rows.length}</span>
      </h3>
      <ul className="surgery-pending__list">
        {rows.map((row) => (
          <li key={row.order.id}>
            <PendingCard
              row={row}
              kind={kind}
              onPointerDown={onCardPointerDown}
              onSchedule={onSchedule}
              onEdit={onEdit}
              dragging={row.order.id != null && row.order.id === draggingOrderId}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * 待ち行列のカード 1 枚。
 *
 * 格子のカードと違って高さが中身で決まるので隠れる行が無い。並べる順は
 * 「何が足りないか(見出し行) → 誰の(患者) → 何を(術式)」。手術部がここで
 * 選ぶのは日程を入れる相手なので、足りていない条件を先頭に出す。
 */
function PendingCard({
  row,
  kind,
  onPointerDown,
  onSchedule,
  onEdit,
  dragging,
}: {
  row: SurgeryWorklistRow;
  kind: PendingKind;
  onPointerDown: (row: SurgeryWorklistRow, event: React.PointerEvent) => void;
  onSchedule: (row: SurgeryWorklistRow) => void;
  onEdit: (row: SurgeryWorklistRow) => void;
  dragging: boolean;
}) {
  const karteLinkState = useKarteLinkState();
  const summary = summarizeSurgeryOrder(row.order);
  const items = surgeryOrderItems(row.order, row.itemRequests);
  const status = surgeryTaskStatus(row.task);
  const movable = isSurgeryMovable(row.task);
  const patient = row.patient;
  const surgeon = summary.staff.find((line) => line.role === "surgeon");

  return (
    <div
      className={[
        "surgery-pending__card",
        movable ? "surgery-pending__card--movable" : "",
        dragging ? "surgery-pending__card--dragging" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onPointerDown={movable ? (e) => onPointerDown(row, e) : undefined}
      title={movable ? "ドラッグしてカレンダーへ" : "この進捗の手術は日程を動かせません"}
    >
      <span className="surgery-pending__card-head">
        <span className={`surgery-calendar__status is-${status}`}>
          {surgeryTaskStatusDisplay(status)}
        </span>
        {/* 緊急・準緊急だけ目立たせる(予定は既定なのでバッジにしない)。
            待ち行列では「どれから組むか」がこの 1 つで決まる。 */}
        {summary.priority !== "routine" && (
          <span className="surgery-pending__priority">{summary.priorityDisplay}</span>
        )}
        <span className="surgery-pending__card-when">{whenLabel(row, kind)}</span>

        {/* ドラッグを使わない経路。押した指がそのままカードを掴まないよう
            pointerdown はここで止める(格子のカード操作と同じ)。 */}
        <span
          className="surgery-pending__card-actions"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <RowMenu label="この手術の操作" escapesClipping>
            <button
              type="button"
              className="row-menu__item"
              onClick={() => onSchedule(row)}
            >
              日程を確定
            </button>
            {/* 日程だけでなく申込の中身を直したいとき(術式・スタッフの変更)。 */}
            <button type="button" className="row-menu__item" onClick={() => onEdit(row)}>
              編集
            </button>
            {patient ? (
              <Link
                to={`/patients/${patient.id}/karte`}
                state={karteLinkState}
                className="row-menu__item"
              >
                カルテを表示
              </Link>
            ) : (
              <span className="row-menu__item row-menu__item--disabled">
                患者を読めていません
              </span>
            )}
          </RowMenu>
        </span>
      </span>

      <span className="surgery-pending__card-patient">
        {patient ? (
          <>
            <span className="surgery-pending__card-mrn">
              {patient.identifier?.[0]?.value ?? "-"}
            </span>
            <span className="surgery-pending__card-patient-name">{displayName(patient)}</span>
            <PatientKana patient={patient} />
            <span className="surgery-pending__card-profile">
              {ageWithMonthsLabel(patient.birthDate ?? "") || "-"} {genderLabel(patient.gender)}
            </span>
          </>
        ) : (
          "-"
        )}
      </span>

      <span className="surgery-pending__card-name">
        {items[0]?.name ?? "術式なし"}
        {items.length > 1 && (
          <span className="order-select__muted"> 他 {items.length - 1} 件</span>
        )}
      </span>
      <span className="surgery-pending__card-meta">
        {[
          summary.durationMinutes != null ? `${summary.durationMinutes}分` : "",
          summary.surgicalDepartmentName,
          surgeon ? `執刀: ${surgeon.practitionerName}` : "",
        ]
          .filter(Boolean)
          .join(" / ") || "-"}
      </span>
    </div>
  );
}

/** 見出し行に出す「今どこまで決まっているか」。足りない条件は組の見出しが言うので、決まっている方を出す。 */
function whenLabel(row: SurgeryWorklistRow, kind: PendingKind): string {
  const summary = summarizeSurgeryOrder(row.order);
  if (kind === "dateless") {
    // 日付が無いので、待たせている長さが読めるよう申込日を出す。
    return `申込 ${row.order.authoredOn?.slice(0, 10) || "-"}`;
  }
  if (kind === "roomless") {
    return `${summary.scheduledDate} ${rangeLabel(summary.scheduledTime, summary.durationMinutes)}`;
  }
  return `${summary.scheduledDate} ${summary.roomName || "部屋未定"}`;
}
