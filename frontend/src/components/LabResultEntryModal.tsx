import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useCreateLabResult, type LabWorklistRow } from "../api/queries";
import { labOrderItems, labOrderLabel, summarizeLabOrder } from "../fhir/labOrderHelpers";
import {
  emptyLabResultForm,
  type LabResultFormValues,
  type LabResultSetting,
} from "../fhir/labResultHelpers";
import { departmentOf } from "../fhir/prescriptionHelpers";
import { useLabOrderResultLines } from "../hooks/useLabOrderResultLines";
import { ErrorBanner } from "./ErrorBanner";
import { LabResultForm } from "./LabResultForm";
import { Modal } from "./Modal";

// 検体検査一覧の「結果登録」。検体が着いた(到着済)オーダーの結果を、一覧から
// そのまま入力する画面。入力欄はカルテの検査結果タブと同じ LabResultForm で、
// 違いは紐付け先のオーダーが決まっていること:
//
// - オーダーは行から決まるので選ばせない(プルダウンではなく固定表示)
// - オーダーの検査項目は開いた時点で結果の行に展開しておく(カルテでは
//   オーダーを選び直した時に展開する。ここは選び直しが無いので初期値に入れる)
// - 入外区分・診療科・検体採取日もオーダーから引き継ぐ
//
// 展開できなかった項目(オーダー項目に JLAC コードが無いなど)は、カルテと同じく
// 名前を挙げて手入力を促す。

// 展開できなかった項目を並べる上限(残りは「他N件」)。
const NOTICE_NAME_COUNT = 5;

function unmatchedNotice(names: string[]): string | null {
  if (names.length === 0) return null;
  const shown = names.slice(0, NOTICE_NAME_COUNT).join("、");
  const rest = names.length > NOTICE_NAME_COUNT ? ` 他${names.length - NOTICE_NAME_COUNT}件` : "";
  return `JLACコードから検査項目マスタを引けなかったため、次の項目は展開していません: ${shown}${rest}`;
}

export function LabResultEntryModal({
  row,
  onClose,
}: {
  row: LabWorklistRow;
  onClose: () => void;
}) {
  const { order, patient } = row;
  const orderId = order.id ?? "";
  const queryClient = useQueryClient();
  const createLabResult = useCreateLabResult();
  const expansion = useLabOrderResultLines(orderId);

  const orderLabel = useMemo(
    () => labOrderLabel(order, labOrderItems(order, row.itemRequests)),
    [order, row.itemRequests],
  );

  const initialValues = useMemo((): LabResultFormValues => {
    const summary = summarizeLabOrder(order);
    return {
      ...emptyLabResultForm(),
      setting: (summary.settingCode || "outpatient") as LabResultSetting,
      // 検体を採る日として出したオーダーなので、検査日をそのまま採取日にする。
      specimenDate: order.authoredOn?.slice(0, 10) || emptyLabResultForm().specimenDate,
      ...departmentOf(order),
      orderId,
      lines: expansion.lines.length > 0 ? expansion.lines : emptyLabResultForm().lines,
    };
  }, [order, orderId, expansion.lines]);

  function handleSubmit(values: LabResultFormValues) {
    if (!patient?.id) return;
    createLabResult.mutate(
      { values, patientId: patient.id },
      {
        onSuccess: () => {
          // 結果が付いた行の「結果登録」を閉じる(一覧は結果の有無も読んでいる)。
          queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "lab-worklist"] });
          onClose();
        },
      },
    );
  }

  const notice = unmatchedNotice(expansion.unmatchedNames);

  return (
    <Modal title="検査結果登録" onClose={onClose} className="modal--lab-order-item">
      <ErrorBanner error={expansion.error} />

      {/* 展開の完了を待ってから描画する(フォームの初期値は初回描画時のみ反映される)。 */}
      {!expansion.ready ? (
        <p>読み込み中...</p>
      ) : (
        <>
          {notice && <p className="lab-result-form__notice">{notice}</p>}
          <LabResultForm
            initialValues={initialValues}
            onSubmit={handleSubmit}
            submitting={createLabResult.isPending}
            submitError={createLabResult.error}
            orderCandidates={[]}
            orderCandidatesLoading={false}
            lockedOrderLabel={orderLabel}
          />
        </>
      )}
    </Modal>
  );
}
