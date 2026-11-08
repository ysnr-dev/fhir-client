import { Fragment, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { usePathway } from "../api/masterQueries";
import { useSelfOrganization } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { PathwayRouteSelects } from "../components/PathwayRouteSelects";
import { PathwaySeriesLink } from "../components/PathwaySeriesLink";
import { ORDER_SET_TYPE_LABELS } from "../components/orderSetRegistry";
import { isOrderSetOrderType } from "../fhir/orderSetHelpers";
import {
  draftFromPathway,
  pathStepLabel,
  PATHWAY_SETTING_OPTIONS,
  PATHWAY_STATUS_OPTIONS,
  type PathwayDraft,
  type PathwayTaskDraft,
} from "../fhir/pathwayHelpers";
import { buildPathwayPreview, previewPhaseRoute } from "../fhir/pathwayPreviewHelpers";
import {
  buildPathwaySheet,
  paginatePathwaySheet,
  type PathwaySheetPage,
  type SheetAssessmentCell,
  type SheetDay,
  type SheetRow,
  type SheetTaskCell,
} from "../fhir/pathwaySheetHelpers";
import { displayOf } from "../fhir/shared";
import { dateTimeLabel, nowFhirDateTime, today } from "../lib/dates";
import { applyTheme, resolveTheme } from "../theme";

// パス定義(保存済みの内容)のパスシートを紙に出す別タブ。カルテのオーバービューと同じ並びで、
// 列の多いパスは病日の区切りで次の紙へ送り、行の見出しと病日の段を紙ごとに繰り返す。
// 入院日を入れなければ日付の段は手書き用の空欄になる。設計は docs/clinical-pathway-design.md §6。

const PAPERS = {
  A4: { label: "A4 横", pageMm: 297, labelMm: 60, maxDays: 10 },
  A3: { label: "A3 横", pageMm: 420, labelMm: 72, maxDays: 16 },
} as const;
type Paper = keyof typeof PAPERS;

const PAGE_MARGIN_MM = 10;

export function PathwayPrintPage() {
  const { pathwayId } = useParams<{ pathwayId: string }>();
  const detail = usePathway(pathwayId ?? null);
  const { organization } = useSelfOrganization();
  const draft = useMemo(() => (detail.data ? draftFromPathway(detail.data) : null), [detail.data]);

  // 紙面は白地に印字するので、ダークテーマでもこのタブだけライトで描く。
  useEffect(() => {
    applyTheme("light");
    return () => applyTheme(resolveTheme());
  }, []);

  const [admissionDate, setAdmissionDate] = useState("");
  const [paper, setPaper] = useState<Paper>("A4");
  const [choices, setChoices] = useState<Map<string, string>>(new Map());
  // 印刷日時は開いた時点で固定する。
  const printedAt = useMemo(() => dateTimeLabel(nowFhirDateTime()), []);

  const route = draft ? previewPhaseRoute(draft.phases, choices) : [];

  return (
    <div className="pathway-print">
      <style>{`@page { size: ${paper} landscape; margin: ${PAGE_MARGIN_MM}mm; }`}</style>
      <div className="karte-print__toolbar">
        <button type="button" disabled={!draft} onClick={() => window.print()}>
          印刷
        </button>
        <label className="pathway-preview__field">
          用紙
          <select value={paper} onChange={(e) => setPaper(e.target.value as Paper)}>
            {(Object.keys(PAPERS) as Paper[]).map((key) => (
              <option key={key} value={key}>
                {PAPERS[key].label}
              </option>
            ))}
          </select>
        </label>
        <label className="pathway-preview__field">
          入院日
          <input type="date" value={admissionDate} onChange={(e) => setAdmissionDate(e.target.value)} />
        </label>
        {draft && (
          <PathwayRouteSelects
            phases={draft.phases}
            route={route}
            choices={choices}
            onChoose={(phaseKey, toPhaseKey) => setChoices((current) => new Map(current).set(phaseKey, toPhaseKey))}
          />
        )}
        {detail.isPending && <span>読み込み中...</span>}
      </div>
      <ErrorBanner error={detail.error} />
      {draft && (
        <PathwaySheetPages
          draft={draft}
          route={route}
          admissionDate={admissionDate}
          paper={paper}
          organizationName={organization?.name ?? ""}
          printedAt={printedAt}
        />
      )}
    </div>
  );
}

function PathwaySheetPages({
  draft,
  route,
  admissionDate,
  paper,
  organizationName,
  printedAt,
}: {
  draft: PathwayDraft;
  route: ReturnType<typeof previewPhaseRoute>;
  admissionDate: string;
  paper: Paper;
  organizationName: string;
  printedAt: string;
}) {
  const { application, tasks } = buildPathwayPreview(draft, admissionDate || today(), route);
  const sheet = buildPathwaySheet(application);
  const { pageMm, labelMm, maxDays } = PAPERS[paper];
  const pages = paginatePathwaySheet(sheet, maxDays);
  const tableMm = pageMm - PAGE_MARGIN_MM * 2;
  const baseDayMm = (tableMm - labelMm) / Math.max(1, Math.min(maxDays, sheet.days.length));
  const majorEvents = new Map(application.events.map((event) => [event.id, event.majorEventName]));
  const dayIndex = new Map(sheet.days.map((day, index) => [day.eventId, index]));
  const heading = [
    draft.pathwayCode,
    draft.version && `版 ${draft.version}`,
    displayOf(PATHWAY_STATUS_OPTIONS, draft.status),
  ]
    .filter(Boolean)
    .join(" / ");

  function hasCellAt(row: SheetRow, index: number): boolean {
    const day = sheet.days[index];
    return day ? row.cells.has(day.eventId) : false;
  }

  function taskOf(row: SheetRow, day: SheetDay): PathwayTaskDraft | undefined {
    const cell = row.cells.get(day.eventId) as SheetTaskCell | undefined;
    return cell ? tasks.get(cell.procedureId) : undefined;
  }

  function renderCell(page: PathwaySheetPage, row: SheetRow, day: SheetDay) {
    const cell = row.cells.get(day.eventId);
    if (!cell) return <td key={day.eventId} />;
    const index = dayIndex.get(day.eventId) as number;
    const fromPrev = hasCellAt(row, index - 1);
    const toNext = hasCellAt(row, index + 1);
    let mark = row.kind === "unit" ? "●" : "○";
    let note = "";
    let orderLabel = "";
    if (row.kind === "assessment" && !row.properValue) {
      note = (cell as SheetAssessmentCell).properValue;
    }
    if (row.kind === "task") {
      mark = "☐";
      const template = taskOf(row, day)?.template;
      if (template) {
        orderLabel = isOrderSetOrderType(template.orderType) ? ORDER_SET_TYPE_LABELS[template.orderType] : "オーダー";
        // 続きで内容が同じなら、紙の左端の列にだけ書く。
        const previous = page.days[page.days.indexOf(day) - 1];
        note = previous && taskOf(row, previous)?.template?.label === template.label ? "" : template.label;
      }
    }
    return (
      <td key={day.eventId}>
        <PathwaySeriesLink fromPrev={fromPrev} toNext={toNext}>
          <span>{orderLabel ? `${mark} ${orderLabel}` : mark}</span>
        </PathwaySeriesLink>
        {note && <div className="pathway-print__cell-note">{note}</div>}
      </td>
    );
  }

  function renderTable(page: PathwaySheetPage) {
    const dayMm = Math.min(baseDayMm, (tableMm - labelMm) / page.days.length);
    return (
      <table className="pathway-print__table" style={{ width: `${labelMm + dayMm * page.days.length}mm` }}>
        <colgroup>
          <col style={{ width: `${labelMm}mm` }} />
          {page.days.map((day) => (
            <col key={day.eventId} style={{ width: `${dayMm}mm` }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th className="pathway-print__heading" colSpan={page.days.length + 1}>
              <div className="pathway-print__heading-row">
                <span>{draft.name}</span>
                <span>{heading}</span>
              </div>
            </th>
          </tr>
          {sheet.phased && (
            <tr>
              <th />
              {page.phaseGroups.map((group) => (
                <th key={group.phaseKey} colSpan={group.span}>
                  {group.name}
                </th>
              ))}
            </tr>
          )}
          <tr>
            <th>病日</th>
            {page.dayGroups.map((group) => (
              <th key={group.days[0].eventId} colSpan={group.days.length}>
                <div className="pathway-print__day-no">{group.elapsedDays}</div>
                {group.title && <div>{group.title}</div>}
              </th>
            ))}
          </tr>
          <tr>
            <th>日付</th>
            {page.dayGroups.map((group) => (
              <th key={group.days[0].eventId} colSpan={group.days.length}>
                {admissionDate ? group.date.slice(5).replace("-", "/") : "\u00A0"}
              </th>
            ))}
          </tr>
          {sheet.split && (
            <tr>
              <th />
              {page.dayGroups.flatMap((group) =>
                group.days.map((day) => (
                  <th key={day.eventId}>{group.days.length > 1 ? pathStepLabel(day.pathStep, day.pathStepName) : ""}</th>
                )),
              )}
            </tr>
          )}
          {page.days.some((day) => majorEvents.get(day.eventId)) && (
            <tr>
              <th>主要イベント</th>
              {page.days.map((day) => (
                <th key={day.eventId} className="pathway-print__major">
                  {majorEvents.get(day.eventId)}
                </th>
              ))}
            </tr>
          )}
        </thead>
        <tbody>
          {page.rows.map((row) => (
            <tr key={row.key} className={`pathway-print__row--${row.kind}`}>
              <th scope="row" className="pathway-print__label">
                {row.critical && "★ "}
                {row.kind === "task" && <span className="pathway-print__category">{row.categoryLabel}</span>}
                {row.label}
                {row.properValue && <span className="pathway-print__proper">{`（${row.properValue}）`}</span>}
              </th>
              {page.days.map((day) => renderCell(page, row, day))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <>
      {(pages.length > 0 ? pages : [null]).map((page, index) => (
        <section
          key={page?.days[0].eventId ?? "empty"}
          className="pathway-print__page"
          style={{ maxWidth: `${tableMm}mm` }}
        >
          {index === 0 && (
            <PathwayInfo draft={draft} organizationName={organizationName} printedAt={printedAt} />
          )}
          {page ? renderTable(page) : <p>病日がありません。</p>}
          {index === pages.length - 1 && page && (
            <p className="pathway-print__legend">● アウトカム　○ 観察項目　☐ タスク　★ 重要アウトカム</p>
          )}
        </section>
      ))}
    </>
  );
}

/** 1 枚目の冒頭に出す定義の属性。空の項目は出さない。 */
function PathwayInfo({
  draft,
  organizationName,
  printedAt,
}: {
  draft: PathwayDraft;
  organizationName: string;
  printedAt: string;
}) {
  const period = draft.validFrom || draft.validTo ? `${draft.validFrom}〜${draft.validTo}` : "";
  const items: [string, string][] = [
    ["パスコード", draft.pathwayCode],
    ["版", draft.version],
    ["状態", displayOf(PATHWAY_STATUS_OPTIONS, draft.status)],
    ["入外", displayOf(PATHWAY_SETTING_OPTIONS, draft.setting)],
    ["診療科", draft.departmentName],
    ["予定日数", draft.scheduledDays && `${draft.scheduledDays} 日`],
    ["承認日", draft.approvedOn],
    ["承認者", draft.approvedBy],
    ["有効期間", period],
    ["標準パス", draft.standardPathName],
    ["印刷日時", printedAt],
  ];
  const wideItems: [string, string][] = [
    ["対象病名", draft.indications.map((indication) => indication.name).join("、")],
    ["適応基準", draft.adaptiveCriteria.trim()],
  ];
  return (
    <>
      <div className="pathway-print__title">
        <span>{draft.name}</span>
        <span className="pathway-print__organization">{organizationName}</span>
      </div>
      <dl className="pathway-print__info">
        {items
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <Fragment key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </Fragment>
          ))}
        {wideItems
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <Fragment key={label}>
              <dt style={{ gridColumn: 1 }}>{label}</dt>
              <dd className="pathway-print__info-wide">{value}</dd>
            </Fragment>
          ))}
      </dl>
    </>
  );
}
