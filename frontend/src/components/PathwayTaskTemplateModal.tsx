import { useMemo, useState } from "react";
import {
  ORDER_SET_SCHEMA_VERSION,
  isOrderSetOrderType,
  migrateEntryValues,
  type OrderSetOrderType,
} from "../fhir/orderSetHelpers";
import type { PathwayTaskTemplate } from "../fhir/pathwayHelpers";
import type { PrescriptionSetting } from "../fhir/prescriptionHelpers";
import { useStackedOrderForms } from "../hooks/useStackedOrderForms";
import { Modal } from "./Modal";
import { ORDER_SET_TYPES, ORDER_SET_TYPE_LABELS, ORDER_SET_TYPE_ORDER } from "./orderSetRegistry";

// パスのタスクに持たせるオーダー雛形の編集。オーダーセットの登録画面と同じく既存の
// オーダー登録フォームを set モード(患者なし)で出し、「この内容にする」で外から
// submit して値を受け取る。閉じたら破棄し、確定した値だけを draft に戻す。
// フォームを病日 × タスクぶん常時マウントすると重く縦にも伸びるので、1 件ずつモーダルで開く。

/** 雛形にできる種別(病名はタスクではない)。 */
const TEMPLATE_TYPES: OrderSetOrderType[] = ORDER_SET_TYPE_ORDER.filter((t) => t !== "condition");

interface Props {
  taskName: string;
  template: PathwayTaskTemplate | null;
  /** 新しく作るときの既定の種別(タスク分類から決める)。 */
  defaultOrderType: string;
  setting: PrescriptionSetting;
  onCommit: (template: PathwayTaskTemplate) => void;
  onClose: () => void;
}

function initialType(template: PathwayTaskTemplate | null, defaultOrderType: string): OrderSetOrderType {
  const candidates = [template?.orderType, defaultOrderType];
  for (const c of candidates) {
    if (c && isOrderSetOrderType(c) && TEMPLATE_TYPES.includes(c)) return c;
  }
  return TEMPLATE_TYPES[0];
}

export function PathwayTaskTemplateModal({ taskName, template, defaultOrderType, setting, onCommit, onClose }: Props) {
  const [orderType, setOrderType] = useState<OrderSetOrderType>(() => initialType(template, defaultOrderType));
  const [error, setError] = useState<string | null>(null);
  const stack = useStackedOrderForms<number>();
  const def = ORDER_SET_TYPES[orderType];

  // 種別が既存の雛形と同じときだけ中身を復元する(変えたら空のフォーム)。
  const initialValues = useMemo(() => {
    if (!def) return null;
    if (template && template.orderType === orderType) {
      const migrated = migrateEntryValues(orderType, template.schemaVersion, template.values);
      if (!migrated.unsupported) return def.buildDoValues(migrated.values, setting || "inpatient");
    }
    return def.emptyValues(setting || "inpatient");
  }, [def, orderType, setting, template]);

  function handleCommit() {
    if (!def) return;
    const result = stack.submitAll([0]);
    if (!result.ok) {
      setError("入力を確認してください。");
      return;
    }
    const submitted = result.collected.get(0);
    if (!submitted) return;
    onCommit({
      orderType,
      label: def.summarize(submitted.values),
      values: def.sanitize(submitted.values),
      schemaVersion: ORDER_SET_SCHEMA_VERSION,
      unsupported: false,
    });
  }

  return (
    <Modal title={`オーダー雛形: ${taskName || "(タスク)"}`} onClose={onClose} className="modal--wide pathway-template-modal">
      <div className="pathway-template-modal__type">
        <label>
          種別
          <select value={orderType} onChange={(e) => setOrderType(e.target.value as OrderSetOrderType)}>
            {TEMPLATE_TYPES.map((t) => (
              <option key={t} value={t}>
                {ORDER_SET_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{error}</p>
        </div>
      )}
      {def && initialValues !== null && (
        <div key={orderType} ref={stack.registerContainer(0)} className="pathway-template-modal__form">
          {def.renderForm({
            patientId: "",
            initialValues,
            onSubmit: (values, ...extra) => stack.collect(0, values, ...extra),
            submitting: false,
            mode: "set",
          })}
        </div>
      )}
      <div className="lab-order-item__actions">
        <button type="button" onClick={handleCommit}>
          この内容にする
        </button>
        <button type="button" onClick={onClose}>
          閉じる
        </button>
      </div>
    </Modal>
  );
}
