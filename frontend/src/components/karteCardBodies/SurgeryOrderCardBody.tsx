import {
  summarizeSurgeryOrder,
  surgeryAnesthesiaMethodDisplay,
  surgeryApproachDisplay,
  surgeryBodySiteLabel,
  surgeryOrderItems,
  type SurgeryOrderSummary,
} from "../../fhir/surgeryOrderHelpers";
import type { SurgeryPerformDisplay } from "../../fhir/surgeryResultHelpers";
import {
  schemaAnnotatedLines,
} from "../../fhir/questionnaireResponseHelpers";
import { ResponseSchemaImages } from "../SchemaImageGallery";

export function SurgeryOrderCardBody({
  serviceRequest,
  itemRequests,
  performs,
}: {
  serviceRequest: fhir4.ServiceRequest;
  itemRequests: fhir4.ServiceRequest[];
  performs: SurgeryPerformDisplay[];
}) {
  const summary = summarizeSurgeryOrder(serviceRequest);
  const items = surgeryOrderItems(serviceRequest, itemRequests);
  const surgeon = summary.staff.find((line) => line.role === "surgeon");

  // 術式が無い申込でも、実施情報が付いていれば出す。
  if (items.length === 0) {
    return (
      <>
        <p className="karte-card__empty">術式がありません。</p>
        <SurgeryPerformSection performs={performs} />
      </>
    );
  }

  return (
    <>
      {items.map((item, index) => (
        <div className="karte-rp" key={item.code}>
          <div className="karte-rp__head">
            <span className="karte-rp__number">{index === 0 ? "主" : "副"}</span>
            <span className="karte-order__group-name">{item.name}</span>
            {surgeryBodySiteLabel(item) && (
              <span className="karte-rp__usage">{surgeryBodySiteLabel(item)}</span>
            )}
            {item.approach && (
              <span className="karte-rp__usage">{surgeryApproachDisplay(item.approach)}</span>
            )}
          </div>
        </div>
      ))}
      {/* 申込の要点。全部はカードに出さず(詳細表示にある)、読影ならぬ現場の
          一目で要る「誰が執刀し、どの麻酔か」だけを 1 行で添える。 */}
      {(surgeon || summary.anesthesiaMethods.length > 0) && (
        <p className="karte-order__comment">
          {[
            surgeon && `執刀: ${surgeon.practitionerName}`,
            summary.anesthesiaMethods.length > 0 &&
              `麻酔: ${summary.anesthesiaMethods
                .map(surgeryAnesthesiaMethodDisplay)
                .join("・")}`,
          ]
            .filter(Boolean)
            .join(" | ")}
        </p>
      )}
      {/* 術前指示は病棟が手術前日〜当日に読むもの。要点 1 行と違って畳まず全文を出す
          (絶飲食の開始時刻や休薬の指示は、読み落とすと手術が中止になる)。 */}
      <SurgeryPreopInstruction summary={summary} />
      <SurgeryPerformSection performs={performs} />
    </>
  );
}

// 術前指示。テンプレートから記載したシェーマ画像は、平文の「あり」の印に代えて
// 実物を続けて出す(放射線の特別指示と同じ見せ方)。
function SurgeryPreopInstruction({ summary }: { summary: SurgeryOrderSummary }) {
  const lines = schemaAnnotatedLines(summary.preopInstruction);
  const responseId = summary.preopInstructionResponseId;
  if (lines.length === 0 && !responseId) return null;

  return (
    <div className="karte-rp__detail karte-rp__detail--indent">
      <span className="karte-rp__detail-label">術前指示:</span>
      <div className="karte-rp__detail-body">
        {lines.map((line, index) => (
          <span key={index}>{line}</span>
        ))}
        {responseId && <ResponseSchemaImages responseId={responseId} />}
      </div>
    </div>
  );
}

// 手術一覧から入力した実施情報。他部門と同じ見せ方だが、実施時刻が幅(入室〜退室)で、
// 測定値と記録(創分類・カウント・合併症・転帰)の行が増える。
const SURGERY_PERFORM_ROWS: {
  label: string;
  of: (perform: SurgeryPerformDisplay) => string[];
}[] = [
  { label: "術式", of: (perform) => perform.procedures },
  { label: "スタッフ", of: (perform) => perform.staff },
  { label: "時刻", of: (perform) => perform.times },
  { label: "測定", of: (perform) => perform.observations },
  { label: "記録", of: (perform) => perform.records },
  { label: "薬剤", of: (perform) => perform.medicines },
  { label: "材料", of: (perform) => perform.materials },
];

function SurgeryPerformSection({ performs }: { performs: SurgeryPerformDisplay[] }) {
  if (performs.length === 0) return null;

  return (
    <>
      {performs.map((perform) => (
        <section className="karte-perform" key={perform.id}>
          <div className="karte-perform__head">
            <span className="karte-perform__title">実施情報</span>
            {perform.periodLabel && (
              <span className="karte-perform__meta">{perform.periodLabel}</span>
            )}
            {/* 実施記録があるのに実施まで至っていない例外。 */}
            {perform.statusNote && (
              <span className="karte-perform__status">{perform.statusNote}</span>
            )}
          </div>
          {SURGERY_PERFORM_ROWS.map(({ label, of }) => {
            const values = of(perform);
            if (values.length === 0) return null;
            return (
              <div className="karte-perform__row" key={label}>
                <span className="karte-perform__label">{label}:</span>
                <span className="karte-perform__values">
                  {values.map((value, index) => (
                    <span key={`${label}-${index}`}>{value}</span>
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
