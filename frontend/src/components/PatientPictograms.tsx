import { Link } from "react-router-dom";
import type { PatientCaution } from "../api/masterClient";
import { summarizeAllergy } from "../fhir/allergyHelpers";
import { summarizeFlag } from "../fhir/flagHelpers";
import type { InfectionRow } from "../fhir/infectionHelpers";
import { CautionPictogram } from "./icons/cautionPictograms";
import { PictogramPopover } from "./PictogramPopover";

// 患者のピクトグラム(注意区分・アレルギー・感染症)の描画。
// 患者帯(PatientHeader)は 1 人ぶんを個別に引いてここへ渡し、病棟マップは
// 全患者ぶんをまとめて引いて患者ごとに渡す。取得と描画を分けるのはそのため。
// 見た目のクラスは患者帯のもの(patient-header__*)をそのまま使う。

/**
 * 帯のピクトグラムの大きさ。文字(14px)より少し大きくして、離れた席からでも
 * 図柄が読めるようにする。帯の高さは行の高さで決まるので、この程度なら伸びない。
 */
export const HEADER_PICTOGRAM_SIZE = 20;

interface CautionBadge {
  pictogram: string;
  category: string;
  /** 吹き出しに並べる注意。同じ図柄が複数あれば行が増える。 */
  lines: { name: string; text: string }[];
  order: number;
}

/**
 * 有効な注意のピクトグラム。文言は帯に出さず、押して開く吹き出しで読む。
 * 帯の行を増やさないための作りなので、ここに文字は置かない。
 *
 * ピクトグラムを持たない区分と、マスタから消えたコードの注意は帯に出さない
 * (プロファイルタブには出る)。
 */
export function CautionPictogramBadges({
  flags,
  cautionsByCode,
  patientId,
  size = HEADER_PICTOGRAM_SIZE,
}: {
  flags: fhir4.Flag[];
  cautionsByCode: Map<string, PatientCaution>;
  patientId: string;
  size?: number;
}) {
  if (flags.length === 0) return null;

  // 同じ図柄はひとつにまとめ、件数を右肩に添える。
  const badges = new Map<string, CautionBadge>();
  for (const flag of flags) {
    const summary = summarizeFlag(flag, cautionsByCode);
    if (!summary.pictogram) continue;

    const line = { name: summary.name, text: summary.text };
    const existing = badges.get(summary.pictogram);
    if (existing) {
      existing.lines.push(line);
      continue;
    }
    badges.set(summary.pictogram, {
      pictogram: summary.pictogram,
      category: summary.category,
      lines: [line],
      order: cautionsByCode.get(summary.cautionCode)?.display_order ?? Number.MAX_SAFE_INTEGER,
    });
  }

  if (badges.size === 0) return null;

  const sorted = [...badges.values()].sort(
    (a, b) => a.order - b.order || a.pictogram.localeCompare(b.pictogram),
  );

  return (
    <span className="patient-header__item patient-header__cautions">
      {sorted.map((badge) => (
        <PictogramPopover
          key={badge.pictogram}
          label={badge.lines.map((line) => (line.text ? `${line.name}: ${line.text}` : line.name)).join(" / ")}
          className={`patient-header__caution--${badge.category}`}
          icon={<CautionPictogram pictogram={badge.pictogram} size={size} />}
          count={badge.lines.length}
        >
          <ul className="patient-header__popover-list">
            {badge.lines.map((line, index) => (
              <li key={index}>
                <span className="patient-header__popover-name">{line.name}</span>
                {line.text && <span className="patient-header__popover-text">{line.text}</span>}
              </li>
            ))}
          </ul>
          <ProfileLink patientId={patientId} />
        </PictogramPopover>
      ))}
    </span>
  );
}

/** 吹き出しの下に置く、プロファイルタブへの導線。 */
function ProfileLink({ patientId }: { patientId: string }) {
  return (
    <Link to={`/patients/${patientId}/karte?tab=profile`} className="patient-header__popover-link">
      プロファイルを開く
    </Link>
  );
}

/**
 * 陽性の感染症のピクトグラム。標準予防策に加えるかの判断に直結するので帯に出す。
 *
 * 注意(Flag)とは別に持つ。感染症は注意区分マスタに登録するものではなく、
 * 検査結果と手入力から組み立てた一覧(感染症の区画)がもとになるため。
 * 種類が複数あってもアイコンは 1 つで、名前はまとめて吹き出しに出す
 * (帯にバイオハザードが並ぶと、どれが何か読めないまま場所だけ取る)。
 */
export function InfectionPictogramBadge({
  rows,
  patientId,
  size = HEADER_PICTOGRAM_SIZE,
}: {
  /** 感染症の一覧(陽性以外が混じっていてもよい)。 */
  rows: InfectionRow[];
  patientId: string;
  size?: number;
}) {
  const positives = rows.filter((row) => row.result === "positive");
  if (positives.length === 0) return null;

  const label = positives.map((row) => `${row.typeLabel} 陽性`).join(" / ");

  return (
    <span className="patient-header__item patient-header__cautions">
      <PictogramPopover
        label={label}
        className="patient-header__caution--infection"
        icon={<CautionPictogram pictogram="infection" size={size} />}
        count={positives.length}
      >
        <ul className="patient-header__popover-list">
          {positives.map((row) => (
            <li key={row.type}>
              <span className="patient-header__popover-name">{row.typeLabel} 陽性</span>
              <span className="patient-header__popover-text">
                {[row.sourceLabel, row.effectiveDate].filter(Boolean).join(" ")}
              </span>
            </li>
          ))}
        </ul>
        <ProfileLink patientId={patientId} />
      </PictogramPopover>
    </span>
  );
}

/**
 * 活動中のアレルギーのピクトグラム。処方・注射・食事の前に確かめるものなので帯に出す。
 *
 * **薬剤とそれ以外で図柄を分ける**。薬剤禁忌は処方・注射で真っ先に確かめるもので、
 * 食物・環境のアレルギーとは見るべき場面が違うため。それぞれの中では種類が複数でも
 * アイコンは 1 つにまとめ、件数を添えて中身は吹き出しで読ませる。
 *
 * 解消済み・非活動のものは出さない(今の禁忌ではないため)。
 */
export function AllergyPictogramBadges({
  allergies,
  patientId,
  size = HEADER_PICTOGRAM_SIZE,
}: {
  allergies: fhir4.AllergyIntolerance[];
  patientId: string;
  size?: number;
}) {
  if (allergies.length === 0) return null;

  const rows = allergies.map((allergy) => ({
    summary: summarizeAllergy(allergy),
    medication: allergy.category?.includes("medication") ?? false,
  }));

  const groups = [
    { key: "allergy-medication", label: "薬剤アレルギー", rows: rows.filter((r) => r.medication) },
    // 食物・環境などをまとめた側。区分は吹き出しの各行に出るので、ここでは括らない。
    { key: "allergy-other", label: "アレルギー", rows: rows.filter((r) => !r.medication) },
  ].filter((group) => group.rows.length > 0);

  return (
    <span className="patient-header__item patient-header__cautions">
      {groups.map((group) => (
        <PictogramPopover
          key={group.key}
          label={`${group.label}: ${group.rows.map((r) => r.summary.name).join(" / ")}`}
          className="patient-header__caution--allergy"
          icon={<CautionPictogram pictogram={group.key} size={size} />}
          count={group.rows.length}
        >
          <ul className="patient-header__popover-list">
            {group.rows.map((row) => (
              <li key={row.summary.id}>
                <span className="patient-header__popover-name">{row.summary.name}</span>
                <span className="patient-header__popover-text">
                  {[row.summary.categoryLabel, row.summary.criticalityLabel && `重篤化リスク ${row.summary.criticalityLabel}`, row.summary.reaction]
                    .filter(Boolean)
                    .join(" ・ ")}
                </span>
              </li>
            ))}
          </ul>
          <AllergyLink patientId={patientId} />
        </PictogramPopover>
      ))}
    </span>
  );
}

/** アレルギーの本体はアレルギータブなので、吹き出しからはそちらへ送る。 */
function AllergyLink({ patientId }: { patientId: string }) {
  return (
    <Link to={`/patients/${patientId}/karte?tab=allergy`} className="patient-header__popover-link">
      アレルギーを開く
    </Link>
  );
}
