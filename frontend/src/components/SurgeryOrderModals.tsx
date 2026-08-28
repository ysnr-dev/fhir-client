import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { SurgeryWorklistRow } from "../api/queries";
import { displayName } from "../fhir/patientHelpers";
import { summarizeSurgeryOrder, surgeryOrderItems } from "../fhir/surgeryOrderHelpers";
import { rangeLabel } from "../fhir/surgeryConflictHelpers";
import { formatDateLabel } from "../fhir/scheduleHelpers";
import { useOrderContext } from "../hooks/useOrderContext";
import { AdmissionPatientSearch } from "./AdmissionModal";
import { Modal } from "./Modal";
import {
  SurgeryOrderCreatePanel,
  SurgeryOrderEditPanel,
  type SurgeryDefaultSchedule,
} from "./SurgeryOrderPanels";

// 手術カレンダーから手術オーダーを登録・修正するためのモーダル。
//
// 中身はカルテ右ペインと**同じ** SurgeryOrderCreatePanel / SurgeryOrderEditPanel。
// 手術部が使う入口を増やすだけで、申込の中身(術式・スタッフ・麻酔・準備)を
// 二重に持たない。作られるオーダーもカルテからの申込と同じ(Task を作らないので
// 進捗は「申込済」から始まる)。
//
// カレンダーからの登録はカルテと違って患者が決まっていないので、入院登録
// (AdmissionModal)と同じ「患者を選ぶ → 中身を書く」の 2 段階にする。

/** カレンダーの空き枠から患者を選んで手術オーダーを登録する。 */
export function SurgeryOrderCreateModal({
  defaultSchedule,
  onClose,
}: {
  /** 掴んだ空き枠。日付・入室時刻・所要時間・手術室をフォームの初期値にする。 */
  defaultSchedule: SurgeryDefaultSchedule;
  onClose: () => void;
}) {
  const [patient, setPatient] = useState<fhir4.Patient | null>(null);
  const queryClient = useQueryClient();
  // 依頼科・依頼医師はヘッダーの選択(カルテと共通)を使う。未選択でも登録は
  // 通る(requester が付かないだけ)ので、止めずに気づけるようにだけしておく。
  const requester = useOrderContext();
  const noRequester = !requester.departmentId && !requester.practitionerId;

  function handleSaved() {
    // 登録の mutation は他オーダーと共用で ["ServiceRequest","search"] しか
    // 無効化しない。カレンダー(surgery-worklist / surgery-unscheduled)は
    // 別のキーなので、ここで落として登録直後のカードを出す。
    queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "surgery-worklist"] });
    queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "surgery-unscheduled"] });
    onClose();
  }

  // 掴んだ枠を見出しに出す。終わりまで決めていれば入室〜退室で出す(格子の帯と
  // 同じ読み方になるように rangeLabel を借りる)。
  const slotLabel = [
    defaultSchedule.roomName,
    formatDateLabel(defaultSchedule.scheduledDate),
    defaultSchedule.durationMinutes
      ? rangeLabel(defaultSchedule.scheduledTime, Number(defaultSchedule.durationMinutes))
      : defaultSchedule.scheduledTime,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Modal
      title={slotLabel ? `手術オーダー登録 - ${slotLabel}` : "手術オーダー登録"}
      onClose={onClose}
      className="modal--lab-order-item"
    >
      {noRequester && (
        <p className="order-select__muted">
          依頼科・依頼医師が未選択です。画面上部の「依頼」から選ぶと登録するオーダーに残ります。
        </p>
      )}

      {patient?.id ? (
        <>
          <div className="walk-in__patient">
            <span>{patient.identifier?.[0]?.value ?? "-"}</span>
            <span>{displayName(patient)}</span>
            <button type="button" onClick={() => setPatient(null)}>
              選び直す
            </button>
          </div>
          {/* 患者を選び直したらフォームを作り直す(初期値は初回描画時にしか読まれない)。 */}
          <SurgeryOrderCreatePanel
            key={patient.id}
            patientId={patient.id}
            defaultSchedule={defaultSchedule}
            onSaved={handleSaved}
          />
        </>
      ) : (
        <AdmissionPatientSearch onSelect={setPatient} />
      )}
    </Modal>
  );
}

/**
 * カレンダー・未確定リストのカードから手術オーダーを修正する。
 *
 * 編集できる範囲・可否はカルテと同じにする(入口で差をつけると「カルテでは
 * 直せるのにカレンダーでは直せない」になるため)。更新の mutation は
 * ["ServiceRequest"] を丸ごと無効化するので、閉じればカレンダーも追従する。
 */
export function SurgeryOrderEditModal({
  row,
  onClose,
}: {
  row: SurgeryWorklistRow;
  onClose: () => void;
}) {
  // _include で患者が同梱されなかった行でも直せるように subject から拾う。
  const patientId = row.patient?.id ?? row.order.subject?.reference?.split("/").pop() ?? "";
  const items = surgeryOrderItems(row.order, row.itemRequests);
  const summary = summarizeSurgeryOrder(row.order);

  return (
    <Modal title="手術オーダー修正" onClose={onClose} className="modal--lab-order-item">
      {/* どの手術を開いているかを出す(カレンダーは同じ形のカードが並ぶため)。 */}
      <div className="walk-in__patient">
        <span>{row.patient?.identifier?.[0]?.value ?? "-"}</span>
        <span>{row.patient ? displayName(row.patient) : "-"}</span>
        <span>
          {summary.scheduledDate ? formatDateLabel(summary.scheduledDate) : "日程未定"}{" "}
          {summary.scheduledTime} {summary.roomName}
        </span>
        <span>{items[0]?.name ?? "術式なし"}</span>
      </div>

      {!patientId || !row.order.id ? (
        <p className="patient-table__empty">このオーダーの患者を読めていないため修正できません。</p>
      ) : (
        <SurgeryOrderEditPanel
          key={row.order.id}
          patientId={patientId}
          srId={row.order.id}
          onSaved={onClose}
        />
      )}
    </Modal>
  );
}
