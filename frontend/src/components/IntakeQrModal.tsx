import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { useIssuedIntakeLink } from "../api/intakeQueries";
import { dateTimeLabel } from "../lib/dates";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

// Web 問診の QR(docs/web-intake-design.md §3.2)。開いた時点でリンクを発行し、QR と URL を出す。
// トークンは発行の応答にしか出ないので、閉じたら同じ QR は出せない(もう一度開くと発行し直す)。

export function IntakeQrModal({
  appointmentId,
  patientId,
  patientName,
  onClose,
}: {
  appointmentId?: string;
  patientId?: string;
  patientName: string;
  onClose: () => void;
}) {
  const [nonce] = useState(() => Math.random().toString(36).slice(2));
  const issue = useIssuedIntakeLink(appointmentId ? { appointment_id: appointmentId } : { patient_id: patientId }, nonce);
  const link = issue.data ?? null;
  const [image, setImage] = useState("");
  const [copied, setCopied] = useState(false);
  const url = link ? `${window.location.origin}${link.path}` : "";

  useEffect(() => {
    if (!url) return;
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
    <Modal title={`問診 QR - ${patientName}`} onClose={onClose}>
      <ErrorBanner error={issue.error} />
      {issue.isPending && <p>発行中...</p>}
      {link && (
        <div className="intake-qr">
          {image && <img className="intake-qr__image" src={image} alt="問診の QR コード" />}
          <div className="client-secret-modal__field">
            <span className="client-secret-modal__label">URL</span>
            <pre className="client-secret-modal__value">{url}</pre>
            <button type="button" onClick={copy}>
              {copied ? "コピーしました" : "コピー"}
            </button>
          </div>
          <p className="intake-qr__meta">有効期限 {dateTimeLabel(link.expires_at)}・質問票 {link.questionnaire_urls.length} 本</p>
        </div>
      )}
    </Modal>
  );
}
