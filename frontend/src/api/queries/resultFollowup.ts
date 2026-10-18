import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  compareFollowUpRows,
  FOLLOW_UP_TASK_CODE,
  followUpRowOf,
  reopenFollowUpEntry,
  resolveFollowUpEntry,
  type FollowUpResolutionInput,
  type FollowUpRow,
} from "../../fhir/followUpHelpers";
import { splitNotificationBundle } from "../../fhir/notificationHelpers";
import { EXAM_REPORT_CONFIGS, EXAM_REPORT_KIND_OF_ORDER } from "../../fhir/examReportHelpers";
import { departmentOrderKindOf, ORDER_KIND_CORE, ORDER_KIND_LABELS, type OrderKind } from "../../fhir/orderKinds";
import { isOrderItemRequest, labOrderItemRequests } from "../../fhir/labOrderHelpers";
import { ORDER_TYPE_SYSTEM } from "../../fhir/orderHeader";
import { TASK_CODE_SYSTEM } from "../../fhir/taskHelpers";
import { addDays, localDay, today } from "../../lib/dates";
import { postBundle, searchResource } from "../fhirClient";
import { NOTIFICATION_TASK_KEY, searchAllPages } from "./core";
import { useOrderEnterer } from "./provenance";

// 検査結果フォロー(docs/result-followup-design.md)。フォロー推奨の台帳と、確認されないまま
// 日数が経った検査結果の通知を引く。どちらも Task なので、通知の書き込みで一緒に読み直す
// (キーを NOTIFICATION_TASK_KEY の下に置く)。

const FOLLOW_UP_KEY = [...NOTIFICATION_TASK_KEY, "followup"];
const STALE_KEY = [...NOTIFICATION_TASK_KEY, "stale"];

const FOLLOW_UP_PAGE = 500;
/** 未対応は件数と期限順の並べ替えに全件が要る(医師 1 人あたり数十件の想定)。 */
const FOLLOW_UP_OPEN_MAX_PAGES = 4;
/** 対応済みは新しい順に並べるだけなので、上限で欠けたら知らせる。 */
const FOLLOW_UP_DONE_MAX_PAGES = 1;

export type FollowUpStatusFilter = "requested" | "completed";

function followUpParams(status: FollowUpStatusFilter, ownerId: string | null | undefined) {
  const params = new URLSearchParams();
  params.set("code", `${TASK_CODE_SYSTEM}|${FOLLOW_UP_TASK_CODE.code}`);
  params.set("status", status);
  if (ownerId) params.set("owner", `Practitioner/${ownerId}`);
  return params;
}

/**
 * フォロー推奨の一覧。未対応は期限の近い順(上流に期限の検索・並べ替えが無いので全件を読んで並べる)、
 * 対応済みは対応の新しい順。
 */
export function useFollowUpRows(status: FollowUpStatusFilter, ownerId: string | null | undefined) {
  return useQuery({
    queryKey: [...FOLLOW_UP_KEY, status, ownerId ?? "all"],
    queryFn: async () => {
      const params = followUpParams(status, ownerId);
      params.set("_include", "Task:subject");
      params.set("_sort", status === "requested" ? "authored-on" : "-modified");
      const result = await searchAllPages<fhir4.Task>("Task", params, {
        page: FOLLOW_UP_PAGE,
        maxPages: status === "requested" ? FOLLOW_UP_OPEN_MAX_PAGES : FOLLOW_UP_DONE_MAX_PAGES,
        complete: status === "requested",
      });
      const patients = new Map<string, fhir4.Patient>();
      for (const bundle of result.bundles) {
        for (const [id, patient] of splitNotificationBundle(bundle).patients) patients.set(id, patient);
      }
      const rows = result.matches.map((task) =>
        followUpRowOf(task, patients.get(task.for?.reference?.split("/").pop() ?? "")),
      );
      if (status === "requested") rows.sort(compareFollowUpRows);
      return { rows, truncated: result.truncated };
    },
    staleTime: 60_000,
  });
}

/** フォロー推奨の対応を記録する。 */
export function useResolveFollowUp() {
  const queryClient = useQueryClient();
  const enterer = useOrderEnterer();
  return useMutation({
    mutationFn: async ({ row, input }: { row: FollowUpRow; input: FollowUpResolutionInput }) => {
      if (!enterer) throw new Error("医療従事者に紐付いたアカウントでログインしてください");
      return postBundle({
        resourceType: "Bundle",
        type: "transaction",
        entry: [resolveFollowUpEntry(row.task, enterer, input)],
      });
    },
    retry: false,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: NOTIFICATION_TASK_KEY }),
  });
}

/** 対応を取り消して未対応に戻す。 */
export function useReopenFollowUp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (row: FollowUpRow) =>
      postBundle({ resourceType: "Bundle", type: "transaction", entry: [reopenFollowUpEntry(row.task)] }),
    retry: false,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: NOTIFICATION_TASK_KEY }),
  });
}

export interface FollowUpOrderCandidate {
  id: string;
  label: string;
}

const ORDER_CANDIDATE_COUNT = 50;

/** 対応オーダーになりうる種別。再検・精査・他科への紹介。 */
const FOLLOW_UP_ORDER_KINDS: OrderKind[] = [
  "rad-order",
  "physio-order",
  "endoscopy-order",
  "lab-order",
  "micro-order",
  "patho-order",
  "consult-order",
];

function followUpOrderLabel(
  header: fhir4.ServiceRequest,
  kind: OrderKind,
  serviceRequests: fhir4.ServiceRequest[],
): string {
  const date = localDay(header.occurrenceDateTime ?? header.authoredOn);
  const examKind = EXAM_REPORT_KIND_OF_ORDER[kind as keyof typeof EXAM_REPORT_KIND_OF_ORDER];
  const content = examKind
    ? EXAM_REPORT_CONFIGS[examKind].examText(header, labOrderItemRequests(serviceRequests, header.id ?? ""))
    : header.code?.text;
  return [date, ORDER_KIND_LABELS[kind], content].filter(Boolean).join(" ");
}

/** 対応オーダーの候補。その患者の検査・他科依頼のオーダー(ヘッダ)のうち、検査日以降に出したもの。 */
export function useFollowUpOrderCandidates(patientId: string | undefined, fromDate: string) {
  return useQuery({
    queryKey: ["ServiceRequest", "search", "followup-candidates", patientId, fromDate],
    queryFn: async (): Promise<FollowUpOrderCandidate[]> => {
      const params = new URLSearchParams();
      params.set("patient", `Patient/${patientId}`);
      params.set("based-on:missing", "true");
      params.set(
        "category",
        FOLLOW_UP_ORDER_KINDS.map((kind) => `${ORDER_TYPE_SYSTEM}|${ORDER_KIND_CORE[kind].orderType.code}`).join(","),
      );
      if (fromDate) params.set("authoredon", `ge${fromDate}`);
      params.set("_sort", "-authoredon");
      params.set("_count", String(ORDER_CANDIDATE_COUNT));
      // 検査名は明細(GP の見出し)から組み立てる。
      params.set("_revinclude:iterate", "ServiceRequest:based-on");
      const { data: bundle } = await searchResource<fhir4.ServiceRequest>("ServiceRequest", params);
      const serviceRequests = (bundle.entry ?? [])
        .map((entry) => entry.resource as fhir4.ServiceRequest | undefined)
        .filter((sr): sr is fhir4.ServiceRequest => sr?.resourceType === "ServiceRequest");
      return serviceRequests
        .filter((sr) => !isOrderItemRequest(sr))
        .flatMap((sr) => {
          const kind = departmentOrderKindOf(sr);
          if (!kind || !sr.id || !FOLLOW_UP_ORDER_KINDS.includes(kind)) return [];
          return [{ id: sr.id, label: followUpOrderLabel(sr, kind, serviceRequests) }];
        });
    },
    enabled: Boolean(patientId),
    staleTime: 60_000,
  });
}

// ---- 確認されないまま日数が経った検査結果 ----

const STALE_PAGE = 500;
const STALE_MAX_PAGES = 2;

function staleParams(codes: string, days: number, ownerId: string | null | undefined) {
  const params = new URLSearchParams();
  params.set("code", codes);
  params.set("status", "requested");
  // 日付だけの値は上流が施設のタイムゾーンで解釈する(その日の 0 時より前)。
  params.set("authored-on", `lt${addDays(today(), -days + 1)}`);
  if (ownerId) params.set("owner", `Practitioner/${ownerId}`);
  return params;
}

/**
 * 通知日から days 日以上経っても未確認の検査結果の通知(古い順)。codes は種別の
 * `system|code` をカンマで並べたもの、行の組み立ては通知レジストリが渡す。
 */
export function useStaleResultRows<Row>(
  codes: string,
  days: number,
  ownerId: string | null | undefined,
  toRows: (tasks: fhir4.Task[], patients: Map<string, fhir4.Patient>) => Row[],
) {
  return useQuery({
    queryKey: [...STALE_KEY, "list", days, ownerId ?? "all"],
    queryFn: async () => {
      const params = staleParams(codes, days, ownerId);
      params.set("_include", "Task:subject");
      params.set("_sort", "authored-on");
      const result = await searchAllPages<fhir4.Task>("Task", params, {
        page: STALE_PAGE,
        maxPages: STALE_MAX_PAGES,
      });
      const patients = new Map<string, fhir4.Patient>();
      for (const bundle of result.bundles) {
        for (const [id, patient] of splitNotificationBundle(bundle).patients) patients.set(id, patient);
      }
      return { tasks: result.matches, patients, truncated: result.truncated };
    },
    select: (data) => ({ rows: toRows(data.tasks, data.patients), truncated: data.truncated }),
    staleTime: 60_000,
  });
}

/** 未確認のまま days 日以上経った検査結果の件数(ホームのカード)。 */
export function useStaleResultCount(codes: string, days: number, ownerId: string | null | undefined) {
  return useQuery({
    queryKey: [...STALE_KEY, "count", days, ownerId ?? "all"],
    queryFn: async () => {
      const params = staleParams(codes, days, ownerId);
      params.set("_summary", "count");
      const { data } = await searchResource<fhir4.Task>("Task", params);
      return data.total ?? 0;
    },
    staleTime: 60_000,
  });
}
