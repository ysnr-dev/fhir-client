// テンプレート(Questionnaire)のカテゴリを表す独自拡張。
//
// カテゴリそのものは FHIR リソースではなく backend の独自マスタ
// (questionnaire_categories / api/adminClient.ts)で、Questionnaire 側には
// その code を書き込む。表示名も一緒に持たせているのは、マスタを引けない
// 環境(別環境へエクスポートしたファイル)でも見出しを出せるようにするため。

/** テンプレートに設定されたカテゴリ。code はマスタの UUID。 */
export interface TemplateCategoryRef {
  code: string;
  display: string;
}

export const TEMPLATE_CATEGORY_EXT_URL =
  "http://fhir-client.local/StructureDefinition/questionnaire-template-category";
export const TEMPLATE_CATEGORY_SYSTEM =
  "http://fhir-client.local/CodeSystem/questionnaire-template-category";

export function templateCategoryExtension(category: TemplateCategoryRef): fhir4.Extension {
  return {
    url: TEMPLATE_CATEGORY_EXT_URL,
    valueCoding: {
      system: TEMPLATE_CATEGORY_SYSTEM,
      code: category.code,
      display: category.display,
    },
  };
}

export function templateCategoryOf(
  questionnaire: fhir4.Questionnaire,
): TemplateCategoryRef | null {
  const coding = questionnaire.extension?.find((e) => e.url === TEMPLATE_CATEGORY_EXT_URL)
    ?.valueCoding;
  if (!coding?.code) return null;
  return { code: coding.code, display: coding.display ?? coding.code };
}

// ---- 選択プルダウン用のグループ化 ----

export interface TemplateCategoryGroup {
  code: string;
  name: string;
  questionnaires: fhir4.Questionnaire[];
}

export interface GroupedTemplates {
  /** テンプレートが1件以上あるカテゴリのみ。マスタの並び順。 */
  groups: TemplateCategoryGroup[];
  /** カテゴリ未設定のテンプレート(プルダウンではカテゴリと同じ層に出す)。 */
  uncategorized: fhir4.Questionnaire[];
}

/**
 * テンプレートをカテゴリ別に振り分ける。
 *
 * マスタに無い code(カテゴリを削除した後や、別環境からインポートした
 * テンプレート)は、拡張に埋まっている表示名でグループを作り、マスタ登録済みの
 * カテゴリの後ろに置く。テンプレート側の設定を勝手に落とさないための扱い。
 */
export function groupTemplatesByCategory(
  questionnaires: fhir4.Questionnaire[],
  categories: { code: string; name: string }[],
): GroupedTemplates {
  const uncategorized: fhir4.Questionnaire[] = [];
  const byCode = new Map<string, TemplateCategoryGroup>();

  for (const questionnaire of questionnaires) {
    const category = templateCategoryOf(questionnaire);
    if (!category) {
      uncategorized.push(questionnaire);
      continue;
    }
    const existing = byCode.get(category.code);
    if (existing) {
      existing.questionnaires.push(questionnaire);
    } else {
      byCode.set(category.code, {
        code: category.code,
        name: category.display,
        questionnaires: [questionnaire],
      });
    }
  }

  const registered: TemplateCategoryGroup[] = [];
  for (const category of categories) {
    const group = byCode.get(category.code);
    if (!group) continue;
    // 表示名はマスタ側を正とする(カテゴリを改名しても引き直さずに済む)。
    registered.push({ ...group, name: category.name });
    byCode.delete(category.code);
  }
  const unregistered = [...byCode.values()].sort((a, b) => a.name.localeCompare(b.name, "ja"));

  return { groups: [...registered, ...unregistered], uncategorized };
}
