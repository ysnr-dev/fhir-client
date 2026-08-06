import type { Medicine } from "../api/masterClient";
import type { MedicineUsageFilters } from "../api/masterQueries";
import type { InjectionUsageType } from "./injectionHelpers";

// 医薬品マスタから用法のプリセット（フォームの初期値）を導出する。いずれも確定マッチでは
// ないため、常にユーザーが変更・解除できる前提で使うこと。
//   - presetUsageFilters:        用法検索モーダルの初期フィルタ（内服・外用を含む全剤形）
//   - presetInjectionUsageType:  注射の用法種別（点滴 / ワンショット）
//
// 薬価基準収載医薬品コードの剤形英字（8桁目）と用法マスタ区分の対応の詳細は
// tmp/yakka_dosage_form_usage_mapping.md を参照。

type Preset = Pick<MedicineUsageFilters, "basicUsageCategory" | "detailedUsageCategory">;

// 名称キーワード層: 剤形区分・8桁目だけでは判別できない例外を吸収する。
// 優先順位が重要（例: 「腟」は「坐剤」より先に判定する）。
function presetFromName(name: string): Preset | undefined {
  if (/気管注入/.test(name)) return { basicUsageCategory: "注入", detailedUsageCategory: "気管内注入" };
  if (/膀胱内注入/.test(name)) return { basicUsageCategory: "外用", detailedUsageCategory: "膀胱注入" };
  if (/膀胱洗浄/.test(name)) return { basicUsageCategory: "外用", detailedUsageCategory: "膀胱洗浄" };
  if (/注腸/.test(name)) return { basicUsageCategory: "外用", detailedUsageCategory: "肛門注入" };
  if (/腟|膣/.test(name)) return { basicUsageCategory: "外用", detailedUsageCategory: "膣内挿入" };
  if (/浣腸/.test(name)) return { basicUsageCategory: "外用", detailedUsageCategory: "浣腸" };
  if (/坐剤|坐薬/.test(name)) return { basicUsageCategory: "外用", detailedUsageCategory: "肛門挿入" };
  if (/口腔用液/.test(name)) return { basicUsageCategory: "内服", detailedUsageCategory: "バッカル" };
  if (/舌下/.test(name)) return { basicUsageCategory: "内服", detailedUsageCategory: "舌下" };
  if (/バッカル/.test(name)) return { basicUsageCategory: "内服", detailedUsageCategory: "バッカル" };
  if (/点眼|眼軟膏|眼検査/.test(name)) return { basicUsageCategory: "外用", detailedUsageCategory: "点眼" };
  // 「眼耳鼻科用液」等の表記ゆれ（眼科耳鼻科用液・眼科耳科用液 等）は点眼扱いにまとめる
  if (name.includes("眼") && /科用/.test(name)) {
    return { basicUsageCategory: "外用", detailedUsageCategory: "点眼" };
  }
  if (/耳科用|点耳/.test(name)) return { basicUsageCategory: "外用", detailedUsageCategory: "点耳" };
  if (/点鼻|鼻科用/.test(name)) return { basicUsageCategory: "外用", detailedUsageCategory: "点鼻" };
  if (/含嗽|うがい|ガーグル/.test(name)) return { basicUsageCategory: "外用", detailedUsageCategory: "うがい" };
  if (/パップ/.test(name)) return { basicUsageCategory: "外用", detailedUsageCategory: "湿布" };
  if (/フォーム/.test(name)) return { basicUsageCategory: "外用", detailedUsageCategory: "塗布" };
  if (/テープ|パッチ|貼付|ＴＴＳ/.test(name)) return { basicUsageCategory: "外用", detailedUsageCategory: "貼付" };
  if (/吸入|ディスカス|エリプタ|タービュヘイラー|レスピマット|スイングヘラー|ロタディスク/.test(name)) {
    return { basicUsageCategory: "外用", detailedUsageCategory: "吸入" };
  }
  if (/トローチ/.test(name)) return { basicUsageCategory: "外用", detailedUsageCategory: "トローチ" };
  return undefined;
}

function basicCategoryFromDosageForm(dosageForm: string | null): string | undefined {
  switch (dosageForm) {
    case "1":
      return "内服";
    case "4":
      return "注射";
    case "6":
    case "8":
      return "外用";
    default:
      return undefined;
  }
}

function presetForInternal(letter: string, classCode: string): Preset {
  if (letter === "K") {
    return classCode.startsWith("217")
      ? { basicUsageCategory: "内服", detailedUsageCategory: "舌下" }
      : { basicUsageCategory: "内服", detailedUsageCategory: "バッカル" };
  }
  return { basicUsageCategory: "内服", detailedUsageCategory: "経口" };
}

function presetForInjection(letter: string): Preset {
  if (letter === "E") return { basicUsageCategory: "注射", detailedUsageCategory: "筋肉内注射" };
  if (letter === "F") return { basicUsageCategory: "注射", detailedUsageCategory: "静脈注射" };
  return { basicUsageCategory: "注射" };
}

function presetForExternalQ(classCode: string): Preset {
  if (classCode === "131") return { basicUsageCategory: "外用", detailedUsageCategory: "点眼" };
  if (classCode === "132") return { basicUsageCategory: "外用", detailedUsageCategory: "点鼻" };
  if (classCode === "261") return { basicUsageCategory: "外用", detailedUsageCategory: "消毒" };
  return { basicUsageCategory: "外用", detailedUsageCategory: "塗布" };
}

function presetForExternal(letter: string, classCode: string): Preset {
  switch (letter) {
    case "A":
      return classCode.startsWith("132")
        ? { basicUsageCategory: "外用", detailedUsageCategory: "点鼻" }
        : { basicUsageCategory: "外用", detailedUsageCategory: "噴霧" };
    case "B":
    case "C":
    case "F":
      return { basicUsageCategory: "外用", detailedUsageCategory: "うがい" };
    case "D":
      return { basicUsageCategory: "内服", detailedUsageCategory: "口腔内塗布" };
    case "E":
      return { basicUsageCategory: "外用", detailedUsageCategory: "トローチ" };
    case "G":
      return { basicUsageCategory: "外用", detailedUsageCategory: "吸入" };
    case "H":
      return { basicUsageCategory: "外用", detailedUsageCategory: "膣内挿入" };
    case "J":
      return { basicUsageCategory: "外用", detailedUsageCategory: "肛門挿入" };
    case "K":
      return { basicUsageCategory: "外用", detailedUsageCategory: "浣腸" };
    case "L":
    case "M":
    case "N":
    case "P":
    case "V":
      return { basicUsageCategory: "外用", detailedUsageCategory: "塗布" };
    case "Q":
      return presetForExternalQ(classCode);
    case "R":
      return { basicUsageCategory: "外用", detailedUsageCategory: "噴霧" };
    case "S":
    case "T":
    case "U":
      return { basicUsageCategory: "外用", detailedUsageCategory: "貼付" };
    case "X":
      return classCode === "261"
        ? { basicUsageCategory: "外用", detailedUsageCategory: "消毒" }
        : { basicUsageCategory: "外用", detailedUsageCategory: "塗布" };
    default:
      return { basicUsageCategory: "外用" };
  }
}

function presetForDental(letter: string): Preset {
  if (letter === "B") return { basicUsageCategory: "外用", detailedUsageCategory: "うがい" };
  return { basicUsageCategory: "外用" };
}

function presetFromDosageForm(dosageForm: string | null, yakkaCode: string | null): Preset {
  if (!yakkaCode || yakkaCode.length < 8) {
    return { basicUsageCategory: basicCategoryFromDosageForm(dosageForm) };
  }

  const letter = yakkaCode[7];
  const classCode = yakkaCode.slice(0, 3);

  switch (dosageForm) {
    case "1":
      return presetForInternal(letter, classCode);
    case "4":
      return presetForInjection(letter);
    case "6":
      return presetForExternal(letter, classCode);
    case "8":
      return presetForDental(letter);
    default:
      return {};
  }
}

// 選択された医薬品から用法検索モーダルの初期フィルタ（プリセット）を導出する。
// 確定マッチではないため、常にユーザーが変更・解除できる前提で使うこと。
export function presetUsageFilters(medicine: Medicine | null | undefined): MedicineUsageFilters {
  if (!medicine) return {};

  const byName = presetFromName(medicine.name);
  if (byName) return byName;

  return presetFromDosageForm(medicine.dosage_form, medicine.yakka_code);
}

// ---- 注射の用法種別（点滴 / ワンショット）----
//
// 点滴かワンショットかは本来「どう投与するか」というオーダーの指示であって医薬品の属性では
// ないため、マスタから確定させることはできない。ただし包装（薬価算定単位）は強い手がかりに
// なる。医薬品マスタの注射薬 4176 件での確認:
//   - 管(アンプル) 1043 件のうち注射容量 100mL 以上は 0 件。名称に「点滴」を含むのも 5%
//   - 筒(シリンジ) 528 件で名称に「点滴」を含むのは 0.6%
//   - 袋(バッグ) 583 件は 95% が 100mL 以上
//   - 瓶 1602 件は粉末バイアルと輸液ボトルが同居するので、注射容量で分ける必要がある
// 決められないもの（主にバイアル。全体の約 1/4）は空を返してユーザーに選ばせる。

/** 「瓶」を輸液ボトル（点滴）とみなす注射容量の下限(mL)。 */
const BOTTLE_ML = 100;

// 薬価マスタの注射容量(mL)。アンプル・粉末製剤は "0" が入っている（未設定と区別できない）。
function injectionVolume(medicine: Medicine): number {
  return Number(medicine.injection_volume ?? "") || 0;
}

/** 医薬品 1 件の用法種別。両方ありうる（バイアル等）場合と判別できない場合は空。 */
export function injectionUsageTypeOf(medicine: Medicine): InjectionUsageType | "" {
  const unit = medicine.unit_name ?? "";
  // 「点滴静注用」等。粉末バイアルでも点滴専用と分かるので包装より優先する。
  if (medicine.name.includes("点滴")) return "drip";
  // 筋注のプレフィルドシリンジがキット単位で登録されている（ゼプリオン水懸筋注シリンジ等）。
  const syringeKit = unit === "キット" && medicine.name.includes("シリンジ");
  if (unit === "袋") return "drip";
  if (unit === "キット" && !syringeKit) return "drip";
  if (unit === "瓶") return injectionVolume(medicine) >= BOTTLE_ML ? "drip" : "";
  if (unit === "管" || unit === "筒" || syringeKit) return "one-shot";
  return "";
}

/**
 * RP（混注のまとまり）の用法種別。混注は「輸液 + アンプル数本」の構成になるので、
 * 点滴の薬剤が 1 つでもあれば点滴とする。全部ワンショットならワンショット、
 * 決まらなければ空（ユーザーが選ぶ）。
 */
export function presetInjectionUsageType(
  medicines: (Medicine | null)[],
): InjectionUsageType | "" {
  const types = medicines.filter((m): m is Medicine => Boolean(m)).map(injectionUsageTypeOf);
  if (types.includes("drip")) return "drip";
  if (types.length > 0 && types.every((t) => t === "one-shot")) return "one-shot";
  return "";
}
