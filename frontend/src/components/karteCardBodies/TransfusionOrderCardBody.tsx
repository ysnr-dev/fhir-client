import { TransfusionBloodBadge } from "../TransfusionBloodBadge";
import type { TransfusionPerformDisplay } from "../../fhir/transfusionResultHelpers";
import {
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
}: {
  serviceRequest: fhir4.ServiceRequest;
  itemRequests: fhir4.ServiceRequest[];
  performs: TransfusionPerformDisplay[];
}) {
  const products = transfusionOrderProducts(itemRequests);
  const comment = transfusionOrderComment(serviceRequest);
  const summary = summarizeTransfusionOrder(serviceRequest);

  if (products.length === 0) return <p className="karte-card__empty">製剤がありません。</p>;

  return (
    <>
      <div className="karte-rp">
        {/* 血液型はカードで真っ先に確かめるものなので、製剤より先に色付きで出す。 */}
        {summary.bloodTypeDisplay && (
          <div className="karte-rp__head">
            <TransfusionBloodBadge abo={summary.aboBloodType} rhd={summary.rhdBloodType} />
          </div>
        )}
        <ul className="karte-rp__medicines">
          {products.map((product, index) => (
            <li key={product.id || index}>
              <span className="karte-rp__number">{index + 1}</span>
              <span className="karte-rp__medicine-name">{productLabel(product)}</span>
              {product.note && <span>{product.note}</span>}
            </li>
          ))}
        </ul>
        {comment && <p className="karte-perform__note">{comment}</p>}
      </div>
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
