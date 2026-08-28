import { useState } from "react";
import { useLocation } from "react-router-dom";

// 一覧から開いた画面(カルテ・麻酔チャート)の「戻る」。
//
// カルテは患者一覧・外来患者一覧・部門業務の各ワークリストから、麻酔チャートは
// 手術一覧と手術カレンダーから開ける。どちらも**開いた元の画面(検索条件つき)へ
// 戻したい**ので、遷移元のパスを Link の state で渡す。
//
// リロードで state は消えるが、麻酔チャートは手術中ずっと開きっぱなしにする画面で
// リロードは普通に起きる。sessionStorage に控えて、そのときも戻れるようにする。

type ReturnState = { returnFrom: string };

function readFrom(state: unknown): string | null {
  const from = (state as Partial<ReturnState> | null)?.returnFrom;
  // 別サイトへ飛ばされないよう、アプリ内の絶対パスだけ受け付ける。
  return typeof from === "string" && from.startsWith("/") && !from.startsWith("//") ? from : null;
}

/** 一覧側で Link に渡す state。絞り込みを保つため検索文字列まで含める。 */
function useLinkState(): ReturnState {
  const location = useLocation();
  return { returnFrom: `${location.pathname}${location.search}` };
}

/** 開かれた側の戻り先。state が無ければ前回の遷移元、それも無ければ fallback。 */
function useReturnTo(storageKey: string, fallback: string): string {
  const location = useLocation();
  const from = readFrom(location.state);
  const [returnTo] = useState(() => {
    if (from) {
      sessionStorage.setItem(storageKey, from);
      return from;
    }
    return sessionStorage.getItem(storageKey) ?? fallback;
  });
  return returnTo;
}

const KARTE_STORAGE_KEY = "fhir-client.karte.returnTo";
const CHART_STORAGE_KEY = "fhir-client.anesthesiaChart.returnTo";

/**
 * 開く側(一覧)が Link に渡す state。渡す中身は「いま自分がどこにいるか」だけなので、
 * カルテでも麻酔チャートでも同じものを使う。戻り先の既定値は開かれた側が決める。
 */
export function useReturnLinkState() {
  return useLinkState();
}

export function useKarteReturnTo(): string {
  return useReturnTo(KARTE_STORAGE_KEY, "/patients");
}

export function useChartReturnTo(): string {
  return useReturnTo(CHART_STORAGE_KEY, "/surgery-worklist");
}
