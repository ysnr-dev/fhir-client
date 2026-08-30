import { useState } from "react";
import { useUpdateEncounter } from "../api/queries";
import {
  buildDischargeCancelledEncounter,
  buildDischargePlanEncounter,
  buildLeaveRemovedEncounter,
  buildTransferPlanEncounter,
  encounterBedId,
  encounterBedLabel,
  encounterNote,
  type DischargePlan,
  type LeaveValues,
  type TransferPlan,
} from "../fhir/encounterHelpers";
import {
  buildDischargeRestoreEntries,
  buildLeaveCancelEntries,
} from "../fhir/mealEncounterSync";
import { displayName } from "../fhir/patientHelpers";
import { useMealSyncContextLoader } from "../hooks/useMealSyncContext";
import { dateTimeLabel } from "../lib/dates";
import { DischargeModal } from "./DischargeModal";
import { ErrorBanner } from "./ErrorBanner";
import { InpatientBodyCells, InpatientHeadCells, KarteLink } from "./InpatientRowCells";
import { LeaveReturnModal } from "./LeaveReturnModal";
import { RowMenu } from "./RowMenu";
import { TransferExecuteModal } from "./TransferExecuteModal";

// 入院患者一覧の「転科・転棟」「外出泊」「退院予定」「退院患者」タブの表。
//
// 前の 3 つは入院中(in-progress)の Encounter に付けたローカル拡張を、拡張の側から
// 並べ直したもの(組み方は fhir/encounterHelpers.ts)。退院患者だけは拡張ではなく
// 退院した(finished)Encounter そのものを並べる。行のもとになる Encounter は
// どれも入院患者タブと同じ検索結果なので、取得は増やさずページ側で振り分ける。
//
// 「実施」はモーダルで日付などを確かめてから書く。「取消」は消す/戻すだけなので
// 確認ダイアログで済ませる(入院予定取消と同じ扱い)。外出泊取消・退院予定取消・
// 退院取消は、その操作で止めた食事オーダーも同じ transaction で元に戻す
// (fhir/mealEncounterSync)。押されたときに患者の食事オーダーを読みに行く。

/** 行のもとになる患者ぶんの情報。どのタブでも要る。 */
interface RowBase {
  encounter: fhir4.Encounter;
  patient?: fhir4.Patient;
}

export interface TransferPlanRow extends RowBase {
  plan: TransferPlan;
}

export interface LeaveRow extends RowBase {
  /** いま居る病室・ベッド。 */
  roomName: string;
  bedName: string;
  leave: LeaveValues;
}

export interface DischargePlanRow extends RowBase {
  roomName: string;
  bedName: string;
  plan: DischargePlan;
}

export interface DischargedRow extends RowBase {
  /** 退院したときに居た病室・ベッド。 */
  roomName: string;
  bedName: string;
}

function EmptyMessage({ filtering, name }: { filtering: boolean; name: string }) {
  return (
    <p className="patient-table__empty">
      {filtering ? `絞り込みに該当する${name}がありません。` : `この病棟の${name}はありません。`}
    </p>
  );
}

// ---- 転科・転棟 ----

export function TransferPlanTable({
  rows,
  filtering,
  occupiedBedIds,
}: {
  rows: TransferPlanRow[];
  filtering: boolean;
  /** いま入院中の患者が居るベッドの id。実施のとき空床のみ選ばせるのに使う。 */
  occupiedBedIds: Set<string>;
}) {
  const [executeTarget, setExecuteTarget] = useState<TransferPlanRow | null>(null);
  const cancelPlan = useUpdateEncounter();

  function handleCancel(row: TransferPlanRow) {
    const label = row.patient ? displayName(row.patient) : "この患者";
    if (!window.confirm(`${label} の転科・転棟予定を取り消します。よろしいですか?`)) return;
    cancelPlan.mutate(buildTransferPlanEncounter(row.encounter, null));
  }

  if (rows.length === 0) return <EmptyMessage filtering={filtering} name="転科・転棟予定" />;

  return (
    <>
      <ErrorBanner error={cancelPlan.error} />
      <div className="inpatient-wrap">
        <table className="patient-table inpatient">
          <thead>
            <tr>
              <InpatientHeadCells />
              <th>転科・転棟予定日</th>
              <th>現在の場所</th>
              <th className="inpatient__col-actions"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.encounter.id}>
                {/* 病室・ベッド・診療科は移動先(この病棟に移ってくる患者の一覧なので、
                    移動後の姿で並べる)。今どこに居るかは右の列に添える。 */}
                <InpatientBodyCells
                  roomName={row.plan.roomName || "-"}
                  bedName={row.plan.bedName || "-"}
                  encounter={row.encounter}
                  patient={row.patient}
                  departmentName={row.plan.departmentName}
                />
                <td>{row.plan.date}</td>
                <td>{encounterBedLabel(row.encounter)}</td>
                <td className="patient-table__actions inpatient__col-actions">
                  <KarteLink patient={row.patient} />
                  <RowMenu
                    label={`${row.patient ? displayName(row.patient) : "この患者"} の操作`}
                    escapesClipping
                  >
                    <button
                      type="button"
                      className="row-menu__item"
                      onClick={() => setExecuteTarget(row)}
                    >
                      転科・転棟実施
                    </button>
                    <button
                      type="button"
                      className="row-menu__item row-menu__item--danger"
                      onClick={() => handleCancel(row)}
                      disabled={cancelPlan.isPending}
                    >
                      転科・転棟予定取消
                    </button>
                  </RowMenu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="order-select__muted">転科・転棟予定 {rows.length} 件</p>

      {executeTarget && (
        <TransferExecuteModal
          encounter={executeTarget.encounter}
          patient={executeTarget.patient}
          plan={executeTarget.plan}
          occupiedBedIds={occupiedBedIds}
          onClose={() => setExecuteTarget(null)}
        />
      )}
    </>
  );
}

// ---- 外出泊 ----

export function LeaveTable({ rows, filtering }: { rows: LeaveRow[]; filtering: boolean }) {
  const [returnTarget, setReturnTarget] = useState<LeaveRow | null>(null);
  const cancelLeave = useUpdateEncounter();
  const loadMealSync = useMealSyncContextLoader();

  async function handleCancel(row: LeaveRow) {
    const label = row.patient ? displayName(row.patient) : "この患者";
    if (
      !window.confirm(
        `${label} の外出泊(${dateTimeLabel(row.leave.start)}〜)を取り消します。外出泊で止めた食事オーダーも元に戻します。よろしいですか?`,
      )
    ) {
      return;
    }
    const ctx = await loadMealSync(row.encounter);
    cancelLeave.mutate({
      encounter: buildLeaveRemovedEncounter(row.encounter, row.leave.id),
      extraEntries: row.leave.id ? buildLeaveCancelEntries(ctx, row.leave.id) : [],
    });
  }

  if (rows.length === 0) return <EmptyMessage filtering={filtering} name="外出泊" />;

  return (
    <>
      <ErrorBanner error={cancelLeave.error} />
      <div className="inpatient-wrap">
        <table className="patient-table inpatient">
          <thead>
            <tr>
              <InpatientHeadCells />
              <th>外出泊開始日時</th>
              <th>外出泊終了日時</th>
              <th>外出泊理由</th>
              <th className="inpatient__col-actions"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              // 1 人が複数の外出泊を持てるので、行の key は Encounter だけでは足りない。
              <tr key={`${row.encounter.id}-${row.leave.id || row.leave.start}`}>
                <InpatientBodyCells
                  roomName={row.roomName}
                  bedName={row.bedName}
                  encounter={row.encounter}
                  patient={row.patient}
                />
                <td>{dateTimeLabel(row.leave.start)}</td>
                <td>{row.leave.end ? dateTimeLabel(row.leave.end) : "未定"}</td>
                <td className="inpatient__note">{row.leave.reason || "-"}</td>
                <td className="patient-table__actions inpatient__col-actions">
                  <KarteLink patient={row.patient} />
                  <RowMenu
                    label={`${row.patient ? displayName(row.patient) : "この患者"} の操作`}
                    escapesClipping
                  >
                    <button
                      type="button"
                      className="row-menu__item"
                      onClick={() => setReturnTarget(row)}
                    >
                      帰院実施
                    </button>
                    <button
                      type="button"
                      className="row-menu__item row-menu__item--danger"
                      onClick={() => handleCancel(row)}
                      disabled={cancelLeave.isPending}
                    >
                      外出泊取消
                    </button>
                  </RowMenu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="order-select__muted">外出泊 {rows.length} 件</p>

      {returnTarget && (
        <LeaveReturnModal
          encounter={returnTarget.encounter}
          patient={returnTarget.patient}
          leave={returnTarget.leave}
          onClose={() => setReturnTarget(null)}
        />
      )}
    </>
  );
}

// ---- 退院予定 ----

export function DischargePlanTable({
  rows,
  filtering,
}: {
  rows: DischargePlanRow[];
  filtering: boolean;
}) {
  const [dischargeTarget, setDischargeTarget] = useState<DischargePlanRow | null>(null);
  const cancelPlan = useUpdateEncounter();
  const loadMealSync = useMealSyncContextLoader();

  async function handleCancel(row: DischargePlanRow) {
    const label = row.patient ? displayName(row.patient) : "この患者";
    if (
      !window.confirm(
        `${label} の退院予定を取り消します。退院予定で止めた食事オーダーは元に戻ります。よろしいですか?`,
      )
    ) {
      return;
    }
    const ctx = await loadMealSync(row.encounter);
    cancelPlan.mutate({
      encounter: buildDischargePlanEncounter(row.encounter, null),
      extraEntries: buildDischargeRestoreEntries(ctx, ["discharge-plan"]),
    });
  }

  if (rows.length === 0) return <EmptyMessage filtering={filtering} name="退院予定" />;

  return (
    <>
      <ErrorBanner error={cancelPlan.error} />
      <div className="inpatient-wrap">
        <table className="patient-table inpatient">
          <thead>
            <tr>
              <InpatientHeadCells />
              <th>退院予定日時</th>
              <th>退院理由</th>
              <th className="inpatient__col-actions"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.encounter.id}>
                <InpatientBodyCells
                  roomName={row.roomName}
                  bedName={row.bedName}
                  encounter={row.encounter}
                  patient={row.patient}
                />
                <td>{dateTimeLabel(row.plan.at)}</td>
                <td className="inpatient__note">{row.plan.reason || "-"}</td>
                <td className="patient-table__actions inpatient__col-actions">
                  <KarteLink patient={row.patient} />
                  <RowMenu
                    label={`${row.patient ? displayName(row.patient) : "この患者"} の操作`}
                    escapesClipping
                  >
                    <button
                      type="button"
                      className="row-menu__item"
                      onClick={() => setDischargeTarget(row)}
                    >
                      退院実施
                    </button>
                    <button
                      type="button"
                      className="row-menu__item row-menu__item--danger"
                      onClick={() => handleCancel(row)}
                      disabled={cancelPlan.isPending}
                    >
                      退院予定取消
                    </button>
                  </RowMenu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="order-select__muted">退院予定 {rows.length} 件</p>

      {/* 退院そのものは入院患者タブと同じモーダル。退院すると退院予定は落ちるので、
          書いたあとこの一覧からも消える。 */}
      {dischargeTarget && (
        <DischargeModal
          encounter={dischargeTarget.encounter}
          patient={dischargeTarget.patient}
          bedLabel={encounterBedLabel(dischargeTarget.encounter)}
          onClose={() => setDischargeTarget(null)}
        />
      )}
    </>
  );
}

// ---- 退院患者 ----

export function DischargedTable({
  rows,
  filtering,
  occupiedBedIds,
}: {
  rows: DischargedRow[];
  filtering: boolean;
  /** いま入院中の患者が居るベッドの id。取消の前に床の重なりを知らせるのに使う。 */
  occupiedBedIds: Set<string>;
}) {
  const cancelDischarge = useUpdateEncounter();
  const loadMealSync = useMealSyncContextLoader();

  async function handleCancel(row: DischargedRow) {
    const label = row.patient ? displayName(row.patient) : "この患者";
    const bedId = encounterBedId(row.encounter);
    // 退院したあとに同じ床へ別の患者を入れていることがある。止めはしないが、
    // そのまま戻すと 1 つの床に 2 人並ぶので確認のときに知らせる。
    const taken = bedId ? occupiedBedIds.has(bedId) : false;
    const bedLabel = encounterBedLabel(row.encounter);
    const message = taken
      ? `${label} の退院を取り消して入院中に戻します。${bedLabel} には別の患者が入院しています。退院で止めた食事オーダーは元に戻ります。よろしいですか?`
      : `${label} の退院を取り消して入院中に戻します。退院で止めた食事オーダーは元に戻ります。よろしいですか?`;
    if (!window.confirm(message)) return;
    // 退院予定で止めたまま退院した分も「退院」に上書きしてあるが、旧データに備えて両方を戻す。
    const ctx = await loadMealSync(row.encounter);
    cancelDischarge.mutate({
      encounter: buildDischargeCancelledEncounter(row.encounter),
      extraEntries: buildDischargeRestoreEntries(ctx, ["discharge", "discharge-plan"]),
    });
  }

  if (rows.length === 0) return <EmptyMessage filtering={filtering} name="退院患者" />;

  return (
    <>
      <ErrorBanner error={cancelDischarge.error} />
      <div className="inpatient-wrap">
        <table className="patient-table inpatient">
          <thead>
            <tr>
              <InpatientHeadCells />
              <th>入院日時</th>
              <th>退院日時</th>
              <th>特記事項</th>
              <th className="inpatient__col-actions"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.encounter.id}>
                <InpatientBodyCells
                  roomName={row.roomName}
                  bedName={row.bedName}
                  encounter={row.encounter}
                  patient={row.patient}
                />
                <td>{dateTimeLabel(row.encounter.period?.start)}</td>
                <td>{dateTimeLabel(row.encounter.period?.end)}</td>
                <td className="inpatient__note">{encounterNote(row.encounter) || "-"}</td>
                <td className="patient-table__actions inpatient__col-actions">
                  <KarteLink patient={row.patient} />
                  <RowMenu
                    label={`${row.patient ? displayName(row.patient) : "この患者"} の操作`}
                    escapesClipping
                  >
                    <button
                      type="button"
                      className="row-menu__item row-menu__item--danger"
                      onClick={() => handleCancel(row)}
                      disabled={cancelDischarge.isPending}
                    >
                      退院取消
                    </button>
                  </RowMenu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="order-select__muted">退院患者 {rows.length} 件</p>
    </>
  );
}
