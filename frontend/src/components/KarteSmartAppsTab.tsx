import { useState } from "react";
import {
  useEmbeddedSmartAppLaunch,
  useLaunchableSmartApps,
  useSmartAppWindowLaunch,
} from "../api/smartAppsQueries";
import { ErrorBanner } from "./ErrorBanner";

// カルテ画面の「アプリ」タブ(docs/smart-app-launch-design.md §3.3)。登録済みの SMART アプリを
// 開いている患者・利用者の文脈(EHR launch)で起動し、枠内(iframe)に出す。
//
// 選択中のアプリは URL(view パラメータ)で表す。起動は患者・アプリ・受診が変わるたびに
// 行う(launch は単回使用で、別の患者の文脈を使い回せない)。アプリ側で画面を再読込すると
// 消費済みの launch で認可が失敗するので、「再起動」で新しい launch を発行する。

// アプリ自身のオリジンとして動かす(PKCE の verifier を sessionStorage に置く、CORS で
// 上流を呼ぶ)ために allow-same-origin が要る。カルテ本体を遷移させる allow-top-navigation
// は付けない。
const IFRAME_SANDBOX =
  "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads";

interface KarteSmartAppsTabProps {
  patientId: string;
  /** URL から渡される選択中のアプリ(smart_apps の id)。空なら未選択。 */
  view: string;
  onViewChange: (view: string | null) => void;
  /** 外来の診察中の Encounter。起動の文脈として渡す。 */
  encounterId?: string;
}

export function KarteSmartAppsTab({ patientId, view, onViewChange, encounterId }: KarteSmartAppsTabProps) {
  const apps = useLaunchableSmartApps();
  const [nonce, setNonce] = useState(0);
  const selected = apps.data?.find((app) => String(app.id) === view) ?? null;

  const embedded = selected?.display === "embed" ? selected : null;
  const launch = useEmbeddedSmartAppLaunch(
    embedded ? { appId: embedded.id, patientId, encounterId } : null,
    nonce,
  );
  const windowLaunch = useSmartAppWindowLaunch();

  function openInWindow() {
    if (!selected) return;
    // ポップアップブロックを避けるため、クリックの同期処理で空のウィンドウを先に開き、
    // 起動 URL が返ってから差し替える。
    const popup = window.open("", "_blank");
    if (popup) popup.opener = null;
    windowLaunch.mutate(
      { appId: selected.id, params: { patient_id: patientId, encounter_id: encounterId } },
      {
        onSuccess: (data) => {
          if (popup) popup.location.replace(data.launch_url);
          else window.open(data.launch_url, "_blank", "noopener,noreferrer");
        },
        onError: () => popup?.close(),
      },
    );
  }

  return (
    <div className="karte-tabpanel smart-app-tab">
      <div className="karte-tabpanel__header">
        <h3>アプリ</h3>
        {selected && selected.display === "embed" && (
          <div className="karte-tabpanel__actions">
            <button type="button" onClick={() => setNonce((n) => n + 1)} disabled={launch.isFetching}>
              再起動
            </button>
          </div>
        )}
      </div>

      <ErrorBanner error={apps.error} />

      {apps.data && apps.data.length === 0 && (
        <p className="smart-app-tab__empty">起動できるアプリがありません。</p>
      )}

      {apps.data && apps.data.length > 0 && (
        <div className="smart-app-tab__list" role="tablist" aria-label="アプリ">
          {apps.data.map((app) => (
            <button
              key={app.id}
              type="button"
              role="tab"
              aria-selected={selected?.id === app.id}
              className={`smart-app-tab__app${selected?.id === app.id ? " smart-app-tab__app--selected" : ""}`}
              onClick={() => onViewChange(String(app.id))}
            >
              {app.name}
            </button>
          ))}
        </div>
      )}

      {selected && selected.display === "window" && (
        <div className="smart-app-tab__window">
          <button type="button" onClick={openInWindow} disabled={windowLaunch.isPending}>
            開く
          </button>
          <ErrorBanner error={windowLaunch.error} />
        </div>
      )}

      {embedded && (
        <>
          <ErrorBanner error={launch.error} />
          {launch.isPending && !launch.error && <p className="smart-app-tab__status">起動中...</p>}
          {launch.data && (
            <iframe
              key={launch.data.launch_url}
              className="smart-app-tab__frame"
              src={launch.data.launch_url}
              title={embedded.name}
              sandbox={IFRAME_SANDBOX}
              allow="clipboard-write"
            />
          )}
          {launch.data && (
            <p className="smart-app-tab__hint">表示されないときは「再起動」を押してください。</p>
          )}
        </>
      )}
    </div>
  );
}
