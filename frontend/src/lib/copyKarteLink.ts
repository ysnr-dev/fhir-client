import { karteLinkHtml, type KarteLink } from "../fhir/karteLinkHelpers";

// 「リンク取得」。HTML(リンク)と文字の両方を載せ、診療記録のエディタに
// 貼るとリンクに、他所へ貼ると文字になるようにする。
export async function copyKarteLink(link: KarteLink, patientId: string): Promise<void> {
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([karteLinkHtml(link, patientId)], { type: "text/html" }),
        "text/plain": new Blob([link.label], { type: "text/plain" }),
      }),
    ]);
  } catch {
    alert("リンクをコピーできませんでした。");
  }
}
