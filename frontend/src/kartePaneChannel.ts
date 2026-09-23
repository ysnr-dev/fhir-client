import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { KartePaneState } from "./components/KarteRightPane";

// カルテの左ペインを別タブ(サブモニターに置きっぱなしにする参照用の画面)で出すための
// タブ間通信。別タブはメインタブのカルテに追従するだけで、自分では患者を選ばない。
//
//   メインで患者を開く・替える → 別タブもその患者に切り替わる
//   メインでカルテを閉じる     → 別タブは患者未指定になる
//   メインのタブを閉じる       → 別タブも閉じる
//
// メインタブが閉じられたかは window.opener を直接見る。beforeunload の合図だと
// メインタブのリロードでも道連れになり、放送の途絶で数えると背面のタブでは
// タイマーが引き延ばされて(ブラウザの節電)生きているのに閉じてしまう。

const CHANNEL_NAME = "fhir-client.karte.pane";
/** 別タブのルート。患者は末尾に付ける(このタブだけリロードしても戻ってこられる)。 */
export const KARTE_PANE_PATH = "/karte-pane";
// 名前を付けて開くと、メインタブのリロードで参照を失っても同じタブを使い回せる。
const PANE_WINDOW_NAME = "fhir-client-karte-pane";

// タブごとの id を置く場所。sessionStorage はタブごとに独立していて、リロードしても
// 残るので「同じタブかどうか」の印に使える。
const HOST_ID_STORAGE_KEY = "fhir-client.karte.paneHostId";
/** 別タブの URL に付ける、追従先のタブ。 */
export const KARTE_PANE_HOST_PARAM = "host";

// 別タブがメインタブに現状を尋ねる間隔。追従そのものは放送で届くので、これは
// メインタブを取り逃がしたとき(リロードでカルテ以外に着地したなど)の取り直し。
const SYNC_INTERVAL_MS = 5000;
// 続けて起きた書き込みを 1 回の合図にまとめる。
const REFRESH_DEBOUNCE_MS = 300;

// アプリを複数のタブで開いていても取り違えないよう、やり取りは「別タブを開いた
// タブ」に限る。メッセージの host は常にその相手のタブの id。
type PaneMessage = { host: string } & (
  /** 別タブ → メイン。生きているか。 */
  | { type: "ping" }
  /** メイン → 別タブ。生きている(ping の返事)。 */
  | { type: "pong"; patientId: string | null }
  /** メイン → 別タブ。開いている患者が変わった(閉じたときは null)。 */
  | { type: "patient"; patientId: string | null }
  /** 別タブ → メイン。右ペインでフォームを開いてほしい。 */
  | { type: "open-form"; patientId: string; state: KartePaneState }
  /** メイン → 別タブ。書き込みがあったので読み直してほしい。 */
  | { type: "refresh" }
);

let fallbackHostId: string | null = null;

/** このタブの id。 */
function thisTabId(): string {
  try {
    const stored = sessionStorage.getItem(HOST_ID_STORAGE_KEY);
    if (stored) return stored;
    const id = crypto.randomUUID();
    sessionStorage.setItem(HOST_ID_STORAGE_KEY, id);
    return id;
  } catch {
    // sessionStorage が使えない環境では、リロードのたびに別のタブとして扱われる。
    fallbackHostId ??= crypto.randomUUID();
    return fallbackHostId;
  }
}

let channel: BroadcastChannel | null | undefined;

function getChannel(): BroadcastChannel | null {
  if (channel === undefined) {
    try {
      channel = typeof BroadcastChannel === "function" ? new BroadcastChannel(CHANNEL_NAME) : null;
    } catch {
      // 使えない環境では別タブ機能が働かないだけで、カルテ本体には影響させない。
      channel = null;
    }
  }
  return channel;
}

function post(message: PaneMessage) {
  getChannel()?.postMessage(message);
}

function subscribe(handler: (message: PaneMessage) => void): () => void {
  const target = getChannel();
  if (!target) return () => {};
  const listener = (event: MessageEvent<PaneMessage>) => handler(event.data);
  target.addEventListener("message", listener);
  return () => target.removeEventListener("message", listener);
}

// ---- メインタブ側 ----------------------------------------------------------

// メインタブで開いているカルテの患者。別タブはこれに追従する。
let hostPatientId: string | null = null;

/** メインタブのカルテが開いている患者。カルテを閉じるときは null を渡す。 */
export function setKartePanePatient(patientId: string | null) {
  hostPatientId = patientId;
  post({ type: "patient", host: thisTabId(), patientId });
}

/**
 * メインタブの応答口。カルテ画面に限らずアプリ全体で生かす(カルテを閉じていても
 * タブが生きている限り別タブは閉じない)。別タブ自身では働かせない。
 */
export function useKartePaneHost(enabled: boolean) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    const unsubscribe = subscribe((message) => {
      if (message.type !== "ping") return;
      // 宛先が自分の ping にだけ答える。host が空なのは URL を直接開いた別タブで、
      // 最初に答えたタブに追従してもらう。
      if (message.host && message.host !== thisTabId()) return;
      post({ type: "pong", host: thisTabId(), patientId: hostPatientId });
    });

    // React Query のキャッシュはタブごとに別なので、メインで書いた記録は放って
    // おくと別タブに出てこない。書き込みが成功したら読み直しの合図を送る。
    let timer = 0;
    const unsubscribeMutations = queryClient.getMutationCache().subscribe((event) => {
      if (event.mutation?.state.status !== "success") return;
      window.clearTimeout(timer);
      timer = window.setTimeout(
        () => post({ type: "refresh", host: thisTabId() }),
        REFRESH_DEBOUNCE_MS,
      );
    });

    return () => {
      unsubscribe();
      unsubscribeMutations();
      window.clearTimeout(timer);
    };
  }, [enabled, queryClient]);
}

/** 別タブから頼まれたフォームを受け取る(対象の患者を開いているときだけ)。 */
export function subscribeKarteFormRequest(
  patientId: string,
  handler: (state: KartePaneState) => void,
): () => void {
  return subscribe((message) => {
    if (message.type !== "open-form") return;
    if (message.host !== thisTabId() || message.patientId !== patientId) return;
    handler(message.state);
  });
}

// 別タブへの参照。メインタブのリロードで失われるが、その場合は名前付きウィンドウ
// として開き直すと同じタブが使い回される。
let paneWindow: Window | null = null;

/** 別タブを開く。既に開いていればそれを前面に出す。 */
export function openKartePane(patientId: string) {
  if (paneWindow && !paneWindow.closed) {
    paneWindow.focus();
    return;
  }
  // 追従先を URL に載せる(別タブをリロードしても同じタブに付いていく)。
  const url = `${KARTE_PANE_PATH}/${patientId}?${KARTE_PANE_HOST_PARAM}=${thisTabId()}`;
  paneWindow = window.open(url, PANE_WINDOW_NAME);
  paneWindow?.focus();
}

// ---- 別タブ側 --------------------------------------------------------------

// 追従しているメインタブ。この タブが別タブ(ゲスト)のときだけ入る。
let followedHostId: string | null = null;

/** 右ペインを持たない別タブから、メインタブにフォームを開いてもらう。 */
export function requestKarteForm(patientId: string, state: KartePaneState) {
  if (!followedHostId) return;
  post({ type: "open-form", host: followedHostId, patientId, state });
  // 入力はメインタブで続けるので、そちらへ移ってもらう。
  window.opener?.focus();
}

export interface KartePaneGuest {
  /** メインタブが開いている患者。カルテを閉じていれば null。 */
  patientId: string | null;
  /** 追従しているメインタブ。URL で渡されなかったときは最初に答えたタブ。 */
  hostId: string | null;
  /** メインタブが見つからなくなった(閉じられた)。 */
  orphaned: boolean;
}

/**
 * 別タブ側の追従。メインタブの患者を受け取り、メインタブが閉じられたら自分も閉じる。
 * 引数は URL から復元した値(メインの返事が来るまでの表示と、追従先のタブ)。
 */
export function useKartePaneGuest(
  initialPatientId: string | null,
  initialHostId: string | null,
): KartePaneGuest {
  const queryClient = useQueryClient();
  const [patientId, setPatientId] = useState(initialPatientId);
  const [hostId, setHostId] = useState(initialHostId);
  const [orphaned, setOrphaned] = useState(false);

  useEffect(() => {
    // 追従先は最初の 1 回だけ URL から入れる(以降は下で相手のタブに合わせる)。
    followedHostId = initialHostId;
    // 自分を開いたタブ。URL を直接開いた別タブには無く、その場合は閉じない。
    const opener = window.opener != null;

    const unsubscribe = subscribe((message) => {
      // 追従先が決まっていなければ、最初に答えたタブに決める。
      if (followedHostId && message.host !== followedHostId) return;

      if (message.type === "refresh") {
        // 別タブに載っているのはカルテのクエリだけなので、まとめて無効化する
        // (カルテ系のキーはリソース型ごとに分かれていて一括では指せない)。
        void queryClient.invalidateQueries();
        return;
      }
      if (message.type !== "pong" && message.type !== "patient") return;
      followedHostId = message.host;
      setHostId(message.host);
      setPatientId(message.patientId);
    });

    const sync = () => {
      if (opener && (!window.opener || window.opener.closed)) {
        // スクリプトで開いたタブなので自分で閉じられる。閉じられなかったときの
        // ために表示も切り替えておく。
        window.close();
        setOrphaned(true);
        return;
      }
      post({ type: "ping", host: followedHostId ?? "" });
    };
    sync();
    const timer = window.setInterval(sync, SYNC_INTERVAL_MS);
    // 背面から戻したときは、間引かれた分を待たずに合わせ直す。
    document.addEventListener("visibilitychange", sync);

    return () => {
      unsubscribe();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", sync);
    };
    // 追従先は最初の値から始めて相手のタブに合わせていくので、変化で張り直さない。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient]);

  return { patientId, hostId, orphaned };
}
