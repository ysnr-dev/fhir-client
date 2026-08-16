import { useMemo, useState, type FormEvent } from "react";
import type { Medicine, MedicalProcedure, RadMaterial } from "../api/masterClient";
import { useRadDatasetLinesForItems } from "../api/masterQueries";
import { useCurrentPractitioner } from "../api/authQueries";
import { useRegisterRadPerform, type RadWorklistRow } from "../api/queries";
import { toDateTimeInput } from "../fhir/clinicalNoteHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { radOrderItems, type RadOrderItemLine } from "../fhir/radOrderHelpers";
import {
  RAD_ROUTE_OPTIONS,
  buildRadPerformBundle,
  doseFieldsForModalities,
  type DoseKey,
  type RadContrastLine,
  type RadMaterialLine,
  type RadPerformFormValues,
  type RadProcedureLine,
} from "../fhir/radResultHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { MedicalProcedureSearchModal } from "./MedicalProcedureSearchModal";
import { MedicineSearchModal } from "./MedicineSearchModal";
import { Modal } from "./Modal";
import { RadMaterialSearchModal } from "./RadMaterialSearchModal";

// 放射線検査の実施入力。設計は docs/rad-result-design.md を参照。
//
// 入力欄そのものは RadPerformInputModal(送信先を持たない)で、使い道は 2 つ:
// - 放射線検査一覧の「実施」… RadPerformModal が包み、実施記録(Procedure 一式)と
//   Task の完了を 1 つの transaction で登録する。
// - オーダー画面の「即実施」… 入力値だけを受け取り、オーダーの登録と同じ
//   transaction に積む(RadOrderForm)。
//
// 初期表示は、オーダーに載っている撮影項目に紐付く実施入力データセットの明細を
// マージしたもの。造影剤も器材も無い単純撮影が件数の大半なので、何も足さずに
// そのまま「登録」で終われるようにしている。

type Adding = "procedure" | "medicine" | "material" | null;

function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9L12 4M6.5 6.5v5M9.5 6.5v5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 行を外すボタン。3 種の明細で同じ見た目・同じ意味なのでまとめる。 */
function RemoveRowButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="rp-card__icon-button"
      title="外す"
      aria-label="外す"
      onClick={onClick}
    >
      <TrashIcon />
    </button>
  );
}

interface Props {
  row: RadWorklistRow;
  onClose: () => void;
}

/** 放射線検査一覧の「実施」。入力した内容をその場で登録する。 */
export function RadPerformModal({ row, onClose }: Props) {
  const register = useRegisterRadPerform();

  const items = useMemo(
    () => radOrderItems(row.order, row.itemRequests),
    [row.order, row.itemRequests],
  );

  return (
    <RadPerformInputModal
      items={items}
      submitLabel="実施を登録"
      submitting={register.isPending}
      submitError={register.error}
      onSubmit={(values) =>
        register.mutate(buildRadPerformBundle(values, row.order, row.task), { onSuccess: onClose })
      }
      onClose={onClose}
    />
  );
}

interface InputProps {
  /** 撮影内容。データセット由来の初期明細と、線量欄の出し分けに使う。 */
  items: RadOrderItemLine[];
  /**
   * 入力済みの内容。即実施で入力し直すときに渡す(データセット由来の初期行では
   * なく、前に入れた内容から始める)。
   */
  initialValues?: RadPerformFormValues | null;
  submitLabel: string;
  submitting?: boolean;
  submitError?: unknown;
  onSubmit: (values: RadPerformFormValues) => void;
  onClose: () => void;
}

export function RadPerformInputModal({
  items,
  initialValues = null,
  submitLabel,
  submitting = false,
  submitError,
  onSubmit,
  onClose,
}: InputProps) {
  const { practitionerId, practitioner } = useCurrentPractitioner();

  const itemCodes = useMemo(() => items.map((item) => item.code), [items]);
  const dataset = useRadDatasetLinesForItems(itemCodes);

  const doseFields = useMemo(
    () => doseFieldsForModalities(items.map((item) => item.modalityCode)),
    [items],
  );

  const [performedAt, setPerformedAt] = useState(
    () => initialValues?.performedAt ?? toDateTimeInput(new Date()),
  );
  const [comment, setComment] = useState(initialValues?.comment ?? "");
  const [doses, setDoses] = useState<Partial<Record<DoseKey, string>>>(
    initialValues?.doses ?? {},
  );
  const [adding, setAdding] = useState<Adding>(null);

  // データセット由来の初期行。読み込み後に一度だけ作り、以降は画面の編集を優先する
  // (差し替えると入力中の数量が戻ってしまう)。入力済みの内容を渡された場合は、
  // それを最初の編集内容として扱う(データセットで上書きしない)。
  const initial = useMemo(() => initialLines(dataset.details), [dataset.details]);
  const [edited, setEdited] = useState<Lines | null>(() =>
    initialValues
      ? {
          procedures: initialValues.procedures,
          contrasts: initialValues.contrasts,
          materials: initialValues.materials,
        }
      : null,
  );
  const lines = edited ?? initial;

  function patch(next: Partial<Lines>) {
    setEdited({ ...lines, ...next });
  }

  const values: RadPerformFormValues = {
    performedAt,
    performerId: practitionerId ?? "",
    performerName: practitioner ? practitionerDisplayName(practitioner) : "",
    procedures: lines.procedures,
    contrasts: lines.contrasts,
    materials: lines.materials,
    doses,
    comment,
  };

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!performedAt) return;

    onSubmit(values);
  }

  return (
    <Modal title="実施入力" onClose={onClose} className="modal--lab-order-item">
      <form onSubmit={handleSubmit}>
        <div className="lab-order-item__fields">
          <label>
            実施時刻
            <input
              type="datetime-local"
              value={performedAt}
              onChange={(e) => setPerformedAt(e.target.value)}
              required
            />
          </label>
          <label>
            実施者
            <input
              type="text"
              value={values.performerName || "(未設定)"}
              readOnly
              disabled
            />
          </label>
        </div>

        {/* 何を撮った分の実施入力なのか。取り違えると別の患者・別の検査に
            実施記録が付くので、入力欄より先に目に入る位置と大きさで出す。 */}
        <p className="rad-perform__items">
          <span className="rad-perform__items-label">撮影内容</span>
          {items.map((item) => item.name).join("、") || "撮影項目なし"}
        </p>

        <ErrorBanner error={dataset.error} />

        <section className="lab-order-item__section">
          <div className="lab-order-item__section-head">
            <h3>手技料</h3>
            <button type="button" onClick={() => setAdding("procedure")}>
              診療行為を追加
            </button>
          </div>
          <LineTable
            columns={["名称", "コード"]}
            rows={lines.procedures.map((line, index) => ({
              key: `${line.code}-${index}`,
              cells: [line.name, line.code],
              onRemove: () =>
                patch({ procedures: lines.procedures.filter((_, i) => i !== index) }),
            }))}
            emptyText="手技料の追加はありません"
          />
        </section>

        <section className="lab-order-item__section">
          <div className="lab-order-item__section-head">
            <h3>造影剤</h3>
            <button type="button" onClick={() => setAdding("medicine")}>
              造影剤を追加
            </button>
          </div>
          <div className="lab-order-item__table-wrap">
            <table className="master-search__table rad-perform__lines">
              <thead>
                <tr>
                  <th>名称</th>
                  <th className="rad-item__compact">使用量</th>
                  <th className="rad-item__compact">経路</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {lines.contrasts.map((line, index) => (
                  <tr key={`${line.medicineCode}-${index}`}>
                    <td>
                      {line.name}
                      <span className="lab-order-item__code">{line.medicineCode}</span>
                    </td>
                    <td className="rad-item__compact">
                      <input
                        type="number"
                        className="rad-quantity-input"
                        step="0.01"
                        min="0"
                        value={line.dose}
                        onChange={(e) =>
                          patch({
                            contrasts: replaceAt(lines.contrasts, index, {
                              ...line,
                              dose: e.target.value,
                            }),
                          })
                        }
                      />
                      {/* 医薬品マスタの製剤単位(本・筒・g など)。器材の数量と同じ出し方。 */}
                      {line.unitName}
                    </td>
                    <td className="rad-item__compact">
                      <select
                        className="rad-route-select"
                        value={line.routeCode}
                        onChange={(e) =>
                          patch({
                            contrasts: replaceAt(lines.contrasts, index, {
                              ...line,
                              routeCode: e.target.value,
                            }),
                          })
                        }
                      >
                        <option value="">未指定</option>
                        {RAD_ROUTE_OPTIONS.map((option) => (
                          <option key={option.code} value={option.code}>
                            {option.display}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="master-search__actions">
                      <RemoveRowButton
                        onClick={() =>
                          patch({ contrasts: lines.contrasts.filter((_, i) => i !== index) })
                        }
                      />
                    </td>
                  </tr>
                ))}
                {lines.contrasts.length === 0 && (
                  <tr>
                    <td colSpan={4} className="master-search__empty">
                      造影剤の使用はありません
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="lab-order-item__section">
          <div className="lab-order-item__section-head">
            <h3>使用器材</h3>
            <button type="button" onClick={() => setAdding("material")}>
              器材を追加
            </button>
          </div>
          <div className="lab-order-item__table-wrap">
            <table className="master-search__table rad-perform__lines">
              <thead>
                <tr>
                  <th>名称</th>
                  <th className="rad-item__compact">数量</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {lines.materials.map((line, index) => (
                  <tr key={`${line.code}-${index}`}>
                    <td>
                      {line.name}
                      <span className="lab-order-item__code">
                        {line.receiptMaterialCode
                          ? `算定 ${line.receiptMaterialCode}`
                          : "算定コード未紐付け"}
                      </span>
                    </td>
                    <td className="rad-item__compact">
                      <input
                        type="number"
                        className="rad-quantity-input"
                        step="0.01"
                        min="0"
                        value={line.quantity}
                        onChange={(e) =>
                          patch({
                            materials: replaceAt(lines.materials, index, {
                              ...line,
                              quantity: e.target.value,
                            }),
                          })
                        }
                      />
                      {line.unitName}
                    </td>
                    <td className="master-search__actions">
                      <RemoveRowButton
                        onClick={() =>
                          patch({ materials: lines.materials.filter((_, i) => i !== index) })
                        }
                      />
                    </td>
                  </tr>
                ))}
                {lines.materials.length === 0 && (
                  <tr>
                    <td colSpan={3} className="master-search__empty">
                      器材の使用はありません
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* 線量欄はモダリティで出し分ける。単純撮影は装置から実測値が出ないため出さない。 */}
        {doseFields.length > 0 && (
          <section className="lab-order-item__section">
            <div className="lab-order-item__section-head">
              <h3>被曝線量</h3>
            </div>
            <div className="lab-order-item__fields">
              {doseFields.map((field) => (
                <label key={field.key}>
                  {field.display}({field.unit})
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={doses[field.key] ?? ""}
                    onChange={(e) => setDoses({ ...doses, [field.key]: e.target.value })}
                  />
                </label>
              ))}
            </div>
          </section>
        )}

        <label className="rad-perform__comment">
          実施コメント
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} />
        </label>

        <ErrorBanner error={submitError} />

        <div className="lab-order-item__actions">
          <button type="submit" disabled={submitting || dataset.isLoading}>
            {submitLabel}
          </button>
          <button type="button" onClick={onClose} disabled={submitting}>
            キャンセル
          </button>
        </div>
      </form>

      {adding === "procedure" && (
        <MedicalProcedureSearchModal
          onSelect={(p: MedicalProcedure) => {
            setAdding(null);
            patch({
              procedures: [
                ...lines.procedures,
                { code: p.procedure_code, name: p.name ?? p.procedure_code },
              ],
            });
          }}
          onClose={() => setAdding(null)}
        />
      )}
      {adding === "medicine" && (
        <MedicineSearchModal
          title="造影剤を選択"
          contrastMedium
          onSelect={(m: Medicine) => {
            setAdding(null);
            patch({
              contrasts: [
                ...lines.contrasts,
                {
                  medicineCode: m.medicine_code,
                  name: m.name ?? m.medicine_code,
                  yjCode: m.yj_code ?? "",
                  dose: "",
                  unitName: m.unit_name ?? "",
                  routeCode: "",
                },
              ],
            });
          }}
          onClose={() => setAdding(null)}
        />
      )}
      {adding === "material" && (
        <RadMaterialSearchModal
          onSelect={(m: RadMaterial) => {
            setAdding(null);
            patch({
              materials: [
                ...lines.materials,
                {
                  code: m.material_code,
                  name: m.name,
                  receiptMaterialCode: m.receipt_material_code ?? "",
                  quantity: "1",
                  unitName: m.unit_name ?? "",
                },
              ],
            });
          }}
          onClose={() => setAdding(null)}
        />
      )}
    </Modal>
  );
}

interface Lines {
  procedures: RadProcedureLine[];
  contrasts: RadContrastLine[];
  materials: RadMaterialLine[];
}

/**
 * 紐付くデータセットのうち「初期値」にしてある明細を初期行にする。初期値でない明細は
 * 出さない(使ったときだけ検索して足す)。
 *
 * 複数のデータセットに同じ手技・造影剤・器材が入っていることがある(造影セットと
 * 穿刺セットの両方に延長チューブが入っている等)ので、種別とコードで重複を落とす。
 * 数量は先に出てきた方を採る。
 */
function initialLines(details: ReturnType<typeof useRadDatasetLinesForItems>["details"]): Lines {
  const lines: Lines = { procedures: [], contrasts: [], materials: [] };
  const seen = new Set<string>();

  for (const detail of details) {
    if (!detail.default_selected) continue;

    const key = `${detail.detail_type}:${detail.code}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const name = detail.resolved_name ?? detail.code;
    if (detail.detail_type === "procedure") {
      lines.procedures.push({ code: detail.code, name });
    } else if (detail.detail_type === "medicine") {
      lines.contrasts.push({
        medicineCode: detail.code,
        name,
        yjCode: detail.yj_code ?? "",
        dose: detail.default_quantity ?? "",
        unitName: detail.resolved_unit_name ?? "",
        routeCode: detail.route_code ?? "",
      });
    } else {
      lines.materials.push({
        code: detail.code,
        name,
        receiptMaterialCode: detail.receipt_material_code ?? "",
        quantity: detail.default_quantity ?? "",
        unitName: detail.resolved_unit_name ?? "",
      });
    }
  }
  return lines;
}

function replaceAt<T>(list: T[], index: number, next: T): T[] {
  return list.map((item, i) => (i === index ? next : item));
}

// 名称とコードだけを並べる表。削除ボタンの付け方を手技料と揃えるために切り出す。
function LineTable({
  columns,
  rows,
  emptyText,
}: {
  columns: string[];
  rows: { key: string; cells: string[]; onRemove: () => void }[];
  emptyText: string;
}) {
  return (
    <div className="lab-order-item__table-wrap">
      <table className="master-search__table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              {row.cells.map((cell, index) => (
                <td key={index}>{cell}</td>
              ))}
              <td className="master-search__actions">
                <RemoveRowButton onClick={row.onRemove} />
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length + 1} className="master-search__empty">
                {emptyText}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
