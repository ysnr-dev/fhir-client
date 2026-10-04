import {
  groupBySpecimen,
  labOrderComment,
  labOrderItems,
  memberSummary,
  specimenGroupLabel,
} from "../../fhir/labOrderHelpers";

// 検体検査は検体(採血管)ごとにまとめて出す。採血の現場が動く単位に合わせる。
// パネル検査は構成項目もオーダーに入っているので、親の後ろに並べて添える
// (マスタではなくオーダーの内容なので、構成を後から直しても過去の表示は変わらない)。
export function LabOrderCardBody({
  serviceRequest,
  itemRequests,
}: {
  serviceRequest: fhir4.ServiceRequest;
  itemRequests: fhir4.ServiceRequest[];
}) {
  const groups = groupBySpecimen(labOrderItems(serviceRequest, itemRequests));
  const comment = labOrderComment(serviceRequest);

  if (groups.length === 0) return <p className="karte-card__empty">検査項目がありません。</p>;

  return (
    <>
      {groups.map((group, index) => (
        <div className="karte-rp" key={group.specimenCode || `unset-${index}`}>
          <div className="karte-rp__head">
            <span className="karte-rp__number">{`GP${index + 1}`}</span>
            <span className="karte-order__group-name">{specimenGroupLabel(group)}</span>
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
      ))}
      {comment && <p className="karte-card__note">{comment}</p>}
    </>
  );
}
