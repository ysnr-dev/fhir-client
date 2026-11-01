import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useCurrentPractitioner } from "../api/authQueries";
import { useTransfusionProductOptions } from "../api/masterQueries";
import {
  useAutologousAppointments,
  useBloodType,
  useRecentLabResults,
  useRegisterAutologousCollection,
  useTransfusionPerformDetail,
  useTransfusionSettings,
  type TransfusionWorklistRow,
} from "../api/queries";
import { autologousLabelPdfUrl } from "../api/reportsClient";
import type { Advisory } from "../fhir/advisoryHelpers";
import {
  autologousExpiryAdvisory,
  autologousUnitsByOrderId,
  buildAutologousCollectionBundle,
  collectedVolumeTotal,
  defaultLotNumber,
  expiryFrom,
  type AutologousCollectionFormValues,
} from "../fhir/autologousHelpers";
import { plannedVolumeOf } from "../fhir/autologousPlanHelpers";
import { latestHemoglobin } from "../fhir/bodyMeasureHelpers";
import { displayName, patientNumberOf } from "../fhir/patientHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { splitPerformBundle } from "../fhir/radResultHelpers";
import { autologousHbAdvisory } from "../fhir/transfusionAdvisoryHelpers";
import { transfusionOrderProducts, type AboBloodType, type RhdBloodType } from "../fhir/transfusionOrderHelpers";
import { localDay, nowDateTimeInput } from "../lib/dates";
import { useAdvisorySession } from "../hooks/useAdvisorySession";
import { AdvisoryNotice } from "./AdvisoryNotice";
import { AutologousPlanTable, plannedTotalOf } from "./AutologousPlanTable";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";
import { TransfusionBloodBadge } from "./TransfusionBloodBadge";

// 輸血一覧の「採血」。自己血(貯血式)のオーダーに対して、採った血を 1 本ずつ記録する
// (JAHIS 患者安全ガイド 輸血編 7.7)。有効期限は採血日と製剤マスタの有効日数から決めて
// 手では変えられず、使用予定日(投与予定日)が期限より後なら警告する。登録した採血記録ごとに
// 採血ラベル(患者 ID・氏名・型・製剤番号・採血日・使用予定日・有効期限・署名欄)を刷れる。
//
// 採血予定(オーダーで組んだ日程)があれば上に並べ、選んだ予定の日時・量を初期値に入れて、
// 登録でその予定を採血済みにする。予定に無い採血(臨時)は予定を選ばずに登録する。
// 直近の Hb を出し、施設設定の下限を下回る・未検査なら警告する。

interface Props {
  row: TransfusionWorklistRow;
  /** 一覧の採血予定日の行から開いたときに選んでおく予定。 */
  appointmentId?: string;
  onClose: () => void;
}

export function AutologousCollectionModal({ row, appointmentId, onClose }: Props) {
  const { order, patient } = row;
  const register = useRegisterAutologousCollection();
  const { practitionerId, practitioner } = useCurrentPractitioner();
  const settings = useTransfusionSettings();
  const products = useTransfusionProductOptions();
  const autoProducts = useMemo(
    () => (products.data?.items ?? []).filter((item) => item.category === "auto"),
    [products.data],
  );
  const ordered = useMemo(() => transfusionOrderProducts(row.itemRequests, order), [row.itemRequests, order]);
  const patientId = order.subject?.reference?.split("/").pop();
  const bloodType = useBloodType(patientId);
  const labs = useRecentLabResults(patientId);
  const hb = useMemo(() => latestHemoglobin(labs.observations), [labs.observations]);
  const perform = useTransfusionPerformDetail(order.id);
  const collected = useMemo(() => {
    const { procedures, dispenses } = splitPerformBundle(perform.data?.data);
    return autologousUnitsByOrderId(procedures, dispenses).get(order.id ?? "") ?? [];
  }, [perform.data, order.id]);
  const plan = useAutologousAppointments(order.id);
  const [selectedId, setSelectedId] = useState(appointmentId ?? "");
  const selected = plan.appointments.find((a) => a.id === selectedId && a.status === "booked");

  const [values, setValues] = useState<AutologousCollectionFormValues>(() => {
    const now = nowDateTimeInput();
    const product =
      autoProducts.find((item) => ordered.some((line) => line.productCode === item.item_code)) ??
      autoProducts[0];
    return {
      collectedAt: now,
      volume: "400",
      lotNumber: defaultLotNumber(patient ? (patientNumberOf(patient) ?? "") : "", now, collected.length + 1),
      productCode: product?.item_code ?? "",
      productName: product?.name ?? "",
      abo: "",
      rhd: "",
      expiry: expiryFrom(now, product?.shelf_life_days),
      performerId: "",
      performerName: "",
      comment: "",
    };
  });
  const [validationError, setValidationError] = useState<string | null>(null);

  // 予定を選んだら、その日の今の時刻と予定量を入れる(予定日に採るのが普通なので日付は予定から、
  // 時刻は実際に採った今から)。
  useEffect(() => {
    if (!selected) return;
    const day = localDay(selected.start);
    const now = nowDateTimeInput();
    const collectedAt = day ? `${day}T${now.slice(11, 16)}` : now;
    const volume = plannedVolumeOf(selected);
    setValues((prev) => ({
      ...prev,
      collectedAt,
      volume: volume || prev.volume,
      lotNumber: defaultLotNumber(patient ? (patientNumberOf(patient) ?? "") : "", collectedAt, collected.length + 1),
    }));
  }, [selected, patient, collected.length]);

  // 患者の型(検査で確定したもの)。採血した血の型としてラベルと出庫の突き合わせに写す。
  const patientType = bloodType.summary?.tested
    ? { abo: bloodType.summary.abo as AboBloodType, rhd: bloodType.summary.rhd as RhdBloodType }
    : { abo: "" as const, rhd: "" as const };

  const shelfLife = autoProducts.find((item) => item.item_code === values.productCode)?.shelf_life_days;
  const expiry = expiryFrom(values.collectedAt, shelfLife);
  const advisoryInput = useMemo<Advisory[]>(() => {
    const list: Advisory[] = [];
    const expiryAdvisory = autologousExpiryAdvisory(expiry, order.occurrenceDateTime ?? "");
    if (expiryAdvisory) list.push(expiryAdvisory);
    if (!labs.isLoading) {
      const hbAdvisory = autologousHbAdvisory(hb, settings);
      if (hbAdvisory) list.push(hbAdvisory);
    }
    return list;
  }, [expiry, order.occurrenceDateTime, labs.isLoading, hb, settings]);
  const session = useAdvisorySession(advisoryInput, "autologous-collection");

  const collectedVolume = collectedVolumeTotal(collected);
  const plannedVolume = plannedTotalOf(plan.appointments);
  const orderedVolume = ordered
    .filter((line) => autoProducts.some((item) => item.item_code === line.productCode))
    .reduce((sum, line) => sum + (Number(line.units) || 0), 0);

  function update<K extends keyof AutologousCollectionFormValues>(key: K, value: AutologousCollectionFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function handleProductChange(code: string) {
    const item = autoProducts.find((i) => i.item_code === code);
    setValues((prev) => ({ ...prev, productCode: code, productName: item?.name ?? prev.productName }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!values.productCode) {
      setValidationError("製剤を選んでください。");
      return;
    }
    if (!values.collectedAt) {
      setValidationError("採血日時を入れてください。");
      return;
    }
    if (!values.lotNumber.trim()) {
      setValidationError("製剤番号を入れてください。");
      return;
    }
    if (!(Number(values.volume) > 0)) {
      setValidationError("採血量を入れてください。");
      return;
    }
    setValidationError(null);
    session.confirm([]);
    register.mutate(
      buildAutologousCollectionBundle(
        {
          ...values,
          expiry,
          abo: patientType.abo,
          rhd: patientType.rhd,
          performerId: practitionerId ?? "",
          performerName: practitioner ? practitionerDisplayName(practitioner) : "",
        },
        order,
        selected,
      ),
      { onSuccess: onClose },
    );
  }

  return (
    <Modal
      title={`自己血の採血${patient ? ` - ${displayName(patient)}` : ""}`}
      onClose={onClose}
      className="modal--wide"
    >
      <form className="transfusion-perform" onSubmit={handleSubmit}>
        {validationError && (
          <div className="error-banner" role="alert">
            <p className="error-banner__line error-banner__line--error">{validationError}</p>
          </div>
        )}
        <ErrorBanner error={register.error ?? products.error ?? perform.error ?? plan.error ?? labs.error} />
        <AdvisoryNotice advisories={session.advisories} />

        <p className="rad-perform__items">
          <span className="rad-perform__items-label">患者血液型</span>
          {patientType.abo ? <TransfusionBloodBadge abo={patientType.abo} rhd={patientType.rhd} /> : "未確定"}{" "}
          <span className="rad-perform__items-label">使用予定日</span>
          {(order.occurrenceDateTime ?? "").slice(0, 10) || "未定"}{" "}
          <span className="rad-perform__items-label">Hb</span>
          {hb ? `${hb.value} ${hb.unit}（${hb.date}）` : labs.isLoading ? "…" : "未検査"}{" "}
          <span className="rad-perform__items-label">累計</span>
          {collectedVolume} mL
          {plannedVolume > 0 && ` / 予定 ${plannedVolume} mL`}
          {orderedVolume > 0 && ` / 依頼 ${orderedVolume} mL`}
        </p>

        {plan.appointments.length > 0 && (
          <section className="lab-order-item__section">
            <div className="lab-order-item__section-head">
              <h3>採血予定</h3>
            </div>
            <AutologousPlanTable
              appointments={plan.appointments}
              selectedId={selectedId}
              onSelect={(appointment) => setSelectedId(appointment?.id ?? "")}
            />
            {selectedId && (
              <button type="button" className="rp-card__compact-button" onClick={() => setSelectedId("")}>
                予定なしで採血
              </button>
            )}
          </section>
        )}

        {collected.length > 0 && (
          <section className="lab-order-item__section">
            <div className="lab-order-item__section-head">
              <h3>採血済み</h3>
            </div>
            <ul className="karte-rp__medicines">
              {collected.map((unit, index) => (
                <li key={unit.dispenseId}>
                  <span className="karte-rp__number">{index + 1}</span>
                  <span className="karte-rp__medicine-name">{unit.label}</span>
                  <a className="button" href={autologousLabelPdfUrl(unit.procedureId)} target="_blank" rel="noopener">
                    ラベル
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="lab-order-item__fields">
          <label>
            製剤 *
            <select value={values.productCode} onChange={(e) => handleProductChange(e.target.value)}>
              <option value="">選択してください</option>
              {autoProducts.map((item) => (
                <option key={item.item_code} value={item.item_code}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            採血日時 *
            <input
              type="datetime-local"
              value={values.collectedAt}
              onChange={(e) => update("collectedAt", e.target.value)}
              required
            />
          </label>
          <label>
            採血量(mL) *
            <input type="number" min={0} step={1} value={values.volume} onChange={(e) => update("volume", e.target.value)} />
          </label>
          <label>
            製剤番号 *
            <input type="text" value={values.lotNumber} onChange={(e) => update("lotNumber", e.target.value)} />
          </label>
          <label>
            有効期限
            <input type="date" value={expiry} readOnly disabled />
          </label>
          <label>
            採血者
            <input type="text" value={practitioner ? practitionerDisplayName(practitioner) : "(未設定)"} readOnly disabled />
          </label>
        </div>
        <div className="lab-order-item__fields">
          <label className="transfusion-perform__comment">
            コメント
            <input type="text" value={values.comment} onChange={(e) => update("comment", e.target.value)} />
          </label>
        </div>

        <div className="lab-order-item__actions">
          <button type="submit" disabled={register.isPending}>
            {register.isPending ? "保存中..." : "採血登録"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
