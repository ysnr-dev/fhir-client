import { Link } from "react-router-dom";
import { usePatientCautions } from "../api/masterQueries";
import {
  useActiveAllergies,
  useActiveFlags,
  useBloodType,
  useLabInfectionResults,
  useManualInfections,
  usePatient,
  usePatientAdmission,
  useRegimenApplications,
} from "../api/queries";
import { summarizeBloodType } from "../fhir/bloodTypeHelpers";
import { bloodTypeLabel } from "../fhir/transfusionOrderHelpers";
import type { PatientCaution } from "../api/masterClient";
import { regimenStatusLabel } from "../fhir/regimenOrderHelpers";
import { HAS_LAB_MAPPED_TYPES, summarizeInfections } from "../fhir/infectionHelpers";
import {
  calculateAge,
  displayKana,
  displayName,
  genderLabel,
} from "../fhir/patientHelpers";
import { CautionPictogram } from "./icons/cautionPictograms";
import {
  AllergyPictogramBadges,
  CautionPictogramBadges,
  HEADER_PICTOGRAM_SIZE,
  InfectionPictogramBadge,
} from "./PatientPictograms";
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
  // ［決定］使用言語・通訳の要否は帯に出さない(2026-09-08)。窓口で毎回見るものではなく、
  // 帯の横幅は患者番号・氏名・生年月日・在院場所と、注意のピクトグラムに使う。
  // プロファイルタブの「使用言語」で読む(通訳必要もそこに出る)。

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
      <BloodType patientId={patientId} />
      {admissionPlace && (
        <span className="patient-header__item">
          <span className="patient-header__label">入院</span>
          <span className="patient-header__value">{admissionPlace}</span>
        </span>
      )}
      <CautionPictograms patientId={patientId} />
      <AllergyPictograms patientId={patientId} />
      <InfectionPictogram patientId={patientId} />
      <ChemotherapyPictogram patientId={patientId} />
    </div>
  );
}

/**
 * 有効な注意のピクトグラム。取得だけここで行い、描画は PatientPictograms に任せる
 * (病棟マップと同じ見た目にするため)。
 */
function CautionPictograms({ patientId }: { patientId: string | undefined }) {
  const { flags } = useActiveFlags(patientId);
  const cautions = usePatientCautions();

  if (!patientId || flags.length === 0) return null;

  const cautionsByCode = new Map<string, PatientCaution>(
    (cautions.data?.items ?? []).map((c) => [c.code, c]),
  );
  return <CautionPictogramBadges flags={flags} cautionsByCode={cautionsByCode} patientId={patientId} />;
}

/** 陽性の感染症のピクトグラム(手入力 + 検査由来)。 */
function InfectionPictogram({ patientId }: { patientId: string | undefined }) {
  const manual = useManualInfections(patientId);
  const lab = useLabInfectionResults(patientId, HAS_LAB_MAPPED_TYPES);

  if (!patientId) return null;

  return (
    <InfectionPictogramBadge
      rows={summarizeInfections(manual.observations, lab.observations)}
      patientId={patientId}
    />
  );
}

/**
 * 化学療法中のピクトグラム(§7.6 E-8)。適用中・休止中のレジメンがあるときだけ出す。
 *
 * 抗がん剤の曝露対策・血管外漏出の観察・易感染への配慮は、化学療法タブを開かなくても
 * 分かっている必要があるので帯に置く。中身(レジメン名・クール・状態)は吹き出しで読む。
 * 完了・中止した適用は出さない(いまの状態ではないため。治療歴は化学療法タブで読む)。
 */
function ChemotherapyPictogram({ patientId }: { patientId: string | undefined }) {
  const applications = useRegimenApplications(patientId);

  if (!patientId) return null;

  const running = (applications.data?.applications ?? []).filter(
    (a) => a.status === "active" || a.status === "on-hold",
  );
  if (running.length === 0) return null;

  const label = running.map((a) => `化学療法: ${a.name}（${regimenStatusLabel(a.status)}）`).join(" / ");

  return (
    <span className="patient-header__item patient-header__cautions">
      <PictogramPopover
        label={label}
        className="patient-header__caution--chemo"
        icon={<CautionPictogram pictogram="chemotherapy" size={HEADER_PICTOGRAM_SIZE} />}
        count={running.length}
      >
        <ul className="patient-header__popover-list">
          {running.map((application) => (
            <li key={application.id}>
              <span className="patient-header__popover-name">{application.name}</span>
              <span className="patient-header__popover-text">
                {[
                  regimenStatusLabel(application.status),
                  `開始 ${application.startDate}`,
                  application.plannedCycles !== null ? `予定 ${application.plannedCycles} クール` : "継続",
                ].join(" / ")}
              </span>
            </li>
          ))}
        </ul>
        <Link className="patient-header__popover-link" to={`/patients/${patientId}/karte?tab=chemo`}>
          化学療法タブを開く
        </Link>
      </PictogramPopover>
    </span>
  );
}

/** 活動中のアレルギーのピクトグラム。 */
function AllergyPictograms({ patientId }: { patientId: string | undefined }) {
  const { allergies } = useActiveAllergies(patientId);

  if (!patientId || allergies.length === 0) return null;

  return <AllergyPictogramBadges allergies={allergies} patientId={patientId} />;
}

/**
 * 血液型。輸血・手術の場面で真っ先に確かめるので帯に出す。
 *
 * **検査で確定していない型には印を付ける**。申告のままの型で製剤は出せないので、
 * 値だけを見て確定と思われないようにする(プロファイルタブの身体区画と同じ扱い)。
 * 確認日は帯には出さない(行を増やさないため)。詳細はプロファイルタブで読む。
 */
function BloodType({ patientId }: { patientId: string | undefined }) {
  const { observations } = useBloodType(patientId);
  const summary = summarizeBloodType(observations);

  const label = summary ? bloodTypeLabel(summary.abo, summary.rhd) : "";
  if (!label) return null;

  return (
    <span className="patient-header__item">
      <span className="patient-header__label">血液型</span>
      <span className="patient-header__value patient-header__value--blood-type">
        {label}
        {!summary?.tested && <span className="blood-type__unconfirmed">検査未確定</span>}
      </span>
    </span>
  );
}
