import { useState } from "react";
import { useLocation } from "react-router-dom";

// カルテは患者一覧・外来患者一覧・部門業務の各ワークリストから開ける。
// 「戻る」で開いた元の一覧(検索条件つき)へ戻せるよう、遷移元のパスを受け渡す。
const STORAGE_KEY = "fhir-client.karte.returnTo";
const DEFAULT_RETURN_TO = "/patients";

type KarteLinkState = { karteFrom: string };

function readFrom(state: unknown): string | null {
  const from = (state as Partial<KarteLinkState> | null)?.karteFrom;
  // 別サイトへ飛ばされないよう、アプリ内の絶対パスだけ受け付ける。
  return typeof from === "string" && from.startsWith("/") && !from.startsWith("//") ? from : null;
}

// 一覧側でカルテへの Link に渡す state。絞り込みを保つため検索文字列まで含める。
export function useKarteLinkState(): KarteLinkState {
  const location = useLocation();
  return { karteFrom: `${location.pathname}${location.search}` };
}

// カルテ側の戻り先。リロードで state が消えても戻れるよう sessionStorage に控える。
export function useKarteReturnTo(): string {
  const location = useLocation();
  const from = readFrom(location.state);
  const [returnTo] = useState(() => {
    if (from) {
      sessionStorage.setItem(STORAGE_KEY, from);
      return from;
    }
    return sessionStorage.getItem(STORAGE_KEY) ?? DEFAULT_RETURN_TO;
  });
  return returnTo;
}
