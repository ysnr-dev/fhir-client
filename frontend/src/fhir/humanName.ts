// 日本人名(漢字・カナ)の HumanName 表現。JP Core は表記の種別を
// iso21090-EN-representation 拡張(IDE = 漢字、SYL = カナ)で区別する。
// Patient・Practitioner で共通に使う。

const KANA_REPRESENTATION_URL = "http://hl7.org/fhir/StructureDefinition/iso21090-EN-representation";
const KANJI_REPRESENTATION = "IDE";
const KANA_REPRESENTATION = "SYL";

export interface JapaneseNameParts {
  familyKanji: string;
  givenKanji: string;
  familyKana: string;
  givenKana: string;
}

export const emptyJapaneseName: JapaneseNameParts = {
  familyKanji: "",
  givenKanji: "",
  familyKana: "",
  givenKana: "",
};

function representationCode(name: fhir4.HumanName): string | undefined {
  return name.extension?.find((ext) => ext.url === KANA_REPRESENTATION_URL)?.valueCode;
}

// 漢字名を先頭にする。上流は use="official" が無いとき先頭の name を
// 検索用の family/given に採るため、並び順が意味を持つ。
export function buildJapaneseNames(parts: JapaneseNameParts): fhir4.HumanName[] {
  const names: fhir4.HumanName[] = [];

  if (parts.familyKanji || parts.givenKanji) {
    names.push({
      extension: [{ url: KANA_REPRESENTATION_URL, valueCode: KANJI_REPRESENTATION }],
      family: parts.familyKanji || undefined,
      given: parts.givenKanji ? [parts.givenKanji] : undefined,
    });
  }

  if (parts.familyKana || parts.givenKana) {
    names.push({
      extension: [{ url: KANA_REPRESENTATION_URL, valueCode: KANA_REPRESENTATION }],
      family: parts.familyKana || undefined,
      given: parts.givenKana ? [parts.givenKana] : undefined,
    });
  }

  return names;
}

// 表記の指定が無い name(他システム由来)は漢字名として扱う。
export function parseJapaneseNames(names: fhir4.HumanName[] | undefined): JapaneseNameParts {
  const kanjiName = names?.find((n) => representationCode(n) === KANJI_REPRESENTATION);
  const kanaName = names?.find((n) => representationCode(n) === KANA_REPRESENTATION);
  const fallbackName = names?.find((n) => !representationCode(n));

  return {
    familyKanji: kanjiName?.family ?? fallbackName?.family ?? "",
    givenKanji: kanjiName?.given?.[0] ?? fallbackName?.given?.[0] ?? "",
    familyKana: kanaName?.family ?? "",
    givenKana: kanaName?.given?.[0] ?? "",
  };
}

export function displayJapaneseName(names: fhir4.HumanName[] | undefined): string {
  const kanjiName = names?.find((n) => representationCode(n) === KANJI_REPRESENTATION);
  const fallbackName = names?.find((n) => !representationCode(n)) ?? names?.[0];
  const name = kanjiName ?? fallbackName;
  if (!name) return "";
  return [name.family, name.given?.[0]].filter(Boolean).join(" ");
}

export function displayJapaneseKana(names: fhir4.HumanName[] | undefined): string {
  const kanaName = names?.find((n) => representationCode(n) === KANA_REPRESENTATION);
  if (!kanaName) return "";
  return [kanaName.family, kanaName.given?.[0]].filter(Boolean).join(" ");
}
