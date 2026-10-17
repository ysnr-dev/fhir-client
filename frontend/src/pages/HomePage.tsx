import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useCurrentPractitioner } from "../api/authQueries";
import { useHomeLayout } from "../api/masterQueries";
import { usePractitionerRoles } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { HomeCardView } from "../components/homeCards";
import { HomeLayoutEditorModal } from "../components/HomeLayoutEditorModal";
import { defaultHomeCards, HOME_POLLING_KINDS, normalizeHomeCards } from "../fhir/homeCards";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import {
  parseDepartmentRoles,
  parsePractitionerRole,
  practitionerRoleLabel,
} from "../fhir/practitionerRoleHelpers";
import { useStoredToggle } from "../hooks/useStoredToggle";
import { today } from "../lib/dates";

// ホーム(トップページ)。ログインした人の「今日の仕事」をカードで 1 画面に集める。
// 並べるカードは本人が保存した設定(backend の home_layouts)で、無ければ職種の既定
// (fhir/homeCards.ts の defaultHomeCards)。ここは cards の順に部品を並べるだけ。
// 各カードは対応する一覧ページと同じ hook で読むので、カードから一覧へ移っても読み直さない。

// 自動更新の入り切り。既定は切ってある(外来一覧・通知のベルと同じ考え方)。
const POLLING_STORAGE_KEY = "fhir-client.home.polling";

export function HomePage() {
  const { user, practitionerId, practitioner, sessionLoading } = useCurrentPractitioner();
  const roles = usePractitionerRoles(practitionerId ?? undefined);
  const roleCode = roles.role ? parsePractitionerRole(roles.role).roleCode : undefined;
  const departments = useMemo(() => parseDepartmentRoles(roles.roles), [roles.roles]);
  const layout = useHomeLayout(practitionerId);
  const loading = sessionLoading || (Boolean(practitionerId) && (roles.isPending || layout.isPending));
  const administrator = Boolean(user?.administrator);
  const defaults = useMemo(
    () => defaultHomeCards({ administrator, practitionerId, roleCode }),
    [administrator, practitionerId, roleCode],
  );
  const cards = useMemo(
    () => normalizeHomeCards(layout.data?.definition) ?? defaults,
    [layout.data, defaults],
  );
  const date = today();

  const [polling, setPolling] = useStoredToggle(POLLING_STORAGE_KEY);
  const [editing, setEditing] = useState(false);
  const showPolling = cards.some((card) => HOME_POLLING_KINDS.includes(card.kind));

  // カードの中の表を折り返さずに出すため、一覧ページと同じく本文の幅制限を外す。
  // page-home はカードを画面の高さに合わせるため、アプリ全体の高さを画面に固定する。
  useEffect(() => {
    document.body.classList.add("page-wide", "page-home");
    return () => document.body.classList.remove("page-wide", "page-home");
  }, []);

  return (
    <div className="page home">
      <div className="page__header">
        <h1>ホーム</h1>
        <div className="page__header-title">
          {practitioner && (
            <span className="home__profile">
              <span>{practitionerDisplayName(practitioner)}</span>
              <span>
                {roleCode ? (
                  practitionerRoleLabel(roleCode)
                ) : (
                  <Link to={`/practitioners/${practitionerId}/edit`}>職種未登録</Link>
                )}
              </span>
              {departments.map((department) => (
                <span key={department.organizationId} className="home__profile-dept">
                  {department.name}
                  {department.primary && departments.length > 1 ? "(既定)" : ""}
                </span>
              ))}
            </span>
          )}
          {showPolling && (
            <label className="outpatient__polling">
              <input
                type="checkbox"
                checked={polling}
                onChange={(e) => setPolling(e.target.checked)}
              />
              自動更新
            </label>
          )}
          {practitionerId && !loading && (
            <button type="button" className="rp-card__compact-button" onClick={() => setEditing(true)}>
              編集
            </button>
          )}
        </div>
      </div>
      <ErrorBanner error={roles.error ?? layout.error} />
      {loading ? (
        <p>読み込み中...</p>
      ) : (
        <div className="home__grid">
          {cards.map((card) => (
            <HomeCardView
              key={card.id}
              card={card}
              date={date}
              practitionerId={practitionerId}
              polling={polling}
            />
          ))}
        </div>
      )}
      {editing && practitionerId && (
        <HomeLayoutEditorModal
          cards={cards}
          saved={layout.data?.definition != null}
          practitionerId={practitionerId}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}
