import type { RegimenDraft } from "../fhir/regimenHelpers";
import { EditorToc, type EditorTocEntry } from "./EditorToc";

// レジメン編集画面の左に出す目次。区画と、投与内容の区画の下にステップを並べる。

export const RE_SECTIONS = {
  basic: "re-section-basic",
  indications: "re-section-indications",
  schedule: "re-section-schedule",
  steps: "re-section-steps",
  dayTable: "re-section-day-table",
  criteria: "re-section-criteria",
  adverseEvents: "re-section-adverse-events",
  references: "re-section-references",
  operation: "re-section-operation",
} as const;

export function regimenStepAnchorId(stepKey: number): string {
  return `re-step-${stepKey}`;
}

export function RegimenEditorToc({ draft, showDayTable }: { draft: RegimenDraft; showDayTable: boolean }) {
  const steps: EditorTocEntry[] = draft.steps.map((step, index) => ({
    anchorId: regimenStepAnchorId(step.key),
    type: String(index + 1),
    text: step.name.trim() || step.drugs[0]?.medicine?.name || "見出しなし",
    children: [],
  }));
  const sections: EditorTocEntry[] = [
    { anchorId: RE_SECTIONS.basic, text: "基本情報", children: [] },
    { anchorId: RE_SECTIONS.indications, text: "適応疾患", children: [] },
    { anchorId: RE_SECTIONS.schedule, text: "スケジュール", children: [] },
    { anchorId: RE_SECTIONS.steps, text: "投与内容", children: steps },
    ...(showDayTable ? [{ anchorId: RE_SECTIONS.dayTable, text: "Day 表", children: [] }] : []),
    { anchorId: RE_SECTIONS.criteria, text: "適応基準", children: [] },
    { anchorId: RE_SECTIONS.adverseEvents, text: "副作用", children: [] },
    { anchorId: RE_SECTIONS.references, text: "参考文献", children: [] },
    { anchorId: RE_SECTIONS.operation, text: "運用", children: [] },
  ];
  return <EditorToc sections={sections} />;
}
