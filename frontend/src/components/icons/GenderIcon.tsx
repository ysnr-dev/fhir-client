import { genderLabel, genderShortLabel } from "../../fhir/patientHelpers";

// 性別の記号(♂ / ♀)。男女以外は短い文字表記のまま出す。
export function GenderIcon({ gender }: { gender: string | undefined }) {
  if (gender !== "male" && gender !== "female") {
    return <span className="gender-icon gender-icon--text">{genderShortLabel(gender)}</span>;
  }
  const label = genderLabel(gender);
  return (
    <svg
      className={`gender-icon gender-icon--${gender}`}
      viewBox="0 0 16 16"
      width="13"
      height="13"
      role="img"
      aria-label={label}
      focusable="false"
    >
      <title>{label}</title>
      {gender === "male" ? (
        <path
          d="M9.5 2.5h4v4M13.5 2.5 9 7M10.5 10a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <path
          d="M12 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM8 10v4.5M5.5 12.5h5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}
