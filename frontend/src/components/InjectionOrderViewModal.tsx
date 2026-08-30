import type { InjectionWorklistRow } from "../api/queries";
import { InjectionDetailPanel } from "./InjectionDetailPanel";
import { injectionTaskQueryNotes } from "../fhir/injectionDispenseHelpers";
import { injectionTaskStatus, injectionTaskStatusDisplay } from "../fhir/injectionTaskHelpers";
import { displayName } from "../fhir/patientHelpers";
import { Modal } from "./Modal";

// 注射一覧の「表示」で開くオーダー内容。カルテの詳細モーダルと同じ
// InjectionDetailPanel を使い、部門の画面なので進捗と疑義照会(進捗の Task に残る)を添える。

export function InjectionOrderViewModal({
  row,
  onClose,
}: {
  row: InjectionWorklistRow;
  onClose: () => void;
}) {
  const { order, patient } = row;
  const status = injectionTaskStatus(row.task);
  const queryNotes = injectionTaskQueryNotes(row.task);

  return (
    <Modal title="注射内容" onClose={onClose} className="modal--wide">
      <div className="lab-order-view">
        {/* 一覧から開くので、どの患者のオーダーを見ているかを必ず頭に出す。 */}
        <p className="lab-order-view__meta">
          <span>
            {patient ? `${patient.identifier?.[0]?.value ?? "-"} ${displayName(patient)}` : "-"}
          </span>
          <span className={`lab-worklist__status lab-worklist__status--${status}`}>
            {injectionTaskStatusDisplay(status)}
          </span>
        </p>
        <InjectionDetailPanel
          serviceRequest={order}
          medicationRequests={row.medicationRequests}
          task={row.task}
        >
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
        </InjectionDetailPanel>
      </div>
    </Modal>
  );
}
