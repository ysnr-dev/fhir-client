import { lazy, Suspense, useState } from "react";
import { useImagingStudy } from "../api/queries";
import {
  isDisplayableSeries,
  parseImagingStudy,
  sortedSeries,
  type ImagingSeries,
} from "../fhir/imagingHelpers";
import { isPatientMismatch } from "../fhir/patientHelpers";
import { ErrorBanner } from "./ErrorBanner";

// cornerstone(ビューア本体)は大きいので、画像を開くときまで読み込まない。
const DicomViewerModal = lazy(() => import("./DicomViewerModal"));
const DicomThumbnail = lazy(() => import("./DicomThumbnail"));

// スタディ 1 件の内容。検査の情報と、シリーズごとのサムネイル(中央の 1 枚)を並べる。

export function KarteImagingDetail({ patientId, studyId }: { patientId: string; studyId: string }) {
  const { data: result, isLoading, error: loadError } = useImagingStudy(studyId);
  const [viewerSeriesUid, setViewerSeriesUid] = useState<string | null>(null);

  const resource = result?.data;
  // URL の患者と ImagingStudy.subject が食い違う場合は他患者のものなので表示しない。
  const patientMismatch = isPatientMismatch(patientId, resource?.subject);
  const error =
    loadError ?? (patientMismatch ? new Error("指定された画像は別の患者のものです。") : undefined);

  const study = resource && !patientMismatch ? parseImagingStudy(resource) : undefined;
  const series = resource && !patientMismatch ? sortedSeries(resource) : [];

  return (
    <>
      <ErrorBanner error={error} />

      {isLoading ? (
        <p>読み込み中...</p>
      ) : (
        study && (
          <div className="prescription-detail">
            <fieldset>
              <legend>検査情報</legend>
              <dl className="prescription-detail__common">
                <dt>検査日</dt>
                <dd>{[study.date, study.time].filter(Boolean).join(" ") || "-"}</dd>
                <dt>モダリティ</dt>
                <dd>{study.modalities.join(" / ") || "-"}</dd>
                <dt>検査内容</dt>
                <dd>{study.description || "-"}</dd>
                <dt>枚数</dt>
                <dd>
                  {study.numberOfSeries} シリーズ / {study.numberOfInstances} 枚
                </dd>
                <dt>取込元施設</dt>
                <dd>{study.institutionName || "-"}</dd>
                <dt>取込元の患者</dt>
                <dd>
                  {[study.sourcePatientName, study.sourcePatientId && `(${study.sourcePatientId})`]
                    .filter(Boolean)
                    .join(" ") || "-"}
                </dd>
              </dl>
            </fieldset>

            <ul className="karte-imaging-series">
              {series.map((item) => (
                <SeriesCard
                  key={item.uid}
                  patientId={patientId}
                  series={item}
                  onOpen={() => setViewerSeriesUid(item.uid)}
                />
              ))}
            </ul>
          </div>
        )
      )}

      {viewerSeriesUid && study && (
        <Suspense fallback={null}>
          <DicomViewerModal
            patientId={patientId}
            study={study}
            series={series}
            initialSeriesUid={viewerSeriesUid}
            onClose={() => setViewerSeriesUid(null)}
          />
        </Suspense>
      )}
    </>
  );
}

function SeriesCard({
  patientId,
  series,
  onOpen,
}: {
  patientId: string;
  series: ImagingSeries;
  onOpen: () => void;
}) {
  const displayable = isDisplayableSeries(series);
  const middle = series.instances[Math.floor(series.instances.length / 2)];
  const label = [series.number != null && `#${series.number}`, series.modality, series.description]
    .filter(Boolean)
    .join(" ");

  return (
    <li className="karte-imaging-series__item">
      <button
        type="button"
        className="karte-imaging-series__thumb"
        disabled={!displayable}
        aria-label={`${label} を開く`}
        onClick={onOpen}
      >
        {displayable && middle ? (
          <Suspense fallback={null}>
            <DicomThumbnail patientId={patientId} sopInstanceUid={middle.uid} />
          </Suspense>
        ) : (
          <span className="karte-imaging-series__unsupported">表示非対応</span>
        )}
      </button>
      <div className="karte-imaging-series__caption">
        <span>{label || "-"}</span>
        <span>{series.instances.length} 枚</span>
      </div>
    </li>
  );
}
