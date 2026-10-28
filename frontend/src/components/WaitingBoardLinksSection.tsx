import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { useLocationOptions } from "../api/queries";
import {
  useIssuedWaitingBoardLink,
  useRevokeWaitingBoardLink,
  useWaitingBoardLinks,
} from "../api/waitingBoardQueries";
import { OUTPATIENT_ROOM_TYPE_CODE, locationTypeCode } from "../fhir/locationHelpers";
import { dateTimeLabel } from "../lib/dates";
import { ErrorBanner } from "./ErrorBanner";
import { CopyIcon } from "./icons/CopyIcon";
import { OpenIcon } from "./icons/OpenIcon";
import { TrashIcon } from "./icons/TrashIcon";

// 施設設定「待合表示板」の区画(docs/waiting-board-design.md §3.2)。ロビーのモニターが開くリンクの
// 発行・表示・取消。施設設定の保存(フォーム全体の submit)とは別に、この区画のボタンがその場で書く。
// 親が 1 つの <form> なので、ここに <form> は置かずボタンはすべて type="button"。

export function WaitingBoardLinksSection() {
  const links = useWaitingBoardLinks();
  const revoke = useRevokeWaitingBoardLink();
  const locations = useLocationOptions();
  const rooms = locations.locations.filter((l) => locationTypeCode(l) === OUTPATIENT_ROOM_TYPE_CODE);
  const roomName = (id: string) => rooms.find((r) => r.id === id)?.name ?? id;

  const [label, setLabel] = useState("");
  const [roomIds, setRoomIds] = useState<string[]>([]);
  // 「発行」を押したときの印。押すたびに変えて 1 本発行し、応答(URL)は次に押すまで出しておく。
  const [issueNonce, setIssueNonce] = useState("");
  const [issuePayload, setIssuePayload] = useState({ label: "", location_ids: [] as string[] });
  const issued = useIssuedWaitingBoardLink(issuePayload, issueNonce);

  function toggleRoom(id: string, checked: boolean) {
    setRoomIds((prev) => (checked ? [...prev, id] : prev.filter((r) => r !== id)));
  }

  function issue() {
    setIssuePayload({ label: label.trim(), location_ids: roomIds });
    setIssueNonce(Math.random().toString(36).slice(2));
    setLabel("");
    setRoomIds([]);
  }

  return (
    <div className="facility-settings__schedule-body">
      <ErrorBanner error={links.error ?? revoke.error ?? issued.error} />
      {links.data && links.data.length > 0 && (
        <table className="patient-table waiting-board-links">
          <thead>
            <tr>
              <th>名前</th>
              <th>診察室</th>
              <th>発行</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {links.data.map((link) => (
              <tr key={link.id}>
                <td>{link.label}</td>
                <td>{link.location_ids.length === 0 ? "すべて" : link.location_ids.map(roomName).join("、")}</td>
                <td>
                  {dateTimeLabel(link.created_at)}
                  {link.created_by_name ? ` ${link.created_by_name}` : ""}
                </td>
                <td>
                  <div className="waiting-board-links__actions">
                    <button
                      type="button"
                      className="rp-card__icon-button"
                      title={link.path ? `${link.label} を表示` : "発行し直してください"}
                      aria-label={`${link.label} を表示`}
                      disabled={!link.path}
                      onClick={() => link.path && window.open(link.path, "_blank", "noopener")}
                    >
                      <OpenIcon />
                    </button>
                    <button
                      type="button"
                      className="rp-card__icon-button"
                      title={`${link.label} を削除`}
                      aria-label={`${link.label} を削除`}
                      disabled={revoke.isPending}
                      onClick={() => revoke.mutate(link.id)}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <label>
        名前
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          aria-label="表示板の名前"
        />
      </label>
      <fieldset className="waiting-board-links__rooms">
        <legend>診察室</legend>
        {rooms.map((room) => (
          <label key={room.id} className="connection-settings-form__checkbox">
            <input
              type="checkbox"
              checked={roomIds.includes(room.id ?? "")}
              onChange={(e) => toggleRoom(room.id ?? "", e.target.checked)}
            />
            {room.name}
          </label>
        ))}
      </fieldset>
      <div>
        <button
          type="button"
          className="rp-card__compact-button"
          disabled={!label.trim() || issued.isFetching}
          onClick={issue}
        >
          発行
        </button>
      </div>

      {issued.isFetching && <p>発行中...</p>}
      {issued.data && <IssuedLink path={issued.data.path} label={issued.data.label} />}
    </div>
  );
}

/** 発行したリンクの URL と QR。次に発行するか画面を離れるまで出しておく。 */
function IssuedLink({ path, label }: { path: string; label: string }) {
  const url = `${window.location.origin}${path}`;
  const [image, setImage] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 440 }).then(setImage).catch(() => setImage(""));
  }, [url]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // クリップボードが使えない環境では手動コピーに任せる。
    }
  }

  return (
    <div className="intake-qr">
      <p className="intake-qr__meta">{label}</p>
      {image && <img className="intake-qr__image" src={image} alt="表示板の QR コード" />}
      <div className="client-secret-modal__field">
        <span className="client-secret-modal__label">URL</span>
        <pre className="client-secret-modal__value">{url}</pre>
        <span className="intake-qr__copy">
          <button type="button" className="rp-card__icon-button" title="URLをコピー" aria-label="URLをコピー" onClick={copy}>
            <CopyIcon />
          </button>
          {copied && <span className="intake-qr__copied">コピーしました</span>}
        </span>
      </div>
    </div>
  );
}
