import { Link } from "react-router-dom";
import { usePatientCautions } from "../api/masterQueries";
import { useActiveFlags, usePatient, usePatientAdmission } from "../api/queries";
import type { PatientCaution } from "../api/masterClient";
import { summarizeFlag } from "../fhir/flagHelpers";
import { calculateAge, displayKana, displayName, genderLabel } from "../fhir/patientHelpers";
import { CautionPictogram } from "./icons/cautionPictograms";

interface PatientHeaderProps {
  patientId: string | undefined;
}

export function PatientHeader({ patientId }: PatientHeaderProps) {
  const patient = usePatient(patientId);
  // 入院中なら居場所を添える(外来のときは項目ごと出さない)。
  const admission = usePatientAdmission(patientId);
  const p = patient.data?.data;
  if (!p) return null;

  // 「東3階病棟 301号室」。どの床かまでは出さない。
  const admissionPlace = admission.data
    ? [admission.data.wardName, admission.data.roomName].filter(Boolean).join(" ")
    : "";

  const kana = displayKana(p);
  const age = p.birthDate ? calculateAge(p.birthDate) : undefined;
  const birth = p.birthDate ? `${p.birthDate}${age !== undefined ? `（${age}歳）` : ""}` : "-";

  return (
    <div className="patient-header">
      <span className="patient-header__item">
        <span className="patient-header__label">患者番号</span>
        <span className="patient-header__value">{p.identifier?.[0]?.value ?? "-"}</span>
      </span>
      <span className="patient-header__item">
        <span className="patient-header__label">氏名</span>
        <span className="patient-header__value patient-header__value--name">{displayName(p)}</span>
      </span>
      {kana && (
        <span className="patient-header__item">
          <span className="patient-header__label">カナ</span>
          <span className="patient-header__value">{kana}</span>
        </span>
      )}
      <span className="patient-header__item">
        <span className="patient-header__label">生年月日</span>
        <span className="patient-header__value">{birth}</span>
      </span>
      <span className="patient-header__item">
        <span className="patient-header__label">性別</span>
        <span className="patient-header__value">{genderLabel(p.gender)}</span>
      </span>
      {admissionPlace && (
        <span className="patient-header__item">
          <span className="patient-header__label">入院</span>
          <span className="patient-header__value">{admissionPlace}</span>
        </span>
      )}
      <CautionPictograms patientId={patientId} />
    </div>
  );
}

interface CautionBadge {
  pictogram: string;
  category: string;
  /** ホバーと読み上げに出す文言。同じ図柄が複数あれば改行で連ねる。 */
  tooltip: string;
  count: number;
  order: number;
}

/**
 * 有効な注意のピクトグラム。文言は帯に出さず、ホバー(title)と読み上げ
 * (aria-label)で読む。帯の行を増やさないための作りなので、ここに文字は置かない。
 *
 * ピクトグラムを持たない区分と、マスタから消えたコードの注意は帯に出さない
 * (プロファイルタブには出る)。
 */
function CautionPictograms({ patientId }: { patientId: string | undefined }) {
  const { flags } = useActiveFlags(patientId);
  const cautions = usePatientCautions();

  if (!patientId || flags.length === 0) return null;

  const cautionsByCode = new Map<string, PatientCaution>(
    (cautions.data?.items ?? []).map((c) => [c.code, c]),
  );

  // 同じ図柄はひとつにまとめ、件数を右肩に添える。
  const badges = new Map<string, CautionBadge>();
  for (const flag of flags) {
    const summary = summarizeFlag(flag, cautionsByCode);
    if (!summary.pictogram) continue;

    const line = summary.text ? `${summary.name}: ${summary.text}` : summary.name;
    const existing = badges.get(summary.pictogram);
    if (existing) {
      existing.count += 1;
      existing.tooltip = `${existing.tooltip}\n${line}`;
      continue;
    }
    badges.set(summary.pictogram, {
      pictogram: summary.pictogram,
      category: summary.category,
      tooltip: line,
      count: 1,
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
        <Link
          key={badge.pictogram}
          to={`/patients/${patientId}/karte?tab=profile`}
          className={`patient-header__caution patient-header__caution--${badge.category}`}
          title={badge.tooltip}
          aria-label={badge.tooltip}
        >
          <CautionPictogram pictogram={badge.pictogram} />
          {badge.count > 1 && <span className="patient-header__caution-count">{badge.count}</span>}
        </Link>
      ))}
    </span>
  );
}
