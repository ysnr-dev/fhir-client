import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useCurrentPractitioner } from "../api/authQueries";
import type { BulletinPost, PatientCaution } from "../api/masterClient";
import { useBulletinPosts, usePatientCautions } from "../api/masterQueries";
import {
  useAllergiesForPatients,
  useBedWardIndex,
  useFlagsForPatients,
  useInfectionsForPatients,
  useInpatientEncounters,
  useNotifications,
  useNursingPendingCounts,
  useOutpatientList,
  usePractitionerRoles,
  type OutpatientRow,
} from "../api/queries";
import { BulletinPostItem } from "../components/BulletinPostItem";
import { BulletinPostModal } from "../components/BulletinPostModal";
import { ErrorBanner } from "../components/ErrorBanner";
import type { NotificationRow } from "../components/notifications/notificationRegistry";
import { HomeWorklistCard } from "../components/HomeWorklistCard";
import { RowPictograms } from "../components/PatientListRowParts";
import { PatientKana } from "../components/PatientRowCells";
import {
  appointmentActorId,
  appointmentBookedTimeLabel,
  appointmentDepartmentLabel,
} from "../fhir/appointmentHelpers";
import {
  encounterAdmissionDate,
  encounterAttendingName,
  encounterBedLabel,
  encounterDepartmentName,
  encounterNurseNames,
} from "../fhir/encounterHelpers";
import {
  HOME_WORKLISTS,
  homeInpatientGroups,
  homeOutpatientRows,
  homeProfileOf,
  type HomeProfile,
} from "../fhir/homeSections";
import { NOTIFICATION_SEVERITY_LABEL, notificationSeverityOf } from "../fhir/notificationHelpers";
import {
  IN_EXAM_STATUS,
  outpatientStatusCode,
  outpatientStatusCounts,
  outpatientStatusLabel,
} from "../fhir/outpatientEncounterHelpers";
import { displayName, patientNumberOf } from "../fhir/patientHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import {
  parseDepartmentRoles,
  parsePractitionerRole,
  practitionerRoleLabel,
} from "../fhir/practitionerRoleHelpers";
import { useStoredToggle } from "../hooks/useStoredToggle";
import { KARTE_TAB_PARAM } from "../karteUrl";
import { dateTimeSecondsLabel, today } from "../lib/dates";
import { useReturnLinkState } from "../returnTo";

// ホーム(トップページ)。ログインした人の「今日の仕事」を職種ごとに 1 画面に集める。
// 何を出すかは fhir/homeSections.ts の homeProfileOf が決め、ここはカードを並べるだけ。
// 各カードは対応する一覧ページと同じ hook で読むので、カードから一覧へ移っても読み直さない。

// 自動更新の入り切り。既定は切ってある(外来一覧・通知のベルと同じ考え方)。
const POLLING_STORAGE_KEY = "fhir-client.home.polling";

const BULLETIN_ROWS = 5;
const NOTIFICATION_ROWS = 5;
const OUTPATIENT_ROWS = 8;

/** 診察待ちとして並べる状態。診療済・未来院は落とす。 */
const WAITING_STATUSES: readonly string[] = ["booked", "arrived", "checked-in", IN_EXAM_STATUS];

export function HomePage() {
  const { user, practitionerId, practitioner, sessionLoading } = useCurrentPractitioner();
  const roles = usePractitionerRoles(practitionerId ?? undefined);
  const roleCode = roles.role ? parsePractitionerRole(roles.role).roleCode : undefined;
  const departments = useMemo(() => parseDepartmentRoles(roles.roles), [roles.roles]);
  const loading = sessionLoading || (Boolean(practitionerId) && roles.isPending);
  const profile = homeProfileOf({
    administrator: Boolean(user?.administrator),
    practitionerId,
    roleCode,
  });

  const [polling, setPolling] = useStoredToggle(POLLING_STORAGE_KEY);

  // カードの中の表を折り返さずに出すため、一覧ページと同じく本文の幅制限を外す。
  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  return (
    <div className="page">
      <div className="page__header">
        <h1>ホーム</h1>
        <div className="page__header-title">
          {practitioner && (
            <span className="home__profile">
              <span>{practitionerDisplayName(practitioner)}</span>
              <span>
                {roleCode ? (
                  practitionerRoleLabel(roleCode)
                ) : (
                  <Link to={`/practitioners/${practitionerId}/edit`}>職種未登録</Link>
                )}
              </span>
              {departments.map((department) => (
                <span key={department.organizationId} className="home__profile-dept">
                  {department.name}
                  {department.primary && departments.length > 1 ? "(既定)" : ""}
                </span>
              ))}
            </span>
          )}
          {profile.sections.includes("outpatient") && (
            <label className="outpatient__polling">
              <input
                type="checkbox"
                checked={polling}
                onChange={(e) => setPolling(e.target.checked)}
              />
              自動更新
            </label>
          )}
        </div>
      </div>
      <ErrorBanner error={roles.error} />
      {loading ? (
        <p>読み込み中...</p>
      ) : profile.kind === "administrator" ? (
        <div className="home__grid">
          <BulletinCard />
          <LauncherCard profile={profile} wide />
        </div>
      ) : (
        <HomeDashboard profile={profile} practitionerId={practitionerId} polling={polling} />
      )}
    </div>
  );
}

interface DashboardProps {
  profile: HomeProfile;
  practitionerId: string | null;
  polling: boolean;
}

/**
 * 医療従事者のホーム。外来・入院はそれぞれ 1 日ぶんを読み、ここで自分の担当に絞る
 * (一覧ページと同じ読み方)。出さないセクションの hook は日付を空にして読みに行かせない。
 */
function HomeDashboard({ profile, practitionerId, polling }: DashboardProps) {
  const date = today();
  const showOutpatient = profile.sections.includes("outpatient");
  const showInpatient = profile.sections.includes("inpatient") && profile.inpatientBy !== null;

  const outpatients = useOutpatientList(showOutpatient ? date : "", { polling });
  const inpatients = useInpatientEncounters(showInpatient ? date : "");
  const bedWards = useBedWardIndex();

  const outpatientRows = useMemo(
    () =>
      homeOutpatientRows(
        outpatients.data?.rows ?? [],
        profile.outpatientMine ? practitionerId : null,
      ),
    [outpatients.data, profile.outpatientMine, practitionerId],
  );
  const inpatientGroups = useMemo(
    () =>
      inpatients.data && profile.inpatientBy && practitionerId
        ? homeInpatientGroups(
            inpatients.data.byBed.values(),
            inpatients.data.patientsById,
            bedWards.bedWards,
            profile.inpatientBy,
            practitionerId,
          )
        : [],
    [inpatients.data, bedWards.bedWards, profile.inpatientBy, practitionerId],
  );

  // 注意のピクトグラムは外来・入院の患者ぶんをまとめて 1 回ずつ引く。
  const patientIds = useMemo(() => {
    const ids = new Set<string>();
    for (const row of outpatientRows) {
      const id = row.patient?.id ?? appointmentActorId(row.appointment, "Patient");
      if (id) ids.add(id);
    }
    for (const group of inpatientGroups) {
      for (const row of group.rows) if (row.patientId) ids.add(row.patientId);
    }
    return [...ids];
  }, [outpatientRows, inpatientGroups]);
  const cautions = usePatientCautions();
  const cautionsByCode = useMemo(
    () => new Map<string, PatientCaution>((cautions.data?.items ?? []).map((c) => [c.code, c])),
    [cautions.data],
  );
  const flags = useFlagsForPatients(patientIds);
  const allergies = useAllergiesForPatients(patientIds);
  const infections = useInfectionsForPatients(patientIds);
  const pictograms = {
    flags: flags.byPatient,
    allergies: allergies.byPatient,
    infections: infections.byPatient,
    cautionsByCode,
  };

  return (
    <div className="home__grid">
      <BulletinCard />
      {profile.sections.includes("notifications") && (
        <NotificationCard practitionerId={practitionerId} />
      )}
      {showOutpatient && (
        <OutpatientCard
          date={date}
          rows={outpatientRows}
          mine={profile.outpatientMine ? practitionerId : null}
          isPending={outpatients.isPending}
          error={outpatients.error}
          truncated={outpatients.data?.truncated}
          pictograms={pictograms}
        />
      )}
      {showInpatient && (
        <InpatientCard
          date={date}
          by={profile.inpatientBy ?? "attending"}
          groups={inpatientGroups}
          isPending={inpatients.isPending || bedWards.isPending}
          error={inpatients.error ?? bedWards.error}
          truncated={inpatients.data?.truncated}
          pictograms={pictograms}
        />
      )}
      {profile.worklists.map((kind) => (
        <HomeWorklistCard key={kind} kind={kind} date={date} />
      ))}
      <LauncherCard profile={profile} wide={profile.worklists.length === 0} />
    </div>
  );
}

type Pictograms = Omit<Parameters<typeof RowPictograms>[0], "patientId">;

// ---- 掲示板 ----

/**
 * 職種によらず全員に出す。今日掲載中の投稿だけを、固定を先頭に新しい順で数件。
 * 幅は他のカードと同じ 1 列ぶん(掲示板 | 通知、外来 | 入院 の並びになる)。
 */
function BulletinCard() {
  const posts = useBulletinPosts({ current: true, per: BULLETIN_ROWS });
  const [editing, setEditing] = useState<BulletinPost | "new" | null>(null);
  const items = posts.data?.items ?? [];
  const rest = (posts.data?.total ?? 0) - items.length;

  return (
    <section className="home__card">
      <div className="home__card-header">
        <h2>掲示板</h2>
        <span className="home__card-actions">
          <button type="button" onClick={() => setEditing("new")}>
            投稿
          </button>
          <Link to="/bulletin">すべて見る</Link>
        </span>
      </div>
      <ErrorBanner error={posts.error} />
      {posts.isPending ? (
        <p className="home__empty">読み込み中...</p>
      ) : items.length === 0 ? (
        <p className="home__empty">掲載中のお知らせはありません。</p>
      ) : (
        <div className="bulletin__list bulletin__list--compact">
          {items.map((post) => (
            <BulletinPostItem key={post.id} post={post} compact onEdit={setEditing} />
          ))}
        </div>
      )}
      {rest > 0 && (
        <p className="home__more">
          <Link to="/bulletin">他 {rest} 件</Link>
        </p>
      )}
      {editing !== null && (
        <BulletinPostModal post={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
      )}
    </section>
  );
}

// ---- 未対応の通知 ----

function NotificationCard({ practitionerId }: { practitionerId: string | null }) {
  const notifications = useNotifications(practitionerId);
  const linkState = useReturnLinkState();

  // 一覧と同じ 60 秒のキャッシュに乗るので、開いたときに古ければ読み直す。
  const { isStale, refetch } = notifications;
  useEffect(() => {
    if (isStale) refetch();
    // 開いたときに一度だけ(isStale の変化で引き直すと実質ポーリングになる)。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = notifications.data ?? [];
  const alertCount = rows.filter((entry) => notificationSeverityOf(entry.row.task) === "alert").length;

  return (
    <section className="home__card">
      <div className="home__card-header">
        <h2>未対応の通知</h2>
        <Link to="/notifications">すべて見る</Link>
      </div>
      <ErrorBanner error={notifications.error} />
      {notifications.isPending ? (
        <p className="home__empty">読み込み中...</p>
      ) : (
        <>
          <p className="home__counts">
            <span className={`home__count home__count--big${alertCount > 0 ? " home__count--alert" : ""}`}>
              未対応 <strong>{rows.length}</strong>
            </span>
            {alertCount > 0 && (
              <span className="home__count">
                アラート <strong>{alertCount}</strong>
              </span>
            )}
          </p>
          {rows.length === 0 ? (
            <p className="home__empty">未対応の通知はありません。</p>
          ) : (
            <div className="home__table-wrap">
              <table className="home__table">
                <tbody>
                  {rows.slice(0, NOTIFICATION_ROWS).map((entry) => (
                    <NotificationLine key={entry.row.task.id} entry={entry} linkState={linkState} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {rows.length > NOTIFICATION_ROWS && (
            <p className="home__more">
              <Link to="/notifications">他 {rows.length - NOTIFICATION_ROWS} 件</Link>
            </p>
          )}
        </>
      )}
    </section>
  );
}

function NotificationLine({
  entry,
  linkState,
}: {
  entry: NotificationRow;
  linkState: ReturnType<typeof useReturnLinkState>;
}) {
  const { kind, row } = entry;
  const severity = notificationSeverityOf(row.task);
  const karteLink = kind.karteLink(row);
  const name = row.patient ? displayName(row.patient) : row.patientId;
  return (
    <tr className={severity === "alert" ? "notification__row--alert" : undefined}>
      <td className="home__cell-compact">
        <span className={`notification__severity notification__severity--${severity}`}>
          {NOTIFICATION_SEVERITY_LABEL[severity]}
        </span>
      </td>
      <td className="home__cell-compact">{kind.label}</td>
      <td className="home__cell-compact">{row.patient ? patientNumberOf(row.patient) : ""}</td>
      <td>
        {karteLink ? (
          <Link className="home__row-link" to={karteLink} state={linkState}>
            {name}
          </Link>
        ) : (
          name
        )}
      </td>
      <td className="home__cell-compact">{dateTimeSecondsLabel(row.authoredOn)}</td>
    </tr>
  );
}

// ---- 本日の外来 ----

interface OutpatientCardProps {
  date: string;
  rows: OutpatientRow[];
  /** 自分の予約に絞っているときの医師 id。全体のときは null。 */
  mine: string | null;
  isPending: boolean;
  error: unknown;
  truncated?: boolean;
  pictograms: Pictograms;
}

function OutpatientCard({ date, rows, mine, isPending, error, truncated, pictograms }: OutpatientCardProps) {
  const linkState = useReturnLinkState();
  const counts = useMemo(() => outpatientStatusCounts(rows), [rows]);
  const waiting = useMemo(
    () =>
      rows
        .filter((row) => WAITING_STATUSES.includes(outpatientStatusCode(row.appointment, row.encounter)))
        .sort((a, b) => (a.appointment.start ?? "").localeCompare(b.appointment.start ?? "")),
    [rows],
  );
  const listLink = `/outpatients?date=${date}${mine ? `&practitioner=${mine}` : ""}`;

  return (
    <section className="home__card">
      <div className="home__card-header">
        <h2>{mine ? "本日の外来(自分の予約)" : "本日の外来"}</h2>
        <Link to={listLink}>外来患者一覧</Link>
      </div>
      <ErrorBanner error={error} />
      {isPending ? (
        <p className="home__empty">読み込み中...</p>
      ) : (
        <>
          <p className="home__counts">
            {counts.map((status) => (
              <span key={status.code} className="home__count">
                {status.label} <strong>{status.count}</strong>
              </span>
            ))}
          </p>
          {truncated && (
            <p className="error-banner__line error-banner__line--warning" role="status">
              この日の予約が多いため、一部のみ表示しています。
            </p>
          )}
          {waiting.length === 0 ? (
            <p className="home__empty">診察待ちの患者はいません。</p>
          ) : (
            <div className="home__table-wrap">
              <table className="home__table">
                <thead>
                  <tr>
                    <th>予約時間</th>
                    <th>患者番号</th>
                    <th>患者氏名</th>
                    <th>診療科</th>
                    <th>状態</th>
                  </tr>
                </thead>
                <tbody>
                  {waiting.slice(0, OUTPATIENT_ROWS).map((row) => {
                    const patientId = row.patient?.id ?? appointmentActorId(row.appointment, "Patient");
                    return (
                      <tr key={row.appointment.id}>
                        <td className="home__cell-compact">{appointmentBookedTimeLabel(row.appointment)}</td>
                        <td className="home__cell-compact">
                          {row.patient ? patientNumberOf(row.patient) : ""}
                        </td>
                        <td>
                          {row.patient && patientId ? (
                            <Link
                              className="home__row-link"
                              to={`/patients/${patientId}/karte`}
                              state={linkState}
                            >
                              {displayName(row.patient)}
                            </Link>
                          ) : (
                            "-"
                          )}
                          <PatientKana patient={row.patient} />
                          {patientId && <RowPictograms patientId={patientId} {...pictograms} />}
                        </td>
                        <td className="home__cell-compact">{appointmentDepartmentLabel(row.appointment)}</td>
                        <td className="home__cell-compact">
                          <span
                            className={`outpatient__status outpatient__status--${outpatientStatusCode(row.appointment, row.encounter)}`}
                          >
                            {outpatientStatusLabel(row.appointment, row.encounter)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {waiting.length > OUTPATIENT_ROWS && (
            <p className="home__more">
              <Link to={listLink}>他 {waiting.length - OUTPATIENT_ROWS} 件</Link>
            </p>
          )}
        </>
      )}
    </section>
  );
}

// ---- 担当入院患者 ----

interface InpatientCardProps {
  date: string;
  by: "attending" | "nurse";
  groups: ReturnType<typeof homeInpatientGroups>;
  isPending: boolean;
  error: unknown;
  truncated?: boolean;
  pictograms: Pictograms;
}

function InpatientCard({ date, by, groups, isPending, error, truncated, pictograms }: InpatientCardProps) {
  const linkState = useReturnLinkState();
  // 未指示受けの件数は病棟単位でしか引けないので、担当患者が最も多い病棟のぶんだけ出す。
  const mainWardId =
    by === "nurse"
      ? [...groups]
          .filter((group) => group.wardId)
          .sort((a, b) => b.rows.length - a.rows.length)[0]?.wardId ?? undefined
      : undefined;
  const pending = useNursingPendingCounts(date, mainWardId);
  const total = groups.reduce((sum, group) => sum + group.rows.length, 0);

  return (
    <section className="home__card">
      <div className="home__card-header">
        <h2>{by === "attending" ? "担当入院患者(主治医)" : "担当入院患者(担当看護師)"}</h2>
        <Link to="/inpatients">入院患者一覧</Link>
      </div>
      <ErrorBanner error={error ?? pending.error} />
      {isPending ? (
        <p className="home__empty">読み込み中...</p>
      ) : (
        <>
          <p className="home__counts">
            <span className="home__count home__count--big">
              在院 <strong>{total}</strong>
            </span>
          </p>
          {truncated && (
            <p className="error-banner__line error-banner__line--warning" role="status">
              入院が多いため、一部のみ表示しています。
            </p>
          )}
          {groups.length === 0 && (
            <p className="home__empty">
              {by === "attending" ? "主治医" : "担当看護師"}として登録された入院患者はいません。
            </p>
          )}
          {groups.map((group) => (
            <div key={group.wardId ?? "unknown"}>
              <p className="home__ward">
                {group.wardId ? (
                  <Link to={`/inpatients?ward=${group.wardId}&date=${date}`}>{group.wardName}</Link>
                ) : (
                  group.wardName
                )}
                <span className="home__ward-count">{group.rows.length} 名</span>
              </p>
              <div className="home__table-wrap">
                <table className="home__table">
                  <thead>
                    <tr>
                      <th>病室・ベッド</th>
                      <th>患者番号</th>
                      <th>患者氏名</th>
                      <th>診療科</th>
                      <th>{by === "attending" ? "担当看護師" : "主治医"}</th>
                      <th>入院日</th>
                      {by === "nurse" && <th></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {group.rows.map((row) => {
                      const pendingCount = row.patientId
                        ? (pending.countByPatientId.get(row.patientId) ?? 0)
                        : 0;
                      return (
                        <tr key={row.encounter.id}>
                          <td className="home__cell-compact">{encounterBedLabel(row.encounter)}</td>
                          <td className="home__cell-compact">
                            {row.patient ? patientNumberOf(row.patient) : ""}
                          </td>
                          <td>
                            {row.patient && row.patientId ? (
                              <Link
                                className="home__row-link"
                                to={`/patients/${row.patientId}/karte`}
                                state={linkState}
                              >
                                {displayName(row.patient)}
                              </Link>
                            ) : (
                              "-"
                            )}
                            <PatientKana patient={row.patient} />
                            {row.patientId && <RowPictograms patientId={row.patientId} {...pictograms} />}
                          </td>
                          <td className="home__cell-compact">{encounterDepartmentName(row.encounter)}</td>
                          <td className="home__cell-compact">
                            {by === "attending"
                              ? encounterNurseNames(row.encounter).join("、") || "-"
                              : encounterAttendingName(row.encounter)}
                          </td>
                          <td className="home__cell-compact">{encounterAdmissionDate(row.encounter)}</td>
                          {by === "nurse" && (
                            <td className="home__cell-compact">
                              {pendingCount > 0 && row.patientId && (
                                <Link
                                  className="inpatient__order-tag"
                                  to={`/patients/${row.patientId}/karte?${KARTE_TAB_PARAM}=nursing`}
                                  state={linkState}
                                >
                                  指示受け {pendingCount}
                                </Link>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </>
      )}
    </section>
  );
}

// ---- ランチャー ----

const COMMON_LINKS: { to: string; label: string }[] = [
  { to: "/bulletin", label: "掲示板" },
  { to: "/patients", label: "患者検索" },
  { to: "/outpatients", label: "外来患者一覧" },
  { to: "/emergency", label: "救急患者一覧" },
  { to: "/inpatients", label: "入院患者一覧" },
  { to: "/ward-map", label: "病棟マップ" },
  { to: "/notifications", label: "通知" },
  { to: "/consult-worklist", label: "他科依頼一覧" },
];

const OTHER_WORKLIST_LINKS: { to: string; label: string }[] = [
  { to: "/surgery-worklist", label: "手術一覧" },
  { to: "/endoscopy-worklist", label: "内視鏡一覧" },
  { to: "/treatment-worklist", label: "処置一覧" },
  { to: "/chemo-room-worklist", label: "外来化学療法室" },
  { to: "/nursing-worklist", label: "看護指示簿" },
];

const ADMIN_LINKS: { to: string; label: string }[] = [
  { to: "/practitioners", label: "医療従事者" },
  { to: "/facility-settings", label: "施設設定" },
  { to: "/settings", label: "接続設定" },
  { to: "/oauth-clients", label: "OAuth クライアント" },
  { to: "/external-systems", label: "外部システム連携" },
];

function LauncherCard({ profile, wide }: { profile: HomeProfile; wide: boolean }) {
  const worklistLinks = Object.entries(HOME_WORKLISTS)
    .filter(([key]) => !profile.worklists.includes(key as keyof typeof HOME_WORKLISTS))
    .map(([, def]) => ({ to: def.path, label: def.label }));
  const groups: { title: string; links: { to: string; label: string }[] }[] = [
    { title: "患者・診療", links: COMMON_LINKS },
    { title: "部門業務", links: [...OTHER_WORKLIST_LINKS, ...worklistLinks] },
  ];
  if (profile.kind === "administrator") groups.push({ title: "管理", links: ADMIN_LINKS });

  return (
    <section className={`home__card${wide ? " home__card--wide" : ""}`}>
      <div className="home__card-header">
        <h2>画面へ移る</h2>
      </div>
      {profile.kind === "administrator" && (
        <p className="home__empty">
          医療従事者に紐付いたアカウントでログインすると、担当患者や通知がここに出ます。
        </p>
      )}
      {groups.map((group) => (
        <div key={group.title} className="home__launcher-group">
          <p className="home__ward">{group.title}</p>
          <div className="home__launcher">
            {group.links.map((link) => (
              <Link key={link.to} to={link.to} className="button">
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
