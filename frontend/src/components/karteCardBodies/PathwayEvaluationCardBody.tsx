import type { PathwayEvaluationCard } from "../../fhir/pathwayKarteHelpers";

/**
 * パス評価のカードの本文。どのパスのどの病日か、S/O/A/P(書いた欄だけ)または自由記載、コメント。
 * 達成状態は見出しのメタに出し、未達成(バリアンス)は本文の先頭でも目立たせる。
 */
export function PathwayEvaluationCardBody({ evaluation }: { evaluation: PathwayEvaluationCard }) {
  return (
    <>
      <p className="karte-pathway-eval__context">
        <span>{evaluation.pathwayTitle}</span>
        <span>{`${evaluation.eventLabel}${evaluation.eventDate ? `(${evaluation.eventDate})` : ""}`}</span>
        {evaluation.achievement === "2" && (
          <span className="karte-pathway-eval__variance">{evaluation.achievementLabel}</span>
        )}
      </p>
      {evaluation.soap.map((item) => (
        <div className="karte-card__section" key={item.code}>
          <span className="karte-card__section-title">{item.code}</span>
          <p className="karte-pathway-eval__text">{item.text}</p>
        </div>
      ))}
      {evaluation.freeText && <p className="karte-pathway-eval__text">{evaluation.freeText}</p>}
      {evaluation.comment && (
        <div className="karte-card__section">
          <span className="karte-card__section-title">コメント</span>
          <p className="karte-pathway-eval__text">{evaluation.comment}</p>
        </div>
      )}
    </>
  );
}
