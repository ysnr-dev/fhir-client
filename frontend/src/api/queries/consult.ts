import { keepPreviousData, type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ORDER_TYPE_SYSTEM } from "../../fhir/orderHeader";
import {
  buildConsultOrderDeleteBundle,
  buildConsultOrderReplyEntry,
  buildConsultOrderStatusEntry,
  CONSULT_ORDER_TYPE,
  consultReply,
  isConsultServiceRequest,
} from "../../fhir/consultOrderHelpers";
import {
  buildConsultTaskUpdate,
  consultOrderStatusFor,
  consultTasksByOrderId,
  type ConsultTaskStatus,
} from "../../fhir/consultTaskHelpers";
import { postBundle, readResource, searchResource } from "../fhirClient";
import { WORKLIST_PAGE } from "./core";
import { staleObservationEntries } from "./micro";
import { invalidateProvenance, useWithOrderProvenance } from "./provenance";
import { fetchWorklistBundles, taskBundleEntry } from "./worklist";

// ---- 他科依頼(コンサルテーション) ----
//
// 明細を持たないヘッダ 1 本 + 進捗 Task で、作りはリハビリと同じ。違うのは
// **進捗の変更で ServiceRequest.status も一緒に動かす**ところ
// (docs/consult-order-design.md §4)。他科依頼は日付軸を持たない(希望日は任意)ので、
// 部門一覧が「未回答だけ」をサーバー側で絞る手段が status しか無い。
//
// 書き込みの入口は useUpdateConsultTaskStatus と useSaveConsultReply の 2 つだけ。
// Task と status が食い違わないよう、どちらも 1 つの transaction で両方を書く。

export function useConsultOrderDetail(srId: string | undefined) {
  const params = new URLSearchParams();
  if (srId) {
    params.set("_id", srId);
    // 進捗を詳細パネル・回答モーダルで使うので同時に取る。
    params.set("_revinclude", "Task:focus");
  }

  // Task が混ざって返るので、要素の型は Resource で受ける。
  return useQuery({
    queryKey: ["ServiceRequest", "detail", "consult-order", srId],
    queryFn: () => searchResource<fhir4.Resource>("ServiceRequest", params),
    enabled: Boolean(srId),
  });
}

export function useUpdateConsultOrder() {
  const queryClient = useQueryClient();
  const withProvenance = useWithOrderProvenance();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(withProvenance(bundle)),
    onSuccess: () => {
      // 希望日が動くとカードの載る日も変わるので、まとめて読み直させる。
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest"] });
      // 依頼目的のテンプレート記入内容も同じ transaction で作り直している。
      queryClient.invalidateQueries({ queryKey: ["QuestionnaireResponse", "search"] });
      invalidateProvenance(queryClient);
    },
  });
}

/**
 * 依頼を消す。明細を持たないのでヘッダ 1 件だけだが、**回答済の依頼は消させない**。
 *
 * 回答は依頼先科の医師が書いた診療記録で、依頼を消しても消えない(消してよいもの
 * でもない)。消すと出どころの分からない記録だけが残るので、先に部門一覧の
 * 「回答取消」で紐付きを外してもらう(docs/consult-order-design.md §7)。
 *
 * useDeleteConsultOrder の本体(読み直しの指示を伴わない)。パスの取り消しがまとめて消すときにも使う。
 */
export const deleteConsultOrderRequest = async (srId: string) => {
  const { data: order } = await readResource<fhir4.ServiceRequest>("ServiceRequest", srId);
  if (consultReply(order).replyId) {
    throw new Error(
      "回答済の他科依頼は削除できません。先に他科依頼一覧で回答を取り消してください。",
    );
  }
  return postBundle(buildConsultOrderDeleteBundle(order));
};

export function useDeleteConsultOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteConsultOrderRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
      // 依頼目的のテンプレート記入内容も道連れで消えている。
      queryClient.invalidateQueries({ queryKey: ["QuestionnaireResponse", "search"] });
      invalidateConsult(queryClient);
    },
  });
}

// ---- 他科依頼一覧(部門ワークリスト) ----
//
// 他部門の一覧は「その日に実施予定のオーダー」を日付で引くが、他科依頼は日付軸を
// 持たない。代わりに status で切る(docs/consult-order-design.md §4.1)。
//
//   未回答 … status=active(依頼済・対応中)。いま溜まっている仕事なので有限。
//   回答済 … status=completed の直近ぶん(-authoredon)。
//
// 依頼先科は ServiceRequest.performer(Organization)に持ち、上流の performer 検索で絞る。

/** 一覧のビュー。未回答は「捌く」画面、回答済は「振り返る」画面。 */
export type ConsultWorklistView = "open" | "answered";

/** 他科依頼一覧の 1 行。依頼 1 件ぶん。 */
export interface ConsultWorklistRow {
  order: fhir4.ServiceRequest;
  patient?: fhir4.Patient;
  /** 進捗。依頼先科がまだ触っていない依頼には無い(= 依頼済)。 */
  task?: fhir4.Task;
}

export interface ConsultWorklistResult {
  rows: ConsultWorklistRow[];
  /** 上限まで読んでも読み切れなかった。 */
  truncated: boolean;
}

function consultWorklistParams(
  view: ConsultWorklistView,
  targetDepartmentId: string | undefined,
  page: number,
): URLSearchParams {
  const params = new URLSearchParams();
  params.set("category", `${ORDER_TYPE_SYSTEM}|${CONSULT_ORDER_TYPE.code}`);
  // 未回答は取消(revoked)も拾う。依頼済・対応中・取消は「まだ閉じていない仕事」
  // として同じ画面で見るため(取消は行の進捗で分かる)。
  if (view === "open") params.set("status", "active,revoked");
  else params.set("status", "completed");
  if (targetDepartmentId) params.set("performer", `Organization/${targetDepartmentId}`);
  params.set("based-on:missing", "true");
  params.set("_count", String(WORKLIST_PAGE));
  params.set("_offset", String(page * WORKLIST_PAGE));
  params.set("_sort", "-authoredon");
  params.set("_include", "ServiceRequest:subject");
  params.set("_revinclude", "Task:focus");
  return params;
}

async function fetchConsultWorklist(
  view: ConsultWorklistView,
  targetDepartmentId: string | undefined,
): Promise<ConsultWorklistResult> {
  const orders: fhir4.ServiceRequest[] = [];

  const { patientsById, tasks, truncated } = await fetchWorklistBundles(
    (page) => consultWorklistParams(view, targetDepartmentId, page),
    (resource) => {
      if (resource.resourceType !== "ServiceRequest") return false;
      const request = resource as fhir4.ServiceRequest;
      if (!isConsultServiceRequest(request)) return false;
      orders.push(request);
      return true;
    },
  );

  const taskByOrderId = consultTasksByOrderId(tasks);

  const rows = orders.map((order) => ({
    order,
    patient: patientsById.get(order.subject?.reference?.split("/").pop() ?? ""),
    task: taskByOrderId.get(order.id ?? ""),
  }));

  return { rows, truncated };
}

/** 他科依頼一覧。targetDepartmentId を渡すとその科あての依頼だけを上流で絞る。 */
export function useConsultWorklist(view: ConsultWorklistView, targetDepartmentId?: string) {
  return useQuery({
    queryKey: ["ServiceRequest", "consult-worklist", view, targetDepartmentId ?? ""],
    queryFn: () => fetchConsultWorklist(view, targetDepartmentId || undefined),
    placeholderData: keepPreviousData,
  });
}

export function invalidateConsult(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "consult-worklist"] });
  // カルテのオーダーカードも進捗と回答を出しているので読み直させる。
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
}

/**
 * 進捗の変更。Task と ServiceRequest.status を 1 つの transaction で両方書く
 * (docs/consult-order-design.md §4)。**片方だけを書く入口を増やさないこと** —
 * status だけが取り残されると、回答済の依頼が部門一覧の未回答に出続ける。
 *
 * 「回答取消」(completed → accepted)では回答への参照も外れる
 * (buildConsultOrderStatusEntry)。回答の診療記録そのものは消さない。
 */
export function useUpdateConsultTaskStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      order,
      task,
      status,
    }: {
      order: fhir4.ServiceRequest;
      task: fhir4.Task | undefined;
      status: ConsultTaskStatus;
    }) =>
      postBundle({
        resourceType: "Bundle",
        type: "transaction",
        entry: [
          taskBundleEntry(buildConsultTaskUpdate(task, order, status)),
          buildConsultOrderStatusEntry(order, consultOrderStatusFor(status)),
        ],
      }),
    onSuccess: () => invalidateConsult(queryClient),
  });
}

/**
 * 回答の保存。診療記録(Composition)を書き、同じ transaction で進捗を回答済にし、
 * 依頼側に回答への参照と status=completed を書く。
 *
 * Composition は採番前なので fullUrl(urn:uuid)で POST し、依頼側からはその
 * urn:uuid を参照する。実 ID への書き換えは上流の transaction 処理が行う
 * (診療記録がテンプレート回答の QuestionnaireResponse を参照するのと同じやり方)。
 *
 * 画像・テンプレート回答のエントリ(entries)は Composition より前に積む
 * — 診療記録の単独保存(saveClinicalNote)と同じ理由で、本体を保存しなかったときに
 * 回答だけが孤児として残らないようにするため。
 */
export function useSaveConsultReply() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      order,
      task,
      composition,
      entries,
      replierName,
    }: {
      order: fhir4.ServiceRequest;
      task: fhir4.Task | undefined;
      composition: fhir4.Composition;
      entries: fhir4.BundleEntry[];
      replierName: string;
    }) => {
      const replyReference = `urn:uuid:${crypto.randomUUID()}`;
      // 記載を編集し直したときに前回の生成 Observation を消すのは単独保存と同じ。
      const stale = await staleObservationEntries(entries);
      return postBundle({
        resourceType: "Bundle",
        type: "transaction",
        entry: [
          ...stale,
          ...entries,
          {
            fullUrl: replyReference,
            resource: composition,
            request: { method: "POST", url: "Composition" },
          },
          taskBundleEntry(buildConsultTaskUpdate(task, order, "completed")),
          buildConsultOrderReplyEntry(order, replyReference, replierName),
        ],
      });
    },
    onSuccess: () => {
      invalidateConsult(queryClient);
      // 回答は通常の診療記録としてもカルテのタイムラインに出る。
      queryClient.invalidateQueries({ queryKey: ["Composition", "search"] });
      queryClient.invalidateQueries({ queryKey: ["QuestionnaireResponse", "search"] });
      queryClient.invalidateQueries({ queryKey: ["Observation", "search"] });
    },
  });
}
