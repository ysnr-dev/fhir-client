import { buildError, masterFetch, type MasterSearchResult } from "./core";

// ---- 祝日・休診日マスタ ----

export type HolidayKind = "national" | "facility";

export interface Holiday {
  id: number;
  /** YYYY-MM-DD */
  holiday_date: string;
  name: string;
  /** national = 国民の祝日(内閣府 CSV の取込で入れ替わる)/ facility = 施設の休診日 */
  kind: HolidayKind;
}

export type HolidayPayload = Pick<Holiday, "holiday_date" | "name" | "kind">;

async function send(url: string, method: string, payload: Partial<HolidayPayload>): Promise<Holiday> {
  const res = await masterFetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as Holiday;
}

export const holidayClient = {
  /** from〜to(両端を含む)の祝日・休診日。1 年ぶんでも 30 件程度なので 1 ページで引き切る。 */
  async search(from: string, to: string): Promise<Holiday[]> {
    const params = new URLSearchParams({ from, to, per: "1000" });
    const res = await masterFetch(`/master/holidays?${params.toString()}`);
    if (!res.ok) throw await buildError(res);
    return ((await res.json()) as MasterSearchResult<Holiday>).items;
  },
  create: (payload: HolidayPayload) => send("/master/holidays", "POST", payload),
  update: (id: number, payload: Partial<HolidayPayload>) => send(`/master/holidays/${id}`, "PATCH", payload),
  async remove(id: number): Promise<void> {
    const res = await masterFetch(`/master/holidays/${id}`, { method: "DELETE" });
    if (!res.ok) throw await buildError(res);
  },
};
