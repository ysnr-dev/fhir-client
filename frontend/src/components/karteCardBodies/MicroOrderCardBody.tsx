import {
  microOrderComment,
  microOrderContents,
  organismSummary,
  specimenLabel,
} from "../../fhir/microOrderHelpers";

// 細菌検査は検体(GP)の見出しの下に検査項目を並べ、目的菌・疑い病名を添える
// (検体検査・放射線のカードと同じ組み方)。
export function MicroOrderCardBody({
  serviceRequest,
  itemRequests,
}: {
  serviceRequest: fhir4.ServiceRequest;
  itemRequests: fhir4.ServiceRequest[];
}) {
  const { specimen, items } = microOrderContents(itemRequests);
  const comment = microOrderComment(serviceRequest);

  if (items.length === 0) return <p className="karte-card__empty">検査項目がありません。</p>;

  const details = [
    { label: "目的菌", value: organismSummary(specimen.organisms) },
    { label: "疑い病名", value: specimen.reasonName },
  ].filter((detail) => detail.value);

  return (
    <>
      <div className="karte-rp">
        <div className="karte-rp__head">
          <span className="karte-rp__number">GP1</span>
          <span className="karte-order__group-name">{specimenLabel(specimen)}</span>
        </div>
        <ul className="karte-rp__medicines">
          {items.map((item) => (
            <li key={item.code}>
              <span className="karte-rp__medicine-name">{item.name}</span>
            </li>
          ))}
        </ul>
        {details.map((detail) => (
          <div className="karte-rp__detail karte-rp__detail--indent" key={detail.label}>
            <span className="karte-rp__detail-label">{`${detail.label}:`}</span>
            <span>{detail.value}</span>
          </div>
        ))}
      </div>
      {comment && <p className="karte-card__note">{comment}</p>}
    </>
  );
}
