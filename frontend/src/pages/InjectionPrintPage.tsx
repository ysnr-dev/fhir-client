import { useParams } from "react-router-dom";
import { injectionLabelPdfUrl, injectionPdfUrl } from "../api/reportsClient";

// 注射箋の発行で開く別タブ。注射箋(A5)と注射ラベル(80×60mm)は用紙もプリンタも違うので
// PDF は分けたまま、1 つのタブに並べてそれぞれのビューアから印刷する
// (ブラウザは 1 回のクリックで新規タブを 1 つしか開かせない)。

export function InjectionPrintPage() {
  const { orderId = "" } = useParams<{ orderId: string }>();

  return (
    <div className="injection-print">
      <section className="injection-print__panel injection-print__panel--order">
        <h2>注射箋</h2>
        <iframe title="注射箋" src={injectionPdfUrl(orderId)} />
      </section>
      <section className="injection-print__panel injection-print__panel--label">
        <h2>注射ラベル</h2>
        <iframe title="注射ラベル" src={injectionLabelPdfUrl(orderId)} />
      </section>
    </div>
  );
}
