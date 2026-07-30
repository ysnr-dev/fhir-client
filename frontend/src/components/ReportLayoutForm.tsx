import { useState } from "react";
import type { ReportLayoutPayload, ReportLayoutSummary } from "../api/adminClient";
import { useCreateReportLayout, useUpdateReportLayout } from "../api/adminQueries";
import { useQuestionnaireOptions } from "../api/queries";
import { questionnaireCanonical } from "../fhir/questionnaireResponseHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { ReportPlaceholderList } from "./ReportPlaceholderList";

interface Props {
  /** 渡されたら編集(差し替え)、無ければ新規登録。 */
  layout?: ReportLayoutSummary;
  onSaved: () => void;
  onCancel: () => void;
}

// ThinReports Basic Editor で作成した .tlf をアップロードして
// Questionnaire の canonical(url|version)に紐付けるフォーム。
export function ReportLayoutForm({ layout, onSaved, onCancel }: Props) {
  const [name, setName] = useState(layout?.name ?? "");
  const [url, setUrl] = useState(layout?.questionnaire_url ?? "");
  const [version, setVersion] = useState(layout?.questionnaire_version ?? "");
  const [tlf, setTlf] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  const { questionnaires } = useQuestionnaireOptions();
  const create = useCreateReportLayout();
  const update = useUpdateReportLayout();
  const saving = create.isPending || update.isPending;

  // 入力中の canonical に一致するテンプレート(プレースホルダー一覧の表示にも使う)。
  const selectedQuestionnaire = questionnaires.find(
    (q) => questionnaireCanonical(q) === canonicalOf(url.trim(), version.trim()),
  );

  // テンプレート選択は url/version の入力補助。上流に接続できない環境でも
  // 登録できるよう、直接入力も許す。
  function handleQuestionnaireSelect(id: string) {
    const questionnaire = questionnaires.find((q) => q.id === id);
    if (!questionnaire) return;
    setUrl(questionnaire.url ?? "");
    setVersion(questionnaire.version ?? "");
    if (!name) setName(questionnaire.title ?? questionnaire.name ?? "");
  }

  async function handleFile(file: File | undefined) {
    setValidationError(null);
    if (!file) return;
    const text = await file.text();
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed !== "object" || parsed === null || !("items" in parsed)) {
        throw new Error();
      }
    } catch {
      setValidationError(
        "ThinReports のレイアウトファイル(.tlf)ではありません。Basic Editor で保存したファイルを選択してください。",
      );
      setTlf(null);
      setFileName("");
      return;
    }
    setTlf(text);
    setFileName(file.name);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setValidationError(null);

    if (!name.trim()) return setValidationError("名称を入力してください。");
    if (!url.trim()) return setValidationError("テンプレートを選択するか URL を入力してください。");
    if (!layout && !tlf) return setValidationError("レイアウトファイル(.tlf)を選択してください。");

    const payload: Partial<ReportLayoutPayload> = {
      name: name.trim(),
      questionnaire_url: url.trim(),
      questionnaire_version: version.trim(),
    };
    if (tlf) payload.tlf = tlf;

    try {
      if (layout) {
        await update.mutateAsync({ id: layout.id, payload });
      } else {
        await create.mutateAsync(payload as ReportLayoutPayload);
      }
      onSaved();
    } catch {
      // エラーは mutation の error として ErrorBanner に表示される
    }
  }

  return (
    <form className="patient-form report-layout-form" onSubmit={handleSubmit}>
      <fieldset disabled={saving}>
        <legend>{layout ? "帳票レイアウトの編集" : "帳票レイアウトの登録"}</legend>

        <label>
          対象テンプレート
          <select
            value={selectedQuestionnaire?.id ?? ""}
            onChange={(e) => handleQuestionnaireSelect(e.target.value)}
          >
            <option value="">選択してください</option>
            {questionnaires.map((q) => (
              <option key={q.id} value={q.id}>
                {q.title ?? q.name ?? q.id}({questionnaireCanonical(q)})
              </option>
            ))}
          </select>
        </label>

        {selectedQuestionnaire && <ReportPlaceholderList questionnaire={selectedQuestionnaire} />}

        <label>
          テンプレート URL
          <input type="text" value={url} onChange={(e) => setUrl(e.target.value)} />
        </label>

        <label>
          バージョン
          <input type="text" value={version} onChange={(e) => setVersion(e.target.value)} />
        </label>

        <label>
          名称
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </label>

        <label>
          レイアウトファイル(.tlf)
          <input
            type="file"
            accept=".tlf,application/json"
            onChange={(e) => void handleFile(e.target.files?.[0])}
          />
        </label>
        {fileName && <p className="report-layout-form__file">選択中: {fileName}</p>}
        {layout && !tlf && (
          <p className="report-layout-form__file">
            ファイルを選択しない場合、レイアウト本体は変更されません。
          </p>
        )}

        {validationError && <p className="error-banner">{validationError}</p>}
        <ErrorBanner error={create.error} />
        <ErrorBanner error={update.error} />

        <div className="patient-form__actions">
          <button type="submit">{saving ? "保存中..." : "保存"}</button>
          <button type="button" onClick={onCancel}>
            キャンセル
          </button>
        </div>
      </fieldset>
    </form>
  );
}

function canonicalOf(url: string, version: string): string {
  return version ? `${url}|${version}` : url;
}
