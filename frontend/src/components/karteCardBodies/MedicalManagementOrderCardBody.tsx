import {
  summarizeMedicalManagementOrder,
  type MedicalManagementItemDisplay,
} from "../../fhir/medicalManagementOrderHelpers";

// 指導・管理料は登録と同時に実施済なので、算定した項目(と加算)を並べるだけのカード。
export function MedicalManagementOrderCardBody({
  serviceRequest,
  items,
}: {
  serviceRequest: fhir4.ServiceRequest;
  items: MedicalManagementItemDisplay[];
}) {
  const summary = summarizeMedicalManagementOrder(serviceRequest);

  if (items.length === 0) {
    return <p className="karte-card__empty">算定項目がありません。</p>;
  }

  return (
    <div className="karte-rp">
      <ul className="karte-rp__medicines">
        {items.flatMap((item) => [
          <li key={item.id}>
            <span className="karte-rp__medicine-name">{item.name}</span>
          </li>,
          ...item.additions.map((addition) => (
            <li key={addition.id}>
              <span className="karte-rp__medicine-name">　{addition.name}</span>
            </li>
          )),
        ])}
      </ul>
      {summary.comment && <p className="karte-perform__note">{summary.comment}</p>}
    </div>
  );
}
