import { utilities } from "@cornerstonejs/core";
import { useEffect, useRef, useState } from "react";
import { imagingInstanceUrl } from "../fhir/imagingHelpers";
import { initCornerstone, wadouriImageId } from "../imaging/cornerstoneSetup";

// シリーズのサムネイル(1 枚を小さく描く)。cornerstone は描画用の領域を 1 つ使い回すので、
// 並んだサムネイルは 1 枚ずつ順に描く。
let queue: Promise<unknown> = Promise.resolve();

const SIZE = 160;

export default function DicomThumbnail({
  patientId,
  sopInstanceUid,
}: {
  patientId: string;
  sopInstanceUid: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    const imageId = wadouriImageId(imagingInstanceUrl(patientId, sopInstanceUid));
    queue = queue
      .then(() => initCornerstone())
      .then(() => {
        const canvas = canvasRef.current;
        if (cancelled || !canvas) return;
        return utilities.loadImageToCanvas({ canvas, imageId, thumbnail: true });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [patientId, sopInstanceUid]);

  if (failed) return <span className="karte-imaging-series__unsupported">表示できません</span>;
  return <canvas ref={canvasRef} width={SIZE} height={SIZE} />;
}
