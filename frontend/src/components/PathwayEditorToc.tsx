import {
  eventDayLabel,
  eventDayOf,
  eventsOfPhase,
  isSplitDay,
  pathStepLabel,
  phaseLabelOf,
  type PathwayDraft,
} from "../fhir/pathwayHelpers";
import { EditorToc, type EditorTocEntry } from "./EditorToc";

// パス編集画面の左に出す目次。区画と、病日の区画の下にフェーズ・病日のツリーを並べる。

export const PE_SECTIONS = {
  basic: "pe-section-basic",
  indications: "pe-section-indications",
  days: "pe-section-days",
  overview: "pe-section-overview",
  operation: "pe-section-operation",
} as const;

export function pathwayPhaseAnchorId(phaseKey: string): string {
  return `pe-phase-${phaseKey}`;
}

export function pathwayEventAnchorId(eventKey: number): string {
  return `pe-event-${eventKey}`;
}

function dayEntries(draft: PathwayDraft): EditorTocEntry[] {
  const eventEntries = (phaseKey: string) =>
    eventsOfPhase(draft.events, phaseKey).map((event) => {
      const day = eventDayOf(event);
      const label = day === null ? `病日 ${event.elapsedDays || "未入力"}` : eventDayLabel(day, event.title);
      const step = isSplitDay(draft.events, event) ? ` ${pathStepLabel(event.pathStep, event.pathStepName)}` : "";
      return { anchorId: pathwayEventAnchorId(event.key), text: label + step, children: [] };
    });
  if (draft.phases.length <= 1) return draft.phases.flatMap((phase) => eventEntries(phase.phaseKey));
  return draft.phases.map((phase) => ({
    anchorId: pathwayPhaseAnchorId(phase.phaseKey),
    text: phaseLabelOf(draft.phases, phase.phaseKey),
    children: eventEntries(phase.phaseKey),
  }));
}

export function PathwayEditorToc({ draft, showOverview }: { draft: PathwayDraft; showOverview: boolean }) {
  const sections: EditorTocEntry[] = [
    { anchorId: PE_SECTIONS.basic, text: "基本情報", children: [] },
    { anchorId: PE_SECTIONS.indications, text: "対象病名", children: [] },
    { anchorId: PE_SECTIONS.days, text: "病日", children: dayEntries(draft) },
    ...(showOverview ? [{ anchorId: PE_SECTIONS.overview, text: "概要表", children: [] }] : []),
    { anchorId: PE_SECTIONS.operation, text: "運用", children: [] },
  ];
  return <EditorToc sections={sections} />;
}
