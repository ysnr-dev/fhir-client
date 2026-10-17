import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { HomeCardKind, HomeCardOf } from "../../fhir/homeCards";

// ホームのカードの共通部品。カード 1 枚は section.home__card で、見出し(h2 + 一覧へのリンク)を
// 上に留め、中身が高さを超えたらカードの中で送る(CSS は App.css の .home__card)。

export interface HomeCardProps<K extends HomeCardKind> {
  card: HomeCardOf<K>;
  /** 今日(lib/dates の today)。日付で読むカードはこの日を読む。 */
  date: string;
  practitionerId: string | null;
  /** 自動更新(外来・救急のカードだけが使う)。 */
  polling: boolean;
}

export function HomeCardFrame({
  title,
  link,
  actions,
  wide,
  children,
}: {
  title: ReactNode;
  /** 見出しの右の一覧へのリンク。 */
  link?: { to: string; label: string };
  /** リンクの左に置くボタン類。 */
  actions?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={wide ? "home__card home__card--wide" : "home__card"}>
      <div className="home__card-header">
        <h2>{title}</h2>
        {actions ? (
          <span className="home__card-actions">
            {actions}
            {link && <Link to={link.to}>{link.label}</Link>}
          </span>
        ) : (
          link && <Link to={link.to}>{link.label}</Link>
        )}
      </div>
      {children}
    </section>
  );
}

export function HomeCardLoading() {
  return <p className="home__empty">読み込み中...</p>;
}

export function HomeCardTruncated({ children }: { children: ReactNode }) {
  return (
    <p className="error-banner__line error-banner__line--warning" role="status">
      {children}
    </p>
  );
}
