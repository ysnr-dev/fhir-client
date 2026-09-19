import { useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { commitImagingStudy, uploadDicomInstance } from "../api/imagingClient";
import { useInvalidateImaging, usePatient, useStoredImagingStudies } from "../api/queries";
import {
  collectDicomInstances,
  filesFromDataTransfer,
  groupStudies,
  runPool,
  type ParsedInstance,
  type ParsedStudy,
} from "../fhir/dicomImport";
import { displayName, patientNumberOf } from "../fhir/patientHelpers";
import { ErrorBanner } from "./ErrorBanner";

// DICOM の取込フォーム(docs/imaging-design.md)。ファイル・フォルダ・ZIP(CD の中身)を
// 受け取り、ブラウザでタグを読んでスタディごとに並べ、選ばれたスタディだけを送る。
//
// 送るのはインスタンス 1 件ずつ。同じ UID の送り直しは backend が成功として扱うので、
// 失敗したぶんの再送も、取込済みスタディへの追加も、同じ操作でよい。

const UPLOAD_CONCURRENCY = 3;

type Phase =
  | { kind: "idle" }
  | { kind: "reading"; found: number }
  | { kind: "uploading"; done: number; total: number };

export default function KarteImagingImportForm({
  patientId,
  onSaved,
}: {
  patientId: string;
  onSaved: () => void;
}) {
  const { data: patientResult } = usePatient(patientId);
  const { data: stored = [] } = useStoredImagingStudies(patientId);
  const invalidateImaging = useInvalidateImaging();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [instances, setInstances] = useState<ParsedInstance[]>([]);
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map());
  const [uploaded, setUploaded] = useState<Set<string>>(new Set());
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // 非同期の読み込み中に他の操作で配列が変わっても、最新の並びに足すための参照。
  const instancesRef = useRef(instances);
  instancesRef.current = instances;

  const studies = useMemo(() => groupStudies(instances), [instances]);
  const storedCounts = useMemo(
    () => new Map(stored.map((s) => [s.study_instance_uid, s.instance_count])),
    [stored],
  );

  const patient = patientResult?.data;
  const busy = phase.kind !== "idle";

  function isFullyStored(study: ParsedStudy): boolean {
    return (storedCounts.get(study.studyUid) ?? 0) >= study.instanceCount;
  }

  // 既定では、まだ取り込んでいないスタディだけを送る。チェックの操作はそれを上書きする。
  function isSelected(study: ParsedStudy): boolean {
    return overrides.get(study.studyUid) ?? !isFullyStored(study);
  }

  function toggle(study: ParsedStudy) {
    const next = !isSelected(study);
    setOverrides((prev) => new Map(prev).set(study.studyUid, next));
  }

  async function addFiles(files: File[]) {
    if (files.length === 0) return;
    setPhase({ kind: "reading", found: 0 });
    const result = await collectDicomInstances(files, ({ found }) =>
      setPhase({ kind: "reading", found }),
    );
    setPhase({ kind: "idle" });

    const known = new Set(instancesRef.current.map((i) => i.key));
    const added = result.instances.filter((i) => !known.has(i.key));
    const errors = [...result.errors];
    if (result.instances.length === 0 && errors.length === 0) {
      errors.push("DICOM ファイルが見つかりませんでした。");
    }
    setMessage(errors.length > 0 ? errors.join(" ") : null);
    if (added.length > 0) setInstances([...instancesRef.current, ...added]);
  }

  function handleFileInput(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    // 同じファイルを続けて選び直せるよう、読み込み前に入力を空にしておく。
    e.target.value = "";
    void addFiles(files);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    if (busy) return;
    void filesFromDataTransfer(e.dataTransfer).then(addFiles);
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    setDragging(true);
  }

  const selectedStudies = studies.filter(isSelected);
  const targets = selectedStudies.flatMap((study) =>
    study.series.flatMap((series) => series.instances.filter((i) => !uploaded.has(i.key))),
  );

  async function handleSubmit() {
    if (targets.length === 0 && selectedStudies.length === 0) return;
    setMessage(null);
    setPhase({ kind: "uploading", done: 0, total: targets.length });

    const succeeded = new Set(uploaded);
    const failures = new Set<string>();
    const reasons = new Set<string>();
    let done = 0;
    await runPool(targets, UPLOAD_CONCURRENCY, async (instance) => {
      try {
        await uploadDicomInstance(patientId, instance);
        succeeded.add(instance.key);
      } catch (err) {
        failures.add(instance.key);
        reasons.add(err instanceof Error ? err.message : "送信に失敗しました。");
      }
      done += 1;
      setPhase({ kind: "uploading", done, total: targets.length });
    });

    // 一部が失敗したスタディも、保存できたぶんで ImagingStudy を作る。再送が通れば
    // 同じ操作で枚数が増える。
    for (const study of selectedStudies) {
      const saved = study.series.some((s) => s.instances.some((i) => succeeded.has(i.key)));
      if (!saved && !storedCounts.get(study.studyUid)) continue;
      try {
        await commitImagingStudy(patientId, study.studyUid);
      } catch (err) {
        reasons.add(err instanceof Error ? err.message : "検査の登録に失敗しました。");
        study.series.forEach((s) => s.instances.forEach((i) => failures.add(i.key)));
      }
    }

    invalidateImaging();
    setUploaded(succeeded);
    setFailed(failures);
    setPhase({ kind: "idle" });
    if (failures.size === 0) {
      onSaved();
      return;
    }
    setMessage(`${failures.size} 枚を取り込めませんでした。${[...reasons].join(" ")}`);
  }

  return (
    <div className="karte-file-form">
      {message && <ErrorBanner error={new Error(message)} />}

      <div
        className={`karte-file-drop${dragging ? " karte-file-drop--dragging" : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <p>ここにファイル・フォルダ・ZIP をドロップ</p>
        <div className="karte-imaging-import__pickers">
          <button type="button" disabled={busy} onClick={() => fileInputRef.current?.click()}>
            ファイルを選択
          </button>
          <button type="button" disabled={busy} onClick={() => folderInputRef.current?.click()}>
            フォルダを選択
          </button>
        </div>
        <input ref={fileInputRef} type="file" multiple hidden onChange={handleFileInput} />
        <input
          ref={folderInputRef}
          type="file"
          multiple
          hidden
          onChange={handleFileInput}
          {...{ webkitdirectory: "" }}
        />
      </div>

      {phase.kind === "reading" && <p>読み込み中... ({phase.found} 枚)</p>}

      {studies.length > 0 && (
        <>
          {patient && (
            <p className="karte-imaging-import__patient">
              取込先: {displayName(patient)}
              {patientNumberOf(patient) ? ` (${patientNumberOf(patient)})` : ""}
            </p>
          )}
          <table className="patient-table karte-imaging-import__table">
            <thead>
              <tr>
                <th></th>
                <th>患者名</th>
                <th>患者 ID</th>
                <th>検査日</th>
                <th>モダリティ</th>
                <th>検査内容</th>
                <th>シリーズ</th>
                <th>枚数</th>
                <th>施設</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {studies.map((study) => {
                const storedCount = storedCounts.get(study.studyUid) ?? 0;
                return (
                  <tr key={study.studyUid}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`${study.description || study.studyUid} を取り込む`}
                        checked={isSelected(study)}
                        disabled={busy}
                        onChange={() => toggle(study)}
                      />
                    </td>
                    <td>{study.patientName || "-"}</td>
                    <td>{study.patientId || "-"}</td>
                    <td>{study.studyDate || "-"}</td>
                    <td>{study.modalities.join(" / ") || "-"}</td>
                    <td>{study.description || "-"}</td>
                    <td>{study.series.length}</td>
                    <td>{study.instanceCount}</td>
                    <td>{study.institutionName || "-"}</td>
                    <td>
                      {storedCount >= study.instanceCount
                        ? "取込済"
                        : storedCount > 0
                          ? `一部取込済 (${storedCount}/${study.instanceCount})`
                          : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      <div className="karte-file-form__actions">
        {phase.kind === "uploading" && (
          <span className="karte-imaging-import__progress">
            取込中... ({phase.done} / {phase.total} 枚)
          </span>
        )}
        <button type="button" disabled={busy || selectedStudies.length === 0} onClick={handleSubmit}>
          {failed.size > 0 ? `${targets.length} 枚を再送` : `${targets.length} 枚を取込`}
        </button>
      </div>
    </div>
  );
}
