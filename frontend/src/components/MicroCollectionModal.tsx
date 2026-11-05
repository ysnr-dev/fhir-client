import { useState, type FormEvent } from "react";
import { useCurrentPractitioner } from "../api/authQueries";
import { useMicroCollectionMethods, useMicroCollectionSites } from "../api/masterQueries";
import { useRecordMicroCollection } from "../api/queries";
import { microLabelPdfUrl } from "../api/reportsClient";
import { displayJapaneseName } from "../fhir/humanName";
import { LATERALITY_OPTIONS, microOrderContents, type MicroSpecimenValues } from "../fhir/microOrderHelpers";
import { nowDateTimeInput, toDateTimeInputValue, toFhirDateTime } from "../lib/dates";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

// 細菌検査の採取の記録(docs/micro-order-design.md §7.7)。カルテの細菌検査カードと看護ワークシートから開く。
//
// 培養の結果は採った時刻と部位で読み方が変わる(血液培養の 2 セットが別の穿刺か、採取から到着までの時間、
// 汚染菌か起炎菌か)。採取した場で日時を残し、予定と違う部位・方法で採ったらそこで直す。採取者は記録した
// ログインユーザー(医療従事者のとき)で、記録済みを直すときは最初に採った人のまま。直した内容で
// そのまま検体ラベルを刷れる(ラベルに採取日時と部位が出る)。

export function MicroCollectionModal({
  serviceRequest,
  itemRequests,
  defaultCollectedAt,
  onClose,
}: {
  serviceRequest: fhir4.ServiceRequest;
  itemRequests: fhir4.ServiceRequest[];
  /** まだ記録していないときの採取日時の初期値("YYYY-MM-DDTHH:mm")。省くといま。 */
  defaultCollectedAt?: string;
  onClose: () => void;
}) {
  const [specimen, setSpecimen] = useState<MicroSpecimenValues>(() => microOrderContents(itemRequests).specimen);
  const [collectedAt, setCollectedAt] = useState(
    () => toDateTimeInputValue(specimen.collectedDateTime) || defaultCollectedAt || nowDateTimeInput(),
  );
  const [printLabel, setPrintLabel] = useState(true);
  const [validationError, setValidationError] = useState<string | null>(null);
  const sites = useMicroCollectionSites();
  const methods = useMicroCollectionMethods();
  const { practitionerId, practitioner } = useCurrentPractitioner();
  const record = useRecordMicroCollection();

  const selectedSite = sites.data?.items.find((site) => site.code === specimen.siteCode);
  const lateralityEnabled = Boolean(selectedSite?.laterality_applicable);

  function handleSiteChange(code: string) {
    const site = sites.data?.items.find((s) => s.code === code);
    setSpecimen((current) => ({
      ...current,
      siteCode: code,
      siteName: site?.name ?? "",
      // 左右を持たない部位に変えたら左右指定も外す。
      lateralityCode: site?.laterality_applicable ? current.lateralityCode : "",
    }));
  }

  function handleMethodChange(code: string) {
    const method = methods.data?.items.find((m) => m.code === code);
    setSpecimen((current) => ({ ...current, methodCode: code, methodName: method?.name ?? "" }));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!collectedAt) {
      setValidationError("採取日時を入力してください。");
      return;
    }
    if (!specimen.siteCode) {
      setValidationError("採取部位を選択してください。");
      return;
    }
    setValidationError(null);
    const collector = specimen.collectorId
      ? { collectorId: specimen.collectorId, collectorName: specimen.collectorName }
      : {
          collectorId: practitionerId ?? "",
          collectorName: practitionerId ? displayJapaneseName(practitioner?.name) : "",
        };
    // ポップアップブロックを避けるため、クリックの同期処理でラベルのタブを先に開き、保存できたら PDF に差し替える
    // (保存前に刷ると、直す前の部位と予定の日付でラベルができてしまう)。
    const labelTab = printLabel ? window.open("", "_blank") : null;
    if (labelTab) labelTab.opener = null;
    record.mutate(
      {
        header: serviceRequest,
        itemRequests,
        specimen: { ...specimen, ...collector, collectedDateTime: toFhirDateTime(collectedAt) },
      },
      {
        onSuccess: () => {
          labelTab?.location.replace(microLabelPdfUrl(serviceRequest.id ?? ""));
          onClose();
        },
        onError: () => labelTab?.close(),
      },
    );
  }

  return (
    <Modal title="細菌検査の採取" onClose={onClose}>
      {validationError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}
      <ErrorBanner error={record.error} />
      <form className="prescription-form" onSubmit={handleSubmit}>
        <fieldset>
          <label>
            採取日時
            <input type="datetime-local" value={collectedAt} onChange={(e) => setCollectedAt(e.target.value)} />
          </label>
          <label>
            採取部位
            <select value={specimen.siteCode} onChange={(e) => handleSiteChange(e.target.value)}>
              <option value="">選択してください</option>
              {sites.data?.items.map((site) => (
                <option key={site.code} value={site.code}>
                  {site.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            左右
            <select
              value={specimen.lateralityCode}
              onChange={(e) => setSpecimen((current) => ({ ...current, lateralityCode: e.target.value }))}
              disabled={!lateralityEnabled}
            >
              <option value="">指定なし</option>
              {LATERALITY_OPTIONS.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.display}
                </option>
              ))}
            </select>
          </label>
          <label>
            採取方法
            <select value={specimen.methodCode} onChange={(e) => handleMethodChange(e.target.value)}>
              <option value="">指定なし</option>
              {methods.data?.items.map((method) => (
                <option key={method.code} value={method.code}>
                  {method.name}
                </option>
              ))}
            </select>
          </label>
          <label className="patho-collection__print">
            <input type="checkbox" checked={printLabel} onChange={(e) => setPrintLabel(e.target.checked)} />
            ラベル発行
          </label>
        </fieldset>
        <div className="prescription-form__submit">
          <button type="submit" disabled={record.isPending || !specimen.id}>
            {record.isPending ? "送信中..." : "採取"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
