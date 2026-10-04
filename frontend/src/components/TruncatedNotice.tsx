import type { ReactNode } from "react";

/** 取得の上限に達して表示が欠けていることを知らせる。 */
export function TruncatedNotice({ show, children }: { show: boolean | undefined; children?: ReactNode }) {
  if (!show) return null;
  return (
    <p className="error-banner__line error-banner__line--error" role="status">
      {children ?? "件数が多いため、一部のみ表示しています。"}
    </p>
  );
}
