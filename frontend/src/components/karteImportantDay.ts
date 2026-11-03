import type { KarteImportantDaySeverity } from "../api/masterClient";

// カルテの重要日の重要度。表示順はこの並び(高が先)。

export const KARTE_IMPORTANT_DAY_SEVERITIES: {
  key: KarteImportantDaySeverity;
  label: string;
}[] = [
  { key: "high", label: "高" },
  { key: "medium", label: "中" },
  { key: "low", label: "低" },
];

export function karteImportantDaySeverityLabel(severity: KarteImportantDaySeverity): string {
  return KARTE_IMPORTANT_DAY_SEVERITIES.find((item) => item.key === severity)?.label ?? severity;
}
