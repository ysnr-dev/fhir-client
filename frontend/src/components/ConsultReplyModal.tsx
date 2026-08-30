import { useState } from "react";
import { useCurrentPractitioner } from "../api/authQueries";
import { useSaveConsultReply } from "../api/queries";
import {
  FREE_TEXT_SECTION_CODE,
  buildClinicalNote,
  emptyClinicalNoteForm,
  newSectionDraft,
  validateClinicalNote,
  type ClinicalNoteFormValues,
} from "../fhir/clinicalNoteHelpers";
import { consultOrderProblem, summarizeConsultOrder } from "../fhir/consultOrderHelpers";
import { departmentOf } from "../fhir/prescriptionHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { useOrderContext } from "../hooks/useOrderContext";
import { ClinicalNoteForm } from "./ClinicalNoteForm";
import { ConsultOrderDetailPanel } from "./ConsultOrderDetailPanel";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

// 他科依頼の回答入力。他部門の「実施入力」に当たる操作だが、登録するのは
// 実施記録(Procedure)ではなく **診療記録(Composition)** (docs/consult-order-design.md §5)。
//
// 回答の様式を新しく作らず既存の診療記録エディタをそのまま使う。回答の中身は結局
// 診察所見と評価・方針で、専用の様式を作ると同じものを二重に持つことになるため。
// SOAP でも自由記載でも書け、テンプレート挿入・シェーマもそのまま使える。
//
// 入口をカルテの右ペインではなくモーダルにしているのは、カルテの右ペインは URL に
// 載せない方針(karteUrl.ts)で、部門一覧から「右ペインを開いた状態」へ遷移させられない
// ため(§5.1)。
//
// 保存は 1 つの transaction で「診療記録 + 進捗を回答済 + 依頼側に回答への参照と
// status=completed」を書く(useSaveConsultReply)。片方だけが書かれると、回答済の依頼が
// 部門一覧の未回答に出続ける。

interface Props {
  order: fhir4.ServiceRequest;
  task: fhir4.Task | undefined;
  patientId: string;
  /** 誰への回答かを見出しに出す。 */
  patientName?: string;
  onClose: () => void;
}

export function ConsultReplyModal({ order, task, patientId, patientName, onClose }: Props) {
  const summary = summarizeConsultOrder(order);
  const requestingDepartment = departmentOf(order).departmentName;

  const saveReply = useSaveConsultReply();
  // Composition.author に回答した医師の実参照を入れる。医療従事者に紐付かない
  // アカウント(administrator など)では validate で保存を止める。
  const { practitionerId, practitioner } = useCurrentPractitioner();
  // 回答した診療科。ヘッダーで選択中の科をそのまま「答えた科」として記録に焼き付ける。
  const orderContext = useOrderContext();
  const [validationError, setValidationError] = useState<string | null>(null);

  // 回答は 1 件の文章として書くことが多いので自由記載で開く(SOAP に切り替えられる)。
  // 対象プロブレムは依頼が指していたものを引き継ぐ。
  const [initialValues] = useState<ClinicalNoteFormValues>(() => ({
    ...emptyClinicalNoteForm(consultOrderProblem(order)),
    mode: "free",
    sections: [newSectionDraft(FREE_TEXT_SECTION_CODE)],
    title: requestingDepartment ? `他科依頼回答(${requestingDepartment})` : "他科依頼回答",
  }));

  function handleSubmit(values: ClinicalNoteFormValues) {
    const error = validateClinicalNote(values, practitionerId);
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);

    const { composition, entries } = buildClinicalNote(values, {
      patientId,
      practitioner,
      consultOrderId: order.id,
      department: orderContext,
    });

    saveReply.mutate(
      {
        order,
        task,
        composition,
        entries,
        replierName: practitioner ? practitionerDisplayName(practitioner) : "",
      },
      { onSuccess: onClose },
    );
  }

  return (
    <Modal
      title={`他科依頼の回答${patientName ? ` - ${patientName}` : ""}`}
      onClose={onClose}
      className="modal--wide"
    >
      <ErrorBanner error={saveReply.error} />

      {/* 何を聞かれているかを見ながら書けるよう、依頼内容を上に出す。 */}
      <ConsultOrderDetailPanel serviceRequest={order} />

      {summary.replyId && (
        <p className="clinical-note-edit__hint">
          この依頼には既に回答があります。ここで登録すると新しい回答に置き換わります
          (前の回答の記録は残ります)。
        </p>
      )}

      <ClinicalNoteForm
        patientId={patientId}
        initialValues={initialValues}
        onSubmit={handleSubmit}
        submitting={saveReply.isPending}
        validationError={validationError}
        submitLabel="回答を登録"
      />
    </Modal>
  );
}
