import {
  bodySiteLabel,
  entryLabel,
  orderEntries,
  radOrderItems,
  type RadOrderItemLine,
} from "../../fhir/radOrderHelpers";
import type { RadPerformDisplay } from "../../fhir/radResultHelpers";
import {
  schemaAnnotatedLines,
} from "../../fhir/questionnaireResponseHelpers";
import { ResponseSchemaImages } from "../SchemaImageGallery";

// GP 単位で入力した内容。撮影項目の下に、見出し付きで 1 行ずつ並べる。
// 検査目的・特別指示はテンプレートからも記載でき、その回答にシェーマ画像が
// 含まれることがあるので、記入内容(QuestionnaireResponse)の参照も持たせる。
const RAD_GP_DETAILS: {
  label: string;
  of: (item: RadOrderItemLine) => string;
  templateOf?: (item: RadOrderItemLine) => string;
}[] = [
  { label: "依頼病名", of: (item) => item.reasonName },
  {
    label: "検査目的",
    of: (item) => item.purpose,
    templateOf: (item) => item.purposeTemplate?.responseId ?? "",
  },
  {
    label: "特別指示",
    of: (item) => item.remarks,
    templateOf: (item) => item.remarksTemplate?.responseId ?? "",
  },
];

// 放射線検査は GP(撮影項目 1 つ、またはセット 1 つ)ごとに出す。セットは構成項目も
// オーダーに入っているので、その中身を GP の下に並べる(マスタではなくオーダーの
// 内容なので、構成を後から直しても過去の表示は変わらない)。
export function RadOrderCardBody({
  serviceRequest,
  itemRequests,
  performs,
}: {
  serviceRequest: fhir4.ServiceRequest;
  itemRequests: fhir4.ServiceRequest[];
  performs: RadPerformDisplay[];
}) {
  const entries = orderEntries(radOrderItems(serviceRequest, itemRequests));

  // 撮影項目が無いオーダーでも、実施情報が付いていれば出す。
  if (entries.length === 0) {
    return (
      <>
        <p className="karte-card__empty">撮影項目がありません。</p>
        <RadPerformSection performs={performs} />
      </>
    );
  }

  return (
    <>
      {entries.map((entry, index) => {
        // セットは自身が撮影ではないので、構成する撮影を並べる。単項目はその 1 件。
        const shots = entry.members.length > 0 ? entry.members : [entry.item];
        return (
          <div className="karte-rp" key={entry.item.code || `gp-${index}`}>
            <div className="karte-rp__head">
              <span className="karte-rp__number">{`GP${index + 1}`}</span>
              <span className="karte-order__group-name">{entryLabel(entry)}</span>
            </div>
            <ul className="karte-rp__medicines">
              {shots.map((shot) => (
                <li key={shot.code}>
                  <span className="karte-rp__medicine-name">{shot.name}</span>
                  {bodySiteLabel(shot) && (
                    <span className="karte-rp__comment">{bodySiteLabel(shot)}</span>
                  )}
                </li>
              ))}
            </ul>
            {/* 依頼病名・検査目的・特別指示は GP 単位の記入なので、撮影項目の後ろに
                同じ字下げで並べる(処方の用法と同じ置き方)。テンプレートから記載した
                シェーマ画像は、平文の「あり」の印に代えて実物を続けて出す
                (テンプレート回答カードと同じ見せ方)。 */}
            {RAD_GP_DETAILS.map(({ label, of, templateOf }) => {
              const lines = schemaAnnotatedLines(of(entry.item));
              const responseId = templateOf?.(entry.item) ?? "";
              if (lines.length === 0 && !responseId) return null;
              return (
                <div className="karte-rp__detail karte-rp__detail--indent" key={label}>
                  <span className="karte-rp__detail-label">{`${label}:`}</span>
                  <div className="karte-rp__detail-body">
                    {lines.map((line, lineIndex) => (
                      <span key={lineIndex}>{line}</span>
                    ))}
                    {responseId && <ResponseSchemaImages responseId={responseId} />}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
      <RadPerformSection performs={performs} />
    </>
  );
}

// 放射線検査一覧から入力した実施情報。依頼した内容(オーダー)とは別の事実なので、
// 撮影項目の下に、地を敷いた別ブロックとして出す。
// 取消 → 再実施で実施記録が複数残ることがあるため(docs/rad-result-design.md §7-6)、
// 1 件に丸めず実施ごとに並べる。
const RAD_PERFORM_ROWS: { label: string; of: (perform: RadPerformDisplay) => string[] }[] = [
  { label: "手技", of: (perform) => perform.procedures },
  { label: "造影剤", of: (perform) => perform.contrasts },
  { label: "器材", of: (perform) => perform.materials },
  { label: "被曝線量", of: (perform) => perform.doses },
];

function RadPerformSection({ performs }: { performs: RadPerformDisplay[] }) {
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
            {/* 実施記録があるのに撮影まで至っていない例外(造影剤だけ入れて中止など)。 */}
            {perform.statusNote && (
              <span className="karte-perform__status">{perform.statusNote}</span>
            )}
          </div>
          {RAD_PERFORM_ROWS.map(({ label, of }) => {
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
