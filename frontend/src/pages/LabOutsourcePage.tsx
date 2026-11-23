import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useCurrentPractitioner } from "../api/authQueries";
import {
  useClinicalLabOptions,
  useLabOutsourceWorklist,
  useUpdateLabShipment,
  type LabWorklistRow,
} from "../api/queries";
import { labOutsourceSlipUrl } from "../api/reportsClient";
import { ErrorBanner } from "../components/ErrorBanner";
import { TruncatedNotice } from "../components/TruncatedNotice";
import { displayJapaneseName } from "../fhir/humanName";
import { specimenGroupLabel } from "../fhir/labOrderHelpers";
import {
  LAB_OUTSOURCE_TUBE_STATUS_OPTIONS,
  labOutsourceTubeItemsLabel,
  labOutsourceTubes,
  type LabOutsourceTube,
  type LabOutsourceTubeStatus,
} from "../fhir/labOutsourceHelpers";
import { labelNumberOf } from "../fhir/labSpecimenHelpers";
import { displayName } from "../fhir/patientHelpers";
import { displayOf, orderDay } from "../fhir/shared";
import { addDays, dateTimeLabel, today } from "../lib/dates";
import { useReturnLinkState } from "../returnTo";

// 外注検査(docs/lab-outsource-design.md §7)。外注に出す管を 1 本 1 行で並べ、提出を
// 記録して、結果がまだ着いていないものを追う。外注先へ渡す伝票は別タブで刷る。
//
// 上流での絞り込みは外注先と検査日の期間まで。状況は読み込んだ管から画面側で絞る
// (提出は管の Specimen の拡張で、上流の検索では引けない)。

type Tube = LabOutsourceTube<LabWorklistRow>;

/** 検査日の期間の初期値(今日までの日数)。 */
const DEFAULT_RANGE_DAYS = 30;

export function LabOutsourcePage() {
  const [organizationId, setOrganizationId] = useState("");
  const [from, setFrom] = useState(() => addDays(today(), -DEFAULT_RANGE_DAYS));
  const [to, setTo] = useState(today);
  const [status, setStatus] = useState<LabOutsourceTubeStatus | "">("waiting");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [slipDate, setSlipDate] = useState(today);

  // 検査項目の列が長くなるので、この画面だけ幅を広げる(検体検査一覧と同じ)。
  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  const labs = useClinicalLabOptions();
  const organizationIds = useMemo(
    () =>
      organizationId
        ? [organizationId]
        : labs.organizations.flatMap((organization) => (organization.id ? [organization.id] : [])),
    // organizations は描画のたびに別の配列になるので、元の data で見張る。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [organizationId, labs.data],
  );
  const worklist = useLabOutsourceWorklist({ organizationIds, from, to });
  const updateShipment = useUpdateLabShipment();

  const { practitionerId, practitioner } = useCurrentPractitioner();
  const recorder = practitionerId
    ? { practitionerId, display: displayJapaneseName(practitioner?.name) }
    : undefined;

  const tubes = useMemo(
    () =>
      labOutsourceTubes(worklist.data?.rows ?? []).filter(
        (tube) => organizationIds.includes(tube.group.outsourceOrganizationId),
      ),
    [worklist.data, organizationIds],
  );
  const shown = useMemo(
    () => (status ? tubes.filter((tube) => tube.status === status) : tubes),
    [tubes, status],
  );
  // 提出できるのは提出待ちの管だけ。表示から消えた管の選択は数えない。
  const sendable = shown.filter((tube) => tube.status === "waiting");
  const sending = sendable.filter((tube) => selected.has(tube.key));

  function toggle(key: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAll() {
    setSelected(sending.length === sendable.length ? new Set() : new Set(sendable.map((tube) => tube.key)));
  }

  function ship() {
    updateShipment.mutate(
      { specimens: sending.flatMap((tube) => (tube.specimen ? [tube.specimen] : [])), recorder },
      { onSuccess: () => setSelected(new Set()) },
    );
  }

  // 絞り込みは選んだ瞬間に効かせるので、Enter での送信は何もしない。
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>外注検査</h1>
        <div className="lab-outsource__header-actions">
          <button
            type="button"
            disabled={sending.length === 0 || updateShipment.isPending}
            onClick={ship}
          >
            {`提出(${sending.length})`}
          </button>
          <label>
            提出日
            <input type="date" value={slipDate} onChange={(e) => setSlipDate(e.target.value)} />
          </label>
          {organizationId && slipDate ? (
            <a
              className="button"
              href={labOutsourceSlipUrl({ organizationId, date: slipDate, from, to })}
              target="_blank"
              rel="noopener"
            >
              外注伝票
            </a>
          ) : (
            <button type="button" disabled title="外注先と提出日を選ぶと発行できます">
              外注伝票
            </button>
          )}
        </div>
      </div>

      <form className="patient-search-form" onSubmit={handleSubmit}>
        <label>
          外注先
          <select value={organizationId} onChange={(e) => setOrganizationId(e.target.value)}>
            <option value="">すべて</option>
            {labs.organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          検査日(開始)
          <input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        </label>
        <label>
          検査日(終了)
          <input type="date" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} />
        </label>
        <label>
          状況
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as LabOutsourceTubeStatus | "")}
          >
            <option value="">すべて</option>
            {LAB_OUTSOURCE_TUBE_STATUS_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.display}
              </option>
            ))}
          </select>
        </label>
      </form>

      <ErrorBanner error={labs.error} />
      <ErrorBanner error={worklist.error} />
      <ErrorBanner error={updateShipment.error} />
      <TruncatedNotice show={worklist.data?.truncated}>
        この期間のオーダーが多いため、一部のみ表示しています。検査日の期間を狭めてください。
      </TruncatedNotice>

      {labs.isLoading || worklist.isLoading ? (
        <p>読み込み中...</p>
      ) : (
        <>
          <div className="lab-worklist-wrap sticky-table-wrap">
            <table className="lab-worklist sticky-table">
              <thead>
                <tr>
                  <th className="lab-worklist__compact">
                    <input
                      type="checkbox"
                      aria-label="提出待ちをすべて選択"
                      checked={sendable.length > 0 && sending.length === sendable.length}
                      disabled={sendable.length === 0}
                      onChange={toggleAll}
                    />
                  </th>
                  <th>患者番号</th>
                  <th>患者氏名</th>
                  <th className="lab-worklist__compact">検査日</th>
                  <th>外注先</th>
                  <th>検体</th>
                  <th className="lab-worklist__content">検査項目</th>
                  <th className="lab-worklist__compact">採取番号</th>
                  <th className="lab-worklist__compact">状況</th>
                  <th className="lab-worklist__compact">提出</th>
                  <th className="lab-worklist__actions"></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((tube) => (
                  <TubeRow
                    key={tube.key}
                    tube={tube}
                    checked={selected.has(tube.key)}
                    pending={updateShipment.isPending}
                    onToggle={() => toggle(tube.key)}
                    onCancel={() =>
                      tube.specimen &&
                      updateShipment.mutate({ specimens: [tube.specimen], cancel: true })
                    }
                  />
                ))}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={11} className="master-search__empty">
                      {labs.organizations.length === 0
                        ? "検査委託先が登録されていません"
                        : tubes.length === 0
                          ? "この期間に外注の検査はありません"
                          : "絞り込みに該当する検査がありません"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="order-select__muted lab-worklist__count">{shown.length} 件</p>
        </>
      )}
    </div>
  );
}

// 状況の色は検体検査一覧の進捗の色を借りる(未着 = 受付済、結果済 = 実施済)。
const STATUS_CLASS: Record<LabOutsourceTubeStatus, string> = {
  unissued: "",
  waiting: "",
  pending: " lab-worklist__status--accepted",
  reported: " lab-worklist__status--completed",
};

function TubeRow({
  tube,
  checked,
  pending,
  onToggle,
  onCancel,
}: {
  tube: Tube;
  checked: boolean;
  pending: boolean;
  onToggle: () => void;
  onCancel: () => void;
}) {
  // カルテの「戻る」でこの一覧に戻れるように遷移元を渡す。
  const returnLinkState = useReturnLinkState();
  const { order, patient } = tube.row;
  const group = { ...tube.group, outsourceOrganizationId: "" };

  return (
    <tr className={order.priority === "urgent" ? "lab-worklist__row--urgent" : undefined}>
      <td className="lab-worklist__compact">
        {tube.status === "waiting" && (
          <input
            type="checkbox"
            aria-label="提出する管として選択"
            checked={checked}
            onChange={onToggle}
          />
        )}
      </td>
      <td>{patient?.identifier?.[0]?.value ?? "-"}</td>
      <td>
        {patient ? (
          <Link to={`/patients/${patient.id}/karte`} state={returnLinkState}>
            {displayName(patient)}
          </Link>
        ) : (
          "-"
        )}
      </td>
      <td className="lab-worklist__compact">
        {orderDay(order) || "-"}
        {order.priority === "urgent" && <span className="dose-conversion__badge">至急</span>}
      </td>
      <td>{tube.group.outsourceOrganizationName || "-"}</td>
      {/* 外注先は隣の列にあるので、検体の見出しからは外す。 */}
      <td>{specimenGroupLabel(group)}</td>
      <td className="lab-worklist__content">{labOutsourceTubeItemsLabel(tube)}</td>
      <td className="lab-worklist__compact">{tube.specimen ? labelNumberOf(tube.specimen) : "-"}</td>
      <td className="lab-worklist__compact">
        <span className={`lab-worklist__status${STATUS_CLASS[tube.status]}`}>
          {displayOf(LAB_OUTSOURCE_TUBE_STATUS_OPTIONS, tube.status)}
        </span>
      </td>
      <td className="lab-worklist__compact">{tube.shippedAt ? dateTimeLabel(tube.shippedAt) : "-"}</td>
      <td className="lab-worklist__actions">
        {tube.status === "pending" && (
          <button type="button" disabled={pending} onClick={onCancel}>
            取消
          </button>
        )}
      </td>
    </tr>
  );
}
