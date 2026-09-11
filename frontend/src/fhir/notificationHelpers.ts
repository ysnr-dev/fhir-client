import { nowFhirDateTime } from "../lib/dates";
import { TASK_CODE_SYSTEM } from "./taskHelpers";

// 通知(Task)の共通層。
//
//   通知の対象 ← focus ── Task(通知) ── owner → 宛先の医療従事者
//
// 「緊急異常値を見てほしい」「代行入力を承認してほしい」のように、**宛先を決めて相手に
// 何かしてもらう**ものを 1 つの器にまとめる。種別は Task.code で分ける(lab-panic /
// order-approval。今後は読影の重要所見・文書作成の督促が乗る)。1 通知 = 1 宛先で、
// 複数人に届けるなら Task を複数作る。
//
// 部門進捗の Task(taskHelpers の createTaskHelpers)とは別物。あちらは「オーダーを部門が
// 処理する進捗」で焦点が ServiceRequest・宛先を持たない。code の system だけ共有する。
//
// 上流の Task 検索は code / status / owner / focus / authored-on に対応していて、code は
// カンマ区切りの OR が効く(一覧は種別を全部並べて 1 回で引く)。ただし `_include=Task:focus`
// の対象は ServiceRequest だけなので、**一覧に出す情報は Task 自身(for / description /
// input)から読める形で持たせる**。患者だけは `_include=Task:subject` で同じ応答に付く。

/**
 * 一覧の行に共通する部分。種別ごとの行(PanicTaskRow など)はこれを拡張して、
 * その種別の内容セルが要る情報を足す。
 */
export interface NotificationRowBase {
  task: fhir4.Task;
  patient?: fhir4.Patient;
  patientId: string;
  authoredOn: string;
  /** 宛先の表示名。宛先なしは空文字。 */
  ownerName: string;
}

/** 通知の状態。requested = 未対応 / completed = 対応済み / cancelled = 取り下げ。 */
export type NotificationStatus = "requested" | "completed" | "cancelled";

/**
 * 通知の強度。`Task.priority` に写す。
 *
 *   alert   アラート   連絡が遅れると患者に害が出る(緊急異常値)
 *   caution 注意       順番を上げて対応してほしい
 *   info    お知らせ   手が空いたときでよい(オーダー承認)
 *
 * オーダー(`ServiceRequest`)の至急区分も `priority` を使うが、あちらは
 * 通常・至急・事後・緊急の語彙(`fhir/shared.ts`)で、この対応表とは別物。
 */
export type NotificationSeverity = "alert" | "caution" | "info";

/** 強い順。一覧の絞り込みもこの順に並べる。 */
export const NOTIFICATION_SEVERITIES: NotificationSeverity[] = ["alert", "caution", "info"];

export const NOTIFICATION_SEVERITY_LABEL: Record<NotificationSeverity, string> = {
  alert: "アラート",
  caution: "注意",
  info: "お知らせ",
};

const SEVERITY_PRIORITY: Record<NotificationSeverity, "stat" | "urgent" | "routine"> = {
  alert: "stat",
  caution: "urgent",
  info: "routine",
};

/** ベルのアラート件数を引く `priority` の値(カンマ区切りは OR)。 */
export const ALERT_PRIORITY_PARAM = "stat,asap";

/**
 * 通知の強度。`asap` をアラートに寄せるのは、通知で使うとしたら「急ぎ」の意味に
 * なるため。priority を持たない Task は最も弱い扱いにする。
 */
export function notificationSeverityOf(task: fhir4.Task): NotificationSeverity {
  if (task.priority === "stat" || task.priority === "asap") return "alert";
  if (task.priority === "urgent") return "caution";
  return "info";
}

export interface NotificationTaskCode {
  code: string;
  display: string;
}

/** 通知を作る・書き換えるときの入力。種別ごとの中身は input に構造化して渡す。 */
export interface NotificationTaskInput {
  code: NotificationTaskCode;
  /** 通知の強度。連絡が遅れて患者に害が出るものは alert。 */
  severity: NotificationSeverity;
  /** 通知の対象。同じ transaction で作るリソースなら urn:uuid(上流が解決する)。 */
  focusReference: string;
  patientId: string;
  /** 宛先。決まらない通知(オーダーに紐付かない検査結果など)では省く。 */
  owner?: fhir4.Reference;
  /** 通知を発生させた人。 */
  requester?: fhir4.Reference;
  /** 通知の元になったオーダー。オーダー側から未対応の通知を引くために持つ。 */
  basedOn?: fhir4.Reference[];
  /** 人が読める要約 1 行。一覧は input を読むので、これは Task をそのまま読む相手向け。 */
  description: string;
  input?: fhir4.TaskInput[];
  /** 期限(YYYY-MM-DD)。締切がある通知だけ。 */
  dueDate?: string;
}

export function hasTaskCode(task: fhir4.Task, code: string): boolean {
  return Boolean(task.code?.coding?.some((c) => c.system === TASK_CODE_SYSTEM && c.code === code));
}

/** 通知の種別コード。レジストリの引き当てに使う。 */
export function notificationCodeOf(task: fhir4.Task): string | undefined {
  return task.code?.coding?.find((c) => c.system === TASK_CODE_SYSTEM)?.code;
}

/**
 * 通知の Task。既にあるものを渡すと、本文と時刻を更新して未対応に戻す
 * (内容が変わったときは、対応済みでも改めて見てもらう必要があるため)。
 */
export function buildNotificationTask(
  input: NotificationTaskInput,
  existing?: fhir4.Task,
): fhir4.Task {
  const now = latestOf(nowFhirDateTime(), existing?.authoredOn);

  const task: fhir4.Task = {
    ...(existing ?? {}),
    resourceType: "Task",
    status: "requested",
    intent: "filler-order",
    priority: SEVERITY_PRIORITY[input.severity],
    code: {
      coding: [{ system: TASK_CODE_SYSTEM, ...input.code }],
      text: input.code.display,
    },
    focus: { reference: input.focusReference },
    for: { reference: `Patient/${input.patientId}` },
    description: input.description,
    authoredOn: existing?.authoredOn ?? now,
    lastModified: now,
  };

  if (input.input?.length) task.input = input.input;
  else delete task.input;
  if (input.owner?.reference) task.owner = input.owner;
  else delete task.owner;
  if (input.requester?.reference) task.requester = input.requester;
  else delete task.requester;
  if (input.basedOn?.length) task.basedOn = input.basedOn;
  else delete task.basedOn;
  if (input.dueDate) task.restriction = { period: { end: input.dueDate } };
  else delete task.restriction;
  // 前の対応記録は残さない(この通知は新しい内容として出し直す)。
  delete task.note;
  delete task.executionPeriod;
  return task;
}

/** 通知の transaction entry。既存があれば PUT、無ければ POST。 */
export function notificationTaskEntry(task: fhir4.Task, existingId?: string): fhir4.BundleEntry {
  return {
    resource: task,
    request: existingId
      ? { method: "PUT", url: `Task/${existingId}` }
      : { method: "POST", url: "Task" },
  };
}

/** 対応済みにした通知。誰がいつ対応したかを note に残す。 */
export function buildCompletedNotificationTask(
  task: fhir4.Task,
  actor: { practitionerId: string; display: string },
  noteText: string,
): fhir4.Task {
  const now = latestOf(nowFhirDateTime(), task.authoredOn);
  return {
    ...task,
    status: "completed",
    lastModified: now,
    executionPeriod: { start: task.authoredOn ?? now, end: now },
    note: [
      {
        authorReference: {
          reference: `Practitioner/${actor.practitionerId}`,
          display: actor.display,
        },
        time: now,
        text: noteText,
      },
    ],
  };
}

/** 通知の取り下げ。対応の要らない事象になったとき(値が直った・オーダーが消えた)。 */
export function buildCancelledNotificationTask(task: fhir4.Task): fhir4.Task {
  return { ...task, status: "cancelled", lastModified: latestOf(nowFhirDateTime(), task.authoredOn) };
}

/**
 * `now` と作成時刻の遅い方。上流の Task は `lastModified >= authoredOn`(inv-1)を検証するので、
 * 作成時刻が未来の通知(端末の時計のずれ、来歴の記録時刻を写した後追いの通知)でも書き換えられる
 * ようにする。時差の表記が違うことがあるので文字列ではなく時刻として比べる。
 */
function latestOf(now: string, authoredOn: string | undefined): string {
  if (!authoredOn) return now;
  const created = Date.parse(authoredOn);
  return Number.isNaN(created) || created <= Date.parse(now) ? now : authoredOn;
}

/** 対応済みにする transaction entry。 */
export function completeNotificationEntry(task: fhir4.Task): fhir4.BundleEntry {
  return { resource: task, request: { method: "PUT", url: `Task/${task.id}` } };
}

/** Task 検索の応答(Task + _include の Patient)を種別ごとの処理に渡せる形に分ける。 */
export function splitNotificationBundle(bundle: fhir4.Bundle | undefined): {
  tasks: fhir4.Task[];
  patients: Map<string, fhir4.Patient>;
} {
  const patients = new Map<string, fhir4.Patient>();
  const tasks: fhir4.Task[] = [];
  for (const entry of bundle?.entry ?? []) {
    const resource = entry.resource;
    if (resource?.resourceType === "Patient" && resource.id) {
      patients.set(resource.id, resource as fhir4.Patient);
    } else if (resource?.resourceType === "Task") {
      tasks.push(resource as fhir4.Task);
    }
  }
  return { tasks, patients };
}

export function taskPatientId(task: fhir4.Task): string {
  return task.for?.reference?.split("/").pop() ?? "";
}

/**
 * 宛先の表示名。オーダーの依頼医などの氏名を保存時に焼き付けてある
 * (この codebase は表示時に Practitioner を引き直さない)。宛先なしは空文字。
 */
export function taskOwnerName(task: fhir4.Task): string {
  return task.owner?.display ?? (task.owner?.reference ? "(氏名なし)" : "");
}

/** input から 1 件の値を読む。type.text をキー名として使う。 */
export function taskInputOf(task: fhir4.Task, key: string): fhir4.TaskInput | undefined {
  return (task.input ?? []).find((input) => input.type?.text === key);
}

/** input から同じキーの値を全部読む(種別・対象オーダーのように複数並ぶもの)。 */
export function taskInputsOf(task: fhir4.Task, key: string): fhir4.TaskInput[] {
  return (task.input ?? []).filter((input) => input.type?.text === key);
}
