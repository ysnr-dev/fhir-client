import {
  entryLabel as treatmentEntryLabel,
  orderEntries as treatmentOrderEntries,
  treatmentOrderItems,
} from "../../fhir/treatmentOrderHelpers";
import type { TreatmentPerformDisplay } from "../../fhir/treatmentResultHelpers";

// 処置は GP(処置項目 1 つ、またはセット 1 つ)ごとに出す。生理検査と同じだが、
// GP 単位の記入欄(依頼病名・検査目的・特別指示)を持たないので項目名だけを並べる。
export function TreatmentOrderCardBody({
  serviceRequest,
  itemRequests,
  performs,
}: {
  serviceRequest: fhir4.ServiceRequest;
  itemRequests: fhir4.ServiceRequest[];
  performs: TreatmentPerformDisplay[];
}) {
  const entries = treatmentOrderEntries(treatmentOrderItems(serviceRequest, itemRequests));

  // 処置項目が無いオーダーでも、実施情報が付いていれば出す。
  if (entries.length === 0) {
    return (
      <>
        <p className="karte-card__empty">処置項目がありません。</p>
        <TreatmentPerformSection performs={performs} />
      </>
    );
  }

  return (
    <>
      {entries.map((entry, index) => (
        // 処置は放射線・生理と違って見出しに分類軸が付かず項目名そのものなので、
        // 単項目のときは明細を出すと同じ名前が 2 行並ぶ。セットのときだけ構成する
        // 処置を並べる(オーダー画面のプレビューと同じ見せ方)。
        <div className="karte-rp" key={entry.item.code || `gp-${index}`}>
          <div className="karte-rp__head">
            <span className="karte-rp__number">{`GP${index + 1}`}</span>
            <span className="karte-order__group-name">{treatmentEntryLabel(entry)}</span>
          </div>
          {entry.members.length > 0 && (
            <ul className="karte-rp__medicines">
              {entry.members.map((member) => (
                <li key={member.code}>
                  <span className="karte-rp__medicine-name">{member.name}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      <TreatmentPerformSection performs={performs} />
    </>
  );
}

// 処置一覧から入力した実施情報。生理検査と同じ見せ方。
const TREATMENT_PERFORM_ROWS: {
  label: string;
  of: (perform: TreatmentPerformDisplay) => string[];
}[] = [
  { label: "手技", of: (perform) => perform.procedures },
  { label: "薬剤", of: (perform) => perform.medicines },
  { label: "器材", of: (perform) => perform.materials },
];

function TreatmentPerformSection({ performs }: { performs: TreatmentPerformDisplay[] }) {
  if (performs.length === 0) return null;

  return (
    <>
      {performs.map((perform) => (
        <section className="karte-perform" key={perform.id}>
          <div className="karte-perform__head">
            <span className="karte-perform__title">実施情報</span>
            {perform.performedAt && (
              <span className="karte-perform__meta">{perform.performedAt}</span>
            )}
            {perform.performerName && (
              <span className="karte-perform__meta">{perform.performerName}</span>
            )}
            {/* 実施記録があるのに実施まで至っていない例外(薬剤だけ入れて中止など)。 */}
            {perform.statusNote && (
              <span className="karte-perform__status">{perform.statusNote}</span>
            )}
          </div>
          {TREATMENT_PERFORM_ROWS.map(({ label, of }) => {
            const values = of(perform);
            if (values.length === 0) return null;
            return (
              <div className="karte-perform__row" key={label}>
                <span className="karte-perform__label">{`${label}:`}</span>
                <span className="karte-perform__values">
                  {values.map((value, index) => (
                    <span key={index}>{value}</span>
                  ))}
                </span>
              </div>
            );
          })}
          {perform.comment && <p className="karte-perform__note">{perform.comment}</p>}
        </section>
      ))}
    </>
  );
}
