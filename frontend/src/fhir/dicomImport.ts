import dicomParser from "dicom-parser";
import { Unzip, UnzipInflate } from "fflate";
import { decodeDicomText, dicomPersonName } from "./dicomText";

// DICOM の取込(docs/imaging-design.md)。選ばれたファイル・フォルダ・ZIP から DICOM を
// 拾い、タグを読んでスタディ・シリーズに振り分ける。
//
// DICOMDIR(CD の目次)は読まない。目次が無い・壊れている・一部だけコピーされた、の
// どれでも同じに扱えるよう、ファイル 1 つずつのタグだけを根拠にする。拡張子も見ない
// (CD の中身は IMG0001 のように拡張子が無い)。

/** backend の /imaging/instances に meta として送る属性(列名と同じ)。 */
export interface DicomInstanceMeta {
  sop_instance_uid: string;
  study_instance_uid: string;
  series_instance_uid: string;
  modality: string;
  series_number: string;
  instance_number: string;
  number_of_frames: string;
  series_description: string;
  body_part: string;
  study_date: string;
  study_time: string;
  study_description: string;
  accession_number: string;
  institution_name: string;
  source_patient_id: string;
  source_patient_name: string;
}

export interface ParsedInstance {
  /** SOP Instance UID。同じ UID のファイルが複数あっても 1 つとして扱う。 */
  key: string;
  name: string;
  blob: Blob;
  meta: DicomInstanceMeta;
}

export interface ParsedSeries {
  seriesUid: string;
  number: string;
  modality: string;
  description: string;
  instances: ParsedInstance[];
}

export interface ParsedStudy {
  studyUid: string;
  patientName: string;
  patientId: string;
  institutionName: string;
  /** YYYY-MM-DD。タグに無ければ空。 */
  studyDate: string;
  modalities: string[];
  description: string;
  series: ParsedSeries[];
  instanceCount: number;
}

const MAGIC_OFFSET = 128;
const PIXEL_DATA_TAG = "x7fe00010";
const DICOMDIR_SOP_CLASS = "1.2.840.10008.1.3.10";
// タグはピクセルデータより前にあり、ふつう数十 KB に収まる。まずこれだけ読み、
// 足りなかったファイルだけ全体を読み直す。
const HEAD_BYTES = 1024 * 1024;

export function isDicom(head: Uint8Array): boolean {
  return (
    head.length >= MAGIC_OFFSET + 4 &&
    head[MAGIC_OFFSET] === 0x44 && // D
    head[MAGIC_OFFSET + 1] === 0x49 && // I
    head[MAGIC_OFFSET + 2] === 0x43 && // C
    head[MAGIC_OFFSET + 3] === 0x4d // M
  );
}

function isZip(head: Uint8Array): boolean {
  return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
}

function parseDataSet(bytes: Uint8Array): dicomParser.DataSet {
  return dicomParser.parseDicom(bytes, { untilTag: PIXEL_DATA_TAG });
}

/**
 * DICOM 1 ファイルのタグを読む。DICOM でないもの、DICOMDIR、UID を持たないものは null。
 */
export async function parseInstance(name: string, blob: Blob): Promise<ParsedInstance | null> {
  const head = new Uint8Array(await blob.slice(0, HEAD_BYTES).arrayBuffer());
  if (!isDicom(head)) return null;

  let dataSet: dicomParser.DataSet;
  try {
    dataSet = parseDataSet(head);
  } catch {
    if (blob.size <= HEAD_BYTES) return null;
    try {
      dataSet = parseDataSet(new Uint8Array(await blob.arrayBuffer()));
    } catch {
      return null;
    }
  }

  const ascii = (tag: string) => (dataSet.string(tag) ?? "").trim();
  const charset = ascii("x00080005");
  const text = (tag: string) => {
    const element = dataSet.elements[tag];
    if (!element || element.length <= 0) return "";
    const raw = dataSet.byteArray.subarray(element.dataOffset, element.dataOffset + element.length);
    return decodeDicomText(raw, charset).trim();
  };

  if (ascii("x00020002") === DICOMDIR_SOP_CLASS) return null;
  const sopUid = ascii("x00080018");
  const studyUid = ascii("x0020000d");
  const seriesUid = ascii("x0020000e");
  if (!sopUid || !studyUid || !seriesUid) return null;

  return {
    key: sopUid,
    name,
    blob,
    meta: {
      sop_instance_uid: sopUid,
      study_instance_uid: studyUid,
      series_instance_uid: seriesUid,
      modality: ascii("x00080060"),
      series_number: ascii("x00200011"),
      instance_number: ascii("x00200013"),
      number_of_frames: ascii("x00280008"),
      series_description: text("x0008103e"),
      body_part: ascii("x00180015"),
      study_date: ascii("x00080020"),
      study_time: ascii("x00080030"),
      study_description: text("x00081030"),
      accession_number: text("x00080050"),
      institution_name: text("x00080080"),
      source_patient_id: text("x00100020"),
      source_patient_name: dicomPersonName(text("x00100010")),
    },
  };
}

export interface CollectProgress {
  /** 見つけた DICOM の数。 */
  found: number;
}

type OnInstance = (instance: ParsedInstance) => void;

/**
 * ZIP の中の DICOM を拾う。展開はストリームで行い、DICOM でないエントリは先頭を見た
 * 時点で捨てる(ZIP 全体をメモリに展開しない)。
 */
async function collectFromZip(file: File, onInstance: OnInstance): Promise<void> {
  const pending: Promise<void>[] = [];
  let failure: unknown = null;

  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.onfile = (entry) => {
    if (entry.name.endsWith("/")) return;
    const chunks: Uint8Array[] = [];
    let size = 0;
    let checked = false;
    entry.ondata = (err, data, final) => {
      if (err) {
        failure = err;
        return;
      }
      chunks.push(data);
      size += data.length;
      if (!checked && (size >= MAGIC_OFFSET + 4 || final)) {
        checked = true;
        const head = new Uint8Array(Math.min(size, MAGIC_OFFSET + 4));
        let offset = 0;
        for (const chunk of chunks) {
          if (offset >= head.length) break;
          const part = chunk.subarray(0, head.length - offset);
          head.set(part, offset);
          offset += part.length;
        }
        if (!isDicom(head)) {
          chunks.length = 0;
          if (!final) entry.terminate();
          return;
        }
      }
      if (final && checked && chunks.length > 0) {
        const blob = new Blob(chunks as BlobPart[]);
        chunks.length = 0;
        pending.push(
          parseInstance(entry.name, blob).then((instance) => {
            if (instance) onInstance(instance);
          }),
        );
      }
    };
    entry.start();
  };

  const reader = file.stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      unzip.push(new Uint8Array(0), true);
      break;
    }
    unzip.push(value, false);
    if (failure) break;
    // 展開が解析を追い越してメモリに溜まらないよう、読み進める前に追いつく。
    await Promise.all(pending.splice(0));
  }
  await Promise.all(pending);
  if (failure) {
    throw new Error(`${file.name}: ZIP を展開できませんでした。`);
  }
}

/** 選ばれたファイルから DICOM を拾う。ZIP は中身を展開して拾う。 */
export async function collectDicomInstances(
  files: readonly File[],
  onProgress?: (progress: CollectProgress) => void,
): Promise<{ instances: ParsedInstance[]; errors: string[] }> {
  const found = new Map<string, ParsedInstance>();
  const errors: string[] = [];
  const add: OnInstance = (instance) => {
    if (found.has(instance.key)) return;
    found.set(instance.key, instance);
    onProgress?.({ found: found.size });
  };

  for (const file of files) {
    try {
      const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
      if (isZip(head)) {
        await collectFromZip(file, add);
      } else {
        const instance = await parseInstance(file.name, file);
        if (instance) add(instance);
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : `${file.name}: 読み込めませんでした。`);
    }
  }
  return { instances: [...found.values()], errors };
}

function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  // readEntries は 1 回で全部を返さない(Chrome は 100 件ずつ)。空になるまで呼ぶ。
  return new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = [];
    const next = () =>
      reader.readEntries((batch) => {
        if (batch.length === 0) resolve(all);
        else {
          all.push(...batch);
          next();
        }
      }, reject);
    next();
  });
}

async function filesOfEntry(entry: FileSystemEntry): Promise<File[]> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) =>
      (entry as FileSystemFileEntry).file(resolve, reject),
    );
    return [file];
  }
  if (!entry.isDirectory) return [];
  const children = await readAllEntries((entry as FileSystemDirectoryEntry).createReader());
  const nested = await Promise.all(children.map(filesOfEntry));
  return nested.flat();
}

/** ドロップされたもの(ファイル・フォルダの混在)を、中のファイルに開く。 */
export async function filesFromDataTransfer(dataTransfer: DataTransfer): Promise<File[]> {
  // エントリはイベントの処理中にしか取り出せないので、await の前に集めきる。
  const entries = Array.from(dataTransfer.items)
    .filter((item) => item.kind === "file")
    .map((item) => item.webkitGetAsEntry?.() ?? null);
  const fallback = Array.from(dataTransfer.files);
  if (entries.length === 0 || entries.some((entry) => entry === null)) return fallback;
  const nested = await Promise.all((entries as FileSystemEntry[]).map(filesOfEntry));
  return nested.flat();
}

function numeric(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

function firstPresent(instances: readonly ParsedInstance[], key: keyof DicomInstanceMeta): string {
  return instances.find((i) => i.meta[key])?.meta[key] ?? "";
}

/** スタディ → シリーズ → インスタンスに振り分ける。並びは検査日の新しい順、番号の若い順。 */
export function groupStudies(instances: readonly ParsedInstance[]): ParsedStudy[] {
  const byStudy = new Map<string, ParsedInstance[]>();
  for (const instance of instances) {
    const list = byStudy.get(instance.meta.study_instance_uid) ?? [];
    list.push(instance);
    byStudy.set(instance.meta.study_instance_uid, list);
  }

  const studies = [...byStudy.entries()].map(([studyUid, members]): ParsedStudy => {
    const bySeries = new Map<string, ParsedInstance[]>();
    for (const instance of members) {
      const list = bySeries.get(instance.meta.series_instance_uid) ?? [];
      list.push(instance);
      bySeries.set(instance.meta.series_instance_uid, list);
    }
    const series = [...bySeries.entries()]
      .map(([seriesUid, list]): ParsedSeries => ({
        seriesUid,
        number: firstPresent(list, "series_number"),
        modality: firstPresent(list, "modality"),
        description: firstPresent(list, "series_description"),
        instances: [...list].sort(
          (a, b) => numeric(a.meta.instance_number) - numeric(b.meta.instance_number),
        ),
      }))
      .sort((a, b) => numeric(a.number) - numeric(b.number));

    const date = firstPresent(members, "study_date");
    return {
      studyUid,
      patientName: firstPresent(members, "source_patient_name"),
      patientId: firstPresent(members, "source_patient_id"),
      institutionName: firstPresent(members, "institution_name"),
      studyDate: /^\d{8}$/.test(date) ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}` : "",
      modalities: [...new Set(series.map((s) => s.modality).filter(Boolean))],
      description: firstPresent(members, "study_description"),
      series,
      instanceCount: members.length,
    };
  });
  return studies.sort((a, b) => b.studyDate.localeCompare(a.studyDate));
}

/** items を最大 limit 件ずつ並行に処理する。1 件の失敗は worker 側で受ける前提。 */
export async function runPool<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await worker(item);
    }
  });
  await Promise.all(runners);
}
