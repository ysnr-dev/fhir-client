import { useRef } from "react";
import {
  eventDayLabel,
  eventDayOf,
  eventsOfPhase,
  isSplitDay,
  pathStepLabel,
  phaseLabelOf,
  type PathwayDraft,
} from "../fhir/pathwayHelpers";
import { useTocTracking } from "../hooks/useTocTracking";

// パス編集画面の左に出す目次。区画と、病日の区画の下にフェーズ・病日のツリーを並べ、押すとその位置へ移動する。
// 見た目はテンプレート編集画面の目次(.qe-toc)と揃える。

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

/** 移動先の上端がここ(ビューポート上端からの px)より上にあれば「読んでいる」とみなす。
 *  追従するヘッダーの高さ(scroll-margin-top)に少し余裕を足した値。 */
const ACTIVE_LINE = 96;

interface TocEntry {
  anchorId: string;
  text: string;
  children: TocEntry[];
}

function flatten(entries: TocEntry[]): string[] {
  return entries.flatMap((entry) => [entry.anchorId, ...flatten(entry.children)]);
}

function dayEntries(draft: PathwayDraft): TocEntry[] {
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

function EntryTree({
  entries,
  activeId,
  onJump,
}: {
  entries: TocEntry[];
  activeId: string;
  onJump: (id: string) => void;
}) {
  if (entries.length === 0) return null;
  return (
    <ul className="qe-toc__items">
      {entries.map((entry) => (
        <li key={entry.anchorId}>
          <button
            type="button"
            className={`qe-toc__item${entry.anchorId === activeId ? " qe-toc__item--active" : ""}`}
            title={entry.text}
            aria-current={entry.anchorId === activeId ? "location" : undefined}
            data-anchor={entry.anchorId}
            onClick={() => onJump(entry.anchorId)}
          >
            <span className="qe-toc__item-text">{entry.text}</span>
          </button>
          <EntryTree entries={entry.children} activeId={activeId} onJump={onJump} />
        </li>
      ))}
    </ul>
  );
}

export function PathwayEditorToc({ draft, showOverview }: { draft: PathwayDraft; showOverview: boolean }) {
  const sections: TocEntry[] = [
    { anchorId: PE_SECTIONS.basic, text: "基本情報", children: [] },
    { anchorId: PE_SECTIONS.indications, text: "対象病名", children: [] },
    { anchorId: PE_SECTIONS.days, text: "病日", children: dayEntries(draft) },
    ...(showOverview ? [{ anchorId: PE_SECTIONS.overview, text: "概要表", children: [] }] : []),
    { anchorId: PE_SECTIONS.operation, text: "運用", children: [] },
  ];
  const navRef = useRef<HTMLElement>(null);
  const { activeId, jumpTo } = useTocTracking(navRef, flatten(sections), ACTIVE_LINE);

  return (
    <nav className="qe-toc" aria-label="目次" ref={navRef}>
      <ul className="qe-toc__sections">
        {sections.map((section) => (
          <li key={section.anchorId}>
            <button
              type="button"
              className={`qe-toc__section${section.anchorId === activeId ? " qe-toc__section--active" : ""}`}
              aria-current={section.anchorId === activeId ? "location" : undefined}
              data-anchor={section.anchorId}
              onClick={() => jumpTo(section.anchorId)}
            >
              {section.text}
            </button>
            <EntryTree entries={section.children} activeId={activeId} onJump={jumpTo} />
          </li>
        ))}
      </ul>
    </nav>
  );
}
