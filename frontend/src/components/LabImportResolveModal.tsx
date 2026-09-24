import { useState } from "react";
import type { LabResultImportRow, LabResultItem } from "../api/masterClient";
import { useLabResultImportMutations, useLabResultItemsByCodes } from "../api/masterQueries";
import { parseCodeValueList } from "../fhir/labResultHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { LabResultItemSearchModal } from "./LabResultItemSearchModal";
import { Modal } from "./Modal";

// 保留行の引き当てを人が決める。取込元コード対応表は持たず、ここで選んだ結果項目の
// JLAC をマスタに書き込むことで次回から自動で当たるようにする
// (docs/lab-result-import-design.md §4 を JLAC 中心に改めたもの)。

interface Props {
  row: LabResultImportRow;
  onClose: () => void;
}

export function LabImportResolveModal({ row, onClose }: Props) {
  const { updateRow } = useLabResultImportMutations();
  const [selected, setSelected] = useState<LabResultItem | null>(null);
  const [searching, setSearching] = useState(false);
  const [writeToMaster, setWriteToMaster] = useState(true);
  const [applyToSameCode, setApplyToSameCode] = useState(true);
  const candidates = useLabResultItemsByCodes(row.candidate_item_codes);

  const fileJlac = row.jlac11_code ?? row.jlac10_code ?? "";
  const conflict = jlacConflict(row, selected);
  const canWriteToMaster = Boolean(fileJlac) && !conflict && hasEmptyJlac(row, selected);

  function handleSubmit() {
    if (!selected) return;
    updateRow.mutate(
      {
        id: row.id,
        payload: {
          result_item_code: selected.result_item_code,
          write_to_master: canWriteToMaster && writeToMaster,
          apply_to_same_code: applyToSameCode,
        },
      },
      { onSuccess: onClose },
    );
  }

  if (searching) {
    return (
      <LabResultItemSearchModal
        title="取込行に割り当てる結果項目を選択"
        onSelect={(item) => {
          setSelected(item);
          setSearching(false);
        }}
        onClose={() => setSearching(false)}
      />
    );
  }

  return (
    <Modal title="結果項目の割り当て" onClose={onClose}>
      <div className="lab-import-resolve">
        <dl className="lab-import-resolve__source">
          <dt>ファイルの項目</dt>
          <dd>
            {row.external_name ?? ""} ({row.external_code ?? ""})
          </dd>
          <dt>JLAC</dt>
          <dd>{fileJlac || "(なし)"}</dd>
          <dt>値</dt>
          <dd>
            {row.value ?? ""} {row.unit ?? ""}
          </dd>
        </dl>

        {row.pending_reason === "item_ambiguous" && (
          <div className="lab-import-resolve__candidates">
            <p>JLAC の前方一致で複数の結果項目が当たりました。</p>
            {(candidates.data?.items ?? []).map((item) => (
              <button key={item.result_item_code} type="button" onClick={() => setSelected(item)}>
                {item.name} ({item.result_item_code})
              </button>
            ))}
          </div>
        )}

        <div className="lab-import-resolve__selected">
          <button type="button" onClick={() => setSearching(true)}>
            結果項目を探す
          </button>
          {selected && (
            <span>
              {selected.name} ({selected.result_item_code} / {selected.data_type})
            </span>
          )}
        </div>

        {selected?.data_type === "CD" || selected?.data_type === "CO" ? (
          <p className="lab-import-resolve__options">
            選択肢: {parseCodeValueList(selected.code_value_list).map((o) => o.display).join(" / ")}
          </p>
        ) : null}

        {canWriteToMaster && (
          <label>
            <input
              type="checkbox"
              checked={writeToMaster}
              onChange={(event) => setWriteToMaster(event.target.checked)}
            />
            結果項目マスタに JLAC({fileJlac})を書き込む
          </label>
        )}
        {conflict && (
          <p className="lab-import-resolve__conflict">
            マスタの JLAC({conflict})とファイルの JLAC({fileJlac})が違います。
          </p>
        )}
        <label>
          <input
            type="checkbox"
            checked={applyToSameCode}
            onChange={(event) => setApplyToSameCode(event.target.checked)}
          />
          同じコードの保留行にも反映する
        </label>

        <ErrorBanner error={updateRow.error} />
        <div className="lab-import-resolve__actions">
          <button type="button" onClick={onClose}>
            キャンセル
          </button>
          <button type="button" onClick={handleSubmit} disabled={!selected || updateRow.isPending}>
            割り当てる
          </button>
        </div>
      </div>
    </Modal>
  );
}

// マスタに既に別の JLAC が入っているとき。上書きせず画面で知らせる。
function jlacConflict(row: LabResultImportRow, item: LabResultItem | null): string {
  if (!item) return "";
  if (row.jlac10_code && item.jlac10_code && item.jlac10_code !== row.jlac10_code) {
    return item.jlac10_code;
  }
  if (row.jlac11_code && item.jlac11_code && item.jlac11_code !== row.jlac11_code) {
    return item.jlac11_code;
  }
  return "";
}

function hasEmptyJlac(row: LabResultImportRow, item: LabResultItem | null): boolean {
  if (!item) return false;
  return Boolean(
    (row.jlac10_code && !item.jlac10_code) || (row.jlac11_code && !item.jlac11_code),
  );
}
