import dicomParser from "dicom-parser";
import { useEffect, useMemo, useState } from "react";
import { masterFetch } from "../api/masterClient";
import { decodeDicomText } from "../fhir/dicomText";
import { imagingInstanceUrl } from "../fhir/imagingHelpers";
import { DICOM_TAGS } from "../imaging/dicomTagNames";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

// 表示中の画像の DICOM タグ一覧。ビューアの隅に出していない属性(撮影条件など)を読む。

interface TagRow {
  tag: string;
  label: string;
  name: string;
  vr: string;
  value: string;
}

const TEXT_VRS = new Set([
  "AE", "AS", "CS", "DA", "DS", "DT", "IS", "LO", "LT", "PN", "SH", "ST", "TM", "UC", "UI", "UR", "UT",
]);
const MAX_VALUES = 16;

function numbers(
  dataSet: dicomParser.DataSet,
  tag: string,
  size: number,
  read: (index: number) => number | undefined,
): string {
  const count = Math.floor((dataSet.elements[tag]?.length ?? 0) / size);
  const values = Array.from({ length: Math.min(count, MAX_VALUES) }, (_, i) => read(i));
  return values.join(" \\ ") + (count > MAX_VALUES ? " ..." : "");
}

function valueOf(dataSet: dicomParser.DataSet, tag: string, vr: string, charset: string): string {
  const element = dataSet.elements[tag];
  if (element.items) return `(${element.items.length} 項目)`;
  if (element.length <= 0) return "";
  if (TEXT_VRS.has(vr)) {
    const raw = dataSet.byteArray.subarray(element.dataOffset, element.dataOffset + element.length);
    return decodeDicomText(raw, charset).trim();
  }
  switch (vr) {
    case "US":
      return numbers(dataSet, tag, 2, (i) => dataSet.uint16(tag, i));
    case "SS":
      return numbers(dataSet, tag, 2, (i) => dataSet.int16(tag, i));
    case "UL":
      return numbers(dataSet, tag, 4, (i) => dataSet.uint32(tag, i));
    case "SL":
      return numbers(dataSet, tag, 4, (i) => dataSet.int32(tag, i));
    case "FL":
      return numbers(dataSet, tag, 4, (i) => dataSet.float(tag, i));
    case "FD":
      return numbers(dataSet, tag, 8, (i) => dataSet.double(tag, i));
    default:
      return `(${element.length} バイト)`;
  }
}

function buildRows(bytes: Uint8Array): TagRow[] {
  const dataSet = dicomParser.parseDicom(bytes, { untilTag: "x7fe00010" });
  const charset = (dataSet.string("x00080005") ?? "").trim();
  return Object.keys(dataSet.elements)
    .sort()
    .filter((tag) => tag !== "x7fe00010")
    .map((tag) => {
      const known = DICOM_TAGS[tag];
      const vr = dataSet.elements[tag].vr ?? known?.vr ?? "";
      return {
        tag,
        label: `(${tag.slice(1, 5)},${tag.slice(5)})`.toUpperCase(),
        name: known?.name ?? "",
        vr,
        value: valueOf(dataSet, tag, vr, charset),
      };
    });
}

export function DicomTagListModal({
  patientId,
  sopInstanceUid,
  onClose,
}: {
  patientId: string;
  sopInstanceUid: string;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<TagRow[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);
    // ビューアが読んだ直後の画像なので、ブラウザのキャッシュから返る。
    masterFetch(imagingInstanceUrl(patientId, sopInstanceUid))
      .then(async (res) => {
        if (!res.ok) throw new Error(`画像を取得できませんでした (HTTP ${res.status})`);
        return buildRows(new Uint8Array(await res.arrayBuffer()));
      })
      .then((result) => {
        if (!cancelled) setRows(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)));
      });
    return () => {
      cancelled = true;
    };
  }, [patientId, sopInstanceUid]);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!rows || !needle) return rows ?? [];
    return rows.filter((row) =>
      [row.label, row.name, row.value].some((text) => text.toLowerCase().includes(needle)),
    );
  }, [rows, filter]);

  return (
    <Modal title="DICOM タグ" onClose={onClose} className="modal--dicom-tags">
      <ErrorBanner error={error} />
      <input
        type="search"
        className="dicom-tags__filter"
        aria-label="タグを絞り込む"
        placeholder="絞り込み"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {rows === null && !error ? (
        <p>読み込み中...</p>
      ) : (
        <div className="dicom-tags__scroll">
          <table className="patient-table dicom-tags__table">
            <thead>
              <tr>
                <th>タグ</th>
                <th>名前</th>
                <th>VR</th>
                <th>値</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.tag}>
                  <td>{row.label}</td>
                  <td>{row.name}</td>
                  <td>{row.vr}</td>
                  <td>{row.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
