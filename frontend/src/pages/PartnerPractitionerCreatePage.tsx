import { Link, useNavigate } from "react-router-dom";
import { useCreatePractitioner } from "../api/queries";
import { PractitionerForm } from "../components/PractitionerForm";
import {
  buildPractitionerSaveBundle,
  type PractitionerFormValues,
} from "../fhir/practitionerHelpers";

// 連携先医師の登録。所属は他院、ログイン設定と自院の診療科は持たない
// (PractitionerForm の partner モード)。保存する形は自院スタッフと同じ。
export function PartnerPractitionerCreatePage() {
  const navigate = useNavigate();
  const createPractitioner = useCreatePractitioner();

  function handleSubmit(values: PractitionerFormValues) {
    createPractitioner.mutate(buildPractitionerSaveBundle({ values }), {
      onSuccess: () => navigate("/partner-practitioners"),
    });
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>連携先医師登録</h1>
        <Link to="/partner-practitioners" className="button">
          ← 一覧に戻る
        </Link>
      </div>
      <PractitionerForm
        partner
        onSubmit={handleSubmit}
        submitting={createPractitioner.isPending}
        submitError={createPractitioner.error}
        submitLabel="登録"
      />
    </div>
  );
}
