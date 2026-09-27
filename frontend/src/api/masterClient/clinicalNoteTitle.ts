import { buildError, masterFetch, type MasterSearchResult } from "./core";

// ---- 診療記録のタイトル ----
// 選んだときに記載形式(テンプレートなら既定のテンプレート)をフォームへ当て、
// 職種がログイン中の医療従事者と一致するものを新規記録の初期値にする。

export type ClinicalNoteTitleMode = "soap" | "free" | "template";

export interface ClinicalNoteTitle {
  id: number;
  title: string;
  mode: ClinicalNoteTitleMode;
  /** mode = template のときの既定テンプレート(Questionnaire の canonical)。 */
  template_canonical: string | null;
  /** PractitionerRole.code(practitionerRoleHelpers の職種)。null は職種を問わない。 */
  role_code: string | null;
  display_order: number | null;
}

export interface ClinicalNoteTitlePayload {
  title?: string;
  mode?: ClinicalNoteTitleMode;
  template_canonical?: string | null;
  role_code?: string | null;
  display_order?: number | null;
}

const CLINICAL_NOTE_TITLES_PATH = "/master/clinical_note_titles";

export async function fetchClinicalNoteTitles(): Promise<MasterSearchResult<ClinicalNoteTitle>> {
  const res = await masterFetch(`${CLINICAL_NOTE_TITLES_PATH}?per=500`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<ClinicalNoteTitle>;
}

export async function createClinicalNoteTitle(
  payload: ClinicalNoteTitlePayload,
): Promise<ClinicalNoteTitle> {
  const res = await masterFetch(CLINICAL_NOTE_TITLES_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as ClinicalNoteTitle;
}

export async function updateClinicalNoteTitle(
  id: number,
  payload: ClinicalNoteTitlePayload,
): Promise<ClinicalNoteTitle> {
  const res = await masterFetch(`${CLINICAL_NOTE_TITLES_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as ClinicalNoteTitle;
}

export async function deleteClinicalNoteTitle(id: number): Promise<void> {
  const res = await masterFetch(`${CLINICAL_NOTE_TITLES_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}
