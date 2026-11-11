import { useState, type FormEvent } from "react";
import type { Medicine } from "../../api/masterClient";
import { nowInput, type ChartDrugFormValues, type ChartDrugLine, type ChartSpec } from "../../fhir/timeSeriesChartHelpers";
import { MedicineSearchModal } from "../MedicineSearchModal";
import { RemoveRowButton } from "../RemoveRowButton";
import { TimeField } from "./TimeField";

// 薬剤(単回 / 持続)の一覧と追加フォーム。薬剤は医薬品マスタから選び、持続は「終了」で閉じる。

interface DrugsSectionProps {
  spec: ChartSpec;
  drugs: readonly ChartDrugLine[];
  readOnly: boolean;
  /** 時刻の初期値(datetime-local)。PointsSection と同じ扱い。 */
  defaultTime?: string;
  onAdd: (values: ChartDrugFormValues) => void;
  onFinish: (line: ChartDrugLine) => void;
  onDelete: (line: ChartDrugLine) => void;
}

export function DrugsSection({ spec, drugs, readOnly, defaultTime, onAdd, onFinish, onDelete }: DrugsSectionProps) {
  const [searching, setSearching] = useState(false);
  const [draft, setDraft] = useState<ChartDrugFormValues | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    onAdd(draft);
    setDraft(null);
  }

  return (
    <fieldset className="time-chart__section">
      <legend>薬剤</legend>
      {drugs.length === 0 ? (
        <p className="patient-table__empty">薬剤はまだありません。</p>
      ) : (
        <ul className="time-chart__list">
          {drugs.map((line) => (
            <li key={line.id}>
              <span className="time-chart__list-time">
                {line.time.slice(11, 16)}
                {line.mode === "infusion" && ` 〜 ${line.running ? "投与中" : line.endTime.slice(11, 16)}`}
              </span>
              <span>{line.name}</span>
              <span className="time-chart__list-note">
                {line.mode === "bolus" ? "単回" : "持続"}
                {line.doseLabel ? ` ${line.doseLabel}` : ""}
              </span>
              {!readOnly && line.running && (
                <button type="button" onClick={() => onFinish(line)}>
                  終了
                </button>
              )}
              {!readOnly && <RemoveRowButton title="削除" onClick={() => onDelete(line)} />}
            </li>
          ))}
        </ul>
      )}

      {!readOnly && !draft && (
        <button type="button" onClick={() => setSearching(true)}>
          薬剤追加
        </button>
      )}

      {draft && (
        <form className="time-chart__entry" onSubmit={submit}>
          <span className="time-chart__drug-name">{draft.name}</span>
          <label>
            投与
            <select
              value={draft.mode}
              onChange={(e) => setDraft({ ...draft, mode: e.target.value as ChartDrugFormValues["mode"] })}
            >
              <option value="bolus">単回</option>
              <option value="infusion">持続</option>
            </select>
          </label>
          {draft.mode === "bolus" ? (
            <label>
              量
              <span className="time-chart__bp-pair">
                <input
                  type="number"
                  step="0.01"
                  value={draft.dose}
                  onChange={(e) => setDraft({ ...draft, dose: e.target.value })}
                />
                {draft.unitName}
              </span>
            </label>
          ) : (
            <label>
              速度
              <span className="time-chart__bp-pair">
                <input
                  type="number"
                  step="0.1"
                  value={draft.rate}
                  onChange={(e) => setDraft({ ...draft, rate: e.target.value })}
                />
                <input
                  type="text"
                  className="time-chart__unit-input"
                  placeholder="mL/h"
                  value={draft.rateUnit}
                  onChange={(e) => setDraft({ ...draft, rateUnit: e.target.value })}
                />
              </span>
            </label>
          )}
          <label>
            経路
            <select value={draft.routeCode} onChange={(e) => setDraft({ ...draft, routeCode: e.target.value })}>
              <option value="">未指定</option>
              {spec.drugRoutes.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.display}
                </option>
              ))}
            </select>
          </label>
          <TimeField
            label={draft.mode === "bolus" ? "時刻" : "開始"}
            value={draft.givenAt}
            onChange={(givenAt) => setDraft({ ...draft, givenAt })}
          />
          <button type="submit">追加</button>
          <button type="button" onClick={() => setDraft(null)}>
            やめる
          </button>
        </form>
      )}

      {searching && (
        <MedicineSearchModal
          title="薬剤を選択"
          onSelect={(medicine: Medicine) => {
            setSearching(false);
            setDraft({
              medicineCode: medicine.medicine_code,
              name: medicine.name,
              yjCode: medicine.yj_code ?? "",
              mode: "bolus",
              dose: "",
              unitName: medicine.unit_name ?? "",
              rate: "",
              rateUnit: "mL/h",
              routeCode: "IV",
              givenAt: defaultTime || nowInput(),
            });
          }}
          onClose={() => setSearching(false)}
        />
      )}
    </fieldset>
  );
}
