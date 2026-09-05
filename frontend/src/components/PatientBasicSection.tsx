import { usePatient } from "../api/queries";
import {
  calculateAge,
  contactRelationshipLabel,
  displayKana,
  displayName,
  genderLabel,
  languageLabel,
  parsePatient,
} from "../fhir/patientHelpers";
import { ErrorBanner } from "./ErrorBanner";

/**
 * プロファイルタブの「基本」区画。カルテを開いたまま連絡先やかかりつけ医を
 * 確かめられるようにするための区画で、ここは読み取り専用。
 * 「患者情報を編集」は患者編集画面へ遷移せず、注意の登録・編集と同じく
 * タブの中で開く(カルテを見ているところから離れないため)。
 */
export function PatientBasicSection({
  patientId,
  onEdit,
}: {
  patientId: string;
  onEdit: () => void;
}) {
  const { data: result, isLoading, error } = usePatient(patientId);
  const patient = result?.data;

  if (isLoading) return <p>読み込み中...</p>;

  return (
    <section className="karte-profile__section">
      <div className="karte-tabpanel__header">
        <h3>基本情報</h3>
        <div className="karte-tabpanel__actions">
          <button type="button" onClick={onEdit}>
            患者情報を編集
          </button>
        </div>
      </div>

      <ErrorBanner error={error} />

      {patient && <BasicTables patient={patient} />}
    </section>
  );
}

function BasicTables({ patient }: { patient: fhir4.Patient }) {
  const values = parsePatient(patient);
  const age = patient.birthDate ? calculateAge(patient.birthDate) : undefined;
  const birth = patient.birthDate
    ? `${patient.birthDate}${age !== undefined ? `（${age}歳）` : ""}`
    : "-";
  const deceasedDate = patient.deceasedDateTime?.slice(0, 10) ?? "";
  const deceased = deceasedDate || patient.deceasedBoolean === true;
  const language = [
    values.language ? languageLabel(values.language) : "",
    values.interpreterNeeded ? "通訳必要" : "",
  ]
    .filter(Boolean)
    .join(" / ");
  const address = patient.address?.[0];
  const addressText =
    address?.text ?? [address?.state, address?.city, address?.line?.join("")].filter(Boolean).join("");

  return (
    <div className="prescription-detail">
      <fieldset>
        <legend>本人</legend>
        <dl className="prescription-detail__common">
          <dt>氏名</dt>
          <dd>{displayName(patient)}</dd>
          <dt>カナ</dt>
          <dd>{displayKana(patient) || "-"}</dd>
          <dt>旧姓</dt>
          <dd>{values.maidenFamily || "-"}</dd>
          <dt>通称名</dt>
          <dd>{values.nickname || "-"}</dd>
          <dt>生年月日</dt>
          <dd>{birth}</dd>
          <dt>性別</dt>
          <dd>{genderLabel(patient.gender)}</dd>
          {deceased && (
            <>
              <dt>死亡日</dt>
              <dd className="patient-header__value--deceased">{deceasedDate || "あり"}</dd>
            </>
          )}
          <dt>使用言語</dt>
          <dd>{language || "-"}</dd>
        </dl>
      </fieldset>

      <fieldset>
        <legend>連絡先</legend>
        <dl className="prescription-detail__common">
          <dt>住所</dt>
          <dd>
            {[values.postalCode ? `〒${values.postalCode}` : "", addressText]
              .filter(Boolean)
              .join(" ") || "-"}
          </dd>
          <dt>固定電話</dt>
          <dd>{values.homePhone || "-"}</dd>
          <dt>携帯電話</dt>
          <dd>{values.mobilePhone || "-"}</dd>
          <dt>EMail</dt>
          <dd>{values.email || "-"}</dd>
        </dl>
      </fieldset>

      <fieldset>
        <legend>緊急連絡先・キーパーソン</legend>
        {values.contacts.length === 0 ? (
          <p className="patient-table__empty">登録されている連絡先がありません。</p>
        ) : (
          <table className="patient-table">
            <thead>
              <tr>
                <th>続柄</th>
                <th>氏名</th>
                <th>固定電話</th>
                <th>携帯電話</th>
                <th>住所</th>
              </tr>
            </thead>
            <tbody>
              {values.contacts.map((contact, index) => (
                <tr key={index}>
                  <td>
                    {[
                      ...contact.relationships.map(contactRelationshipLabel).filter(Boolean),
                      contact.relationshipNote,
                    ]
                      .filter(Boolean)
                      .join(" / ") || "-"}
                  </td>
                  <td>{[contact.family, contact.given].filter(Boolean).join(" ") || "-"}</td>
                  <td>{contact.homePhone || "-"}</td>
                  <td>{contact.mobilePhone || "-"}</td>
                  <td>{contact.address || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </fieldset>

      <fieldset>
        <legend>かかりつけ医・紹介元</legend>
        <dl className="prescription-detail__common">
          <dt>連携先</dt>
          <dd>{values.generalPractitionerName || values.generalPractitionerRef || "-"}</dd>
        </dl>
      </fieldset>
    </div>
  );
}
