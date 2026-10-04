import {
  organLabel,
  pathoOrderClinicalInfo,
  pathoOrderClinicalInfoTemplate,
  pathoOrderComment,
  pathoOrderSchemas,
  pathoOrderSpecimens,
  pathoSchemaImageRefs,
  specimenTypeDisplay,
} from "../../fhir/pathoOrderHelpers";
import {
  schemaAnnotatedLines,
} from "../../fhir/questionnaireResponseHelpers";
import { ResponseSchemaImages, SchemaImageGallery } from "../SchemaImageGallery";

// 病理は検体を番号付きで並べ、臨床経過を添える。検体が複数あるのが普通なので、
// 検体 1 件を 1 行にして「① 胃前庭部（生検・EMR）」の形で読めるようにする。
export function PathoOrderCardBody({
  serviceRequest,
  itemRequests,
}: {
  serviceRequest: fhir4.ServiceRequest;
  itemRequests: fhir4.ServiceRequest[];
}) {
  const specimens = pathoOrderSpecimens(itemRequests);
  const comment = pathoOrderComment(serviceRequest);
  // テンプレートから書いた臨床経過は「(シェーマ画像あり)」の印を落として本文だけ出し、
  // 画像は下にサムネイルで並べる(放射線オーダーのカードと同じ見せ方)。
  const clinicalInfo = schemaAnnotatedLines(pathoOrderClinicalInfo(serviceRequest)).join("\n");
  const clinicalInfoResponseId = pathoOrderClinicalInfoTemplate(serviceRequest)?.responseId ?? "";
  const schemas = pathoOrderSchemas(serviceRequest);

  if (specimens.length === 0) return <p className="karte-card__empty">検体がありません。</p>;

  return (
    <>
      <div className="karte-rp">
        <ul className="karte-rp__medicines">
          {specimens.map((specimen, index) => {
            const detail = [
              specimen.typeName || specimenTypeDisplay(specimen.typeCode),
              specimen.methodName,
            ]
              .filter(Boolean)
              .join("・");
            return (
              <li key={specimen.id || index}>
                <span className="karte-rp__number">{index + 1}</span>
                <span className="karte-rp__medicine-name">{organLabel(specimen) || "臓器未設定"}</span>
                {detail && <span className="karte-rp__detail-label">{`（${detail}）`}</span>}
                {specimen.note && <span>{specimen.note}</span>}
              </li>
            );
          })}
        </ul>
        {clinicalInfo && (
          <div className="karte-rp__detail karte-rp__detail--indent">
            <span className="karte-rp__detail-label">臨床経過:</span>
            <span>{clinicalInfo}</span>
          </div>
        )}
      </div>
      {/* テンプレート記入内のシェーマと、オーダーに添えたシェーマ(AP-031)。 */}
      {clinicalInfoResponseId && <ResponseSchemaImages responseId={clinicalInfoResponseId} />}
      {schemas.length > 0 && <SchemaImageGallery refs={pathoSchemaImageRefs(schemas)} />}
      {comment && <p className="karte-card__note">{comment}</p>}
    </>
  );
}
