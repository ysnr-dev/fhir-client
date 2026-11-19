import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  useNcdSurgeries,
  useSelfDepartments,
  useSsiCultures,
  useWardDeviceInfections,
  useWardOptions,
} from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { HelpTip } from "../components/HelpTip";
import { HaiJudgmentModal } from "../components/HaiJudgmentModal";
import { PatientKana } from "../components/PatientRowCells";
import { StatCell, StatSection, StatSections, StatTile, StatTiles } from "../components/StatSummary";
import { TruncatedNotice } from "../components/TruncatedNotice";
import {
  HAI_RESULT_OPTIONS,
  SSI_CSV_HEADER,
  SSI_DEPTH_OPTIONS,
  SSI_IMPLANT_FOLLOW_UP_DAYS,
  SSI_STATE_LABELS,
  deviceInfectionCounts,
  deviceInfectionRateLabel,
  deviceInfectionRows,
  positiveCultureSummary,
  ssiCsvCells,
  ssiDepthLabel,
  ssiRateLabel,
  ssiRateSummary,
  ssiRows,
  type DeviceInfectionRow,
  type HaiType,
  type SsiRateRow,
  type SsiRow,
  type SsiState,
} from "../fhir/haiSurveillanceHelpers";
import {
  daysInserted,
  lineDrainLabel,
  lineDrainMonthStats,
  removalReasonLabel,
  type DeviceDayGroup,
} from "../fhir/lineDrainHelpers";
import { locationDisplayName } from "../fhir/locationHelpers";
import { defaultNcdFrom, surgeryNameOf } from "../fhir/ncdHelpers";
import { displayName, patientNumberOf } from "../fhir/patientHelpers";
import { useWardMonthPresence } from "../hooks/useWardMonthPresence";
import { csvBlob } from "../lib/csv";
import { addDays, addMonths, localDay, shortDate, today } from "../lib/dates";
import { downloadBlob } from "../lib/download";
import { useReturnLinkState } from "../returnTo";

// 医療関連感染サーベイランス(docs/hai-surveillance-design.md §4)。
// 「SSI判定」は手術の実施記録を手術日の期間で並べ、術後の培養陽性を手がかりに感染の有無を判定する。
// 「SSI発生率」は同じ期間の手術を創分類・依頼科でまとめる。「デバイス関連感染」は病棟 × 月の留置を
// 判定し、デバイス日数を分母に感染率を出す。判定はタブの中のモーダルで書く(カルテへは移らない)。

type Tab = "ssi" | "ssi-rate" | "device";

const TABS: [Tab, string][] = [
  ["ssi", "SSI判定"],
  ["ssi-rate", "SSI発生率"],
  ["device", "デバイス関連感染"],
];

export function InfectionSurveillancePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab: Tab = tabParam === "ssi-rate" || tabParam === "device" ? tabParam : "ssi";

  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  function setParams(next: Record<string, string>, replace = false) {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    setSearchParams(params, { replace });
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>感染サーベイランス</h1>
      </div>

      <div className="order-select__tabs" role="tablist">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? "order-select__tab is-active" : "order-select__tab"}
            onClick={() => setParams({ tab: key === "ssi" ? "" : key })}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "device" ? (
        <DeviceTab searchParams={searchParams} setParams={setParams} />
      ) : (
        <SsiTab rate={tab === "ssi-rate"} searchParams={searchParams} setParams={setParams} />
      )}
    </div>
  );
}

interface TabProps {
  searchParams: URLSearchParams;
  setParams: (next: Record<string, string>, replace?: boolean) => void;
}

// ---- 手術部位感染 ----

function SsiTab({ rate, searchParams, setParams }: TabProps & { rate: boolean }) {
  const todayValue = today();
  const from = searchParams.get("from") || defaultNcdFrom(todayValue);
  const to = searchParams.get("to") || todayValue;
  const departmentId = searchParams.get("department") ?? "";
  const state = (searchParams.get("state") ?? "") as SsiState | "";
  const returnLinkState = useReturnLinkState();
  const [dialogId, setDialogId] = useState<string | null>(null);

  const departments = useSelfDepartments();
  const surgeries = useNcdSurgeries(from, to, departmentId);
  const patientIds = useMemo(
    () => (surgeries.data?.surgeries ?? []).map((s) => s.hub.subject?.reference?.split("/").pop() ?? ""),
    [surgeries.data],
  );
  // 培養は埋入物のある手術の観察期間の終わりまで読む(先の日付は無いので今日で止める)。
  const cultureTo = [addDays(to, SSI_IMPLANT_FOLLOW_UP_DAYS), todayValue].sort()[0];
  const cultures = useSsiCultures(patientIds, from, cultureTo);

  const rows = useMemo(
    () => ssiRows(surgeries.data?.surgeries ?? [], cultures.data?.cultures ?? [], todayValue),
    [surgeries.data, cultures.data, todayValue],
  );
  const visible = rows.filter((row) => !state || row.state === state);
  const patientsById = surgeries.data?.patients ?? new Map<string, fhir4.Patient>();
  const dialogRow = dialogId ? rows.find((row) => row.hub.id === dialogId) : undefined;
  // 分母が欠けると発生率が狂うので、読み切れていないときは発生率の表を出さない。
  const truncated = Boolean(surgeries.data?.truncated);

  function exportCsv() {
    const body = visible.map((row) => {
      const patient = patientsById.get(row.patientId);
      return [patient ? (patientNumberOf(patient) ?? "") : "", patient ? displayName(patient) : "", ...ssiCsvCells(row)];
    });
    downloadBlob(csvBlob(SSI_CSV_HEADER, body), `ssi-${from}-${to}.csv`);
  }

  return (
    <>
      <form className="patient-search-form" onSubmit={(e: FormEvent) => e.preventDefault()}>
        <label>
          手術日
          <span className="cancer-registry__range">
            <input type="date" value={from} onChange={(e) => setParams({ from: e.target.value })} />
            〜
            <input type="date" aria-label="手術日の終わり" value={to} onChange={(e) => setParams({ to: e.target.value })} />
          </span>
        </label>
        <label>
          依頼科
          <select value={departmentId} onChange={(e) => setParams({ department: e.target.value })}>
            <option value="">すべて</option>
            {departments.departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </label>
        {!rate && (
          <label>
            判定
            <select value={state} onChange={(e) => setParams({ state: e.target.value })}>
              <option value="">すべて</option>
              {(Object.keys(SSI_STATE_LABELS) as SsiState[]).map((key) => (
                <option key={key} value={key}>
                  {SSI_STATE_LABELS[key]}
                </option>
              ))}
            </select>
          </label>
        )}
        {!rate && (
          <div className="patient-search-form__actions">
            <button type="button" onClick={exportCsv} disabled={visible.length === 0}>
              CSV
            </button>
          </div>
        )}
      </form>

      <ErrorBanner error={surgeries.error} />
      <ErrorBanner error={cultures.error} />
      <ErrorBanner error={departments.error} />

      {surgeries.isLoading || cultures.isLoading ? (
        <p>読み込み中...</p>
      ) : rate ? (
        truncated ? (
          <TruncatedNotice show>手術の記録を読み切れていないため、発生率を出せません。</TruncatedNotice>
        ) : (
          <SsiRate rows={rows} />
        )
      ) : (
        <>
          <TruncatedNotice show={truncated || cultures.data?.truncated} />
          <div className="lab-worklist-wrap sticky-table-wrap">
            <table className="lab-worklist sticky-table">
              <thead>
                <tr>
                  <th className="lab-worklist__compact">患者番号</th>
                  <th>患者</th>
                  <th className="lab-worklist__compact">手術日</th>
                  <th>術式</th>
                  <th className="lab-worklist__compact">依頼科</th>
                  <th className="lab-worklist__compact">創分類</th>
                  <th className="lab-worklist__compact">手術時間</th>
                  <th className="lab-worklist__compact">術後日数</th>
                  <th className="lab-worklist__compact">培養陽性</th>
                  <th className="lab-worklist__compact">判定</th>
                  <th className="lab-worklist__compact">感染部位</th>
                  <th className="lab-worklist__compact">診断日</th>
                  <th>起因菌</th>
                  <th className="lab-worklist__compact">判定者</th>
                  <th className="lab-worklist__compact"></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => {
                  const patient = patientsById.get(row.patientId);
                  const judgment = row.judgment;
                  return (
                    <tr key={row.hub.id}>
                      <td className="lab-worklist__compact">{patient ? patientNumberOf(patient) : ""}</td>
                      <td>
                        {patient ? (
                          <>
                            <Link to={`/patients/${row.patientId}/karte`} state={returnLinkState}>
                              {displayName(patient)}
                            </Link>
                            <PatientKana patient={patient} />
                          </>
                        ) : (
                          row.patientId
                        )}
                      </td>
                      <td className="lab-worklist__compact">{row.surgeryDate || "-"}</td>
                      <td>{surgeryNameOf(row.record, row.hub)}</td>
                      <td className="lab-worklist__compact">{row.departmentName}</td>
                      <td className="lab-worklist__compact">{row.record.woundClass}</td>
                      <td className="lab-worklist__compact">
                        {row.operationMinutes === null ? "" : `${row.operationMinutes} 分`}
                      </td>
                      <td className={row.overdue ? "lab-worklist__compact admission-documents__overdue" : "lab-worklist__compact"}>
                        {row.postoperativeDays ?? "-"}
                      </td>
                      <td
                        className={
                          row.cultures.length > 0 && row.state === "pending"
                            ? "lab-worklist__compact line-drain__days--over"
                            : "lab-worklist__compact"
                        }
                        title={positiveCultureSummary(row.cultures) || undefined}
                      >
                        {row.cultures.length > 0 ? `${row.cultures.length} 件` : ""}
                      </td>
                      <td className={`lab-worklist__compact hai__state--${row.state}`}>{SSI_STATE_LABELS[row.state]}</td>
                      <td className="lab-worklist__compact">{ssiDepthLabel(judgment?.depth ?? "")}</td>
                      <td className="lab-worklist__compact">{judgment?.date ?? ""}</td>
                      <td>{judgment?.pathogen ?? ""}</td>
                      <td className="lab-worklist__compact">{judgment?.performer?.display ?? ""}</td>
                      <td className="lab-worklist__compact">
                        <button
                          type="button"
                          className="rp-card__compact-button"
                          onClick={() => setDialogId(row.hub.id ?? null)}
                        >
                          判定
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={15} className="master-search__empty">
                      {rows.length === 0 ? "手術の実施記録はありません。" : "絞り込みに一致する手術がありません。"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="order-select__muted lab-worklist__count">
            {visible.length} 件 / 未判定 {visible.filter((row) => row.state === "pending").length} 件 / SSI{" "}
            {visible.filter((row) => row.state === "infected").length} 件
          </p>
        </>
      )}

      {dialogRow && (
        <HaiJudgmentModal
          target={{
            type: "ssi",
            patientId: dialogRow.patientId,
            procedureId: dialogRow.hub.id ?? "",
            encounterId: dialogRow.encounterId || undefined,
          }}
          summary={[
            patientLabel(patientsById.get(dialogRow.patientId), dialogRow.patientId),
            surgeryNameOf(dialogRow.record, dialogRow.hub),
            `手術日 ${dialogRow.surgeryDate}`,
            dialogRow.record.woundClass && `創分類 ${dialogRow.record.woundClass}`,
          ]}
          startDay={dialogRow.surgeryDate}
          judgment={dialogRow.judgment}
          pathogenOptions={[...new Set(dialogRow.cultures.flatMap((culture) => culture.organisms))]}
          onClose={() => setDialogId(null)}
        />
      )}
    </>
  );
}

function patientLabel(patient: fhir4.Patient | undefined, patientId: string): string {
  return patient ? displayName(patient) : patientId;
}

const SSI_RATE_FORMULA = "SSI の件数 ÷ 手術件数 × 100。分母は期間内の手術すべて(未判定を含む)";

function SsiRate({ rows }: { rows: SsiRow[] }) {
  const byWoundClass = ssiRateSummary(rows, (row) => row.record.woundClass);
  const byDepartment = ssiRateSummary(rows, (row) => row.departmentName);
  // 末尾が合計の行(どちらの表でも同じ)。
  const total = byWoundClass[byWoundClass.length - 1];
  return (
    <>
      <StatTiles>
        <StatTile label="手術件数" value={total.surgeries} />
        <StatTile
          label="SSI"
          value={total.infected}
          alert={total.infected > 0}
          sub={SSI_DEPTH_OPTIONS.map((o, i) => `${o.display} ${total.byDepth[i]}`).join("・")}
        />
        <StatTile label="発生率" help={SSI_RATE_FORMULA} value={rateText(ssiRateLabel(total))} />
        <StatTile label="未判定" value={total.pending} />
      </StatTiles>
      <StatSections>
        <SsiRateTable title="創分類別" rows={byWoundClass} />
        <SsiRateTable title="依頼科別" rows={byDepartment} />
      </StatSections>
    </>
  );
}

/** 発生率の表示(ssiRateLabel は「-」か % を付けない数)。 */
function rateText(label: string): string {
  return label === "-" ? label : `${label}%`;
}

function SsiRateTable({ title, rows }: { title: string; rows: SsiRateRow[] }) {
  const body = rows.slice(0, -1);
  const total = rows[rows.length - 1];
  const line = (row: SsiRateRow) => (
    <>
      <th className="stat-table__label">{row.label}</th>
      <StatCell value={row.surgeries} groupStart />
      <StatCell value={row.pending} />
      <StatCell value={row.infected} groupStart strong tone="alert" />
      {row.byDepth.map((count, depthIndex) => (
        <StatCell key={SSI_DEPTH_OPTIONS[depthIndex].code} value={count} />
      ))}
      <StatCell value={rateText(ssiRateLabel(row))} groupStart />
    </>
  );
  return (
    <StatSection title={title}>
      <table className="lab-worklist stat-table">
        <thead>
          <tr>
            <th></th>
            <th className="stat-table__num stat-table__group-start">手術件数</th>
            <th className="stat-table__num">未判定</th>
            <th className="stat-table__num stat-table__group-start">SSI</th>
            {SSI_DEPTH_OPTIONS.map((o) => (
              <th key={o.code} className="stat-table__num">
                {o.display}
              </th>
            ))}
            <th className="stat-table__num stat-table__group-start">
              発生率 <HelpTip text={SSI_RATE_FORMULA} />
            </th>
          </tr>
        </thead>
        <tbody>
          {body.map((row) => (
            <tr key={row.label}>{line(row)}</tr>
          ))}
          {body.length === 0 && (
            <tr>
              <td colSpan={5 + SSI_DEPTH_OPTIONS.length} className="master-search__empty">
                手術の実施記録はありません。
              </td>
            </tr>
          )}
        </tbody>
        {body.length > 1 && (
          <tfoot>
            <tr>{line(total)}</tr>
          </tfoot>
        )}
      </table>
    </StatSection>
  );
}

// ---- デバイス関連感染 ----

const DEVICE_GROUPS: { type: Exclude<HaiType, "ssi">; group: DeviceDayGroup; label: string; short: string }[] = [
  { type: "clabsi", group: "vascular-central", label: "中心静脈カテーテル(CLABSI)", short: "CLABSI" },
  { type: "cauti", group: "urinary", label: "尿道留置カテーテル(CAUTI)", short: "CAUTI" },
  { type: "vap", group: "airway", label: "気管チューブ(VAP)", short: "VAP" },
];

const DEVICE_RATE_FORMULA = "感染件数 ÷ デバイス日数 × 1000。使用比はデバイス日数 ÷ 患者延べ日数";

function DeviceTab({ searchParams, setParams }: TabProps) {
  const wardId = searchParams.get("ward") ?? "";
  const date = searchParams.get("date") || today();
  const month = date.slice(0, 7);
  const wardOptions = useWardOptions();

  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current || wardId) return;
    const first = wardOptions.wards[0];
    if (!first?.id) return;
    initialized.current = true;
    setParams({ ward: first.id }, true);
    // 初回に一度だけ動けばよい。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wardId, wardOptions.wards]);

  return (
    <>
      <form className="patient-search-form" onSubmit={(e: FormEvent) => e.preventDefault()}>
        <label>
          月
          <span className="inpatient__date">
            <button type="button" onClick={() => setParams({ date: addMonths(date, -1) })} aria-label="前の月">
              &lt;
            </button>
            <input
              type="month"
              value={month}
              onChange={(e) => e.target.value && setParams({ date: `${e.target.value}-01` })}
            />
            <button type="button" onClick={() => setParams({ date: addMonths(date, 1) })} aria-label="次の月">
              &gt;
            </button>
          </span>
        </label>
        <label>
          病棟
          <select value={wardId} onChange={(e) => setParams({ ward: e.target.value })}>
            {wardOptions.wards.map((w) => (
              <option key={w.id} value={w.id}>
                {locationDisplayName(w)}
              </option>
            ))}
          </select>
        </label>
      </form>

      <ErrorBanner error={wardOptions.error} />

      {wardId ? (
        <DeviceMonth month={month} wardId={wardId} />
      ) : (
        <p className="patient-table__empty">病棟を選んでください。</p>
      )}
    </>
  );
}

function DeviceMonth({ month, wardId }: { month: string; wardId: string }) {
  const ward = useWardMonthPresence(month, wardId);
  const { presence, days } = ward;
  const infections = useWardDeviceInfections(ward.patientIds, ward.from, ward.to);
  const todayValue = today();
  const [dialogId, setDialogId] = useState<string | null>(null);

  const stats = useMemo(
    () => lineDrainMonthStats(presence, infections.data?.records ?? [], days),
    [presence, infections.data, days],
  );
  const rows = useMemo(
    () => deviceInfectionRows(infections.data?.records ?? [], infections.data?.judgments ?? new Map()),
    [infections.data],
  );
  const counts = useMemo(() => deviceInfectionCounts(rows, days), [rows, days]);
  const dialogRow = dialogId ? rows.find((row) => row.record.id === dialogId) : undefined;
  // 分母・分子が欠けると感染率が狂うので、読み切れていないときは表を出さない。
  const truncated = ward.truncated || Boolean(infections.data?.truncated);
  const ratio = (numerator: number, denominator: number) =>
    denominator > 0 ? (numerator / denominator).toFixed(2) : "-";

  if (ward.isLoading || infections.isLoading) return <p>読み込み中...</p>;

  return (
    <>
      {ward.errors.map((error, index) => (
        <ErrorBanner key={index} error={error} />
      ))}
      <ErrorBanner error={infections.error} />
      {truncated ? (
        <TruncatedNotice show>入院または留置の記録を読み切れていないため、感染率を出せません。</TruncatedNotice>
      ) : (
        <>
          <StatTiles>
            <StatTile label="患者延べ日数" value={stats.patientDays} sub={month.replace("-", "/")} />
            {DEVICE_GROUPS.map(({ type, group, short }) => {
              const deviceDays = stats.groups[group].deviceDays;
              return (
                <StatTile
                  key={type}
                  label={`${short} 感染率`}
                  help={DEVICE_RATE_FORMULA}
                  value={deviceInfectionRateLabel(counts[type], deviceDays)}
                  alert={counts[type] > 0}
                  sub={`感染 ${counts[type]}件・デバイス日数 ${deviceDays}・使用比 ${ratio(deviceDays, stats.patientDays)}`}
                />
              );
            })}
          </StatTiles>
          {DEVICE_GROUPS.map(({ type, label }) => {
            const groupRows = rows.filter((row) => row.type === type);
            return (
              <section key={type} className="hai-device">
                <div className="hai-device__head">
                  <h3 className="hai-device__title">{label}</h3>
                </div>
                {groupRows.length === 0 ? (
                  <p className="hai-device__empty">対象の留置物はありません。</p>
                ) : (
                  <div className="lab-worklist-wrap">
                    <table className="lab-worklist hai-device__table">
                      <colgroup>
                        <col className="hai-device__col--patient" />
                        <col className="hai-device__col--device" />
                        <col className="hai-device__col--period" />
                        <col className="hai-device__col--days" />
                        <col className="hai-device__col--reason" />
                        <col className="hai-device__col--state" />
                        <col className="hai-device__col--date" />
                        <col />
                        <col className="hai-device__col--performer" />
                        <col className="hai-device__col--action" />
                      </colgroup>
                      <thead>
                        <tr>
                          <th>患者</th>
                          <th>種別・部位</th>
                          <th>留置期間</th>
                          <th className="hai-device__number">留置日数</th>
                          <th>抜去区分</th>
                          <th>判定</th>
                          <th>診断日</th>
                          <th>起因菌</th>
                          <th>判定者</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {groupRows.map((row) => (
                          <DeviceRow
                            key={row.record.id}
                            row={row}
                            patient={ward.patientsById?.get(row.patientId)}
                            today={todayValue}
                            onJudge={() => setDialogId(row.record.id)}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            );
          })}
        </>
      )}

      {dialogRow && (
        <HaiJudgmentModal
          target={{
            type: dialogRow.type,
            patientId: dialogRow.patientId,
            procedureId: dialogRow.record.id,
            encounterId: dialogRow.record.encounterId || undefined,
          }}
          summary={[
            patientLabel(ward.patientsById?.get(dialogRow.patientId), dialogRow.patientId),
            lineDrainLabel(dialogRow.record),
            `挿入日 ${localDay(dialogRow.record.insertedAt)}`,
          ]}
          startDay={localDay(dialogRow.record.insertedAt)}
          judgment={dialogRow.judgment}
          onClose={() => setDialogId(null)}
        />
      )}
    </>
  );
}

function DeviceRow({
  row,
  patient,
  today: todayValue,
  onJudge,
}: {
  row: DeviceInfectionRow;
  patient: fhir4.Patient | undefined;
  today: string;
  onJudge: () => void;
}) {
  const { record, judgment } = row;
  const returnLinkState = useReturnLinkState();
  const state: SsiState = !judgment ? "pending" : judgment.result === "infected" ? "infected" : "none";
  const suspected = record.removalReason === "infection" && !judgment;
  return (
    <tr>
      <td>
        {patient ? (
          <Link to={`/patients/${row.patientId}/karte?tab=profile`} state={returnLinkState}>
            {displayName(patient)}
          </Link>
        ) : (
          row.patientId
        )}
      </td>
      <td>{lineDrainLabel(record)}</td>
      <td>
        {shortDate(localDay(record.insertedAt))} 〜 {record.removedAt ? shortDate(localDay(record.removedAt)) : "留置中"}
      </td>
      <td className="hai-device__number">{daysInserted(record, todayValue)}</td>
      <td className={suspected ? "line-drain__days--over" : undefined}>{removalReasonLabel(record.removalReason)}</td>
      <td className={`hai__state--${state}`}>
        {judgment ? HAI_RESULT_OPTIONS.find((o) => o.code === judgment.result)?.display : "未判定"}
      </td>
      <td>{judgment?.date ? shortDate(judgment.date) : ""}</td>
      <td className="hai-device__wrap">{judgment?.pathogen ?? ""}</td>
      <td>{judgment?.performer?.display ?? ""}</td>
      <td className="lab-worklist__actions">
        <button type="button" className="rp-card__compact-button" onClick={onJudge}>
          判定
        </button>
      </td>
    </tr>
  );
}
