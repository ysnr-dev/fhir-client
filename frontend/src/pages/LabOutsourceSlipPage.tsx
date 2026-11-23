import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useLabOutsourceWorklist, useOrganization, useSelfOrganization } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { TruncatedNotice } from "../components/TruncatedNotice";
import { specimenGroupLabel } from "../fhir/labOrderHelpers";
import { labOutsourceTubeItemsLabel, labOutsourceTubes } from "../fhir/labOutsourceHelpers";
import { labelNumberOf } from "../fhir/labSpecimenHelpers";
import { displayKana, displayName, genderLabel } from "../fhir/patientHelpers";
import { orderDay } from "../fhir/shared";
import { dateTimeLabel, localDay, nowFhirDateTime } from "../lib/dates";
import { usePrintPageTheme } from "../theme";

// 外注伝票を紙に出す別タブ。外注先 1 つ・提出日 1 日ぶんの管を 1 本 1 行で並べ、検体と
// 一緒に外注先へ渡す。対象は提出を記録した管(外注検査の画面の「提出」)。
// 設計は docs/lab-outsource-design.md §7。

export function LabOutsourceSlipPage() {
  const [searchParams] = useSearchParams();
  const organizationId = searchParams.get("organization") ?? "";
  const date = searchParams.get("date") ?? "";
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";

  // 紙面は白地に印字するので、このタブだけライトで描く。
  usePrintPageTheme();

  const organization = useOrganization(organizationId || undefined);
  const { organization: self } = useSelfOrganization();
  const worklist = useLabOutsourceWorklist({
    organizationIds: organizationId ? [organizationId] : [],
    from,
    to,
  });
  // 印刷日時は開いた時点で固定する。
  const printedAt = useMemo(() => dateTimeLabel(nowFhirDateTime()), []);

  const tubes = useMemo(
    () =>
      labOutsourceTubes(worklist.data?.rows ?? []).filter(
        (tube) =>
          tube.group.outsourceOrganizationId === organizationId &&
          tube.shippedAt &&
          localDay(tube.shippedAt) === date,
      ),
    [worklist.data, organizationId, date],
  );

  return (
    <div className="lab-outsource-slip">
      <style>{"@page { size: A4 portrait; margin: 12mm; }"}</style>
      <div className="karte-print__toolbar">
        <button type="button" disabled={tubes.length === 0} onClick={() => window.print()}>
          印刷
        </button>
        {worklist.isPending && <span>読み込み中...</span>}
      </div>
      <ErrorBanner error={organization.error ?? worklist.error} />
      <TruncatedNotice show={worklist.data?.truncated}>
        この期間のオーダーが多いため、一部の管が載っていません。検査日の期間を狭めて開き直してください。
      </TruncatedNotice>

      <div className="lab-outsource-slip__page">
        <h1 className="lab-outsource-slip__title">外注検査依頼書</h1>
        <dl className="lab-outsource-slip__info">
          <dt>依頼先</dt>
          <dd>{organization.data?.data.name ? `${organization.data.data.name} 御中` : "-"}</dd>
          <dt>依頼元</dt>
          <dd>{self?.name ?? "-"}</dd>
          <dt>提出日</dt>
          <dd>{date || "-"}</dd>
          <dt>本数</dt>
          <dd>{`${tubes.length} 本`}</dd>
        </dl>

        <table className="lab-outsource-slip__table">
          <thead>
            <tr>
              <th className="lab-outsource-slip__no">No.</th>
              <th>採取番号</th>
              <th>患者番号</th>
              <th>氏名</th>
              <th>性別</th>
              <th>生年月日</th>
              <th>検査日</th>
              <th>検体</th>
              <th>検査項目</th>
            </tr>
          </thead>
          <tbody>
            {tubes.map((tube, index) => {
              const { order, patient } = tube.row;
              return (
                <tr key={tube.key}>
                  <td className="lab-outsource-slip__no">{index + 1}</td>
                  <td>{tube.specimen ? labelNumberOf(tube.specimen) : ""}</td>
                  <td>{patient?.identifier?.[0]?.value ?? ""}</td>
                  <td>
                    {patient ? displayName(patient) : ""}
                    {patient && displayKana(patient) && (
                      <span className="lab-outsource-slip__kana">{displayKana(patient)}</span>
                    )}
                  </td>
                  <td>{patient ? genderLabel(patient.gender) : ""}</td>
                  <td>{patient?.birthDate ?? ""}</td>
                  <td>
                    {orderDay(order)}
                    {order.priority === "urgent" && " 至急"}
                  </td>
                  {/* 依頼先は紙の頭にあるので、検体の見出しからは外す。 */}
                  <td>{specimenGroupLabel({ ...tube.group, outsourceOrganizationId: "" })}</td>
                  <td>{labOutsourceTubeItemsLabel(tube)}</td>
                </tr>
              );
            })}
            {tubes.length === 0 && !worklist.isPending && (
              <tr>
                <td colSpan={9} className="lab-outsource-slip__empty">
                  この日に提出した管はありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="lab-outsource-slip__footer">{`印刷 ${printedAt}`}</p>
      </div>
    </div>
  );
}
