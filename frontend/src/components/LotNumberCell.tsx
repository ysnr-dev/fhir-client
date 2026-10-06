import { normalizeLotNumber } from "../fhir/lotNumberHelpers";

interface LotNumberCellProps {
  /** ロット番号を記録する薬か(薬剤付加情報の lot_required)。対象外の薬は欄を出さない。 */
  required: boolean;
  value: string;
  onChange: (value: string) => void;
  /** 読み上げと title に使う薬剤名。 */
  medicineName: string;
  disabled?: boolean;
  /** 同じ記録の同じ薬に同じロットが重なっている。 */
  duplicate?: boolean;
}

/**
 * 実施入力の薬の行に置くロット番号の欄。バーコードリーダーはキーボード入力として入るので
 * テキスト欄で受け、欄を離れたときに半角にそろえる。空のままでも登録はでき、列見出しの「未入力」で
 * 知らせて後から入れてもらう(ロット管理の未入力一覧)。
 */
export function LotNumberCell({ required, value, onChange, medicineName, disabled, duplicate }: LotNumberCellProps) {
  if (!required && !value) return null;
  return (
    <span className="lot-number-cell">
      <input
        type="text"
        className={duplicate ? "lot-number-cell__input is-invalid" : "lot-number-cell__input"}
        value={value}
        aria-label={`${medicineName}のロット番号`}
        title={`${medicineName}のロット番号`}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => {
          const normalized = normalizeLotNumber(e.target.value);
          if (normalized !== e.target.value) onChange(normalized);
        }}
      />
      {duplicate && <span className="lot-number-cell__error">ロットが重複</span>}
    </span>
  );
}

/** ロット列の見出し。対象の薬でロットが空の行があれば「未入力」を添える。 */
export function LotColumnHeading({ missing }: { missing: boolean }) {
  return (
    <span className="lot-number-heading">
      ロット番号
      {missing && <span className="lot-number-cell__missing">未入力</span>}
    </span>
  );
}
