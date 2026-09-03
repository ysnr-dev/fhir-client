import { toFhirDateTime } from "../lib/dates";
import {
  MEAL_ORDER_TYPE,
  MEAL_SKIPPED,
  MEAL_TIMING_OPTIONS,
  mealOrderAt,
  mealOrderDietName,
  mealOrderDietRef,
  mealPointKey,
  mealStapleChoiceText,
  mealTimingDisplay,
  parseMealStaples,
  type MealTiming,
} from "./mealOrderHelpers";
import { NURSING_OBSERVATION_CODE_SYSTEM } from "./nursingOrderHelpers";
import { ORDER_TYPE_SYSTEM } from "./prescriptionHelpers";
import { codingBySystem } from "./shared";

// 経過表の食事摂取量。
//
// 記録は **1 食 × 主食/副食 = Observation 2 件**。看護観察と同じ MEDIS の観察マスタから
// 「食事摂取量（主食）/（副食）」の**％の項目**を使う(同名で g・5 段階の項目もあるが、
// 温度板は割合で読むもの)。
//
// `basedOn` はその食事を出している**食事オーダー**。食事オーダーは継続オーダー
// (開始した食事から終了まで毎日 3 食)なので、日と食事から担当オーダーを引く
// (`mealOrderAt`)。看護指示のように「摂取量の指示」を別に立てさせない。
//
// `effectiveDateTime` は食事オーダーと同じ **08/12/18 の時刻**を焼く(SS-MIX2 の
// ODS-2 と同じ規約)。これで「どの食事か」を時刻が持つので拡張は足さず、24 時間表示でも
// その時間の枠に落ちる。
//
// 入力は **0〜10 割の 11 段階**で、保存は％に直す(8 割 → 80%)。列幅 64px に朝昼夕の
// 3 つを並べるので、100 という 3 桁は入らない。

/** 食事摂取量（主食）％。MEDIS 看護観察マスタの管理番号。 */
export const MEAL_INTAKE_STAPLE_MANAGE_NO = "31003419";
/** 食事摂取量（副食）％。 */
export const MEAL_INTAKE_SIDE_MANAGE_NO = "31003420";

export type MealIntakeKind = "staple" | "side";

export const MEAL_INTAKE_ROWS: { kind: MealIntakeKind; manageNo: string; label: string }[] = [
  { kind: "staple", manageNo: MEAL_INTAKE_STAPLE_MANAGE_NO, label: "主食" },
  { kind: "side", manageNo: MEAL_INTAKE_SIDE_MANAGE_NO, label: "副食" },
];

/** 摂取量を記録する 1 食。 */
export interface MealIntakeSlot {
  /** その食事の日時(オーダーと同じ 08/12/18)。印の位置と Observation の日時になる。 */
  at: string;
  date: string;
  timing: MealTiming;
  /** その食事を出しているオーダー。 */
  orderId: string;
  dietName: string;
  /** 主食の指定(「米飯180g」)。無ければ空。 */
  stapleName: string;
}

/** 1 食ぶんの記録。 */
export interface MealIntakeCell {
  slot: MealIntakeSlot;
  /** 記録済みの割合(％)。未記録は undefined。 */
  percent?: number;
  /** 記録済みの Observation。直すときに上書きする。 */
  observationId?: string;
}

export interface MealIntakeRow {
  kind: MealIntakeKind;
  label: string;
  cells: MealIntakeCell[];
}

/** 経過表に出す食事の枠と記録。オーダーの無い日・欠食・食止めの食事は枠を出さない。 */
export function buildMealIntakeRows(args: {
  /** 期間にかかる食事オーダー。 */
  orders: fhir4.ServiceRequest[];
  /** 摂取量の Observation(期間ぶん)。 */
  observations: fhir4.Observation[];
  /** 表示している日。 */
  days: string[];
  /** 食止めの食種コード。この食種のオーダーは 1 食も出ないので枠を作らない。 */
  fastingDietCodes: Set<string>;
}): MealIntakeRow[] {
  const slots: MealIntakeSlot[] = [];
  for (const date of args.days) {
    for (const timing of MEAL_TIMING_OPTIONS) {
      const order = mealOrderAt(args.orders, date, timing.code);
      if (!order?.id) continue;
      const dietCode = mealOrderDietRef(order)?.code ?? "";
      if (dietCode && args.fastingDietCodes.has(dietCode)) continue;
      // 欠食(その食事だけ出さない)は主食の指定の側に入っている。
      const staples = parseMealStaples(order);
      if (staples[timing.code] === MEAL_SKIPPED) continue;
      slots.push({
        at: mealPointKey(date, timing.code),
        date,
        timing: timing.code,
        orderId: order.id,
        dietName: mealOrderDietName(order),
        stapleName:
          staples[timing.code] === null ? "" : mealStapleChoiceText(staples[timing.code]),
      });
    }
  }

  // 記録は「食事の日時 + 項目」で引く。同じ食事に 2 件あれば後の 1 件を採る
  // (直しは上書きなので普通は 1 件。データが乱れていても表は 1 つの値で読む)。
  const byKey = new Map<string, fhir4.Observation>();
  for (const observation of args.observations) {
    if (observation.status === "entered-in-error") continue;
    const manageNo = codingBySystem(
      observation.code?.coding,
      NURSING_OBSERVATION_CODE_SYSTEM,
    )?.code;
    const at = observation.effectiveDateTime ?? "";
    if (!manageNo || !at) continue;
    byKey.set(`${at.slice(0, 16)}/${manageNo}`, observation);
  }

  return MEAL_INTAKE_ROWS.map((row) => ({
    kind: row.kind,
    label: row.label,
    cells: slots.map((slot) => {
      const observation = byKey.get(`${slot.at}/${row.manageNo}`);
      const percent = observation?.valueQuantity?.value;
      return {
        slot,
        ...(typeof percent === "number" ? { percent } : {}),
        ...(observation?.id ? { observationId: observation.id } : {}),
      };
    }),
  }));
}

/** 割の表示。8 割は「8」、85% のような端数は「8.5」。未記録は空。 */
export function mealIntakeLabel(percent: number | undefined): string {
  if (percent === undefined) return "";
  const bu = Math.round((percent / 10) * 10) / 10;
  return `${bu}`;
}

/** 「8/28 朝 一般食2000kcal 米飯180g」。印のホバーと入力の見出しに使う。 */
export function mealIntakeSlotLabel(slot: MealIntakeSlot): string {
  const [, month, day] = slot.date.split("-");
  const md = month && day ? `${Number(month)}/${Number(day)}` : slot.date;
  return [`${md} ${mealTimingDisplay(slot.timing)}`, slot.dietName, slot.stapleName]
    .filter(Boolean)
    .join(" ");
}

/** 入力の値。0〜10 割、空文字は「記録しない」。 */
export type MealIntakeInput = Record<MealIntakeKind, string>;

export const MEAL_INTAKE_STEPS = Array.from({ length: 11 }, (_, i) => String(i));

/** 1 食ぶんを 1 transaction で保存する。値を空にした項目は、記録があれば消す。 */
export function buildMealIntakeBundle(args: {
  slot: MealIntakeSlot;
  input: MealIntakeInput;
  /** その食事の既存の記録(項目ごと)。 */
  existing: Partial<Record<MealIntakeKind, string>>;
  subject: fhir4.Reference;
  encounter?: fhir4.Reference;
  performer: { id: string; name: string } | null;
}): fhir4.Bundle {
  const entry: fhir4.BundleEntry[] = [];
  const effectiveDateTime = toFhirDateTime(args.slot.at);

  for (const row of MEAL_INTAKE_ROWS) {
    const raw = args.input[row.kind].trim();
    const existingId = args.existing[row.kind];
    if (raw === "") {
      // 記録を消す(食べていない食事に 0 を入れるのとは別。0 割は「摂取なし」)。
      if (existingId) {
        entry.push({ request: { method: "DELETE", url: `Observation/${existingId}` } });
      }
      continue;
    }
    const percent = Number(raw) * 10;
    if (!Number.isFinite(percent)) continue;

    const observation: fhir4.Observation = {
      resourceType: "Observation",
      ...(existingId ? { id: existingId } : {}),
      status: "final",
      // 上流は先頭の category しか索引しないので、これ以外は付けない。
      category: [{ coding: [{ system: ORDER_TYPE_SYSTEM, ...MEAL_ORDER_TYPE }] }],
      code: {
        coding: [
          {
            system: NURSING_OBSERVATION_CODE_SYSTEM,
            code: row.manageNo,
            display: `食事摂取量（${row.label}）`,
          },
        ],
        text: `食事摂取量（${row.label}）`,
      },
      subject: args.subject,
      ...(args.encounter ? { encounter: args.encounter } : {}),
      basedOn: [{ reference: `ServiceRequest/${args.slot.orderId}` }],
      effectiveDateTime,
      valueQuantity: { value: percent, unit: "%", system: "http://unitsofmeasure.org", code: "%" },
    };
    if (args.performer?.id) {
      observation.performer = [
        {
          reference: `Practitioner/${args.performer.id}`,
          ...(args.performer.name ? { display: args.performer.name } : {}),
        },
      ];
    }

    entry.push(
      existingId
        ? { resource: observation, request: { method: "PUT", url: `Observation/${existingId}` } }
        : { resource: observation, request: { method: "POST", url: "Observation" } },
    );
  }

  return { resourceType: "Bundle", type: "transaction", entry };
}
