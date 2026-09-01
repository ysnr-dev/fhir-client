import type { LabWorklistRow } from "../api/queries";
import {
  groupBySpecimen,
  labOrderComment,
  labOrderItems,
  memberSummary,
  specimenGroupLabel,
  summarizeLabOrder,
  type LabSpecimenGroup,
} from "../fhir/labOrderHelpers";
import { labelNumberOf, specimenArrived, specimenTypeCodeOf } from "../fhir/labSpecimenHelpers";
import { labTaskStatus, labTaskStatusDisplay } from "../fhir/labTaskHelpers";
import { displayName } from "../fhir/patientHelpers";
import { orderContextSummary, prescriptionRequester } from "../fhir/prescriptionHelpers";
import { Modal } from "./Modal";
import { orderDay } from "../fhir/shared";

// 検体検査一覧の「表示」で開くオーダー内容。カルテのカード(KarteTimeline の
// LabOrderCardBody)と同じ組み方で、検体(採血管)ごとに検査項目を並べる。
//
// カルテと違うのは、部門の画面なので管そのものの状況も要ること:
// 検体ごとの発行・到着と、ラベルに刷られた採取番号を見出しに添える
// (docs/lab-arrival-design.md §4-2)。番号は現物のラベルと突き合わせるためのもので、
// 到着が記録されない管の問い合わせはこの番号で行う。
//
// 管ごとの進捗のバッジは、それが掛かっている GP 番号の隣に置く。

/** 検体グループに対応する管(ラベル発行が作った Specimen)。未発行なら無い。 */
function tubeOf(specimens: fhir4.Specimen[], group: LabSpecimenGroup): fhir4.Specimen | undefined {
  return specimens.find((s) => specimenTypeCodeOf(s) === group.specimenCode);
}

/** 管(検体グループ)の状況。台帳は上流の Specimen(labSpecimenHelpers を参照)。 */
function TubeBadge({ specimen }: { specimen?: fhir4.Specimen }) {
  if (!specimen) return <span className="lab-worklist__tube lab-worklist__tube--none">未発行</span>;
  if (!specimenArrived(specimen)) {
    return <span className="lab-worklist__tube lab-worklist__tube--issued">発行済</span>;
  }
  return <span className="lab-worklist__tube lab-worklist__tube--arrived">到着済</span>;
}

export function LabOrderViewModal({ row, onClose }: { row: LabWorklistRow; onClose: () => void }) {
  const { order, patient } = row;
  const summary = summarizeLabOrder(order);
  const groups = groupBySpecimen(labOrderItems(order, row.itemRequests));
  const comment = labOrderComment(order);
  const status = labTaskStatus(row.task);

  // 一覧から開くので、どの患者のオーダーを見ているかを必ず頭に出す。
  const meta = [
    patient ? `${patient.identifier?.[0]?.value ?? "-"} ${displayName(patient)}` : "",
    orderDay(order),
    summary.settingDisplay,
    summary.urgent ? summary.priorityDisplay : "",
    orderContextSummary(prescriptionRequester(order)),
  ].filter(Boolean);

  return (
    <Modal title="検体検査内容" onClose={onClose} className="modal--wide">
      <div className="lab-order-view">
        <p className="lab-order-view__meta">
          <span>{meta.join(" | ")}</span>
          <span className={`lab-worklist__status lab-worklist__status--${status}`}>
            {labTaskStatusDisplay(status)}
          </span>
        </p>

        {groups.map((group, index) => {
          const tube = tubeOf(row.specimens, group);
          const number = tube ? labelNumberOf(tube) : "";
          return (
            <div className="karte-rp" key={group.specimenCode || `unset-${index}`}>
              <div className="karte-rp__head">
                <span className="karte-rp__number">{`GP${index + 1}`}</span>
                <TubeBadge specimen={tube} />
                <span className="karte-order__group-name">{specimenGroupLabel(group)}</span>
                {number && (
                  <span className="lab-order-view__number">{`採取番号 ${number}`}</span>
                )}
              </div>
              <ul className="karte-rp__medicines">
                {group.entries.map((entry) => (
                  <li key={entry.item.code}>
                    <span className="karte-rp__medicine-name">{entry.item.name}</span>
                    {entry.members.length > 0 && (
                      <span className="karte-rp__comment">{`（${memberSummary(entry.members)}）`}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        {groups.length === 0 && <p className="karte-card__empty">検査項目がありません。</p>}
        {comment && <p className="karte-card__note">{comment}</p>}
      </div>
    </Modal>
  );
}
