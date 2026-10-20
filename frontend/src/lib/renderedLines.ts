// 画面に描いた要素を、差分で比べる「行」に起こす。innerText を丸ごと使うと
// 「ラベル」と「値」が別の行になり、見出しも本文も同じ見た目になって構造が読めないので、
// DOM を歩いて次のように起こす。
//   - dl の dt/dd は「ラベル: 値」の 1 行にまとめる
//   - 太字で描かれた行(見出し・RP 番号など)は strong として持つ
//   - 字下げは描画位置(左端からの距離)から段に直す
// 文字そのものは描画された文字(innerText)なので、画面に出ない要素は比べない。

export interface RenderedLine {
  text: string;
  /** 太字で描かれた行。差分でも太字にし、変更箇所の見出しとして残す。 */
  strong: boolean;
  /** 字下げの段。 */
  indent: number;
  /** 「ラベル: 値」の行のラベル部分の文字数(": " を含む)。 */
  labelLength?: number;
}

const INDENT_STEP_PX = 12;
const MAX_INDENT = 8;
const SAME_ROW_PX = 4;
const INLINE_DISPLAYS = new Set(["inline", "inline-block", "inline-flex", "inline-grid"]);
const FLOW_DISPLAYS = new Set(["flex", "inline-flex", "grid", "inline-grid"]);
const SKIPPED_TAGS = new Set(["BUTTON", "SCRIPT", "STYLE", "TEMPLATE"]);

export function renderedLines(root: HTMLElement): RenderedLine[] {
  const rootLeft = root.getBoundingClientRect().left;
  const lines: RenderedLine[] = [];

  const indentOf = (element: Element): number => {
    const left = element.getBoundingClientRect().left - rootLeft;
    return Math.min(MAX_INDENT, Math.max(0, Math.round(left / INDENT_STEP_PX)));
  };

  const push = (text: string, element: HTMLElement, strong: boolean, labelLength?: number) => {
    const indent = indentOf(element);
    let first = true;
    for (const raw of text.split("\n")) {
      const line = raw.replace(/\s+$/, "");
      if (line.trim() === "") continue;
      lines.push({
        text: line,
        strong,
        indent: first ? indent : indent + 1,
        labelLength: first ? labelLength : undefined,
      });
      first = false;
    }
  };

  const visitDefinitionList = (list: HTMLElement) => {
    for (const term of list.children) {
      if (term.tagName !== "DT" || !(term instanceof HTMLElement)) continue;
      const label = term.innerText.trim();
      const values: string[] = [];
      for (let next = term.nextElementSibling; next && next.tagName === "DD"; next = next.nextElementSibling) {
        if (next instanceof HTMLElement && isShown(next)) values.push(next.innerText.trim());
      }
      if (!isShown(term)) continue;
      const value = values.filter((v) => v !== "").join("\n");
      push(label === "" ? value : `${label}: ${value}`, term, false, label === "" ? undefined : label.length + 2);
    }
  };

  // flex・grid の子は横にも並ぶ(薬剤名と量、ラベルと値)。描画の上端が同じ子を 1 行にまとめ、
  // 1 つだけの行はそのまま辿る(中に段落や箇条書きがあることがある)。
  const visitRows = (element: HTMLElement) => {
    const children = [...element.children].filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && !SKIPPED_TAGS.has(child.tagName) && isShown(child),
    );
    const rows: { top: number; items: HTMLElement[] }[] = [];
    for (const child of children) {
      const top = child.getBoundingClientRect().top;
      const row = rows.find((r) => Math.abs(r.top - top) < SAME_ROW_PX);
      if (row) row.items.push(child);
      else rows.push({ top, items: [child] });
    }
    rows.sort((a, b) => a.top - b.top);
    for (const row of rows) {
      if (row.items.length === 1) {
        visit(row.items[0]);
        continue;
      }
      const items = row.items.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
      const text = items.map((item) => item.innerText.trim()).filter((t) => t !== "").join(" ");
      push(text, items[0], items.every(isStrong));
    }
  };

  const visit = (element: HTMLElement) => {
    if (SKIPPED_TAGS.has(element.tagName) || !isShown(element)) return;
    if (element.tagName === "DL") {
      visitDefinitionList(element);
      return;
    }
    if (element.tagName === "TR") {
      const cells = [...element.children]
        .filter((cell): cell is HTMLElement => cell instanceof HTMLElement && isShown(cell))
        .map((cell) => cell.innerText.trim());
      push(cells.join("\t"), element, isStrong(element));
      return;
    }
    const hasBlockChild = [...element.children].some((child) => child instanceof HTMLElement && isBlock(child));
    if (!hasBlockChild) {
      push(element.innerText, element, isStrong(element));
      return;
    }
    if (FLOW_DISPLAYS.has(getComputedStyle(element).display)) {
      visitRows(element);
      return;
    }
    // インラインの子と塊の子が混ざるときは、インラインの並びを 1 行にまとめる。
    let run = "";
    const flush = () => {
      if (run !== "") push(run, element, isStrong(element));
      run = "";
    };
    for (const node of element.childNodes) {
      if (node instanceof HTMLElement && isBlock(node)) {
        flush();
        visit(node);
      } else if (node instanceof HTMLElement) {
        if (!SKIPPED_TAGS.has(node.tagName)) run += node.innerText;
      } else if (node.nodeType === Node.TEXT_NODE) {
        run += (node.textContent ?? "").replace(/\s+/g, " ");
      }
    }
    flush();
  };

  visit(root);
  return lines;
}

function isShown(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

function isBlock(element: HTMLElement): boolean {
  const display = getComputedStyle(element).display;
  return display !== "none" && !INLINE_DISPLAYS.has(display);
}

const HEADING_TAGS = new Set(["H1", "H2", "H3", "H4", "H5", "H6", "LEGEND"]);

// 見出し(h1〜h6・legend)か太字で描かれているか。要素そのものが太字でなくても、
// 文字をすべて持つ唯一の子が太字なら太字とみなす(<div><span class="title">見出し</span></div> の形)。
function isStrong(element: HTMLElement): boolean {
  if (HEADING_TAGS.has(element.tagName) || element.getAttribute("role") === "heading") return true;
  const weight = getComputedStyle(element).fontWeight;
  if (weight === "bold" || weight === "bolder" || Number(weight) >= 600) return true;
  const only = element.children.length === 1 ? element.children[0] : null;
  if (only instanceof HTMLElement && only.textContent?.trim() === element.textContent?.trim()) {
    return isStrong(only);
  }
  return false;
}
