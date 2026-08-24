import { useMemo, useState, type FormEvent } from "react";
import type { Medicine, MedicalMaterial, MedicalProcedure } from "../api/masterClient";
import { useEndoscopyDatasetLinesForItems } from "../api/masterQueries";
import { useCurrentPractitioner } from "../api/authQueries";
import { useRegisterEndoscopyPerform, type EndoscopyWorklistRow } from "../api/queries";
import { toDateTimeInput } from "../fhir/clinicalNoteHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { endoscopyOrderItems, type EndoscopyOrderItemLine } from "../fhir/endoscopyOrderHelpers";
import {
  ENDOSCOPY_ROUTE_OPTIONS,
  buildEndoscopyPerformBundle,
  type EndoscopyMedicineLine,
  type EndoscopyMaterialLine,
  type EndoscopyPerformFormValues,
  type EndoscopyProcedureLine,
} from "../fhir/endoscopyResultHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { MedicalMaterialSearchModal } from "./MedicalMaterialSearchModal";
import { MedicalProcedureSearchModal } from "./MedicalProcedureSearchModal";
import { MedicineSearchModal } from "./MedicineSearchModal";
import { Modal } from "./Modal";

// 内視鏡の実施入力。放射線検査(docs/rad-result-design.md)と同じ形。
//
// 入力欄そのものは EndoscopyPerformInputModal(送信先を持たない)で、使い道は 2 つ:
// - 内視鏡一覧の「実施」… EndoscopyPerformModal が包み、実施記録(Procedure 一式)と
//   Task の完了を 1 つの transaction で登録する。
// - オーダー画面の「即実施」… 入力値だけを受け取り、オーダーの登録と同じ
//   transaction に積む(EndoscopyOrderForm)。
//
// 初期表示は、オーダーに載っているオーダー項目に紐付く実施入力データセットの明細を
// マージしたもの。薬剤も器材も無い検査が件数の大半なので、何も足さずに
// そのまま「登録」で終われるようにしている。
//
// 放射線と違い被曝線量の欄は無い(内視鏡に電離放射線はない)。器材は施設内の
// 器材マスタを挟まず、算定コードである特定保険医療材料を直接選ぶ。

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
  row: EndoscopyWorklistRow;
  onClose: () => void;
}

/** 内視鏡一覧の「実施」。入力した内容をその場で登録する。 */
export function EndoscopyPerformModal({ row, onClose }: Props) {
  const register = useRegisterEndoscopyPerform();

  const items = useMemo(
    () => endoscopyOrderItems(row.order, row.itemRequests),
    [row.order, row.itemRequests],
  );

  return (
    <EndoscopyPerformInputModal
      items={items}
      submitLabel="実施を登録"
      submitting={register.isPending}
      submitError={register.error}
      onSubmit={(values) =>
        register.mutate(buildEndoscopyPerformBundle(values, row.order, row.task), { onSuccess: onClose })
      }
      onClose={onClose}
    />
  );
}

interface InputProps {
  /** オーダー内容。データセット由来の初期明細の取得と、実施対象の表示に使う。 */
  items: EndoscopyOrderItemLine[];
  /**
   * 入力済みの内容。即実施で入力し直すときに渡す(データセット由来の初期行では
   * なく、前に入れた内容から始める)。
   */
  initialValues?: EndoscopyPerformFormValues | null;
  submitLabel: string;
  submitting?: boolean;
  submitError?: unknown;
  onSubmit: (values: EndoscopyPerformFormValues) => void;
  onClose: () => void;
}

export function EndoscopyPerformInputModal({
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
  const dataset = useEndoscopyDatasetLinesForItems(itemCodes);

  const [performedAt, setPerformedAt] = useState(
    () => initialValues?.performedAt ?? toDateTimeInput(new Date()),
  );
  const [comment, setComment] = useState(initialValues?.comment ?? "");
  const [adding, setAdding] = useState<Adding>(null);

  // データセット由来の初期行。読み込み後に一度だけ作り、以降は画面の編集を優先する
  // (差し替えると入力中の数量が戻ってしまう)。入力済みの内容を渡された場合は、
  // それを最初の編集内容として扱う(データセットで上書きしない)。
  const initial = useMemo(() => initialLines(dataset.details), [dataset.details]);
  const [edited, setEdited] = useState<Lines | null>(() =>
    initialValues
      ? {
          procedures: initialValues.procedures,
          medicines: initialValues.medicines,
          materials: initialValues.materials,
        }
      : null,
  );
  const lines = edited ?? initial;

  function patch(next: Partial<Lines>) {
    setEdited({ ...lines, ...next });
  }

  const values: EndoscopyPerformFormValues = {
    performedAt,
    performerId: practitionerId ?? "",
    performerName: practitioner ? practitionerDisplayName(practitioner) : "",
    procedures: lines.procedures,
    medicines: lines.medicines,
    materials: lines.materials,
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

        {/* 何の分の実施入力なのか。取り違えると別の患者・別の検査に
            実施記録が付くので、入力欄より先に目に入る位置と大きさで出す。 */}
        <p className="rad-perform__items">
          <span className="rad-perform__items-label">オーダー内容</span>
          {items.map((item) => item.name).join("、") || "オーダー項目なし"}
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
            <h3>薬剤</h3>
            <button type="button" onClick={() => setAdding("medicine")}>
              薬剤を追加
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
                {lines.medicines.map((line, index) => (
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
                            medicines: replaceAt(lines.medicines, index, {
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
                            medicines: replaceAt(lines.medicines, index, {
                              ...line,
                              routeCode: e.target.value,
                            }),
                          })
                        }
                      >
                        <option value="">未指定</option>
                        {ENDOSCOPY_ROUTE_OPTIONS.map((option) => (
                          <option key={option.code} value={option.code}>
                            {option.display}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="master-search__actions">
                      <RemoveRowButton
                        onClick={() =>
                          patch({ medicines: lines.medicines.filter((_, i) => i !== index) })
                        }
                      />
                    </td>
                  </tr>
                ))}
                {lines.medicines.length === 0 && (
                  <tr>
                    <td colSpan={4} className="master-search__empty">
                      薬剤の使用はありません
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
                      {/* code はレセ電算の特定器材コードそのもの。マスタから選ばず
                          名称だけ手入力した行では空になる。 */}
                      <span className="lab-order-item__code">{line.code}</span>
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
      {/* 内視鏡で使う薬剤は造影剤に限らない(鎮静剤・鎮痙剤・咽頭麻酔・前処置
          試験の気管支拡張薬など)ので、造影剤区分では絞らない。 */}
      {adding === "medicine" && (
        <MedicineSearchModal
          title="薬剤を選択"
          onSelect={(m: Medicine) => {
            setAdding(null);
            patch({
              medicines: [
                ...lines.medicines,
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
        <MedicalMaterialSearchModal
          onSelect={(m: MedicalMaterial) => {
            setAdding(null);
            patch({
              materials: [
                ...lines.materials,
                {
                  code: m.material_code,
                  name: m.name ?? m.material_code,
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
  procedures: EndoscopyProcedureLine[];
  medicines: EndoscopyMedicineLine[];
  materials: EndoscopyMaterialLine[];
}

/**
 * 紐付くデータセットのうち「初期値」にしてある明細を初期行にする。初期値でない明細は
 * 出さない(使ったときだけ検索して足す)。
 *
 * 複数のデータセットに同じ手技・薬剤・器材が入っていることがある(上部のセットと
 * 下部のセットの両方に同じ鎮静剤が入っている等)ので、種別とコードで
 * 重複を落とす。
 * 数量は先に出てきた方を採る。
 */
function initialLines(details: ReturnType<typeof useEndoscopyDatasetLinesForItems>["details"]): Lines {
  const lines: Lines = { procedures: [], medicines: [], materials: [] };
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
      lines.medicines.push({
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
