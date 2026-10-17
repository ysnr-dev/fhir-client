import { Link } from "react-router-dom";
import { appMenuLabelOf } from "../../appMenu";
import { HomeCardFrame, type HomeCardProps } from "./shared";

/** よく使う画面へのリンク集。候補はヘッダーのメニュー(appMenu.ts)と同じ。 */
export function ShortcutsCard({ card }: HomeCardProps<"shortcuts">) {
  const links = card.settings.links.flatMap((to) => {
    const label = appMenuLabelOf(to);
    return label ? [{ to, label }] : [];
  });
  return (
    <HomeCardFrame title="ショートカット">
      {links.length === 0 ? (
        <p className="home__empty">画面を選んでいません。</p>
      ) : (
        <ul className="home__shortcuts">
          {links.map((link) => (
            <li key={link.to}>
              <Link className="button" to={link.to}>
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </HomeCardFrame>
  );
}
