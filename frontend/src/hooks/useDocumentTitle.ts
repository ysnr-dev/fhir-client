import { useEffect } from "react";
import { ADMIN_MENU, appMenuLinks } from "../appMenu";
import { MASTER_MENU } from "../masterMenu";
import { KARTE_PANE_PATH } from "../kartePaneChannel";
import { BOARD_PATH, INTAKE_PATH, KARTE_PRINT_PATH } from "../karteUrl";
import {
  ANESTHESIA_CHART_PRINT_PATH,
  DIALYSIS_CHART_PRINT_PATH,
  INJECTION_PRINT_PATH,
  PATHWAY_PRINT_PATH,
} from "../api/reportsClient";

/**
 * ブラウザのタブの題名。画面の名前は URL からメニューの項目名を引いて付け(useRouteDocumentTitle)、
 * 患者名など画面の中身で決まる名前は画面が上書きする(useDocumentTitle)。
 * 子の effect が親より先に走っても、画面の指定がメニュー由来の名前に負けないように分けて持つ。
 */
const APP_NAME = "FHIR Client";

let routeTitle = "";
const pageTitles: Array<{ title: string }> = [];

function applyTitle() {
  const title = pageTitles[pageTitles.length - 1]?.title || routeTitle;
  document.title = title ? `${title} - ${APP_NAME}` : APP_NAME;
}

const FIXED_TITLES: Array<{ path: string; title: string }> = [
  { path: KARTE_PRINT_PATH, title: "カルテ印刷" },
  { path: KARTE_PANE_PATH, title: "カルテ" },
  { path: INJECTION_PRINT_PATH, title: "注射箋" },
  { path: PATHWAY_PRINT_PATH, title: "クリニカルパス印刷" },
  { path: DIALYSIS_CHART_PRINT_PATH, title: "透析経過表印刷" },
  { path: ANESTHESIA_CHART_PRINT_PATH, title: "麻酔チャート印刷" },
  { path: INTAKE_PATH, title: "Web 問診" },
  { path: BOARD_PATH, title: "待合表示板" },
];

let menuTitles: Array<{ path: string; title: string }> | null = null;

function titleCandidates() {
  menuTitles ??= [
    ...FIXED_TITLES,
    ...appMenuLinks().map((item) => ({ path: item.to, title: item.label })),
    ...ADMIN_MENU.map((item) => ({ path: item.to, title: item.label })),
    ...MASTER_MENU.flatMap((group) => group.items.map((item) => ({ path: item.to, title: item.label }))),
  ].map(({ path, title }) => ({ path: path.split("?")[0].replace(/\/$/, ""), title }));
  return menuTitles;
}

/** URL に最も長く一致するメニューの項目名。カルテは患者ごとの画面なので別に扱う。 */
export function routeTitleOf(pathname: string): string {
  if (pathname === "/") return "ホーム";
  if (/^\/patients\/[^/]+\/karte/.test(pathname)) return "カルテ";
  let best: { path: string; title: string } | undefined;
  for (const candidate of titleCandidates()) {
    const matches = pathname === candidate.path || pathname.startsWith(`${candidate.path}/`);
    if (matches && (!best || candidate.path.length > best.path.length)) best = candidate;
  }
  return best?.title ?? "";
}

export function useRouteDocumentTitle(pathname: string) {
  useEffect(() => {
    routeTitle = routeTitleOf(pathname);
    applyTitle();
  }, [pathname]);
}

/** 画面の中身で決まる題名(患者名など)。空のあいだはメニュー由来の名前のまま。 */
export function useDocumentTitle(title: string | undefined) {
  useEffect(() => {
    if (!title) return;
    const entry = { title };
    pageTitles.push(entry);
    applyTitle();
    return () => {
      const index = pageTitles.indexOf(entry);
      if (index >= 0) pageTitles.splice(index, 1);
      applyTitle();
    };
  }, [title]);
}
