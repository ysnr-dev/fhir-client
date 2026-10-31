import type { AdverseEventRecord } from "../../fhir/adverseEventHelpers";

/**
 * 有害事象のカードの本文。Grade(3 以上は赤)と発現〜回復の期間、対処・経過。
 * 用語と原因の治療は見出しに出す。
 */
export function AdverseEventCardBody({ record }: { record: AdverseEventRecord }) {
  return (
    <>
      <p className="karte-adverse-event__context">
        <span className={`regimen-adverse__grade regimen-adverse__grade--${record.grade}`}>Grade {record.grade}</span>
        <span>{`${record.onset} 〜 ${record.resolved || "継続中"}`}</span>
      </p>
      {record.note && <p className="karte-pathway-eval__text">{record.note}</p>}
    </>
  );
}
