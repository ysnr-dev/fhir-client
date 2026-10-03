import type { KarteLink } from "../fhir/karteLinkHelpers";
import { copyKarteLink } from "../lib/copyKarteLink";
import { RowMenu } from "./RowMenu";

// レポート・ファイル・DICOM のボタン群の右端に置くケバブ。link が null(未選択)なら無効。
export function KarteLinkMenu({
  label,
  link,
  patientId,
}: {
  label: string;
  link: KarteLink | null;
  patientId: string;
}) {
  return (
    <RowMenu label={label}>
      <button
        type="button"
        className="row-menu__item"
        disabled={!link}
        onClick={() => link && void copyKarteLink(link, patientId)}
      >
        リンクを取得
      </button>
    </RowMenu>
  );
}
