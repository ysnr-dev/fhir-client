import { useState } from "react";
import { ATTENDING_MODES, type AttendingMode } from "../../fhir/extractRecordQuery";
import { stratumName, type ExtractPatientScope } from "../../hooks/useExtractPatientScope";
import type { RecordPatientAttributes } from "../../hooks/useRecordPatientAttributes";
import { ErrorBanner } from "../ErrorBanner";
import { TruncatedNotice } from "../TruncatedNotice";
import { DataExtractGuide } from "./DataExtractGuide";
import { ExtractFormRow } from "./ExtractFormRow";
import { ExtractQuerySelect } from "./ExtractQuerySelect";
import { PatientFolderSelect } from "./PatientFolderSelect";
import { StrataEditorModal } from "./StrataEditorModal";

// 記録を表にするタブの「患者」の行(患者の条件・患者フォルダ)と「比較」の行(比較群・担当医)、実行したときの該当人数
// (hooks/useExtractPatientScope、docs/data-extract-design.md §8・§21)。

export function PatientScopeRow({ scope }: { scope: ExtractPatientScope }) {
  return (
    <ExtractFormRow label="患者" help="患者の条件と患者フォルダの両方を選ぶと、両方に入る患者の記録に絞ります。">
      <label className="extract-field">
        患者の条件
        <ExtractQuerySelect
          queries={scope.queries}
          value={scope.queryId}
          emptyLabel="すべて"
          onChange={(next) => scope.setQueryId(next?.id ?? null)}
        />
      </label>
      <label className="extract-field">
        患者フォルダ
        <PatientFolderSelect
          folders={scope.folders}
          value={scope.folderId}
          emptyLabel="すべて"
          onChange={(next) => scope.setFolderId(next?.id ?? null)}
        />
      </label>
    </ExtractFormRow>
  );
}

export function CompareRow({ scope }: { scope: ExtractPatientScope }) {
  const [editingStrata, setEditingStrata] = useState(false);
  const [guide, setGuide] = useState(false);
  return (
    <ExtractFormRow label="比較" onGuide={() => setGuide(true)}>
      <span className="extract-checks">
        <button type="button" className="rp-card__compact-button" onClick={() => setEditingStrata(true)}>
          比較群
        </button>
        {scope.strata.length > 0 && (
          <span className="extract-chips">
            {scope.strata.map((stratum) => (
              <span key={stratum.key} className="extract-chip">
                {stratumName(stratum, scope.queries)}
              </span>
            ))}
          </span>
        )}
      </span>
      {scope.strata.length > 0 && (
        <label className="extract-checks__item">
          <input
            type="checkbox"
            checked={scope.strataOnly}
            onChange={(e) => scope.setStrataOnly(e.target.checked)}
          />
          比較群外を除く
        </label>
      )}
      <label className="extract-field">
        担当医
        <select
          value={scope.attending}
          onChange={(e) => scope.setAttending(e.target.value as AttendingMode | "")}
        >
          <option value="">なし</option>
          {ATTENDING_MODES.map((mode) => (
            <option key={mode.value} value={mode.value}>
              {mode.label}
            </option>
          ))}
        </select>
      </label>
      {editingStrata && (
        <StrataEditorModal
          strata={scope.strata}
          queries={scope.queries}
          onChange={scope.setStrata}
          onClose={() => setEditingStrata(false)}
        />
      )}
      {guide && <DataExtractGuide topic="compare" onClose={() => setGuide(false)} />}
    </ExtractFormRow>
  );
}

export function PatientScopeSummary({ scope }: { scope: ExtractPatientScope }) {
  const { query, folder, strata } = scope.summary;
  return (
    <>
      {query && <span className="order-select__muted">{`「${query.name}」に該当 ${query.count} 人`}</span>}
      {folder && <span className="order-select__muted">{`フォルダ「${folder.name}」に ${folder.count} 人`}</span>}
      {strata.map((s) => (
        <span key={s.name} className="order-select__muted">{`比較群「${s.name}」${s.count} 人`}</span>
      ))}
    </>
  );
}

export function PatientScopeProgress({ scope }: { scope: ExtractPatientScope }) {
  if (!scope.running) return null;
  return <span className="order-select__muted">{`患者を抽出中(検索 ${scope.requests} 回)`}</span>;
}

/** 担当医を読んでいる間の表示と、読み切れなかった・読めなかったときの注記。 */
export function PatientAttributesStatus({ attributes }: { attributes: RecordPatientAttributes }) {
  return (
    <>
      {attributes.running && <span className="order-select__muted">担当医を読込中</span>}
      <TruncatedNotice show={attributes.truncated}>
        受診・処方が多く読み切れなかったため、担当医は読めた記録から決めています。期間か患者を絞ってください。
      </TruncatedNotice>
      <ErrorBanner error={attributes.error} />
    </>
  );
}
