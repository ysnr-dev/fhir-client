// DICOM の文字列(患者名・施設名・検査内容など)を読める文字にする。
//
// dicom-parser は値をバイト列のまま返すので、Specific Character Set (0008,0005) に
// 従ってこちらで復号する。日本の装置は ISO 2022 のエスケープで JIS X 0208(漢字)と
// JIS X 0201(半角カナ)を切り替える。TextDecoder の iso-2022-jp は 8 ビットの
// 半角カナを扱えないので、エスケープはここで追う。

const ESC = 0x1b;

type G0 = "ascii" | "kanji" | "kanji-supplement" | "katakana";

const eucJp = () => new TextDecoder("euc-jp");

/** JIS X 0201 / 0208 / 0212 を ISO 2022 のエスケープつきで復号する。 */
function decodeJis(bytes: Uint8Array): string {
  const decoder = eucJp();
  let g0: G0 = "ascii";
  let out = "";
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b === ESC) {
      const a = bytes[i + 1];
      const c = bytes[i + 2];
      if (a === 0x24 && c === 0x28 && bytes[i + 3] === 0x44) {
        g0 = "kanji-supplement"; // ESC $ ( D
        i += 4;
      } else if (a === 0x24 && (c === 0x42 || c === 0x40)) {
        g0 = "kanji"; // ESC $ B / ESC $ @
        i += 3;
      } else if (a === 0x28 && c === 0x49) {
        g0 = "katakana"; // ESC ( I
        i += 3;
      } else if (a === 0x28 || a === 0x29) {
        // ESC ( B / ESC ( J は 1 バイト文字へ戻る。ESC ) I は G1 の指定で、G1 は
        // 常に半角カナとして読むので状態は変えない。
        if (a === 0x28) g0 = "ascii";
        i += 3;
      } else {
        i += 1;
      }
      continue;
    }
    if (b >= 0xa1 && b <= 0xdf) {
      out += String.fromCharCode(0xff61 + (b - 0xa1));
      i += 1;
    } else if (g0 === "katakana" && b >= 0x21 && b <= 0x5f) {
      out += String.fromCharCode(0xff61 + (b - 0x21));
      i += 1;
    } else if ((g0 === "kanji" || g0 === "kanji-supplement") && b >= 0x21 && b <= 0x7e) {
      const pair = [b | 0x80, (bytes[i + 1] ?? 0x21) | 0x80];
      out += decoder.decode(new Uint8Array(g0 === "kanji" ? pair : [0x8f, ...pair]));
      i += 2;
    } else {
      out += String.fromCharCode(b);
      i += 1;
    }
  }
  return out;
}

function tryDecode(label: string, bytes: Uint8Array): string | null {
  try {
    return new TextDecoder(label, { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * specificCharacterSet は (0008,0005) の値そのまま(多値は "\" 区切り)。
 * 文字集合の指定が無いのに 8 ビットの文字が入っているファイルは規格外だが実在するので、
 * UTF-8、Shift_JIS の順に当てはまるものを使う。
 */
export function decodeDicomText(bytes: Uint8Array, specificCharacterSet: string): string {
  const charsets = specificCharacterSet.split("\\").map((s) => s.trim().toUpperCase());
  let text: string;
  if (charsets.some((c) => c === "ISO_IR 192")) {
    text = new TextDecoder("utf-8").decode(bytes);
  } else if (charsets.some((c) => c === "GB18030" || c === "GBK")) {
    text = new TextDecoder("gb18030").decode(bytes);
  } else if (charsets.some((c) => c.startsWith("ISO 2022") || c === "ISO_IR 13")) {
    text = decodeJis(bytes);
  } else if (bytes.some((b) => b >= 0x80) && charsets.every((c) => c === "")) {
    text =
      tryDecode("utf-8", bytes) ?? tryDecode("shift_jis", bytes) ?? new TextDecoder("latin1").decode(bytes);
  } else {
    text = new TextDecoder("latin1").decode(bytes);
  }
  // 値は偶数長に揃えるため、末尾に空白か NUL が詰められている。
  return text.replace(/[\0 ]+$/, "");
}

/**
 * 患者名(PN)。「英字=漢字=カナ」の 3 つの書き方を持てるので、漢字、カナ、英字の
 * 順で最初にあるものを出す。姓名の区切り(^)は空白にする。
 */
export function dicomPersonName(value: string): string {
  const [alphabetic = "", ideographic = "", phonetic = ""] = value.split("=");
  const chosen = [ideographic, phonetic, alphabetic].find((group) => group.replace(/\^/g, "").trim());
  return (chosen ?? "").split("^").filter(Boolean).join(" ").trim();
}
