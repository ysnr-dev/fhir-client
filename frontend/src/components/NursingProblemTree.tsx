import {
  NURSING_ACTIVITY_TYPES,
  NURSING_ACTIVITY_TYPE_LABELS,
  NURSING_ITEM_TYPE_LABELS,
  interventionGroups,
  nursingDiagnosisCode,
  nursingGoalViews,
  type NursingActivityValues,
  type NursingProblemView,
} from "../fhir/nursingCarePlanHelpers";
import { nursingOrderState } from "../fhir/nursingOrderHelpers";

// 看護問題 1 件の中身(因子・目標・計画・評価)をツリーで並べる。看護計画タブのカードと看護サマリーの入力で使う。

/** 計画の行 1 つ。展開した看護指示が効いていれば「指示中」を添える。 */
function ActivityLeaf({ activity, view, at }: { activity: NursingActivityValues; view: NursingProblemView; at: string }) {
  const orders = view.ordersByActivity.get(activity.id) ?? [];
  const ordered = view.active && orders.some((sr) => nursingOrderState(sr, at) === "active");
  return (
    <li className={activity.stopped ? "nursing-plan__activity--stopped" : undefined}>
      {activity.text}
      {ordered && <span className="nursing-tab__plan-badge">指示中</span>}
    </li>
  );
}

/** カードの中身。因子・目標・計画(OP/TP/EP、看護介入と行動)・評価をツリーで並べる。 */
export function NursingProblemTree({ view, at }: { view: NursingProblemView; at: string }) {
  const goals = nursingGoalViews(view.goals, at);
  const latest = view.evaluations.find((e) => e.kind === "problem");
  const diagnosisCode = nursingDiagnosisCode(view.condition);
  const groups = interventionGroups(view.activities);
  return (
    <ul className="nursing-tree">
      {diagnosisCode && (
        <li>
          <span className="nursing-tree__label">看護診断</span>
          <ul>
            <li>
              {diagnosisCode} {view.condition.code?.coding?.[0]?.display ?? view.name}
            </li>
          </ul>
        </li>
      )}
      {view.factors.length > 0 && (
        <li>
          <span className="nursing-tree__label">因子</span>
          <ul>
            {view.factors.map((f) => (
              <li key={`${f.kind}:${f.name}`}>
                <span className="nursing-tree__kind">{NURSING_ITEM_TYPE_LABELS[f.kind]}</span>
                {f.name}
              </li>
            ))}
          </ul>
        </li>
      )}
      <li>
        <span className="nursing-tree__label">{view.entry === "diagnosis" ? "目標（NOC）" : "目標"}</span>
        <ul>
          {goals.map((goal) => (
            <li key={goal.goal.id} className={goal.status === "active" ? undefined : "nursing-plan__goal--done"}>
              {goal.text}
              {goal.outcomeName && <span className="nursing-plan__outcome">成果: {goal.outcomeName}</span>}
              {goal.dueDate && (
                <span className={`nursing-plan__due${goal.overdue ? " nursing-plan__due--overdue" : ""}`}>
                  評価予定 {goal.dueDate}
                </span>
              )}
              {goal.achievement && <span className="nursing-plan__achievement">{goal.achievement}</span>}
            </li>
          ))}
        </ul>
      </li>
      {groups.length > 0 && (
        <li>
          <span className="nursing-tree__label">看護介入（NIC）</span>
          <ul>
            {groups.map((group) => (
              <li key={group.code || group.name}>
                <span className="nursing-plan__intervention">{group.name || group.code}</span>
                <ul>
                  {group.rows.map((activity) => (
                    <ActivityLeaf key={activity.id} activity={activity} view={view} at={at} />
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </li>
      )}
      {NURSING_ACTIVITY_TYPES.map((type) => {
        const rows = view.activities.filter((a) => a.type === type);
        if (rows.length === 0) return null;
        return (
          <li key={type}>
            <span className="nursing-tree__label">{NURSING_ACTIVITY_TYPE_LABELS[type]}</span>
            <ul>
              {rows.map((activity) => (
                <ActivityLeaf key={activity.id} activity={activity} view={view} at={at} />
              ))}
            </ul>
          </li>
        );
      })}
      {latest && (
        <li>
          <span className="nursing-tree__label">評価</span>
          <ul>
            <li>
              {latest.date.slice(0, 10)} {latest.result}
              {latest.performer && ` (${latest.performer})`}
              {latest.note && <div className="nursing-plan__note">{latest.note}</div>}
            </li>
          </ul>
        </li>
      )}
    </ul>
  );
}
