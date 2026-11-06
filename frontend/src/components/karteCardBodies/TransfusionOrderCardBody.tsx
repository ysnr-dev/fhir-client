import { TransfusionBloodBadge } from "../TransfusionBloodBadge";
import type { AutologousUnit } from "../../fhir/autologousHelpers";
import type { TransfusionDispenseDisplay } from "../../fhir/transfusionDispenseHelpers";
import type { TransfusionPerformDisplay } from "../../fhir/transfusionResultHelpers";
import {
  bloodTypeLabel,
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
  { label: "未実施", of: (perform) => perform.notGivenBags },
  { label: "観察", of: (perform) => perform.observations },
  // 副作用は「なし」も記録として意味があるので、値があれば必ず出す。
  { label: "副作用", of: (perform) => (perform.reaction ? [perform.reaction] : []) },
  { label: "遅発性副作用", of: (perform) => perform.delayedReactions },
];

// 輸血は製剤の一覧が本文。検査区分と同意書の状態はタイトルに出るのでここには出さない。
export function TransfusionOrderCardBody({
  serviceRequest,
  itemRequests,
  performs,
  dispenses = [],
  collections = [],
}: {
  serviceRequest: fhir4.ServiceRequest;
  itemRequests: fhir4.ServiceRequest[];
  performs: TransfusionPerformDisplay[];
  dispenses?: TransfusionDispenseDisplay[];
  collections?: AutologousUnit[];
}) {
  const products = transfusionOrderProducts(itemRequests, serviceRequest);
  const comment = transfusionOrderComment(serviceRequest);
  const summary = summarizeTransfusionOrder(serviceRequest);

  if (products.length === 0) return <p className="karte-card__empty">製剤がありません。</p>;

  return (
    <>
      <div className="karte-rp">
        {/* 緊急度・使用場所はカードで真っ先に確かめるものなので、製剤より先に出す。
            血液型は依頼した製剤の型だけを製剤の行に出す(患者の型は患者帯と詳細で読む)。 */}
        {(summary.urgencyBadge || summary.locationName || summary.purpose) && (
          <div className="karte-rp__head">
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
              <TransfusionBloodBadge abo={product.abo} rhd={product.rhd} />
              {product.note && <span>{product.note}</span>}
            </li>
          ))}
        </ul>
        {comment && <p className="karte-perform__note">{comment}</p>}
      </div>
      {/* 自己血の採血記録。 */}
      {collections.length > 0 && (
        <section className="karte-perform">
          <div className="karte-perform__head">
            <span className="karte-perform__title">採血</span>
          </div>
          <table className="karte-perform__table">
            <tbody>
              {collections.map((unit) => (
                <tr key={unit.dispenseId}>
                  <td>{unit.lotNumber && `No.${unit.lotNumber}`}</td>
                  <td>{unit.collectedAt && `${unit.collectedAt.slice(0, 10)} 採血`}</td>
                  <td>{unit.volume}</td>
                  <td>{bloodTypeLabel(unit.abo, unit.rhd)}</td>
                  <td>{unit.expiry && `期限 ${unit.expiry}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {/* 出庫記録。どのバッグを出したか(製剤番号・期限・照射・交差)は実施の前に確かめるもの。
          バッグの型は詳細で読む(カードの血液型は依頼した製剤の型だけにする)。 */}
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
            {perform.confirmerName && (
              <span className="karte-perform__meta">確認 {perform.confirmerName}</span>
            )}
            {perform.verification && (
              <span className="karte-perform__meta">{perform.verification}</span>
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
