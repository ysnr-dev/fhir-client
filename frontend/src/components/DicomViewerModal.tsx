import { cache } from "@cornerstonejs/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { useImagingStudyInstances } from "../api/queries";
import {
  imagingInstanceUrl,
  isDisplayableSeries,
  isDisplayableSopClass,
  type ImagingSeries,
  type ImagingStudySummary,
} from "../fhir/imagingHelpers";
import type { CapturedImage, CornerTexts } from "../imaging/captureViewport";
import { wadouriImageId } from "../imaging/cornerstoneSetup";
import { CT_WINDOW_PRESETS } from "../imaging/windowPresets";
import { today } from "../lib/dates";
import { DicomAnnotationTextModal } from "./DicomAnnotationTextModal";
import { DicomSaveImageModal } from "./DicomSaveImageModal";
import { DicomTagListModal } from "./DicomTagListModal";
import {
  DicomViewport,
  type DicomViewportHandle,
  type RequestAnnotationText,
  type ViewerTool,
  type ViewportState,
} from "./DicomViewport";
import { ErrorBanner } from "./ErrorBanner";

// DICOM のビューア(全画面)。左にシリーズ、中央に画像、上に道具を並べる。
// 計測・注釈は開いている間だけのもので保存しない。残したいときは描いたままの
// 画像を JPEG にしてカルテのファイルに登録する。

const TOOL_GROUPS: { label: string; tools: { key: ViewerTool; label: string }[] }[] = [
  {
    label: "操作",
    tools: [
      { key: "window", label: "ウィンドウ" },
      { key: "pan", label: "移動" },
      { key: "zoom", label: "拡大" },
    ],
  },
  {
    label: "計測",
    tools: [
      { key: "length", label: "距離" },
      { key: "angle", label: "角度" },
      { key: "cobbAngle", label: "Cobb角" },
      { key: "bidirectional", label: "長径・短径" },
      { key: "probe", label: "点" },
    ],
  },
  {
    label: "範囲",
    tools: [
      { key: "rectangle", label: "矩形" },
      { key: "ellipse", label: "楕円" },
      { key: "circle", label: "円" },
      { key: "freehand", label: "フリーハンド" },
    ],
  },
  {
    label: "注釈",
    tools: [
      { key: "arrow", label: "矢印" },
      { key: "label", label: "文字" },
    ],
  },
];

interface TextRequest {
  current: string;
  done: (text: string | null) => void;
}

const SAVED_NOTICE_MS = 3000;

const CORNER_KEYS = {
  "top-left": "topLeft",
  "top-right": "topRight",
  "bottom-left": "bottomLeft",
  "bottom-right": "bottomRight",
} as const;

const DEFAULT_WINDOW = "default";

export default function DicomViewerModal({
  patientId,
  study,
  series,
  initialSeriesUid,
  onClose,
}: {
  patientId: string;
  study: ImagingStudySummary;
  series: ImagingSeries[];
  initialSeriesUid: string;
  onClose: () => void;
}) {
  const viewportRef = useRef<DicomViewportHandle>(null);
  const [seriesUid, setSeriesUid] = useState(initialSeriesUid);
  const [tool, setTool] = useState<ViewerTool>("window");
  const [state, setState] = useState<ViewportState | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [textRequest, setTextRequest] = useState<TextRequest | null>(null);
  const [captured, setCaptured] = useState<CapturedImage | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  const requestText: RequestAnnotationText = (current, done) => setTextRequest({ current, done });

  const { data: stored, error: storedError } = useImagingStudyInstances(patientId, study.studyUid);

  const displayable = useMemo(() => series.filter(isDisplayableSeries), [series]);
  const current = displayable.find((s) => s.uid === seriesUid) ?? displayable[0];

  // 1 枚 = 画像 1 つ。マルチフレーム(動画)はフレームごとに 1 つ。フレーム数は
  // ImagingStudy に無いので、保存済みインスタンスの一覧が届いてから組み立てる。
  const images = useMemo(() => {
    if (!current || !stored) return [];
    const frames = new Map(stored.map((i) => [i.sop_instance_uid, i.number_of_frames ?? 1]));
    return current.instances
      .filter((instance) => isDisplayableSopClass(instance.sopClassUid))
      .flatMap((instance) => {
        const url = imagingInstanceUrl(patientId, instance.uid);
        const count = frames.get(instance.uid) ?? 1;
        if (count <= 1) return [{ sopInstanceUid: instance.uid, imageId: wadouriImageId(url) }];
        return Array.from({ length: count }, (_, i) => ({
          sopInstanceUid: instance.uid,
          imageId: wadouriImageId(url, i + 1),
        }));
      });
  }, [current, stored, patientId]);
  const imageIds = useMemo(() => images.map((image) => image.imageId), [images]);

  // 復号済みの画像は枚数ぶんメモリに載る。閉じるときに手放す。
  useEffect(() => () => cache.purgeCache(), []);

  useEffect(() => {
    if (!savedNotice) return;
    const timer = window.setTimeout(() => setSavedNotice(false), SAVED_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [savedNotice]);

  const dialogOpen = tagsOpen || textRequest !== null || captured !== null;

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (dialogOpen) return;
      const position = displayable.findIndex((s) => s.uid === current?.uid);
      if (e.key === "Escape") onClose();
      else if (e.key === "Delete" || e.key === "Backspace") {
        viewportRef.current?.deleteSelectedAnnotations();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        viewportRef.current?.undo();
      }
      else if (e.key === "ArrowUp") viewportRef.current?.scroll(-1);
      else if (e.key === "ArrowDown") viewportRef.current?.scroll(1);
      else if (e.key === "ArrowLeft" && position > 0) setSeriesUid(displayable[position - 1].uid);
      else if (e.key === "ArrowRight" && position >= 0 && position < displayable.length - 1) {
        setSeriesUid(displayable[position + 1].uid);
      } else return;
      e.preventDefault();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [displayable, current, dialogOpen, onClose]);

  const currentImage = state ? images[state.index] : undefined;
  const isCt = current?.modality === "CT";

  // 画面の四隅と同じ内容。JPEG に書き込むときにも使う。
  const corners: CornerTexts = {
    topLeft: [study.sourcePatientName, study.sourcePatientId, study.institutionName],
    topRight: [
      [study.date, study.time].filter(Boolean).join(" "),
      study.description,
      current?.description ?? "",
    ],
    bottomLeft: state
      ? [
          `Im ${state.index + 1} / ${state.total}`,
          state.zoom != null ? `拡大 ${Math.round(state.zoom * 100)}%` : "",
        ]
      : [],
    bottomRight:
      state?.windowWidth != null && state.windowCenter != null
        ? [`WW ${Math.round(state.windowWidth)} / WL ${Math.round(state.windowCenter)}`]
        : [],
  };

  async function handleCapture() {
    const viewport = viewportRef.current;
    if (!viewport) return;
    setCapturing(true);
    try {
      setCaptured(await viewport.captureJpeg(corners));
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setCapturing(false);
    }
  }

  const defaultTitle = [
    study.date,
    current?.description || current?.modality,
    state && `Im ${state.index + 1}`,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="dicom-viewer" role="dialog" aria-modal="true" aria-label="画像ビューア">
      <div className="dicom-viewer__toolbar">
        {TOOL_GROUPS.map((group) => (
          <div
            key={group.label}
            className="dicom-viewer__tools"
            role="group"
            aria-label={`左ドラッグの操作(${group.label})`}
          >
            {group.tools.map((item) => (
              <button
                key={item.key}
                type="button"
                className={item.key === tool ? "dicom-viewer__tool--active" : undefined}
                aria-pressed={item.key === tool}
                onClick={() => setTool(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>
        ))}
        {isCt && (
          <select
            aria-label="ウィンドウのプリセット"
            value=""
            onChange={(e) => {
              const preset = CT_WINDOW_PRESETS.find((p) => p.label === e.target.value);
              viewportRef.current?.setWindow(
                e.target.value === DEFAULT_WINDOW || !preset
                  ? null
                  : { width: preset.width, center: preset.center },
              );
            }}
          >
            <option value="" disabled>
              プリセット
            </option>
            <option value={DEFAULT_WINDOW}>既定</option>
            {CT_WINDOW_PRESETS.map((preset) => (
              <option key={preset.label} value={preset.label}>
                {preset.label}
              </option>
            ))}
          </select>
        )}
        <button type="button" onClick={() => viewportRef.current?.toggleInvert()}>
          反転
        </button>
        <button type="button" onClick={() => viewportRef.current?.undo()}>
          元に戻す
        </button>
        <button type="button" onClick={() => viewportRef.current?.clearAnnotations()}>
          注釈を消去
        </button>
        <button type="button" onClick={() => viewportRef.current?.reset()}>
          リセット
        </button>
        <button type="button" disabled={!currentImage} onClick={() => setTagsOpen(true)}>
          タグ
        </button>
        <button type="button" disabled={!currentImage || capturing} onClick={handleCapture}>
          画像を保存
        </button>
        {savedNotice && (
          <span className="dicom-viewer__notice" role="status">
            ファイルに保存しました
          </span>
        )}
        <button type="button" className="dicom-viewer__close" onClick={onClose}>
          閉じる
        </button>
      </div>

      <div className="dicom-viewer__body">
        <ul className="dicom-viewer__series">
          {displayable.map((item) => (
            <li key={item.uid}>
              <button
                type="button"
                className={item.uid === current?.uid ? "dicom-viewer__series--active" : undefined}
                aria-current={item.uid === current?.uid}
                onClick={() => setSeriesUid(item.uid)}
              >
                <span>
                  {[item.number != null && `#${item.number}`, item.modality].filter(Boolean).join(" ")}
                </span>
                <span>{item.description || "-"}</span>
                <span>{item.instances.length} 枚</span>
              </button>
            </li>
          ))}
        </ul>

        <div className="dicom-viewer__stage">
          <DicomViewport
            ref={viewportRef}
            imageIds={imageIds}
            tool={tool}
            onStateChange={setState}
            onError={setError}
            onRequestText={requestText}
          />
          {(["top-left", "top-right", "bottom-left", "bottom-right"] as const).map((corner) => (
            <div key={corner} className={`dicom-viewer__overlay dicom-viewer__overlay--${corner}`}>
              {corners[CORNER_KEYS[corner]].map((text, i) => (text ? <span key={i}>{text}</span> : null))}
            </div>
          ))}
          {(error || storedError) && (
            <div className="dicom-viewer__error">
              <ErrorBanner error={error ?? storedError} />
            </div>
          )}
        </div>
      </div>

      {tagsOpen && currentImage && (
        <DicomTagListModal
          patientId={patientId}
          sopInstanceUid={currentImage.sopInstanceUid}
          onClose={() => setTagsOpen(false)}
        />
      )}
      {textRequest && (
        <DicomAnnotationTextModal
          initialText={textRequest.current}
          onDone={(text) => {
            setTextRequest(null);
            textRequest.done(text);
          }}
        />
      )}
      {captured && (
        <DicomSaveImageModal
          patientId={patientId}
          image={captured}
          defaultTitle={defaultTitle}
          defaultDate={study.date || today()}
          onSaved={() => {
            setCaptured(null);
            setSavedNotice(true);
          }}
          onClose={() => setCaptured(null)}
        />
      )}
    </div>
  );
}
