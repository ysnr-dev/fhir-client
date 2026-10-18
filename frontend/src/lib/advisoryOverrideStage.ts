import type { AdvisoryOverride } from "../fhir/advisoryHelpers";

// 無視した警告を、フォームから登録の Bundle へ渡すための受け渡し場所(docs/advisory-design.md §2.8)。
// フォームは `onSubmit(values)` しか呼ばず、Bundle の組み立てと来歴(useWithOrderProvenance)は
// 親にあるので、登録の直前にここへ置き、来歴を足すときに取り出す。取り出すと消える。

let staged: AdvisoryOverride[] | null = null;

export function stageAdvisoryOverrides(overrides: AdvisoryOverride[]) {
  staged = overrides.length > 0 ? overrides : null;
}

/** 置かれていれば取り出して消す。無ければ null。 */
export function takeStagedAdvisoryOverrides(): AdvisoryOverride[] | null {
  const value = staged;
  staged = null;
  return value;
}

export function clearStagedAdvisoryOverrides() {
  staged = null;
}
