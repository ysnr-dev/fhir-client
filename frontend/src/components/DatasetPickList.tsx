import { useId, useState } from "react";

// 実施入力データセットに登録した候補から選ぶモード。マスタ検索モーダルに足す。
//
// データセットには「初期値ON」(実施入力を開いた時点で明細に並ぶ行)のほかに
// 「初期値OFF」の行も登録できる。使ったときだけ足す薬剤・器材がこれで、
// 全件検索から探すとなると名称かコードを覚えていないと辿り着けない。
// そこで候補がある検索モーダルは既定を「データセット」にして、その検査で
// 使う可能性のある行だけを並べ、そこに無いものだけ全件検索に切り替えて探す。
//
// 検索モーダル(診療行為・医薬品・特定器材・放射線器材)は他の画面からも使うので、
// datasetPick を渡さない呼び出しは今までどおり全件検索だけになる。
//
// 放射線・生理検査・内視鏡・処置の実施入力で共通。データセットの明細は部門ごとに
// 別の型だが、候補にするのに要る列は同じなので DatasetDetailLike で構造だけ受ける。

export type DatasetPickMode = "dataset" | "all";

/** データセットに登録されている候補 1 行。 */
export interface DatasetPickOption {
  /** 呼び出し側がデータセット明細に戻すための識別子。 */
  key: string;
  code: string;
  name: string;
  /** 既定量・投与経路などの補足。 */
  note?: string;
  /** すでに明細に入っている行。二重に足さないよう選べなくする。 */
  added?: boolean;
}

export interface DatasetPickProps {
  options: DatasetPickOption[];
  /** 補足列の見出し。薬剤なら「既定量・経路」など。省略すると補足列を出さない。 */
  noteLabel?: string;
  onSelect: (option: DatasetPickOption) => void;
  /** 候補が 1 件も無いときの文言。 */
  emptyText?: string;
}

/**
 * データセット明細のうち、候補を組み立てるのに要る列。部門ごとに型が別
 * (RadDatasetDetail / PhysioDatasetDetail / …)なので構造で受ける。
 */
export interface DatasetDetailLike {
  id: number;
  detail_type: string;
  code: string;
  default_quantity: string | null;
  route_code: string | null;
  resolved_name: string | null;
  resolved_unit_name: string | null;
}

/**
 * 種別とコードが同じ明細は 1 件だけ残す。複数のデータセットに同じ手技・薬剤・器材が
 * 入っていることがある(造影セットと穿刺セットの両方に延長チューブが入っている等)。
 * 数量は先に出てきた方を採る。初期行と候補一覧で同じ並びを使う。
 */
export function dedupeDatasetDetails<T extends DatasetDetailLike>(details: T[]): T[] {
  const seen = new Set<string>();
  return details.filter((detail) => {
    const key = `${detail.detail_type}:${detail.code}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * 検索モーダルに渡す候補一式。種別で絞り、すでに明細にあるコードは追加済みにする。
 * 選ばれたら元の明細を onAdd に返すので、初期行と同じ既定量・経路で足せる。
 */
export function buildDatasetPick<T extends DatasetDetailLike>({
  details,
  type,
  addedCodes,
  routeDisplay,
  onAdd,
  emptyText,
}: {
  details: T[];
  type: string;
  addedCodes: Set<string>;
  /** 経路コード → 表示名。部門ごとに選べる経路が違う。 */
  routeDisplay: (code: string) => string;
  onAdd: (detail: T) => void;
  emptyText?: string;
}): DatasetPickProps {
  const target = details.filter((detail) => detail.detail_type === type);

  return {
    options: target.map((detail) => ({
      key: String(detail.id),
      code: detail.code,
      name: detail.resolved_name ?? detail.code,
      note: detailNote(detail, routeDisplay),
      added: addedCodes.has(detail.code),
    })),
    noteLabel: type === "medicine" ? "既定量・経路" : type === "material" ? "既定量" : undefined,
    onSelect: (option) => {
      const detail = target.find((d) => String(d.id) === option.key);
      if (detail) onAdd(detail);
    },
    emptyText,
  };
}

/** 候補一覧に出す既定値の補足。薬剤は使用量と経路、器材は数量。 */
function detailNote(detail: DatasetDetailLike, routeDisplay: (code: string) => string): string {
  const quantity = detail.default_quantity
    ? `${detail.default_quantity}${detail.resolved_unit_name ?? ""}`
    : "";
  if (detail.detail_type === "medicine" && detail.route_code) {
    return [quantity, routeDisplay(detail.route_code)].filter(Boolean).join(" / ");
  }
  return quantity;
}

/**
 * 検索モーダルの表示モード。候補があるときだけデータセットから始める
 * (候補が無いモーダルでいきなり空の一覧を見せない)。
 */
export function useDatasetPickMode(pick?: DatasetPickProps) {
  return useState<DatasetPickMode>(pick && pick.options.length > 0 ? "dataset" : "all");
}

export function DatasetPickModeTabs({
  mode,
  onChange,
  count,
}: {
  mode: DatasetPickMode;
  onChange: (mode: DatasetPickMode) => void;
  count: number;
}) {
  // 同じ画面に検索モーダルが複数開くことはないが、ラジオの name は
  // 使い回すと別のモーダルと排他になるので id から作る。
  const name = useId();

  return (
    <div className="master-search__mode">
      <span className="master-search__mode-legend">候補</span>
      <div className="master-search__mode-options">
        <label className="master-search__mode-option">
          <input
            type="radio"
            name={name}
            checked={mode === "dataset"}
            onChange={() => onChange("dataset")}
          />
          データセット ({count})
        </label>
        <label className="master-search__mode-option">
          <input
            type="radio"
            name={name}
            checked={mode === "all"}
            onChange={() => onChange("all")}
          />
          全件検索
        </label>
      </div>
    </div>
  );
}

export function DatasetPickTable({
  options,
  noteLabel,
  onSelect,
  emptyText = "オーダー項目のデータセットに登録がありません",
}: DatasetPickProps) {
  const columns = noteLabel ? 4 : 3;

  return (
    <div className="lab-order-item__table-wrap">
      <table className="master-search__table">
        <thead>
          <tr>
            <th>コード</th>
            <th>名称</th>
            {noteLabel && <th className="rad-item__compact">{noteLabel}</th>}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {options.map((option) => (
            <tr key={option.key}>
              <td>{option.code}</td>
              <td>{option.name}</td>
              {noteLabel && <td className="rad-item__compact">{option.note}</td>}
              <td className="master-search__actions">
                <button type="button" onClick={() => onSelect(option)} disabled={option.added}>
                  {option.added ? "追加済み" : "選択"}
                </button>
              </td>
            </tr>
          ))}
          {options.length === 0 && (
            <tr>
              <td colSpan={columns} className="master-search__empty">
                {emptyText}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
