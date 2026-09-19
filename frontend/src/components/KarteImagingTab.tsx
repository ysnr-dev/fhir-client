import { lazy, Suspense, useEffect, useState } from "react";
import { useImagingStudySearch } from "../api/queries";
import { parseImagingStudy } from "../fhir/imagingHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { ImagingStudyTable } from "./ImagingStudyTable";
import { KarteImagingDetail } from "./KarteImagingDetail";
import { Pagination } from "./Pagination";

// ZIP の展開と DICOM のタグ解析は、取込を開いたときだけ読み込む。
const KarteImagingImportForm = lazy(() => import("./KarteImagingImportForm"));

// カルテ画面の「DICOM」タブ(docs/imaging-design.md)。取り込んだ DICOM をスタディ単位で
// 並べ、シリーズを選んでビューアで開く。
//
// 一覧と詳細は URL(view パラメータ)で表す。取込は選んだファイルを URL では復元
// できないので、このコンポーネント内の状態に留める。

type Mode = { kind: "list" } | { kind: "detail"; studyId: string } | { kind: "import" };

const MODE_TITLES: Record<Mode["kind"], string> = {
  list: "DICOM",
  detail: "DICOM 表示",
  import: "DICOM 取込",
};

interface KarteImagingTabProps {
  patientId: string;
  /** URL から渡される表示対象の ImagingStudy の ID。空なら一覧。 */
  view: string;
  onViewChange: (view: string | null) => void;
}

export function KarteImagingTab({ patientId, view, onViewChange }: KarteImagingTabProps) {
  const [importing, setImporting] = useState(false);
  const [offset, setOffset] = useState(0);

  // 戻る・進むで表示対象が変わったら、開いていた取込フォームは畳む。
  useEffect(() => setImporting(false), [view]);

  const mode: Mode = importing
    ? { kind: "import" }
    : view
      ? { kind: "detail", studyId: view }
      : { kind: "list" };

  const { bundle, total, count, hasPrevious, hasNext, isLoading, error } = useImagingStudySearch(
    patientId,
    offset,
  );
  const studies =
    bundle?.entry
      ?.map((e) => e.resource)
      .filter((r): r is fhir4.ImagingStudy => r?.resourceType === "ImagingStudy")
      .map(parseImagingStudy) ?? [];

  function backToList() {
    setImporting(false);
    onViewChange(null);
  }

  if (mode.kind !== "list") {
    return (
      <div className="karte-tabpanel">
        <div className="karte-tabpanel__header">
          <h3>{MODE_TITLES[mode.kind]}</h3>
          <div className="karte-tabpanel__actions">
            <button type="button" onClick={backToList}>
              ← 一覧に戻る
            </button>
          </div>
        </div>
        {mode.kind === "detail" ? (
          <KarteImagingDetail patientId={patientId} studyId={mode.studyId} />
        ) : (
          <Suspense fallback={<p>読み込み中...</p>}>
            <KarteImagingImportForm patientId={patientId} onSaved={backToList} />
          </Suspense>
        )}
      </div>
    );
  }

  return (
    <div className="karte-tabpanel">
      <div className="karte-tabpanel__header">
        <h3>{MODE_TITLES.list}</h3>
        <div className="karte-tabpanel__actions">
          <button type="button" onClick={() => setImporting(true)}>
            取込
          </button>
        </div>
      </div>

      <ErrorBanner error={error} />

      {isLoading ? (
        <p>読み込み中...</p>
      ) : (
        <>
          <ImagingStudyTable
            patientId={patientId}
            studies={studies}
            onView={(studyId) => onViewChange(studyId)}
          />
          <Pagination
            offset={offset}
            count={count}
            total={total}
            hasPrevious={hasPrevious}
            hasNext={hasNext}
            onPrevious={() => setOffset((o) => Math.max(0, o - count))}
            onNext={() => setOffset((o) => o + count)}
          />
        </>
      )}
    </div>
  );
}
