import { useState } from "react";
import { useRegisterRadiotherapyPlan, type RadiotherapyWorklistRow } from "../api/queries";
import { displayName } from "../fhir/patientHelpers";
import { summarizeRadiotherapyOrder } from "../fhir/radiotherapyOrderHelpers";
import {
  buildRadiotherapyPlanBundle,
  draftRadiotherapyPlan,
  emptyRadiotherapyPlanOptions,
  radiotherapyPlanEligibility,
  radiotherapyProgress,
  type RadiotherapyFractionDisplay,
  type RadiotherapyPlanOptions,
} from "../fhir/radiotherapyResultHelpers";
import { radiotherapyTaskStatus } from "../fhir/radiotherapyTaskHelpers";
import { formatDateLabel } from "../fhir/scheduleHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";
import type { RadiotherapySlot } from "./RadiotherapyCalendar";

// カレンダーで掴んだ空き枠に、どの治療コースの照射を入れるかを選ぶ
// (docs/radiotherapy-order-design.md §7.4)。
//
// 治療処方の段階では装置も時刻も決まっていない。決まるのは部門が日程を組むときなので、
// 空き枠から始まるのは新しいオーダーではなく**既にあるコースの日程**。手術カレンダーの
// 「未確定の手術を格子に落として日程を確定する」に当たる。
//
// - 予定を組む … 残りの回数ぶんを、この枠(装置・開始時刻・所要時間・開始日)で一括登録する
// - 1 回だけ追加 … 次の回をこの枠に 1 件だけ入れる(振替・飛んだ日の埋め合わせ)

/** 掴んだ枠を一括登録の初期値にする。 */
export function planOptionsFromSlot(slot: RadiotherapySlot): Partial<RadiotherapyPlanOptions> {
  return {
    startDate: slot.date,
    ...(slot.startTime ? { startTime: slot.startTime } : {}),
    ...(slot.durationMinutes ? { durationMinutes: String(slot.durationMinutes) } : {}),
    device: { code: slot.deviceCode, name: slot.deviceName },
  };
}

/** 受付前のコースの理由(radiotherapyPlanEligibility が返す文言)。 */
const NOT_ACCEPTED = "受付がまだ";

interface Props {
  slot: RadiotherapySlot;
  /** 進行中の治療コース。予定を足せるもの・足せないものに、ここで分ける。 */
  courses: { row: RadiotherapyWorklistRow; fractions: RadiotherapyFractionDisplay[] }[];
  /** 「予定を組む」。一括登録を、この枠を初期値にして開く。 */
  onPlan: (row: RadiotherapyWorklistRow) => void;
  onClose: () => void;
}

export function RadiotherapySlotModal({ slot, courses, onPlan, onClose }: Props) {
  const register = useRegisterRadiotherapyPlan();
  const [addingId, setAddingId] = useState<string | null>(null);

  const slotLabel = [
    slot.deviceName || "装置未定",
    formatDateLabel(slot.date),
    slot.durationMinutes ? `${slot.startTime}〜(${slot.durationMinutes}分)` : slot.startTime,
  ]
    .filter(Boolean)
    .join(" ");

  const rows = courses.map(({ row, fractions }) => {
    const summary = summarizeRadiotherapyOrder(row.order);
    return {
      row,
      fractions,
      summary,
      progress: radiotherapyProgress(summary, fractions),
      eligibility: radiotherapyPlanEligibility(radiotherapyTaskStatus(row.task), summary, fractions),
    };
  });
  const candidates = rows.filter((r) => r.eligibility.canPlan);
  // 対象外のコースは**並べない**。押せない行を何十件も読ませても仕事は進まないので、
  // 件数と次の一手(受付)だけを出す。コースそのものは右の一覧にある。
  const excluded = rows.filter((r) => !r.eligibility.canPlan);
  // 理由ごとの件数だけを出す。行を並べても押せないので、**受付すれば入れられる件数**が分かれば足りる。
  const notAccepted = excluded.filter((r) => r.eligibility.reason === NOT_ACCEPTED).length;

  // 次の回をこの枠に 1 件だけ入れる。どの Phase の何回目かは一括登録と同じ数え方で決める。
  function handleAddOne(row: RadiotherapyWorklistRow, fractions: RadiotherapyFractionDisplay[]) {
    const options: RadiotherapyPlanOptions = {
      ...emptyRadiotherapyPlanOptions(slot.date),
      ...planOptionsFromSlot(slot),
      // その日に置くので、曜日では絞らない。
      weekdays: [0, 1, 2, 3, 4, 5, 6],
    };
    const [next] = draftRadiotherapyPlan(summarizeRadiotherapyOrder(row.order), fractions, options);
    if (!next) return;
    setAddingId(row.order.id ?? null);
    register.mutate(buildRadiotherapyPlanBundle([next], options, row.order), { onSuccess: onClose });
  }

  return (
    <Modal
      title={`照射予定を入れる - ${slotLabel}`}
      onClose={onClose}
      className={candidates.length > 0 ? "modal--wide" : undefined}
    >
      <ErrorBanner error={register.error} />

      {candidates.length === 0 ? (
        <div className="radiotherapy-slot__empty">
          <p className="radiotherapy-slot__empty-title">予定を入れられる治療コースがありません</p>
          <p className="radiotherapy-slot__empty-note">
            {excluded.length === 0
              ? "進行中の治療コースがありません。"
              : notAccepted > 0
                ? `進行中の ${excluded.length} 件のうち ${notAccepted} 件は受付がまだです。右の一覧で「受付」を押すと、この枠に予定を入れられます。`
                : `進行中の ${excluded.length} 件は、いずれも照射予定が処方の回数に足りています。`}
          </p>
        </div>
      ) : (
        <div className="radiotherapy-slot__table">
          <table className="master-search__table">
            <thead>
              <tr>
                <th>患者</th>
                <th>コース</th>
                <th>処方</th>
                <th>照射 / 予定</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {candidates.map(({ row, fractions, summary, progress }) => {
                const remaining = progress.prescribed - progress.delivered - progress.planned;
                return (
                  <tr key={row.order.id}>
                    <td>
                      {row.patient?.identifier?.[0]?.value ?? "-"}{" "}
                      {row.patient ? displayName(row.patient) : "-"}
                    </td>
                    <td>
                      第{summary.courseNumber}コース {summary.siteLabel}
                    </td>
                    <td>{summary.doseLabel}</td>
                    <td>
                      {progress.fractionLabel}　予定 {progress.planned} 回（残り {remaining} 回）
                    </td>
                    <td className="radiotherapy-slot__actions">
                      <button type="button" onClick={() => onPlan(row)} disabled={register.isPending}>
                        予定を組む
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAddOne(row, fractions)}
                        disabled={register.isPending}
                      >
                        {register.isPending && addingId === row.order.id ? "登録中..." : "1回だけ追加"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="radiotherapy-slot__footer">
        <button type="button" onClick={onClose}>
          閉じる
        </button>
      </div>
    </Modal>
  );
}
