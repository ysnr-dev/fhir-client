import { DETAIL_KINDS, type KarteDetailKind } from "../karteUrl";

// 診療記録の本文に貼る、カルテ内のリソースへのリンク。
//
//   <a href="DiagnosticReport/abc" data-karte-link="lab-result">検査結果 2026-09-05</a>
//
// href は FHIR の相対参照(型/id)で、アプリの URL ではない。data-karte-link は
// 開き方で、詳細モーダルの種別(KarteDetailKind)か、タブで開くファイル・DICOM。
// クリップボードに載せる HTML だけは data-patient で患者を添え、貼り付け時に
// 別患者のリンクを落とす(本文には残さない)。

export type KarteLinkKind = KarteDetailKind | "file" | "imaging";

export interface KarteLink {
  kind: KarteLinkKind;
  resourceType: string;
  id: string;
  label: string;
}

export const KARTE_LINK_ATTR = "data-karte-link";
export const KARTE_LINK_PATIENT_ATTR = "data-patient";

const REFERENCE_PATTERN = /^([A-Z][A-Za-z]+)\/([A-Za-z0-9\-.]{1,64})$/;

const LINK_KINDS = new Set<string>([...DETAIL_KINDS, "file", "imaging"]);

export function isKarteLinkHref(href: string): boolean {
  return REFERENCE_PATTERN.test(href);
}

function isKarteLinkKind(value: string): value is KarteLinkKind {
  return LINK_KINDS.has(value);
}

/** 参照(型/id)と開き方からリンクを読む。形が崩れていれば null。 */
export function parseKarteLink(reference: string, kind: string, label: string): KarteLink | null {
  const match = REFERENCE_PATTERN.exec(reference);
  if (!match || !isKarteLinkKind(kind)) return null;
  return { kind, resourceType: match[1], id: match[2], label };
}

/** 本文中の <a> をリンクとして読む。 */
export function parseKarteLinkAnchor(anchor: Element): KarteLink | null {
  return parseKarteLink(
    anchor.getAttribute("href") ?? "",
    anchor.getAttribute(KARTE_LINK_ATTR) ?? "",
    anchor.textContent ?? "",
  );
}

/** クリップボードに載せる HTML。 */
export function karteLinkHtml(link: KarteLink, patientId: string): string {
  const anchor = document.createElement("a");
  anchor.setAttribute("href", `${link.resourceType}/${link.id}`);
  anchor.setAttribute(KARTE_LINK_ATTR, link.kind);
  anchor.setAttribute(KARTE_LINK_PATIENT_ATTR, patientId);
  anchor.textContent = link.label;
  return anchor.outerHTML;
}

/**
 * 貼り付けられた href を参照(型/id)に戻す。ブラウザはクリップボードへ書くときに
 * 相対 URL をページ基準の絶対 URL に解決するので、同じオリジンの URL なら末尾の
 * 型/id を取り出す。戻せなければ空文字。
 */
function pastedReference(href: string): string {
  if (REFERENCE_PATTERN.test(href)) return href;
  try {
    const url = new URL(href);
    if (url.origin !== window.location.origin) return "";
    return /[A-Z][A-Za-z]+\/[A-Za-z0-9\-.]{1,64}$/.exec(url.pathname)?.[0] ?? "";
  } catch {
    return "";
  }
}

/**
 * 貼り付ける HTML から、別患者のリンクと形の崩れたリンクを文字だけにし、
 * 残ったリンクの患者属性を落とす。
 */
export function sanitizePastedKarteLinks(html: string, patientId: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.body.querySelectorAll("a").forEach((anchor) => {
    const reference = pastedReference(anchor.getAttribute("href") ?? "");
    if (reference) anchor.setAttribute("href", reference);
    const patient = anchor.getAttribute(KARTE_LINK_PATIENT_ATTR);
    if (!parseKarteLinkAnchor(anchor) || (patient && patient !== patientId)) {
      anchor.replaceWith(...Array.from(anchor.childNodes));
      return;
    }
    anchor.removeAttribute(KARTE_LINK_PATIENT_ATTR);
  });
  return doc.body.innerHTML;
}

/** ラベルの部品を空白でつなぐ。 */
export function karteLinkLabel(...parts: (string | undefined | null | false)[]): string {
  return parts
    .map((part) => (part || "").trim())
    .filter(Boolean)
    .join(" ");
}
