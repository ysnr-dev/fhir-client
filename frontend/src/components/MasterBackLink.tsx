import { Link, useLocation } from "react-router-dom";
import { masterBackPath } from "../masterMenu";

/** マスタの画面の見出しの行に置く「戻る」。行き先は masterBackPath(マスタの画面でなければ出さない)。 */
export function MasterBackLink() {
  const { pathname } = useLocation();
  const to = masterBackPath(pathname);
  if (!to) return null;
  return (
    <Link to={to} className="button">
      戻る
    </Link>
  );
}
