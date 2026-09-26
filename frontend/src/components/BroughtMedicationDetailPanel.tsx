import { dateTimeLabel } from "../lib/dates";
import {
  BROUGHT_STATE_LABELS,
  broughtDoseLabel,
  broughtStockLabel,
  substitutionLabel,
  summarizeBroughtMedication,
} from "../fhir/broughtMedicationHelpers";
import { JsonBlock } from "./JsonBlock";

// 持参薬 1 剤の内容。聞き取り・鑑別・判断の 3 段に分けて出す。操作は呼び出し側(タブ)が持つ。

export function BroughtMedicationDetailPanel({
  statement,
  onOpenPrescription,
}: {
  statement: fhir4.MedicationStatement;
  onOpenPrescription?: (srId: string) => void;
}) {
  const summary = summarizeBroughtMedication(statement);

  return (
    <div className="prescription-detail">
      <fieldset>
        <legend>聞き取り</legend>
        <dl className="prescription-detail__common">
          <dt>状態</dt>
          <dd>{BROUGHT_STATE_LABELS[summary.state]}</dd>
          <dt>薬剤</dt>
          <dd>{summary.name || "-"}</dd>
          {summary.reportedName && (
            <>
              <dt>登録時の名前</dt>
              <dd>{summary.reportedName}</dd>
            </>
          )}
          <dt>用法</dt>
          <dd>{summary.usageName || "-"}</dd>
          <dt>1 回量</dt>
          <dd>{broughtDoseLabel(summary) || "-"}</dd>
          <dt>持参数・残日数</dt>
          <dd>{broughtStockLabel(summary) || "-"}</dd>
          <dt>情報源</dt>
          <dd>{summary.source || "-"}</dd>
          <dt>処方元</dt>
          <dd>{summary.prescriber || "-"}</dd>
          <dt>最終服用日時</dt>
          <dd>{summary.lastTakenAt ? dateTimeLabel(summary.lastTakenAt) : "-"}</dd>
          <dt>登録</dt>
          <dd>
            {[summary.assertedAt ? dateTimeLabel(summary.assertedAt) : "", summary.registeredBy]
              .filter(Boolean)
              .join(" ") || "-"}
          </dd>
          <dt>コメント</dt>
          <dd>{summary.comment || "-"}</dd>
        </dl>
      </fieldset>

      <fieldset>
        <legend>鑑別</legend>
        {summary.identifiedAt ? (
          <dl className="prescription-detail__common">
            <dt>院内での扱い</dt>
            <dd>{substitutionLabel(summary.substitution) || "-"}</dd>
            {summary.substitute && (
              <>
                <dt>代替薬</dt>
                <dd>{summary.substitute.name}</dd>
              </>
            )}
            <dt>鑑別日時</dt>
            <dd>
              {[dateTimeLabel(summary.identifiedAt), summary.identifiedBy].filter(Boolean).join(" ")}
            </dd>
            <dt>コメント</dt>
            <dd>{summary.identificationComment || "-"}</dd>
          </dl>
        ) : (
          <p>未鑑別</p>
        )}
      </fieldset>

      <fieldset>
        <legend>判断</legend>
        {summary.decidedAt ? (
          <dl className="prescription-detail__common">
            <dt>判断</dt>
            <dd>{BROUGHT_STATE_LABELS[summary.state]}</dd>
            <dt>理由</dt>
            <dd>{summary.decisionReason || "-"}</dd>
            <dt>判断日時</dt>
            <dd>
              {[dateTimeLabel(summary.decidedAt), summary.decidedBy].filter(Boolean).join(" ")}
            </dd>
            {summary.convertedOrderId && (
              <>
                <dt>院内処方</dt>
                <dd>
                  {onOpenPrescription ? (
                    <button
                      type="button"
                      onClick={() => onOpenPrescription(summary.convertedOrderId as string)}
                    >
                      処方を開く
                    </button>
                  ) : (
                    summary.convertedOrderId
                  )}
                </dd>
              </>
            )}
          </dl>
        ) : (
          <p>未判断</p>
        )}
      </fieldset>

      <details className="prescription-detail__raw">
        <summary>FHIR JSON を表示</summary>
        <JsonBlock value={statement} />
      </details>
    </div>
  );
}
