import { buildError, masterFetch, type MasterSearchResult } from "./core";
import { appendDrilldown, type JlacItemDrilldown } from "./medicine";

export interface JlacItem {
  id: number;
  category_name: string | null;
  // 分析物レベルのまとめ(例: 総蛋白(TP))。同じ大項目が材料・測定法違いで
  // 多数の行に分かれるため、選択モーダルの段階的絞り込みの起点になる。
  major_item: string | null;
  fhir_item_name: string | null;
  abbreviation: string | null;
  jlac11_specimen: string | null;
  jlac11_method: string | null;
  jlac11_code: string;
  // JLAC10 でオーダーされた検査項目からマスタを引き当てるために使う。
  jlac10_code: string | null;
  display_unit: string | null;
  xml_unit: string | null;
  // PQ:数値型、CD:大小順序のないコード型、CO:大小順序のあるコード型、ST:文字列型
  data_type: string | null;
  // コード型の選択肢。「1：陽性、2：陰性」のような 区切り文字列
  code_value_list: string | null;
  // コード型の値の CodeSystem URL
  code_oid: string | null;
}

export async function searchJlacItems(
  params: JlacItemDrilldown & {
    name?: string;
    // JLAC コードはどちらもカンマ区切りで複数指定できる。
    jlac11_code?: string;
    jlac10_code?: string;
    page?: number;
    per?: number;
  },
): Promise<MasterSearchResult<JlacItem>> {
  const search = new URLSearchParams();
  if (params.name) search.set("name", params.name);
  if (params.jlac11_code) search.set("jlac11_code", params.jlac11_code);
  if (params.jlac10_code) search.set("jlac10_code", params.jlac10_code);
  appendDrilldown(search, params);
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`/master/jlac_items?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<JlacItem>;
}

// 段階的絞り込みの4リストぶんの選択肢。上位の選択で絞り込まれた値が返る
// (区分名称だけは絞り込みに関係なく全件)。
export interface JlacItemFilterOptions {
  category_names: string[];
  major_items: string[];
  specimens: string[];
  methods: string[];
}

export async function fetchJlacItemFilterOptions(
  params: JlacItemDrilldown & { name?: string },
): Promise<JlacItemFilterOptions> {
  const search = new URLSearchParams();
  if (params.name) search.set("name", params.name);
  appendDrilldown(search, params);

  const res = await masterFetch(`/master/jlac_items/filter_options?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as JlacItemFilterOptions;
}
