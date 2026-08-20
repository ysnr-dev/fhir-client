import type { RxWorklistRow } from "../api/queries";
import { displayName } from "../fhir/patientHelpers";
import {
  groupByRp,
  orderContextSummary,
  prescriptionComment,
  prescriptionRequester,
  summarizeServiceRequest,
} from "../fhir/prescriptionHelpers";
import { rxTaskQueryNotes } from "../fhir/rxDispenseHelpers";
import { rxTaskStatus, rxTaskStatusDisplay } from "../fhir/rxTaskHelpers";
import { Modal } from "./Modal";

// 処方一覧の「表示」で開くオーダー内容。カルテのカード(KarteTimeline の
// 処方カード)と同じ組み方で、RP ごとに医薬品と用法を並べる。
//
// カルテと違うのは、部門の画面なので作業の状況も要ること: 進捗のバッジと、
// 調剤時に記録した疑義照会(進捗の Task に残る)を添える。

export function RxOrderViewModal({ row, onClose }: { row: RxWorklistRow; onClose: () => void }) {
  const { order, patient } = row;
  const summary = summarizeServiceRequest(order);
  const rps = groupByRp(row.medicationRequests);
  const comment = prescriptionComment(order);
  const status = rxTaskStatus(row.task);
  const queryNotes = rxTaskQueryNotes(row.task);

  // 一覧から開くので、どの患者のオーダーを見ているかを必ず頭に出す。
  const meta = [
    patient ? `${patient.identifier?.[0]?.value ?? "-"} ${displayName(patient)}` : "",
    summary.date,
    summary.settingDisplay,
    summary.categoryDisplay,
    orderContextSummary(prescriptionRequester(order)),
  ].filter(Boolean);

  return (
    <Modal title="処方内容" onClose={onClose} className="modal--wide">
      <div className="lab-order-view">
        <p className="lab-order-view__meta">
          <span>{meta.join(" | ")}</span>
          <span className={`lab-worklist__status lab-worklist__status--${status}`}>
            {rxTaskStatusDisplay(status)}
          </span>
        </p>

        {rps.map((rp) => (
          <div className="karte-rp" key={rp.rpNumber}>
            <div className="karte-rp__head">
              <span className="karte-rp__number">{`RP${rp.rpNumber}`}</span>
            </div>
            <ul className="karte-rp__medicines">
              {rp.medicines.map((medicine) => (
                <li key={medicine.orderInRp}>
                  <span className="karte-rp__medicine-name">{medicine.name}</span>
                  {medicine.dose != null && (
                    <span className="karte-rp__medicine-dose">
                      {`${medicine.dose}${medicine.unit ?? ""}`}
                    </span>
                  )}
                  {medicine.comment && (
                    <span className="karte-rp__comment">{`（${medicine.comment}）`}</span>
                  )}
                </li>
              ))}
            </ul>
            {/* 紙の処方箋と同じく、用法は薬剤の後ろに置く。 */}
            <div className="karte-rp__detail">
              <span className="karte-rp__detail-label">用法:</span>
              <span>{rp.usageName ?? "-"}</span>
              {rp.basicCategory === "内服" && rp.doseDays != null && (
                <span className="karte-rp__dose">{`${rp.doseDays}日分`}</span>
              )}
              {rp.basicCategory === "頓服" && rp.doseCount != null && (
                <span className="karte-rp__dose">{`${rp.doseCount}回分`}</span>
              )}
              {rp.usageComment && (
                <span className="karte-rp__comment">{`（${rp.usageComment}）`}</span>
              )}
            </div>
          </div>
        ))}
        {rps.length === 0 && <p className="karte-card__empty">処方内容がありません。</p>}
        {comment && <p className="karte-card__note">{comment}</p>}

        {queryNotes.length > 0 && (
          <div className="rx-dispense__notes">
            <p className="rx-dispense__notes-label">疑義照会</p>
            {queryNotes.map((note, index) => (
              <p className="karte-card__note" key={index}>
                {note}
              </p>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
