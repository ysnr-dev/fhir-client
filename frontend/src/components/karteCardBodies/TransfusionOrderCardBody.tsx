import { TransfusionBloodBadge } from "../TransfusionBloodBadge";
import type { TransfusionDispenseDisplay } from "../../fhir/transfusionDispenseHelpers";
import type { TransfusionPerformDisplay } from "../../fhir/transfusionResultHelpers";
import {
  isDifferentFromPatient,
  productLabel,
  summarizeTransfusionOrder,
  transfusionOrderComment,
  transfusionOrderProducts,
} from "../../fhir/transfusionOrderHelpers";

// 輸血の実施情報の行。バッグと副作用は他部門の「薬剤」「器材」に当たる。
const TRANSFUSION_PERFORM_ROWS: {
  label: string;
  of: (perform: TransfusionPerformDisplay) => string[];
}[] = [
  { label: "バッグ", of: (perform) => perform.bags },
  // 副作用は「なし」も記録として意味があるので、値があれば必ず出す。
  { label: "副作用", of: (perform) => (perform.reaction ? [perform.reaction] : []) },
];

// 輸血は製剤の一覧が本文。検査区分と同意書の状態はタイトルに出るのでここには出さない。
export function TransfusionOrderCardBody({
  serviceRequest,
  itemRequests,
  performs,
  dispenses = [],
}: {
  serviceRequest: fhir4.ServiceRequest;
  itemRequests: fhir4.ServiceRequest[];
  performs: TransfusionPerformDisplay[];
  dispenses?: TransfusionDispenseDisplay[];
}) {
  const products = transfusionOrderProducts(itemRequests, serviceRequest);
  const comment = transfusionOrderComment(serviceRequest);
  const summary = summarizeTransfusionOrder(serviceRequest);
  const patient = { abo: summary.aboBloodType, rhd: summary.rhdBloodType };

  if (products.length === 0) return <p className="karte-card__empty">製剤がありません。</p>;

  return (
    <>
      <div className="karte-rp">
        {/* 患者の型と緊急度・使用場所はカードで真っ先に確かめるものなので、製剤より先に出す。 */}
        {(summary.bloodTypeDisplay || summary.urgencyBadge || summary.locationName) && (
          <div className="karte-rp__head">
            {summary.bloodTypeDisplay && (
              <TransfusionBloodBadge abo={summary.aboBloodType} rhd={summary.rhdBloodType} />
            )}
            {summary.urgencyBadge && (
              <span className="dose-conversion__badge">{summary.urgencyBadge}</span>
            )}
            {summary.locationName && <span>{summary.locationName}</span>}
            {summary.purpose && <span>{summary.purpose}</span>}
          </div>
        )}
        <ul className="karte-rp__medicines">
          {products.map((product, index) => (
            <li key={product.id || index}>
              <span className="karte-rp__number">{index + 1}</span>
              <span className="karte-rp__medicine-name">{productLabel({ ...product, abo: "", rhd: "" })}</span>
              {/* 製剤の型は患者の型と違いうる(異型適合)ので製剤ごとに色付きで出す。 */}
              <TransfusionBloodBadge abo={product.abo} rhd={product.rhd} />
              {isDifferentFromPatient(product, patient) && (
                <span className="blood-type__unconfirmed">異型</span>
              )}
              {product.note && <span>{product.note}</span>}
            </li>
          ))}
        </ul>
        {comment && <p className="karte-perform__note">{comment}</p>}
      </div>
      {/* 出庫記録。どのバッグを出したか(製剤番号・型・期限・照射・交差)は実施の前に確かめるもの。 */}
      {dispenses.map((dispense) => (
        <section className="karte-perform" key={dispense.id}>
          <div className="karte-perform__head">
            <span className="karte-perform__title">出庫</span>
            {dispense.dispensedAt && <span className="karte-perform__meta">{dispense.dispensedAt}</span>}
            {dispense.dispenserName && (
              <span className="karte-perform__meta">{dispense.dispenserName}</span>
            )}
          </div>
          <div className="karte-perform__row">
            <span className="karte-perform__label">バッグ:</span>
            <span className="karte-perform__values">
              {dispense.bags.map((bag) => (
                <span key={bag.id}>{bag.label}</span>
              ))}
            </span>
          </div>
          {dispense.comment && <p className="karte-perform__note">{dispense.comment}</p>}
        </section>
      ))}
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
            {/* 実施記録があるのに輸血まで至っていない例外(途中で中止など)。 */}
            {perform.statusNote && (
              <span className="karte-perform__status">{perform.statusNote}</span>
            )}
          </div>
          {TRANSFUSION_PERFORM_ROWS.map(({ label, of }) => {
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
