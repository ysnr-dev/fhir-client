import type { InjectionPerformDisplay } from "../../fhir/injectionPerformHelpers";

// 注射の実施情報(施用 1 回ぶん)。輸血と同じ見た目で、薬剤と結果・理由を出す。
export function InjectionPerformSection({ perform }: { perform: InjectionPerformDisplay }) {
  const rows: { label: string; values: string[] }[] = [
    { label: "薬剤", values: perform.medicines },
    { label: "理由", values: perform.reason ? [perform.reason] : [] },
  ];
  return (
    <section className="karte-perform">
      <div className="karte-perform__head">
        <span className="karte-perform__title">実施情報</span>
        {perform.performedAt && <span className="karte-perform__meta">{perform.performedAt}</span>}
        {perform.performerName && (
          <span className="karte-perform__meta">{perform.performerName}</span>
        )}
        {/* 施用まで至らなかった記録(途中で中止・実施せず)。 */}
        {perform.statusNote && <span className="karte-perform__status">{perform.statusNote}</span>}
      </div>
      {rows.map(({ label, values }) =>
        values.length === 0 ? null : (
          <div className="karte-perform__row" key={label}>
            <span className="karte-perform__label">{`${label}:`}</span>
            <span className="karte-perform__values">
              {values.map((value, index) => (
                <span key={index}>{value}</span>
              ))}
            </span>
          </div>
        ),
      )}
      {perform.comment && <p className="karte-perform__note">{perform.comment}</p>}
    </section>
  );
}
