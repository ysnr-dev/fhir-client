import { useMemo } from "react";
import { summarizeTaskStatuses } from "../../fhir/homeSections";
import { ErrorBanner } from "../ErrorBanner";
import { HomeCardFrame, HomeCardLoading, HomeCardTruncated } from "./shared";

export interface HomeCountsCardProps {
  title: string;
  /** 一覧ページ。 */
  path: string;
  isPending: boolean;
  error: unknown;
  /** 行ごとの Task の状態(Task 無しは requested)。読み込み前は undefined。 */
  statuses: string[] | undefined;
  /** 状態コード → 表示名。部門ごとの語彙(受付済 / 実施中 / 出庫済 …)で出す。 */
  options: { code: string; display: string }[];
  /** 大きな数字。省略すると completed / cancelled 以外の件数。 */
  open?: number;
  openLabel?: string;
  truncated?: boolean;
  /** 部門固有の補足(リハビリの「本日未実施」など)。 */
  extra?: { label: string; count: number }[];
}

/** 件数だけのカード。部門ワークリストと、他科依頼・チーム依頼・看護指示・化学療法室が使う。 */
export function HomeCountsCard({
  title,
  path,
  isPending,
  error,
  statuses,
  options,
  open,
  openLabel = "未処理",
  truncated,
  extra,
}: HomeCountsCardProps) {
  const summary = useMemo(() => summarizeTaskStatuses(statuses ?? []), [statuses]);
  return (
    <HomeCardFrame title={title} link={{ to: path, label: "一覧" }}>
      <ErrorBanner error={error} />
      {isPending ? (
        <HomeCardLoading />
      ) : (
        <>
          <p className="home__counts">
            <span className="home__count home__count--big">
              {openLabel} <strong>{open ?? summary.open}</strong>
            </span>
          </p>
          <p className="home__counts">
            {options
              .filter((option) => (summary.byStatus.get(option.code) ?? 0) > 0)
              .map((option) => (
                <span key={option.code} className="home__count">
                  {option.display} <strong>{summary.byStatus.get(option.code)}</strong>
                </span>
              ))}
            {extra?.map((item) => (
              <span key={item.label} className="home__count">
                {item.label} <strong>{item.count}</strong>
              </span>
            ))}
          </p>
          {truncated && <HomeCardTruncated>件数が多いため、一部のみ数えています。</HomeCardTruncated>}
        </>
      )}
    </HomeCardFrame>
  );
}
