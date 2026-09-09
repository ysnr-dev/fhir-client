import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { fetchInpatients, useCommitBedMoves } from "../api/queries";
import {
  bedPlaceLabel,
  buildMovePlanBundle,
  findStaleMoves,
  validateMovePlan,
  WORKSPACE,
  type BedPlace,
  type MovePlan,
} from "../fhir/bedMovePlanHelpers";
import { today } from "../lib/dates";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

// 転床の一括確定。転床日を決め、移動一覧と検証結果を見せてから 1 つの transaction で書く。
// 確定の直前に入院を引き直し、プランを組んでいる間に他の端末で動いていたら止める
// (キャッシュを信じて古い Encounter を PUT しない)。

export function WardMapMoveConfirmModal({
  plan,
  byBedOriginal,
  bedPlaces,
  patientName,
  onClose,
  onCommitted,
}: {
  plan: MovePlan;
  byBedOriginal: Map<string, fhir4.Encounter>;
  bedPlaces: Map<string, BedPlace>;
  patientName: (encounter: fhir4.Encounter) => string;
  onClose: () => void;
  onCommitted: () => void;
}) {
  const [date, setDate] = useState(today);
  const [staleMessage, setStaleMessage] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const queryClient = useQueryClient();
  const commit = useCommitBedMoves();

  const issues = useMemo(
    () => validateMovePlan(plan, byBedOriginal, bedPlaces, date, patientName),
    [plan, byBedOriginal, bedPlaces, date, patientName],
  );
  const moves = [...plan.values()];
  const busy = checking || commit.isPending;

  async function handleConfirm() {
    setStaleMessage(null);
    setChecking(true);
    try {
      const day = today();
      const latest = await queryClient.fetchQuery({
        queryKey: ["Encounter", "inpatients", day],
        queryFn: () => fetchInpatients(day),
        staleTime: 0,
      });
      const stale = findStaleMoves(plan, latest);
      if (stale.length > 0) {
        setStaleMessage(
          `他の端末で入院情報が変わりました(${stale.map((m) => patientName(m.encounter)).join("、")})。プランを見直してください。`,
        );
        return;
      }
      const latestById = new Map(latest.encounters.map((e) => [e.id ?? "", e]));
      await commit.mutateAsync(buildMovePlanBundle(plan, bedPlaces, date, latestById));
      onCommitted();
    } catch {
      // commit.error に出る。
    } finally {
      setChecking(false);
    }
  }

  return (
    <Modal title="転床を確定" onClose={onClose}>
      <ErrorBanner error={commit.error} />
      {(staleMessage || issues.length > 0) && (
        <div className="error-banner" role="alert">
          {staleMessage && <p className="error-banner__line error-banner__line--error">{staleMessage}</p>}
          {issues.map((issue, index) => (
            <p key={index} className="error-banner__line error-banner__line--error">
              {issue.message}
            </p>
          ))}
        </div>
      )}

      <div className="walk-in">
        <div className="walk-in__fields">
          <label>
            転室・転床日(必須)
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>

        <table className="patient-table ward-map__confirm-table">
          <thead>
            <tr>
              <th>患者</th>
              <th>移動元</th>
              <th>移動先</th>
            </tr>
          </thead>
          <tbody>
            {moves.map((move) => (
              <tr key={move.encounter.id}>
                <td>{patientName(move.encounter)}</td>
                <td>{bedPlaceLabel(bedPlaces.get(move.fromBedId))}</td>
                <td>{move.toBedId === WORKSPACE ? "退避(未定)" : bedPlaceLabel(bedPlaces.get(move.toBedId))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="walk-in__actions">
          <button type="button" onClick={handleConfirm} disabled={busy || issues.length > 0 || moves.length === 0}>
            {busy ? "登録中..." : `${moves.length} 件を確定`}
          </button>
          <button type="button" onClick={onClose} disabled={busy}>
            キャンセル
          </button>
        </div>
      </div>
    </Modal>
  );
}
