import type { KarteImportantDay } from "../api/masterClient";
import { FlagIcon } from "./icons/FlagIcon";
import { karteImportantDaySeverityLabel } from "./karteImportantDay";

// 重要日の印(旗)。重要度を色で分け、低だけは輪郭の旗にして色に頼らず区別できるようにする。
// ツールチップに重要度と理由を出す。診療日ペインの日付の右と、タイムラインの日付見出しで使う。

export function KarteImportantDayMark({ entry }: { entry: KarteImportantDay }) {
  const title = [`重要度: ${karteImportantDaySeverityLabel(entry.severity)}`, entry.comment]
    .filter(Boolean)
    .join(" ");
  return (
    <span
      className={`karte-important-mark karte-important-mark--${entry.severity}`}
      title={title}
      aria-label={title}
      role="img"
    >
      <FlagIcon filled={entry.severity !== "low"} />
    </span>
  );
}
