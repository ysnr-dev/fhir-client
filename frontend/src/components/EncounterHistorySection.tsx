import { useState } from "react";
import { usePatientEncounterHistory } from "../api/queries";
import { ENCOUNTER_HISTORY_FILTERS, encounterHistoryRows } from "../fhir/encounterHistoryHelpers";
import { today } from "../lib/dates";
import { ErrorBanner } from "./ErrorBanner";
import { TruncatedNotice } from "./TruncatedNotice";

interface EncounterHistorySectionProps {
  patientId: string;
  /** 行を押したとき、その受診の開始日をカルテのタイムラインで開く。 */
  onOpenDay: (day: string) => void;
}

/** プロファイルタブの「受診歴」区画。入院・外来・救急の受診を新しい順に読み、行からタイムラインのその日へ飛ぶ。 */
export function EncounterHistorySection({ patientId, onOpenDay }: EncounterHistorySectionProps) {
  const [filter, setFilter] = useState<(typeof ENCOUNTER_HISTORY_FILTERS)[number]["key"]>("all");
  const { data, isLoading, error } = usePatientEncounterHistory(patientId);

  const rows = data ? encounterHistoryRows(data.encounters, data.appointments, today()) : [];
  const visibleRows = filter === "all" ? rows : rows.filter((row) => row.kind === filter);

  return (
    <section className="karte-profile__section">
      <div className="karte-tabpanel__header">
        <h3>受診歴</h3>
        <div className="karte-tabpanel__actions">
          <select
            aria-label="区分"
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
          >
            {ENCOUNTER_HISTORY_FILTERS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <ErrorBanner error={error} />
      <TruncatedNotice show={data?.truncated} />

      {isLoading ? (
        <p>読み込み中...</p>
      ) : error ? null : visibleRows.length === 0 ? (
        <p className="patient-table__empty">受診歴がありません。</p>
      ) : (
        <ul className="profile-list">
          {visibleRows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                className="profile-list__item encounter-history__row"
                disabled={!row.day}
                onClick={() => onOpenDay(row.day)}
              >
                <span className="profile-list__name">{row.kindLabel}</span>
                <span>{row.period}</span>
                {row.status && <span className="encounter-history__status">{row.status}</span>}
                {row.meta && <span className="profile-list__meta">{row.meta}</span>}
                {row.note && <span className="profile-list__note">{row.note}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
