import { createContext, useContext } from "react";
import type { KarteLink } from "../fhir/karteLinkHelpers";

// 診療記録の本文に貼ったリンクを開く口。カルテ画面(KartePage)が配る。
// 無い場所(カルテ外)ではリンクを文字として出す。
export interface KarteLinkActions {
  patientId: string;
  openLink: (link: KarteLink) => void;
}

export const KarteLinkContext = createContext<KarteLinkActions | null>(null);

export function useKarteLinkActions(): KarteLinkActions | null {
  return useContext(KarteLinkContext);
}
