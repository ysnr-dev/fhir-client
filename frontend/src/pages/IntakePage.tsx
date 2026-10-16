import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchIntakeState,
  IntakePublicError,
  submitIntakeResponse,
  verifyIntakeBirthDate,
  type IntakePublicStatus,
} from "../api/intakePublicClient";
import { QuestionnaireResponseForm } from "../components/QuestionnaireResponseForm";
import { questionnaireUrlOf } from "../fhir/nursingProfileHelpers";
import { questionnaireCanonical } from "../fhir/questionnaireResponseHelpers";

// Web 問診の患者画面(docs/web-intake-design.md §3.1)。QR の URL(/q/<token>)で開く。
// AuthGate の外に置き、ログインも患者の個人情報の表示も無い。生年月日の照合 → 質問票を 1 グループ 1 ページで →
// 送信 → 完了。回答の item は組み立てずそのまま backend に送り、職員が取り込むときに QuestionnaireResponse にする。

const INTAKE_KEY = ["intake-public"];

export function IntakePage({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const state = useQuery({
    queryKey: [...INTAKE_KEY, token],
    queryFn: () => fetchIntakeState(token),
    retry: false,
  });
  const [done, setDone] = useState(false);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: [...INTAKE_KEY, token] });

  if (state.isPending) return <IntakeShell>読み込み中...</IntakeShell>;
  if (state.error) {
    const status = state.error instanceof IntakePublicError ? state.error.status : 0;
    return (
      <IntakeShell>
        <p className="intake-page__message">
          {status === 401 ? "この問診のリンクは無効です。受付でお知らせください。" : "問診を開けませんでした。しばらくしてからもう一度お試しください。"}
        </p>
      </IntakeShell>
    );
  }
  const data = state.data;
  if (!data) return null;
  if (data.status === "expired" || data.status === "locked") return <IntakeShell><ClosedMessage status={data.status} /></IntakeShell>;
  if (data.status === "verify") return <VerifyStep token={token} onVerified={invalidate} />;

  const questionnaires = data.questionnaires ?? [];
  // 送信済みはリンクの url(版なし)で見る(患者が開いている間に版が上がっても二重に聞かない)。
  const submitted = new Set(data.submitted_urls.map(questionnaireUrlOf));
  const remaining = questionnaires.filter((q) => !submitted.has(q.url ?? ""));
  if (done || (questionnaires.length > 0 && remaining.length === 0)) {
    return (
      <IntakeShell>
        <p className="intake-page__message">ご回答ありがとうございました。受付でお知らせください。</p>
      </IntakeShell>
    );
  }
  if (questionnaires.length === 0) {
    return <IntakeShell><p className="intake-page__message">答えていただく問診票がありません。受付でお知らせください。</p></IntakeShell>;
  }
  return (
    <QuestionnaireStep
      key={questionnaireCanonical(remaining[0])}
      token={token}
      questionnaire={remaining[0]}
      position={questionnaires.length - remaining.length + 1}
      total={questionnaires.length}
      onSubmitted={() => {
        if (remaining.length <= 1) setDone(true);
        invalidate();
      }}
    />
  );
}

function IntakeShell({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <div className="intake-page">
      <div className="intake-page__card">
        <h1 className="intake-page__title">{title ?? "問診"}</h1>
        {children}
      </div>
    </div>
  );
}

function ClosedMessage({ status }: { status: IntakePublicStatus }) {
  return (
    <p className="intake-page__message">
      {status === "locked"
        ? "生年月日の入力に続けて失敗したため、この問診は閉じました。受付でお知らせください。"
        : "この問診の期限は過ぎました。受付でお知らせください。"}
    </p>
  );
}

function VerifyStep({ token, onVerified }: { token: string; onVerified: () => void }) {
  const [birthDate, setBirthDate] = useState("");
  const verify = useMutation({
    mutationFn: () => verifyIntakeBirthDate(token, birthDate),
    onSuccess: onVerified,
  });
  const error = verify.error instanceof IntakePublicError ? verify.error : null;
  if (error?.state === "locked" || error?.state === "expired") {
    return <IntakeShell><ClosedMessage status={error.state} /></IntakeShell>;
  }
  return (
    <IntakeShell title="ご本人の確認">
      <form
        className="intake-page__form"
        onSubmit={(e) => {
          e.preventDefault();
          if (birthDate) verify.mutate();
        }}
      >
        <label className="intake-page__field">
          <span>生年月日</span>
          <input type="date" value={birthDate} required onChange={(e) => setBirthDate(e.target.value)} />
        </label>
        {error && <p className="intake-page__error">{error.message}</p>}
        <button type="submit" disabled={!birthDate || verify.isPending}>
          次へ
        </button>
      </form>
    </IntakeShell>
  );
}

function QuestionnaireStep({
  token,
  questionnaire,
  position,
  total,
  onSubmitted,
}: {
  token: string;
  questionnaire: fhir4.Questionnaire;
  position: number;
  total: number;
  onSubmitted: () => void;
}) {
  const pages = questionnaire.item ?? [];
  const [page, setPage] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const submit = useMutation({
    mutationFn: (items: fhir4.QuestionnaireResponseItem[]) =>
      submitIntakeResponse(token, {
        questionnaire_url: questionnaireCanonical(questionnaire),
        questionnaire_version: questionnaire.version,
        answers: items,
      }),
    onSuccess: onSubmitted,
  });
  const last = page >= pages.length - 1;

  // ページを送ったら先頭から読めるようにする。
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [page]);

  function next() {
    if (formRef.current && !formRef.current.reportValidity()) return;
    setPage((p) => Math.min(p + 1, pages.length - 1));
  }

  const heading = pages[page]?.text || questionnaire.title || "問診";
  return (
    <IntakeShell title={total > 1 ? `${questionnaire.title ?? "問診"}(${position}/${total})` : (questionnaire.title ?? "問診")}>
      <p className="intake-page__progress">
        {heading}({page + 1}/{pages.length})
      </p>
      <QuestionnaireResponseForm
        questionnaire={questionnaire}
        pageIndex={page}
        hidePickers
        showHeader={false}
        formRef={formRef}
        submitLabel={last ? "送信" : "次へ"}
        submitting={submit.isPending}
        onSubmit={(items) => {
          if (last) submit.mutate(items);
          else next();
        }}
      />
      {submit.error && <p className="intake-page__error">{submit.error.message}</p>}
      {page > 0 && (
        <button type="button" className="intake-page__back" onClick={() => setPage((p) => p - 1)}>
          戻る
        </button>
      )}
    </IntakeShell>
  );
}
