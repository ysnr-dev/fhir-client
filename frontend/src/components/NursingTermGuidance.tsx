import type { NursingTerm } from "../api/masterClient";
import { NURSING_DIAGNOSIS_TYPE_LABELS, NURSING_ITEM_TYPE_LABELS } from "../fhir/nursingCarePlanHelpers";

/** 看護診断の定義・ガイダンス・付随項目。立案のパネルでも使う。 */
export function NursingTermGuidance({ term }: { term: NursingTerm }) {
  const types = [...new Set(term.items.map((i) => i.item_type))];
  return (
    <dl className="nursing-plan__guidance">
      <dt>コード</dt>
      <dd>
        {term.code}
        {term.diagnosis_type && ` (${NURSING_DIAGNOSIS_TYPE_LABELS[term.diagnosis_type]})`}
      </dd>
      {term.definition && (
        <>
          <dt>定義</dt>
          <dd>{term.definition}</dd>
        </>
      )}
      {term.guidance && (
        <>
          <dt>ガイダンス</dt>
          <dd>{term.guidance}</dd>
        </>
      )}
      {types.map((type) => (
        <div key={type}>
          <dt>{NURSING_ITEM_TYPE_LABELS[type]}</dt>
          <dd>{term.items.filter((i) => i.item_type === type).map((i) => i.name).join(" / ")}</dd>
        </div>
      ))}
    </dl>
  );
}
