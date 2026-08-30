import {
  useInjectionSeriesLater,
  useUpdateInjectionTaskStatus,
} from "../api/queries";
import { injectionSeriesLabel } from "../fhir/injectionHelpers";
import { type InjectionTaskStatus } from "../fhir/injectionTaskHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

// 注射の中止・中止取消。連日オーダーは後続日があるので、削除と同じく
// 「この日のみ / この日以降すべて」を選ばせる(「明日からやめる」が指示の形)。
// 実施済の注射は中止できない(判定は canCancelInjection。呼ぶ側で出し分ける)。

interface InjectionCancelModalProps {
  serviceRequest: fhir4.ServiceRequest;
  /** その日の進捗 Task。まだ無ければ undefined(依頼済)。 */
  task: fhir4.Task | undefined;
  /** 中止するのか、中止を取り消して依頼済に戻すのか。 */
  mode: "cancel" | "restore";
  onClose: () => void;
  onDone: () => void;
}

export function InjectionCancelModal({
  serviceRequest,
  task,
  mode,
  onClose,
  onDone,
}: InjectionCancelModalProps) {
  const later = useInjectionSeriesLater(serviceRequest);
  const update = useUpdateInjectionTaskStatus();
  const laterTargets = later.data ?? [];
  const date = serviceRequest.authoredOn?.slice(0, 10) ?? "";
  const lastDate =
    laterTargets[laterTargets.length - 1]?.serviceRequest.authoredOn?.slice(0, 10) ?? "";
  const seriesLabel = injectionSeriesLabel(serviceRequest);

  const status: InjectionTaskStatus = mode === "cancel" ? "cancelled" : "requested";
  // 「中止を取消」をそのまま動詞に埋めると「注射を中止を取消します」になるので、
  // 見出し・本文・ボタンの言い回しをモードごとに持つ。
  const words =
    mode === "cancel"
      ? {
          title: "注射の中止",
          body: (d: string) => `${d} の注射を中止します。`,
          one: "この日のみ中止",
          all: (n: number) => `この日以降 ${n} 日分を中止`,
          only: "中止",
        }
      : {
          title: "注射の中止取消",
          body: (d: string) => `${d} の注射の中止を取り消します(依頼済に戻します)。`,
          one: "この日のみ取り消す",
          all: (n: number) => `この日以降 ${n} 日分を取り消す`,
          only: "取り消す",
        };

  function run(withLater: boolean) {
    const targets = [
      { serviceRequest, task },
      ...(withLater
        ? laterTargets.map((t) => ({ serviceRequest: t.serviceRequest, task: t.task }))
        : []),
    ];
    update.mutate({ targets, status }, { onSuccess: onDone });
  }

  return (
    <Modal title={words.title} onClose={onClose}>
      <ErrorBanner error={later.error ?? update.error} />
      {later.isLoading ? (
        <p>読み込み中...</p>
      ) : (
        <>
          <p>
            {words.body(date)}
            {seriesLabel && <span className="injection-series-label">{seriesLabel}</span>}
          </p>
          {laterTargets.length > 0 && (
            <p className="injection-scope__note">
              {`この後に ${laterTargets.length} 日分(〜${lastDate})の同じオーダーがあります。`}
            </p>
          )}
          <div className="plain-text-modal__actions">
            <button type="button" onClick={onClose} disabled={update.isPending}>
              キャンセル
            </button>
            <button type="button" onClick={() => run(false)} disabled={update.isPending}>
              {laterTargets.length > 0 ? words.one : words.only}
            </button>
            {laterTargets.length > 0 && (
              <button type="button" onClick={() => run(true)} disabled={update.isPending}>
                {words.all(laterTargets.length + 1)}
              </button>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
