import { Link } from "react-router-dom";
import { usePatientCautions } from "../api/masterQueries";
import {
  useActiveAllergies,
  useActiveFlags,
  useLabInfectionResults,
  useManualInfections,
  usePatient,
  usePatientAdmission,
} from "../api/queries";
import { summarizeAllergy } from "../fhir/allergyHelpers";
import type { PatientCaution } from "../api/masterClient";
import { summarizeFlag } from "../fhir/flagHelpers";
import { HAS_LAB_MAPPED_TYPES, summarizeInfections } from "../fhir/infectionHelpers";
import {
  calculateAge,
  displayKana,
  displayName,
  genderLabel,
  languageLabel,
} from "../fhir/patientHelpers";
import { CautionPictogram } from "./icons/cautionPictograms";
import { PictogramPopover } from "./PictogramPopover";

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
  // 死亡は「その患者に今からオーダーを出してよいか」に直結するので帯に出す。
  const deceasedDate = p.deceasedDateTime?.slice(0, 10) ?? "";
  const deceased = deceasedDate || p.deceasedBoolean === true;
  // 通訳の要否は窓口・病棟が最初に知りたいので、言語と併せて帯に出す。
  const communication = p.communication?.[0];
  const languageCode = communication?.language?.coding?.[0]?.code ?? "";
  const interpreter = communication?.preferred === true;
  const languageText = [
    languageCode && languageCode !== "und" ? languageLabel(languageCode) : "",
    interpreter ? "通訳必要" : "",
  ]
    .filter(Boolean)
    .join(" / ");

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
      {deceased && (
        <span className="patient-header__item">
          <span className="patient-header__label">死亡</span>
          <span className="patient-header__value patient-header__value--deceased">
            {deceasedDate || "あり"}
          </span>
        </span>
      )}
      {languageText && (
        <span className="patient-header__item">
          <span className="patient-header__label">言語</span>
          <span className="patient-header__value">{languageText}</span>
        </span>
      )}
      {admissionPlace && (
        <span className="patient-header__item">
          <span className="patient-header__label">入院</span>
          <span className="patient-header__value">{admissionPlace}</span>
        </span>
      )}
      <CautionPictograms patientId={patientId} />
      <AllergyPictograms patientId={patientId} />
      <InfectionPictogram patientId={patientId} />
    </div>
  );
}

/**
 * 帯のピクトグラムの大きさ。文字(14px)より少し大きくして、離れた席からでも
 * 図柄が読めるようにする。帯の高さは行の高さで決まるので、この程度なら伸びない。
 */
const HEADER_PICTOGRAM_SIZE = 20;

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
          icon={<CautionPictogram pictogram={badge.pictogram} size={HEADER_PICTOGRAM_SIZE} />}
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
function InfectionPictogram({ patientId }: { patientId: string | undefined }) {
  const manual = useManualInfections(patientId);
  const lab = useLabInfectionResults(patientId, HAS_LAB_MAPPED_TYPES);

  if (!patientId) return null;

  const positives = summarizeInfections(manual.observations, lab.observations).filter(
    (row) => row.result === "positive",
  );
  if (positives.length === 0) return null;

  const label = positives.map((row) => `${row.typeLabel} 陽性`).join(" / ");

  return (
    <span className="patient-header__item patient-header__cautions">
      <PictogramPopover
        label={label}
        className="patient-header__caution--infection"
        icon={<CautionPictogram pictogram="infection" size={HEADER_PICTOGRAM_SIZE} />}
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
function AllergyPictograms({ patientId }: { patientId: string | undefined }) {
  const { allergies } = useActiveAllergies(patientId);

  if (!patientId || allergies.length === 0) return null;

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
          icon={<CautionPictogram pictogram={group.key} size={HEADER_PICTOGRAM_SIZE} />}
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
