import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useCurrentPractitioner } from "../api/authQueries";
import { useTransfusionProductOptions } from "../api/masterQueries";
import {
  useBloodType,
  usePatient,
  usePractitionerOptions,
  useRegisterTransfusionPerform,
  useTransfusionPerformDetail,
  useTransfusionReactionHistory,
  useTransfusionSettings,
} from "../api/queries";
import { type Advisory, advisoryKey, severityOf } from "../fhir/advisoryHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { splitPerformBundle } from "../fhir/radResultHelpers";
import { reactionHistoryAdvisory } from "../fhir/transfusionAdvisoryHelpers";
import {
  patientTypeForDispense,
  transfusionDispensesByOrderId,
  type TransfusionDispensedBag,
} from "../fhir/transfusionDispenseHelpers";
import {
  bloodTypeLabel,
  compatibleAbo,
  compatibleRhd,
  productNeedsBloodType,
  summarizeTransfusionOrder,
} from "../fhir/transfusionOrderHelpers";
import {
  BAG_OUTCOME_OPTIONS,
  EMPTY_TRANSFUSION_SCAN,
  REACTION_OPTIONS,
  REACTION_SYMPTOM_OPTIONS,
  buildTransfusionPerformBundle,
  emptyBagLine,
  emptyTransfusionPerformForm,
  hasVitalValues,
  nowFhirDateTime,
  observationPointDisplay,
  pointTime,
  type TransfusionBagLine,
  type TransfusionBagOutcome,
  type TransfusionPerformFormValues,
  type TransfusionReaction,
  type TransfusionScanState,
} from "../fhir/transfusionResultHelpers";
import { VITAL_MEASURES, type VitalFormValues } from "../fhir/vitalHelpers";
import { localDay, today } from "../lib/dates";
import { useAdvisorySession } from "../hooks/useAdvisorySession";
import { AdvisoryConfirmModal } from "./AdvisoryConfirmModal";
import { AdvisoryNotice } from "./AdvisoryNotice";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";
import { TransfusionBloodBadge } from "./TransfusionBloodBadge";
import { TransfusionVerifyStep } from "./TransfusionVerifyStep";
import { TrashIcon } from "./icons/TrashIcon";

// 輸血の実施入力。手術(SurgeryPerformModal)と同じく、実施記録一式と Task の完了を
// 1 つの transaction で登録する。
//
// **入口が 2 つある**のがこのモーダルの他部門との違い。輸血は出庫するのが輸血部門、
// 投与するのが病棟で、実際に投与した人が記録を書けなければ意味が無い
// (docs/transfusion-order-design.md §5.1)。
// - 輸血一覧の「実施」… 部門が病棟から受けた報告を代わりに入れる
// - カルテカードの「実施入力」… 投与した病棟がその場で入れる
// どちらも同じ Bundle を書くので、送信まで含めてこのコンポーネントで完結させる。
//
// 初期表示は出庫したバッグ(製剤番号・型つき)をそのまま行にしたもの(出庫記録が無ければ
// オーダーの製剤)。入れなかったバッグは消さずに「未実施」「返却」にして残す(ガイド 7.5.3-4)。
// 出庫記録に無い製剤番号・有効期限切れ・未照射・交差不適合・患者の型との不適合は警告の器に出す。
//
// 施設設定で投与時の照合を有効にしていれば、入力の前に照合(TransfusionVerifyStep)を出す。
// 患者番号(リストバンド)と製剤ラベルの献血番号を読み、結果はハブの Procedure に残す。
// 確認者(読み合わせの相手)は実施者と並べて記録する(ガイド 7.5.3-1 ③)。
//
// 製剤はオーダー画面と同じ**製剤マスタのセレクト**にする。名前をそのまま打てるように
// すると、MedicationAdministration の coding に載るコードが選び直しに追従せず、
// 「コードは A 製剤・表示は B 製剤」という記録ができてしまう。製剤番号を必須にして
// 遡及調査の起点にしている以上、製剤コードが実物と食い違ってはいけない。

interface Props {
  order: fhir4.ServiceRequest;
  /** オーダーの製剤明細。出庫記録が無いときのバッグの初期行を作るのに使う。 */
  itemRequests: fhir4.ServiceRequest[];
  task: fhir4.Task | undefined;
  /** 誰の輸血かを見出しに出す。取り違え防止のため。 */
  patientName?: string;
  onClose: () => void;
}

export function TransfusionPerformModal({ order, itemRequests, task, patientName, onClose }: Props) {
  // 出庫記録があれば、払い出したバッグ(製剤番号・型つき)をそのまま初期行にする。
  // 読み終わるまで待つのは、初期値が初回描画時にしか効かないため。
  const perform = useTransfusionPerformDetail(order.id);
  const dispensed = useMemo(() => {
    const { procedures, dispenses } = splitPerformBundle(perform.data?.data);
    return (transfusionDispensesByOrderId(procedures, dispenses).get(order.id ?? "") ?? []).flatMap(
      (d) => d.bags,
    );
  }, [perform.data, order.id]);
  if (perform.isLoading) {
    return (
      <Modal
        title={`輸血の実施入力${patientName ? ` - ${patientName}` : ""}`}
        onClose={onClose}
        className="modal--wide"
      >
        <p>読み込み中...</p>
      </Modal>
    );
  }
  return (
    <TransfusionPerformForm
      order={order}
      itemRequests={itemRequests}
      task={task}
      patientName={patientName}
      dispensed={dispensed}
      onClose={onClose}
    />
  );
}

function bagFromDispensed(bag: TransfusionDispensedBag): TransfusionBagLine {
  return {
    ...emptyBagLine(),
    productCode: bag.productCode,
    productName: bag.productName,
    units: bag.units,
    unitLabel: bag.unitLabel,
    lotNumber: bag.lotNumber,
    abo: bag.abo as TransfusionBagLine["abo"],
    rhd: bag.rhd as TransfusionBagLine["rhd"],
  };
}

function TransfusionPerformForm({
  order,
  itemRequests,
  task,
  patientName,
  dispensed,
  onClose,
}: Props & { dispensed: TransfusionDispensedBag[] }) {
  const register = useRegisterTransfusionPerform();
  const { practitionerId, practitioner } = useCurrentPractitioner();
  const practitionerName = practitioner ? practitionerDisplayName(practitioner) : null;
  const products = useTransfusionProductOptions();
  const productItems = useMemo(() => products.data?.items ?? [], [products.data]);
  const practitioners = usePractitionerOptions();
  const settings = useTransfusionSettings();
  const summary = summarizeTransfusionOrder(order);
  const patientId = order.subject?.reference?.split("/").pop();
  const patient = usePatient(patientId).data?.data;
  const bloodType = useBloodType(patientId);
  const reactions = useTransfusionReactionHistory(patientId);

  const [values, setValues] = useState<TransfusionPerformFormValues>(() => {
    const empty = emptyTransfusionPerformForm(itemRequests);
    return dispensed.length > 0 ? { ...empty, bags: dispensed.map(bagFromDispensed) } : empty;
  });
  const [validationError, setValidationError] = useState<string | null>(null);
  // 照合と入力のどちらを出しているか。null のあいだは設定に従う(有効なら照合から)。
  const [stepChoice, setStepChoice] = useState<"verify" | "input" | null>(null);
  const step = stepChoice ?? (settings.verification_enabled ? "verify" : "input");
  const [scan, setScan] = useState<TransfusionScanState>(EMPTY_TRANSFUSION_SCAN);
  const [confirmSubmit, setConfirmSubmit] = useState<(() => void) | null>(null);

  // 開始・終了を変えたら、まだ値の無い観察の時点の時刻を追わせる(入れた時刻は動かさない)。
  useEffect(() => {
    setValues((prev) => ({
      ...prev,
      observations: prev.observations.map((point) =>
        hasVitalValues(point.vitals)
          ? point
          : {
              ...point,
              vitals: { ...point.vitals, measuredAt: pointTime(point.point, prev.startedAt, prev.endedAt) },
            },
      ),
    }));
  }, [values.startedAt, values.endedAt]);

  // ---- 警告(ガイド 7.5.3-2 ①〜⑤と出庫記録との突き合わせ) ----
  const patientType = useMemo(
    () => patientTypeForDispense(bloodType.summary, summary),
    [bloodType.summary, summary],
  );
  const advisoryInput = useMemo<Advisory[]>(() => {
    const list: Advisory[] = [];
    const warn = (kind: Advisory["kind"], parts: (string | number)[], message: string) =>
      list.push({ key: advisoryKey(kind, ...parts), kind, severity: severityOf(kind, true), message });
    const day = localDay(values.startedAt) || today();
    values.bags.forEach((bag, index) => {
      if (!bag.productCode || bag.outcome !== "given") return;
      const label = `バッグ${index + 1}`;
      const lot = bag.lotNumber.trim();
      const record = dispensed.find((d) => d.lotNumber === lot);
      if (lot && !record) {
        warn("perform-not-dispensed", [index, lot], `${label}: 製剤番号 ${lot} は出庫記録にありません`);
      }
      if (record) {
        if (record.expiry && record.expiry < day) {
          warn("dispense-expiry", [index, record.expiry], `${label}: 有効期限（${record.expiry}）が切れています`);
        }
        const item = productItems.find((i) => i.item_code === record.productCode);
        if (item?.requires_irradiation && !record.irradiated) {
          warn("dispense-irradiation", [index], `${label}: 照射が要る製剤ですが未照射です`);
        }
        if (record.crossmatch === "incompatible") {
          warn("dispense-crossmatch", [index], `${label}: 交差適合試験が不適合です`);
        }
      }
      const category = productItems.find((i) => i.item_code === bag.productCode)?.category;
      if (productNeedsBloodType(category) && patientType.abo && bag.abo) {
        const aboOk = compatibleAbo(patientType, category).includes(bag.abo);
        const rhdOk =
          !bag.rhd || compatibleRhd(patientType, category, summary.urgencyLevel).includes(bag.rhd);
        if (!aboOk || !rhdOk) {
          warn(
            "dispense-blood-type",
            [index, bag.abo, bag.rhd],
            `${label}: ${bloodTypeLabel(bag.abo, bag.rhd)} は患者の型（${bloodTypeLabel(patientType.abo, patientType.rhd)}）に適合しません`,
          );
        }
      }
    });
    // 出庫したのに入力に無いバッグ(実施にも未実施にも入っていない)。
    for (const record of dispensed) {
      if (!record.lotNumber || values.bags.some((bag) => bag.lotNumber.trim() === record.lotNumber)) {
        continue;
      }
      warn("perform-missing-bag", [record.lotNumber], `出庫したバッグ No.${record.lotNumber} が入力にありません`);
    }
    const history = reactionHistoryAdvisory(reactions.history);
    if (history) list.push(history);
    return list;
  }, [values.bags, values.startedAt, dispensed, productItems, patientType, summary.urgencyLevel, reactions.history]);
  const session = useAdvisorySession(advisoryInput, "transfusion-perform");

  function update<K extends keyof TransfusionPerformFormValues>(
    key: K,
    value: TransfusionPerformFormValues[K],
  ) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function updateBag(index: number, patch: Partial<TransfusionBagLine>) {
    setValues((prev) => ({
      ...prev,
      bags: prev.bags.map((bag, i) => (i === index ? { ...bag, ...patch } : bag)),
    }));
  }

  /**
   * 製剤を選び直したときは、コード・名称・単位の呼び方をまとめて入れ替える
   * (バラバラに持つと記録が食い違う)。単位数は上書きしない —— ここは「実際に
   * 何単位入れたか」の記録で、入力済みの値を製剤の既定値で消してはいけない。
   * まだ空の行(手で足したバッグ)にだけ既定値を入れる。
   */
  function handleProductChange(index: number, code: string) {
    const item = productItems.find((i) => i.item_code === code);
    if (!item) {
      // マスタから消えた製剤(選択肢に残してあるもの)を選び直したときは値を保つ。
      updateBag(index, { productCode: code });
      return;
    }
    setValues((prev) => ({
      ...prev,
      bags: prev.bags.map((bag, i) =>
        i === index
          ? {
              ...bag,
              productCode: item.item_code,
              productName: item.name,
              unitLabel: item.unit_label,
              units: bag.units || (item.default_units === null ? "" : String(item.default_units)),
            }
          : bag,
      ),
    }));
  }

  function addBag() {
    setValues((prev) => ({ ...prev, bags: [...prev.bags, emptyBagLine()] }));
  }

  function removeBag(index: number) {
    setValues((prev) => ({ ...prev, bags: prev.bags.filter((_, i) => i !== index) }));
  }

  function updateVitals(point: string, patch: Partial<VitalFormValues>) {
    setValues((prev) => ({
      ...prev,
      observations: prev.observations.map((o) =>
        o.point === point ? { ...o, vitals: { ...o.vitals, ...patch } } : o,
      ),
    }));
  }

  function toggleSymptom(code: string) {
    setValues((prev) => ({
      ...prev,
      symptoms: prev.symptoms.includes(code)
        ? prev.symptoms.filter((c) => c !== code)
        : [...prev.symptoms, code],
    }));
  }

  function handleConfirmerChange(id: string) {
    const found = practitioners.practitioners.find((p) => p.id === id);
    setValues((prev) => ({
      ...prev,
      confirmerId: id,
      confirmerName: found ? practitionerDisplayName(found) : "",
    }));
  }

  /** 照合を終えて入力へ。 */
  function completeVerification() {
    setValues((prev) => ({
      ...prev,
      verification: {
        status: "verified",
        patientMatched: true,
        bagNumbers: scan.bagNumbers,
        at: nowFhirDateTime(),
      },
    }));
    setStepChoice("input");
  }

  function skipVerification(reasonCode: string, reasonText: string) {
    setValues((prev) => ({
      ...prev,
      verification: {
        status: "skipped",
        patientMatched: scan.patient === "matched",
        bagNumbers: scan.bagNumbers,
        reasonCode,
        reasonText,
        at: nowFhirDateTime(),
      },
    }));
    setStepChoice("input");
  }

  function validate(): string | null {
    if (!values.startedAt) return "開始時刻を入れてください。";
    if (values.endedAt && values.endedAt < values.startedAt) {
      return "終了時刻は開始時刻より後にしてください。";
    }
    // 製剤が選ばれていない行は保存しないので、検証も選ばれた行だけで行う。
    const bags = values.bags.filter((bag) => bag.productCode);
    if (bags.every((bag) => bag.outcome !== "given")) {
      return "輸血したバッグの製剤を 1 本以上選んでください。";
    }
    // 製剤番号は遡及調査の起点。空のまま登録できると、後から追えなくなる。
    if (bags.some((bag) => !bag.lotNumber.trim())) return "製剤番号を入れてください。";
    // 「観察していない」と「観察して無かった」を区別するため、必ず選ばせる。
    if (!values.reaction) return "副作用の有無を選んでください。";
    if (values.reaction === "present" && values.symptoms.length === 0 && !values.reactionNote.trim()) {
      return "副作用の症状を選ぶか内容を入れてください。";
    }
    for (const point of values.observations) {
      if (hasVitalValues(point.vitals) && !point.vitals.measuredAt) {
        return `${observationPointDisplay(point.point)}の時刻を入れてください。`;
      }
    }
    return null;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const error = validate();
    setValidationError(error);
    if (error) return;
    if (session.blocked.length > 0) {
      setValidationError(session.blocked.map((advisory) => advisory.message).join(" / "));
      return;
    }

    const submitted: TransfusionPerformFormValues = {
      ...values,
      performerId: practitionerId ?? "",
      performerName: practitionerName ?? "",
      // 製剤を選んでいない行(足したまま入力しなかった行)は落とす。
      bags: values.bags.filter((bag) => bag.productCode),
    };
    const submit = () =>
      register.mutate(buildTransfusionPerformBundle(submitted, order, task), { onSuccess: onClose });
    if (session.pending.length > 0) {
      setConfirmSubmit(() => submit);
      return;
    }
    session.confirm([]);
    submit();
  }

  const title = `輸血の実施入力${patientName ? ` - ${patientName}` : ""}`;
  const confirmerSelect = (
    <label>
      確認者
      <select value={values.confirmerId} onChange={(e) => handleConfirmerChange(e.target.value)}>
        <option value="">選択してください</option>
        {practitioners.practitioners.map((p) => (
          <option key={p.id} value={p.id}>
            {practitionerDisplayName(p)}
          </option>
        ))}
      </select>
    </label>
  );

  if (step === "verify") {
    return (
      <Modal title={`${title} - 照合`} onClose={onClose} className="modal--wide">
        <div className="transfusion-perform">
          <ErrorBanner error={practitioners.error} />
          <div className="lab-order-item__fields">{confirmerSelect}</div>
          <TransfusionVerifyStep
            patient={patient}
            bags={values.bags.filter((bag) => bag.productCode && bag.outcome === "given")}
            practitionerName={practitionerName}
            confirmerName={values.confirmerName}
            scan={scan}
            onScanChange={setScan}
            onComplete={completeVerification}
            onSkip={skipVerification}
          />
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={title} onClose={onClose} className="modal--wide">
      <form className="transfusion-perform" onSubmit={handleSubmit}>
        {validationError && (
          <div className="error-banner" role="alert">
            <p className="error-banner__line error-banner__line--error">{validationError}</p>
          </div>
        )}
        <ErrorBanner error={register.error} />
        <ErrorBanner error={products.error} />
        <ErrorBanner error={practitioners.error} />
        <AdvisoryNotice advisories={session.advisories} />

        {/* 誰の何型の輸血なのか。取り違えると別の患者に別の型を入れた記録が残るので、
            入力欄より先に目に入る位置と大きさで出す。 */}
        <p className="rad-perform__items">
          <span className="rad-perform__items-label">患者血液型</span>
          {summary.bloodTypeDisplay ? (
            <TransfusionBloodBadge abo={summary.aboBloodType} rhd={summary.rhdBloodType} />
          ) : (
            "未指定"
          )}
          {values.verification && (
            <>
              {" "}
              <span className="dose-conversion__badge">
                {values.verification.status === "verified" ? "照合済" : "照合スキップ"}
              </span>
            </>
          )}
        </p>

        <div className="lab-order-item__fields">
          <label>
            開始時刻 *
            <input
              type="datetime-local"
              value={values.startedAt}
              onChange={(e) => update("startedAt", e.target.value)}
              required
            />
          </label>
          <label>
            終了時刻
            <input
              type="datetime-local"
              value={values.endedAt}
              onChange={(e) => update("endedAt", e.target.value)}
            />
          </label>
          <label>
            実施者
            <input type="text" value={practitionerName ?? "(未設定)"} readOnly disabled />
          </label>
          {confirmerSelect}
        </div>

        <section className="lab-order-item__section">
          <div className="lab-order-item__section-head">
            <h3>バッグ *</h3>
            <button type="button" onClick={addBag}>
              バッグ追加
            </button>
          </div>
          <ul className="transfusion-order__products">
            {values.bags.map((bag, index) => (
              <BagCard
                // バッグは並べ替えず、追加・削除しかしないので index を鍵にしてよい。
                key={index}
                index={index}
                bag={bag}
                productItems={productItems}
                onProductChange={(code) => handleProductChange(index, code)}
                onChange={(patch) => updateBag(index, patch)}
                onRemove={() => removeBag(index)}
              />
            ))}
            {values.bags.length === 0 && (
              <li className="order-select__muted">「バッグ追加」から入れてください。</li>
            )}
          </ul>
        </section>

        {/* 投与前・5 分後・15 分後・終了時の観察。空の時点は記録しない。 */}
        <section className="lab-order-item__section">
          <div className="lab-order-item__section-head">
            <h3>観察</h3>
          </div>
          <table className="rp-card__medicines rp-card__medicines--form transfusion-perform__observations">
            <thead>
              <tr>
                <th>時点</th>
                <th>時刻</th>
                <th>血圧</th>
                <th>脈拍</th>
                <th>体温</th>
                <th>SpO2</th>
                <th>呼吸数</th>
              </tr>
            </thead>
            <tbody>
              {values.observations.map((point) => (
                <tr key={point.point}>
                  <th scope="row">{observationPointDisplay(point.point)}</th>
                  <td>
                    <input
                      type="datetime-local"
                      value={point.vitals.measuredAt}
                      onChange={(e) => updateVitals(point.point, { measuredAt: e.target.value })}
                      aria-label={`${observationPointDisplay(point.point)}の時刻`}
                    />
                  </td>
                  <td className="transfusion-perform__bp">
                    <input
                      type="number"
                      value={point.vitals.systolic}
                      onChange={(e) => updateVitals(point.point, { systolic: e.target.value })}
                      aria-label={`${observationPointDisplay(point.point)}の収縮期血圧`}
                    />
                    /
                    <input
                      type="number"
                      value={point.vitals.diastolic}
                      onChange={(e) => updateVitals(point.point, { diastolic: e.target.value })}
                      aria-label={`${observationPointDisplay(point.point)}の拡張期血圧`}
                    />
                  </td>
                  {(["pulse", "temperature", "spo2", "respiration"] as const).map((key) => {
                    const measure = VITAL_MEASURES.find((m) => m.key === key);
                    return (
                      <td key={key}>
                        <input
                          type="number"
                          step={measure?.step}
                          value={point.vitals[key]}
                          onChange={(e) => updateVitals(point.point, { [key]: e.target.value })}
                          aria-label={`${observationPointDisplay(point.point)}の${measure?.label ?? key}`}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* 副作用。観察したうえで無かったことも記録として要るので、「なし」も選ばせる。
            あり なら学会の症状項目から選ぶ。 */}
        <section className="lab-order-item__section">
          <div className="lab-order-item__section-head">
            <h3>副作用 *</h3>
          </div>
          <div className="transfusion-order__blood-type">
            <div className="transfusion-order__chips" role="group" aria-label="副作用の有無">
              {REACTION_OPTIONS.map((option) => {
                const selected = values.reaction === option.code;
                return (
                  <button
                    key={option.code}
                    type="button"
                    aria-pressed={selected}
                    className={`transfusion-chip transfusion-chip--reaction-${option.code}${
                      selected ? " transfusion-chip--selected" : ""
                    }`}
                    onClick={() =>
                      update("reaction", selected ? "" : (option.code as TransfusionReaction))
                    }
                  >
                    {option.display}
                  </button>
                );
              })}
            </div>
          </div>
          {values.reaction === "present" && (
            <>
              <div className="transfusion-perform__symptoms" role="group" aria-label="症状">
                {REACTION_SYMPTOM_OPTIONS.map((option) => {
                  const selected = values.symptoms.includes(option.code);
                  return (
                    <button
                      key={option.code}
                      type="button"
                      aria-pressed={selected}
                      className={`transfusion-chip transfusion-chip--symptom${
                        selected ? " transfusion-chip--selected transfusion-chip--reaction-present" : ""
                      }`}
                      onClick={() => toggleSymptom(option.code)}
                    >
                      {option.display}
                    </button>
                  );
                })}
              </div>
              <div className="lab-order-item__fields">
                <label className="transfusion-perform__reaction-note">
                  内容
                  <input
                    type="text"
                    value={values.reactionNote}
                    onChange={(e) => update("reactionNote", e.target.value)}
                  />
                </label>
              </div>
            </>
          )}
        </section>

        <div className="lab-order-item__fields">
          <label className="transfusion-perform__comment">
            実施コメント
            <textarea
              value={values.comment}
              onChange={(e) => update("comment", e.target.value)}
              rows={2}
            />
          </label>
        </div>

        <div className="lab-order-item__actions">
          {settings.verification_enabled && (
            <button type="button" onClick={() => setStepChoice("verify")}>
              照合
            </button>
          )}
          <button type="submit" disabled={register.isPending}>
            {register.isPending ? "保存中..." : "実施登録"}
          </button>
        </div>
      </form>
      {confirmSubmit && (
        <AdvisoryConfirmModal
          advisories={session.pending}
          submitting={register.isPending}
          onConfirm={(overrides) => {
            session.confirm(overrides);
            setConfirmSubmit(null);
            confirmSubmit();
          }}
          onCancel={() => setConfirmSubmit(null)}
        />
      )}
    </Modal>
  );
}

// バッグ 1 本。出庫記録から初期値が入るが、実際に入れたものが違えばマスタから選び直す。
function BagCard({
  index,
  bag,
  productItems,
  onProductChange,
  onChange,
  onRemove,
}: {
  index: number;
  bag: TransfusionBagLine;
  productItems: {
    item_code: string;
    name: string;
    unit_label: string;
    default_units: number | null;
  }[];
  onProductChange: (code: string) => void;
  onChange: (patch: Partial<TransfusionBagLine>) => void;
  onRemove: () => void;
}) {
  // 有効期間切れなどでマスタの選択肢に無い製剤。保存済みの選択を失わせない。
  const missing =
    bag.productCode && !productItems.some((i) => i.item_code === bag.productCode);
  const given = bag.outcome === "given";

  return (
    <li className="transfusion-order__product">
      <div className="transfusion-order__product-head">
        <span className="transfusion-order__product-number">
          バッグ{index + 1} <TransfusionBloodBadge abo={bag.abo} rhd={bag.rhd} />
        </span>
        <button
          type="button"
          className="rp-card__icon-button"
          title="このバッグを削除"
          aria-label={`バッグ${index + 1}を削除`}
          onClick={onRemove}
        >
          <TrashIcon />
        </button>
      </div>

      <label className="transfusion-order__product-name">
        製剤 *
        <select value={bag.productCode} onChange={(e) => onProductChange(e.target.value)}>
          <option value="">選択してください</option>
          {productItems.map((item) => (
            <option key={item.item_code} value={item.item_code}>
              {item.name}
            </option>
          ))}
          {missing && <option value={bag.productCode}>{bag.productName} (無効)</option>}
        </select>
      </label>

      <label className="transfusion-order__product-units">
        単位数
        <input
          type="number"
          min={0}
          step="any"
          value={bag.units}
          onChange={(e) => onChange({ units: e.target.value })}
          disabled={!given}
        />
      </label>
      <span className="transfusion-order__product-unit-label">{bag.unitLabel}</span>

      {/* 遡及調査の起点。バッグごとに違うので必ず 1 本ずつ入れる。 */}
      <label className="transfusion-order__product-note">
        製剤番号 *
        <input
          type="text"
          value={bag.lotNumber}
          onChange={(e) => onChange({ lotNumber: e.target.value })}
        />
      </label>

      {/* 出庫したのに入れなかったバッグは消さずに残す(未実施・返却)。 */}
      <label className="transfusion-dispense__field">
        実施
        <select
          value={bag.outcome}
          onChange={(e) => onChange({ outcome: e.target.value as TransfusionBagOutcome })}
        >
          {BAG_OUTCOME_OPTIONS.map((o) => (
            <option key={o.code} value={o.code}>
              {o.display}
            </option>
          ))}
        </select>
      </label>

      {/* バッグごとの時刻。空なら輸血全体の開始・終了を使う。 */}
      {given && (
        <>
          <label className="transfusion-perform__bag-time">
            開始
            <input
              type="datetime-local"
              value={bag.startedAt}
              onChange={(e) => onChange({ startedAt: e.target.value })}
            />
          </label>
          <label className="transfusion-perform__bag-time">
            終了
            <input
              type="datetime-local"
              value={bag.endedAt}
              onChange={(e) => onChange({ endedAt: e.target.value })}
            />
          </label>
        </>
      )}
    </li>
  );
}
