import { buildError, masterFetch, type MasterSearchResult } from "./core";

// 口腔診査情報標準コード仕様(JDAOES Ver.1.02)のコード表。固定の標準コード表なので読み取りだけ。
export interface OralExamCode {
  id: number;
  /** TB / TD / TP / TM / TE / TF / NS / KS / KK / SI / SK */
  record: string;
  /** 項目識別名称(TP-11)。 */
  item: string;
  item_name: string | null;
  code: string;
  display: string;
  /** 対応する標準プロファイル 26 項目(TF-8)。 */
  tf_ref: string | null;
  /** コーディングシステム名(JDASTP11)。 */
  cs_name: string | null;
  /** コーディングシステム名の OID。FHIR の system は urn:oid: を付けて使う。 */
  cs_oid: string | null;
  note: string | null;
  display_order: number | null;
}

const ORAL_EXAM_CODES_PATH = "/master/oral_exam_codes";

export async function fetchOralExamCodes(): Promise<MasterSearchResult<OralExamCode>> {
  const res = await masterFetch(`${ORAL_EXAM_CODES_PATH}?per=1000`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<OralExamCode>;
}
