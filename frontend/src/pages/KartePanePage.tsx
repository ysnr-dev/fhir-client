import { useEffect } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { KartePage } from "./KartePage";
import { KARTE_PANE_HOST_PARAM, KARTE_PANE_PATH, useKartePaneGuest } from "../kartePaneChannel";
import { KARTE_CARD_PARAM, KARTE_TAB_PARAM } from "../karteUrl";

// 患者が替わっても(カルテを閉じて別の患者を開いても)引き継ぐ表示。サブモニターで
// 見ているタブや絞り込みは患者によらない。開いている病名・詳細などは患者ごとのものなので落とす。
const CARRIED_PARAMS = [KARTE_TAB_PARAM, KARTE_CARD_PARAM];

// カルテの左ペインだけを出す別タブ(サブモニター常駐)。画面の中身は KartePage を
// そのまま使い、右ペインと画面を離れる操作だけを落とす。患者は自分では選ばず、
// 自分を開いたメインタブのカルテに追従する。
export function KartePanePage() {
  const { patientId } = useParams<{ patientId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const urlHostId = searchParams.get(KARTE_PANE_HOST_PARAM);
  const { patientId: followedPatientId, hostId, orphaned } = useKartePaneGuest(
    patientId ?? null,
    urlHostId,
  );

  // 追従した患者と追従先のタブを URL にも載せる(このタブだけをリロードしても
  // 同じメインタブの同じ患者に戻ってこられる)。
  useEffect(() => {
    if (followedPatientId === (patientId ?? null) && hostId === urlHostId) return;
    const path = followedPatientId ? `${KARTE_PANE_PATH}/${followedPatientId}` : KARTE_PANE_PATH;
    const next = new URLSearchParams();
    if (hostId) next.set(KARTE_PANE_HOST_PARAM, hostId);
    const samePatient = followedPatientId === (patientId ?? null);
    for (const [key, value] of searchParams) {
      if (key === KARTE_PANE_HOST_PARAM) continue;
      if (samePatient || CARRIED_PARAMS.includes(key)) next.append(key, value);
    }
    const query = next.toString();
    navigate(query ? `${path}?${query}` : path, { replace: true });
  }, [followedPatientId, patientId, hostId, urlHostId, searchParams, navigate]);

  if (orphaned) {
    return <div className="karte-pane-empty">メインのタブが閉じられました。</div>;
  }
  if (!followedPatientId) {
    return (
      <div className="karte-pane-empty">メインのタブでカルテを開くと、ここに表示されます。</div>
    );
  }

  // 患者が替わったら中の状態(開いているタブやスクロール位置)は持ち越さない。
  return <KartePage key={followedPatientId} detached patientId={followedPatientId} />;
}
