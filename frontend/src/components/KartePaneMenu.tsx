import { useState, type ReactNode } from "react";
import { useCurrentPractitioner } from "../api/authQueries";
import { useKartePaneFavorite } from "../api/masterQueries";
import type { ProblemRef } from "../fhir/conditionHelpers";
import { useStoredToggle } from "../hooks/useStoredToggle";
import { KARTE_MENU_ITEMS, karteMenuFullLabel, karteMenuItemsOf, type KarteMenuItem } from "./karteMenu";
import { KartePaneFavoriteModal } from "./KartePaneFavoriteModal";
import type { KartePaneState } from "./KarteRightPane";

// カルテ右ペインの新規登録の入口(右端に縦並びのボタン列)。「全て」と、本人が選んだ「頻用」をタブで切り替える。

const FAVORITE_TAB_KEY = "karte-right-menu-favorite";

export function KartePaneMenu({
  selectedProblem,
  onStateChange,
}: {
  selectedProblem: ProblemRef | undefined;
  onStateChange: (state: KartePaneState) => void;
}) {
  const { practitionerId } = useCurrentPractitioner();
  const favorite = useKartePaneFavorite(practitionerId);
  // どちらのタブを見ていたかは端末ごとに覚える。頻用は医療従事者に紐付くので administrator には出さない。
  const [favoriteTab, setFavoriteTab] = useStoredToggle(FAVORITE_TAB_KEY);
  const [editing, setEditing] = useState(false);
  const showFavorite = Boolean(practitionerId) && favoriteTab;
  const favoriteItems = karteMenuItemsOf(favorite.data?.menu_keys ?? []);

  const button = (item: KarteMenuItem, label: string) => (
    <button key={item.key} type="button" onClick={() => onStateChange(item.open(selectedProblem))}>
      {label}
    </button>
  );

  return (
    <>
      <div className="karte-right__actions">
        {practitionerId && (
          <div className="karte-right__menu-tabs" role="tablist" aria-label="メニュー">
            {[
              { favorite: false, label: "全て" },
              { favorite: true, label: "頻用" },
            ].map((tab) => (
              <button
                key={tab.label}
                type="button"
                role="tab"
                aria-selected={tab.favorite === showFavorite}
                className={`karte-right__menu-tab${tab.favorite === showFavorite ? " karte-right__menu-tab--active" : ""}`}
                onClick={() => setFavoriteTab(tab.favorite)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}
        {showFavorite ? (
          <>
            {favoriteItems.map((item) => button(item, karteMenuFullLabel(item)))}
            <button type="button" className="karte-right__favorite-settings" onClick={() => setEditing(true)}>
              頻用設定
            </button>
          </>
        ) : (
          groupedItems().map((entry) =>
            "items" in entry ? (
              <PaneActionGroup key={entry.group} label={entry.group}>
                {entry.items.map((item) => button(item, item.label))}
              </PaneActionGroup>
            ) : (
              button(entry, entry.label)
            ),
          )
        )}
      </div>
      {editing && practitionerId && (
        <KartePaneFavoriteModal
          practitionerId={practitionerId}
          menuKeys={favoriteItems.map((item) => item.key)}
          onClose={() => setEditing(false)}
        />
      )}
    </>
  );
}

/** 「全て」の並び。同じ見出しの続くメニューを 1 つの見出しに束ねる。 */
function groupedItems(): (KarteMenuItem | { group: string; items: KarteMenuItem[] })[] {
  const entries: (KarteMenuItem | { group: string; items: KarteMenuItem[] })[] = [];
  for (const item of KARTE_MENU_ITEMS) {
    const last = entries[entries.length - 1];
    if (!item.group) entries.push(item);
    else if (last && "items" in last && last.group === item.group) last.items.push(item);
    else entries.push({ group: item.group, items: [item] });
  }
  return entries;
}

// 登録ボタン列の中で、同じ領域のボタンを見出しのボタンの下に畳む。
function PaneActionGroup({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="karte-right__group-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
        <span className="karte-right__group-caret" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open && (
        <div className="karte-right__group" role="group" aria-label={label}>
          {children}
        </div>
      )}
    </>
  );
}
