import { useMemo } from "react";
import { useCurrentPractitioner } from "../api/authQueries";
import type { ManagementFeeItem } from "../api/masterClient";
import { useManagementFeeItems } from "../api/masterQueries";
import { fetchPatientDocumentDueTasks, usePatientDocumentDueTasks } from "../api/queries";
import {
  buildCompletedDocumentDueEntries,
  documentDueFeeCode,
  templateDocumentDueTasks,
} from "../fhir/documentDueHelpers";
import { feeItemsForTemplate } from "../fhir/managementFeeDocumentHelpers";
import {
  buildMedicalManagementOrderBundle,
  emptyMedicalManagementOrderForm,
} from "../fhir/medicalManagementOrderHelpers";
import { withOrderWard } from "../fhir/orderHeader";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { useDefaultOrderSetting } from "./useDefaultOrderSetting";
import { useOrderContext } from "./useOrderContext";

/**
 * 文書作成と指導・管理料の連動(docs/medical-management-order-design.md §6)。
 * その文書テンプレートを要件に持つ項目(算定の候補)と、文書の保存と同じ transaction に
 * 足す entry(選んだ項目の指導・管理料オーダーと、その文書を待っていた督促の完了)を返す。
 * 先に算定してこの文書を待っている項目(awaitedCodes)は、算定の候補でチェックを外して出す。
 */
export function useDocumentFeeLink(patientId: string, templateCode: string | undefined) {
  const defaultSetting = useDefaultOrderSetting(patientId);
  const requester = useOrderContext();
  const { practitionerId, practitioner } = useCurrentPractitioner();
  const master = useManagementFeeItems({ active: true, setting: defaultSetting.setting });

  const dueTasks = usePatientDocumentDueTasks(templateCode ? patientId : undefined);
  const awaitedCodes = useMemo(
    () =>
      new Set(
        templateCode ? templateDocumentDueTasks(dueTasks.data ?? [], templateCode).map(documentDueFeeCode) : [],
      ),
    [dueTasks.data, templateCode],
  );

  const candidates = useMemo(
    () => (templateCode ? feeItemsForTemplate(master.data?.items ?? [], templateCode) : []),
    [master.data, templateCode],
  );

  function extraEntries(args: { items: ManagementFeeItem[]; date: string; title: string }) {
    return async (documentReference: string): Promise<fhir4.BundleEntry[]> => {
      const order =
        args.items.length > 0
          ? (buildMedicalManagementOrderBundle(
              {
                ...emptyMedicalManagementOrderForm(defaultSetting.setting),
                date: args.date,
                lines: args.items.map((item) => ({ code: item.receipt_code, name: item.name, additions: [] })),
              },
              patientId,
              withOrderWard(requester, defaultSetting.setting, defaultSetting),
              { reference: documentReference, display: args.title },
            ).entry ?? [])
          : [];
      // 督促を閉じる人として名乗れないログイン(管理者)では閉じない。
      const closing =
        templateCode && practitionerId && practitioner
          ? buildCompletedDocumentDueEntries(
              templateDocumentDueTasks(await fetchPatientDocumentDueTasks(patientId), templateCode),
              { practitionerId, display: practitionerDisplayName(practitioner) },
            )
          : [];
      return [...order, ...closing];
    };
  }

  return {
    candidates,
    awaitedCodes,
    /** 候補の有無が分かったか。分かるまで「作成」を押させない。 */
    ready: defaultSetting.ready && !master.isPending && !(templateCode && dueTasks.isPending),
    error: master.error ?? dueTasks.error,
    extraEntries,
  };
}
