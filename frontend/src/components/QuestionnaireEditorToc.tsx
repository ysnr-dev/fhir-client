import { ITEM_TYPE_LABELS, type EditorItem } from "../fhir/questionnaireHelpers";
import { EditorToc, type EditorTocEntry } from "./EditorToc";

// テンプレート編集画面の左に出す目次。区画と項目のツリーを並べ、押すとその位置へ移動する。
// 移動先は QuestionnaireEditor の区画と QuestionnaireItemEditor の項目に振った id。

export const QE_SECTIONS = [
  { id: "qe-section-meta", label: "テンプレート情報" },
  { id: "qe-section-observation", label: "回答から Observation を生成" },
  { id: "qe-section-variables", label: "変数(FHIRPath)" },
  { id: "qe-section-items", label: "項目" },
] as const;

export function qeItemAnchorId(itemId: string): string {
  return `qe-item-${itemId}`;
}

function itemEntries(items: EditorItem[]): EditorTocEntry[] {
  return items.map((item) => ({
    anchorId: qeItemAnchorId(item.id),
    type: ITEM_TYPE_LABELS[item.type],
    text: item.text || item.linkId,
    children: itemEntries(item.children),
  }));
}

export function QuestionnaireEditorToc({ items }: { items: EditorItem[] }) {
  const sections: EditorTocEntry[] = QE_SECTIONS.map((section) => ({
    anchorId: section.id,
    text: section.label,
    children: section.id === "qe-section-items" ? itemEntries(items) : [],
  }));
  return <EditorToc sections={sections} />;
}
