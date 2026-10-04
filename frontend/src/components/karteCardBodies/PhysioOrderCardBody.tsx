import {
  // GP の見出しの組み立ては放射線と同名の関数なので、別名で取り込む。
  entryLabel as physioEntryLabel,
  orderEntries as physioOrderEntries,
  physioOrderItems,
  type PhysioOrderItemLine,
} from "../../fhir/physioOrderHelpers";
import type { PhysioPerformDisplay } from "../../fhir/physioResultHelpers";
import {
  schemaAnnotatedLines,
} from "../../fhir/questionnaireResponseHelpers";
import { ResponseSchemaImages } from "../SchemaImageGallery";

// GP 単位で入力した内容。放射線検査と同じ形。
const PHYSIO_GP_DETAILS: {
  label: string;
  of: (item: PhysioOrderItemLine) => string;
  templateOf?: (item: PhysioOrderItemLine) => string;
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

// 生理検査は GP(検査項目 1 つ、またはセット 1 つ)ごとに出す。放射線検査と同じだが、
// 部位は持たないので検査名だけを並べる。
export function PhysioOrderCardBody({
  serviceRequest,
  itemRequests,
  performs,
}: {
  serviceRequest: fhir4.ServiceRequest;
  itemRequests: fhir4.ServiceRequest[];
  performs: PhysioPerformDisplay[];
}) {
  const entries = physioOrderEntries(physioOrderItems(serviceRequest, itemRequests));

  // 検査項目が無いオーダーでも、実施情報が付いていれば出す。
  if (entries.length === 0) {
    return (
      <>
        <p className="karte-card__empty">検査項目がありません。</p>
        <PhysioPerformSection performs={performs} />
      </>
    );
  }

  return (
    <>
      {entries.map((entry, index) => {
        // セットは自身が検査ではないので、構成する検査を並べる。単項目はその 1 件。
        const exams = entry.members.length > 0 ? entry.members : [entry.item];
        return (
          <div className="karte-rp" key={entry.item.code || `gp-${index}`}>
            <div className="karte-rp__head">
              <span className="karte-rp__number">{`GP${index + 1}`}</span>
              <span className="karte-order__group-name">{physioEntryLabel(entry)}</span>
            </div>
            <ul className="karte-rp__medicines">
              {exams.map((exam) => (
                <li key={exam.code}>
                  <span className="karte-rp__medicine-name">{exam.name}</span>
                </li>
              ))}
            </ul>
            {/* 依頼病名・検査目的・特別指示は GP 単位の記入なので、検査項目の後ろに
                同じ字下げで並べる(放射線検査と同じ置き方)。 */}
            {PHYSIO_GP_DETAILS.map(({ label, of, templateOf }) => {
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
      <PhysioPerformSection performs={performs} />
    </>
  );
}

// 生理検査一覧から入力した実施情報。放射線検査と同じ見せ方だが、被曝線量の行は無い。
const PHYSIO_PERFORM_ROWS: { label: string; of: (perform: PhysioPerformDisplay) => string[] }[] = [
  { label: "手技", of: (perform) => perform.procedures },
  { label: "薬剤", of: (perform) => perform.medicines },
  { label: "器材", of: (perform) => perform.materials },
];

function PhysioPerformSection({ performs }: { performs: PhysioPerformDisplay[] }) {
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
            {/* 実施記録があるのに検査まで至っていない例外(薬剤だけ入れて中止など)。 */}
            {perform.statusNote && (
              <span className="karte-perform__status">{perform.statusNote}</span>
            )}
          </div>
          {PHYSIO_PERFORM_ROWS.map(({ label, of }) => {
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
