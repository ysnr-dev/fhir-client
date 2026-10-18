import { type Advisory, sortBySeverity } from "../fhir/advisoryHelpers";

// 警告(判断支援)の表示(docs/advisory-design.md §2.4)。フォームの先頭にまとめて出す一覧と、
// 薬剤行の下に出す印。どちらも種別を知らず、重さで色を変えるだけ。登録前の確認は
// `AdvisoryConfirmModal` が行う。

/** フォームの先頭に出す警告の一覧。重いものから並べる。無ければ何も出さない。 */
export function AdvisoryNotice({ advisories, className }: { advisories: Advisory[]; className?: string }) {
  if (advisories.length === 0) return null;
  return (
    <ul className={`advisory-notice${className ? ` ${className}` : ""}`} role="note">
      {sortBySeverity(advisories).map((advisory) => (
        <li key={advisory.key} className={`advisory advisory--${advisory.severity}`} title={advisory.detail}>
          {advisory.message}
          {advisory.source && (
            <span className="advisory__source">
              {advisory.source.url ? (
                <a href={advisory.source.url} target="_blank" rel="noopener noreferrer">
                  {advisory.source.label}
                </a>
              ) : (
                advisory.source.label
              )}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** 薬剤行の下に出す警告の印。確認を要するもの・止めるものは危険色。 */
export function AdvisoryInlineMarks({ advisories }: { advisories: Advisory[] | undefined }) {
  if (!advisories || advisories.length === 0) return null;
  return (
    <>
      {advisories.map((advisory) => (
        <span
          key={advisory.key}
          className={`medicine-warning medicine-warning--${advisory.kind}${
            advisory.severity === "info" ? "" : " medicine-warning--high"
          }`}
          title={advisory.detail}
          role="note"
        >
          {advisory.message}
        </span>
      ))}
    </>
  );
}
