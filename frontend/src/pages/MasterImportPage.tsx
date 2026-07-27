import { useRef, useState } from "react";
import { useImportMaster } from "../api/masterQueries";
import type { MasterType } from "../api/masterClient";
import { ErrorBanner } from "../components/ErrorBanner";

interface MasterOption {
  type: MasterType;
  label: string;
  formatHint: string;
  accept: string;
}

const MASTER_OPTIONS: MasterOption[] = [
  {
    type: "hot_codes",
    label: "HOTコードマスタ",
    formatHint: "MEDIS HOT9 / CSV・TXT（Shift_JIS、ヘッダあり・24列）",
    accept: ".txt,.csv",
  },
  {
    type: "medicines",
    label: "医薬品マスタ",
    formatHint: "薬価基準収載医薬品 / CSV（Shift_JIS、ヘッダなし・42列）",
    accept: ".csv",
  },
  {
    type: "medicine_usages",
    label: "用法マスタ",
    formatHint: "電子処方箋 用法マスタ / Excel（.xlsx）",
    accept: ".xlsx",
  },
  {
    type: "lab_items",
    label: "検査項目マスタ",
    formatHint: "共有項目JLACコードマスタ / CSV（UTF-8、ヘッダあり・32列）",
    accept: ".csv",
  },
  {
    type: "diseases",
    label: "病名マスタ",
    formatHint: "ICD10対応標準病名マスター 病名基本テーブル nmain*.txt（Shift_JIS、ヘッダなし・20列）",
    accept: ".txt,.csv",
  },
  {
    type: "modifiers",
    label: "修飾語マスタ",
    formatHint: "ICD10対応標準病名マスター 修飾語テーブル mdfy*.txt（Shift_JIS、ヘッダなし・10列）",
    accept: ".txt,.csv",
  },
  {
    type: "disease_indexes",
    label: "病名索引マスタ",
    formatHint: "ICD10対応標準病名マスター 索引テーブル index*.txt（Shift_JIS、ヘッダなし・9列）",
    accept: ".txt,.csv",
  },
];

export function MasterImportPage() {
  const [masterType, setMasterType] = useState<MasterType>("hot_codes");
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importMaster = useImportMaster();

  const selected = MASTER_OPTIONS.find((o) => o.type === masterType)!;

  function handleMasterTypeChange(type: MasterType) {
    setMasterType(type);
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    importMaster.reset();
  }

  function handleFileChange(nextFile: File | null) {
    setFile(nextFile);
    importMaster.reset();
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;
    importMaster.mutate({ masterType, file });
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>マスタ取込</h1>
      </div>
      <form className="master-import-form" onSubmit={handleSubmit}>
        <fieldset>
          <legend>マスタ種別</legend>
          {MASTER_OPTIONS.map((option) => (
            <label key={option.type} className="master-import-form__radio">
              <input
                type="radio"
                name="masterType"
                value={option.type}
                checked={masterType === option.type}
                onChange={() => handleMasterTypeChange(option.type)}
              />
              {option.label}
            </label>
          ))}
        </fieldset>
        <p className="master-import-form__hint">対応ファイル: {selected.formatHint}</p>
        <label>
          取込ファイル
          <input
            ref={fileInputRef}
            type="file"
            accept={selected.accept}
            onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
          />
        </label>
        <p className="master-import-form__warning">
          取込を実行すると、選択したマスタの既存データはすべて削除され、ファイルの内容で置き換えられます。
        </p>
        <div className="master-import-form__actions">
          <button type="submit" disabled={!file || importMaster.isPending}>
            {importMaster.isPending ? "取込中..." : "取込実行"}
          </button>
        </div>
        {importMaster.isSuccess && (
          <p className="master-import-form__success" role="status">
            {importMaster.data.imported} 件を取り込みました
          </p>
        )}
        <ErrorBanner error={importMaster.error} />
      </form>
    </div>
  );
}
