import {
  useChemoRoomList,
  useConsultWorklist,
  useNursingWorklist,
  useTeamRequestWorklist,
  useWardOptions,
} from "../../api/queries";
import { CONSULT_TASK_STATUS_OPTIONS, consultTaskStatus } from "../../fhir/consultTaskHelpers";
import { INJECTION_TASK_STATUS_OPTIONS, injectionTaskStatus } from "../../fhir/injectionTaskHelpers";
import { NURSING_TASK_STATUS_OPTIONS, nursingTaskStatus } from "../../fhir/nursingTaskHelpers";
import { TEAM_REQUEST_TASK_STATUS_OPTIONS, teamRequestTaskStatus } from "../../fhir/teamRequestTaskHelpers";
import { HomeCountsCard } from "./HomeCountsCard";
import type { HomeCardProps } from "./shared";

// 件数だけのカード(部門ワークリスト以外)。どれも対応する一覧ページと同じ hook で読む。

/** 他科依頼。依頼先の科で絞った未回答の依頼。 */
export function ConsultCard({ card }: HomeCardProps<"consult">) {
  const query = useConsultWorklist("open", card.settings.departmentId);
  return (
    <HomeCountsCard
      title="他科依頼"
      path="/consult-worklist"
      isPending={query.isPending}
      error={query.error}
      statuses={query.data?.rows.map((row) => consultTaskStatus(row.task))}
      options={CONSULT_TASK_STATUS_OPTIONS}
      truncated={query.data?.truncated}
    />
  );
}

/** チーム依頼。チームで絞った終了していない依頼。 */
export function TeamCard({ card }: HomeCardProps<"team">) {
  const query = useTeamRequestWorklist("open", card.settings.teamId);
  return (
    <HomeCountsCard
      title="チーム依頼"
      path="/team-worklist"
      isPending={query.isPending}
      error={query.error}
      statuses={query.data?.rows.map((row) => teamRequestTaskStatus(row.task))}
      options={TEAM_REQUEST_TASK_STATUS_OPTIONS}
      truncated={query.data?.truncated}
    />
  );
}

/** 指示受け待ちは大きな数字に出すので、内訳の chip からは外す。 */
const NURSING_BREAKDOWN_OPTIONS = NURSING_TASK_STATUS_OPTIONS.filter((o) => o.code !== "requested");

/**
 * 看護指示(指示簿)。指示受けには完了が無い(受けたら accepted のまま)ので、未処理は
 * 有効な指示のうち指示受け待ちの件数にする。
 */
export function NursingCard({ card, date }: HomeCardProps<"nursing">) {
  const wardId = card.settings.wardId;
  const wards = useWardOptions();
  const wardName = wards.wards.find((w) => w.id === wardId)?.name ?? "";
  const query = useNursingWorklist(date, wardId || undefined);
  const pending = query.data?.rows.filter(
    (row) => row.order.status === "active" && nursingTaskStatus(row.task) === "requested",
  ).length;
  return (
    <HomeCountsCard
      title={`看護指示(${wardName})`}
      path={`/nursing-worklist?ward=${wardId}&date=${date}`}
      isPending={Boolean(wardId) && query.isPending}
      error={query.error}
      statuses={query.data?.rows.map((row) => nursingTaskStatus(row.task))}
      options={NURSING_BREAKDOWN_OPTIONS}
      open={pending ?? 0}
      openLabel="指示受け待ち"
      truncated={query.data?.truncated}
    />
  );
}

/** 外来化学療法室。その日の予約と、注射 Task の状態。 */
export function ChemoRoomCard({ date }: HomeCardProps<"chemoRoom">) {
  const query = useChemoRoomList(date);
  return (
    <HomeCountsCard
      title="外来化学療法室"
      path="/chemo-room-worklist"
      isPending={query.isPending}
      error={query.error}
      statuses={query.data?.map((row) => injectionTaskStatus(row.task))}
      options={INJECTION_TASK_STATUS_OPTIONS}
    />
  );
}
