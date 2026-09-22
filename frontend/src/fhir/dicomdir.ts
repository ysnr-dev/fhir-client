import dicomParser from "dicom-parser";
import type { DicomInstanceMeta } from "./dicomImport";
import { decodeDicomText, dicomPersonName } from "./dicomText";

// PDI(IHE Portable Data for Imaging)のディスクの目次 = DICOMDIR を読む
// (docs/imaging-design.md §4.2)。
//
// DICOMDIR はルートに 1 つあり、患者 > スタディ > シリーズ > 画像の木で、葉が
// ディスクの中のファイル(例: DICOM\00000000\00000000)を指す。木は「次の記録」と
// 「下の記録」のファイル先頭からのバイト位置で繋がっていて、並び順ではない。
//
// ここで読めるのは目次に書かれた属性だけ。取込時にはファイル本体のタグを読み直す。

const RECORD_SEQUENCE = "x00041220";
const FIRST_RECORD_OFFSET = "x00041200";
const NEXT_RECORD_OFFSET = "x00041400";
const IN_USE_FLAG = "x00041410";
const CHILD_RECORD_OFFSET = "x00041420";
const REFERENCED_FILE_ID = "x00041500";
const CHARACTER_SET = "x00080005";
/** 項目タグ (FFFE,E000) と長さの 8 バイト。dicom-parser の dataOffset はその後ろを指す。 */
const ITEM_HEADER_BYTES = 8;

/** 目次が指していた DICOM 1 ファイル。 */
export interface DicomdirEntry {
  /** ディスクの中の位置。区切りは "/"、大文字に揃えたもの(例: DICOM/00000000/00000000)。 */
  path: string;
  meta: DicomInstanceMeta;
}

/** 記録の属性 → meta の対応。どの階層の記録でも同じに読み、下の階層へ引き継ぐ。 */
const FIELDS: { tag: string; key: keyof DicomInstanceMeta; text?: boolean; personName?: boolean }[] = [
  { tag: "x00100010", key: "source_patient_name", text: true, personName: true },
  { tag: "x00100020", key: "source_patient_id", text: true },
  { tag: "x0020000d", key: "study_instance_uid" },
  { tag: "x00080020", key: "study_date" },
  { tag: "x00080030", key: "study_time" },
  { tag: "x00081030", key: "study_description", text: true },
  { tag: "x00080050", key: "accession_number", text: true },
  { tag: "x00080080", key: "institution_name", text: true },
  { tag: "x0020000e", key: "series_instance_uid" },
  { tag: "x00080060", key: "modality" },
  { tag: "x00200011", key: "series_number" },
  { tag: "x0008103e", key: "series_description", text: true },
  { tag: "x00180015", key: "body_part" },
  { tag: "x00041511", key: "sop_instance_uid" },
  { tag: "x00200013", key: "instance_number" },
  { tag: "x00280008", key: "number_of_frames" },
];

const EMPTY_META: DicomInstanceMeta = {
  sop_instance_uid: "",
  study_instance_uid: "",
  series_instance_uid: "",
  modality: "",
  series_number: "",
  instance_number: "",
  number_of_frames: "",
  series_description: "",
  body_part: "",
  study_date: "",
  study_time: "",
  study_description: "",
  accession_number: "",
  institution_name: "",
  source_patient_id: "",
  source_patient_name: "",
};

function ascii(dataSet: dicomParser.DataSet, tag: string): string {
  return (dataSet.string(tag) ?? "").trim();
}

function text(dataSet: dicomParser.DataSet, tag: string, charset: string): string {
  const element = dataSet.elements[tag];
  if (!element || element.length <= 0) return "";
  const raw = dataSet.byteArray.subarray(element.dataOffset, element.dataOffset + element.length);
  return decodeDicomText(raw, charset).trim();
}

/** 1 記録の属性を読む。値が空のものは入れない(上の階層の値を消さないため)。 */
function fieldsOf(dataSet: dicomParser.DataSet, charset: string): Partial<DicomInstanceMeta> {
  const fields: Partial<DicomInstanceMeta> = {};
  for (const field of FIELDS) {
    const raw = field.text ? text(dataSet, field.tag, charset) : ascii(dataSet, field.tag);
    const value = field.personName ? dicomPersonName(raw) : raw;
    if (value) fields[field.key] = value;
  }
  return fields;
}

/** 参照先(多値は階層の区切り)を "DICOM/00000000/00000000" の形にする。 */
function fileIdPath(dataSet: dicomParser.DataSet): string {
  const value = ascii(dataSet, REFERENCED_FILE_ID);
  if (!value) return "";
  return value
    .split(/[\\/]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/")
    .toUpperCase();
}

/**
 * DICOMDIR の中身から、参照されている DICOM ファイルの一覧を作る。
 * DICOMDIR として読めないときは例外。
 */
export function parseDicomdir(bytes: Uint8Array): DicomdirEntry[] {
  const dataSet = dicomParser.parseDicom(bytes);
  const items = dataSet.elements[RECORD_SEQUENCE]?.items ?? [];

  const byOffset = new Map<number, dicomParser.DataSet>();
  for (const item of items) {
    if (item.dataSet) byOffset.set(item.dataOffset - ITEM_HEADER_BYTES, item.dataSet);
  }

  const entries: DicomdirEntry[] = [];
  const visited = new Set<number>();

  const walk = (start: number, inheritedCharset: string, inherited: Partial<DicomInstanceMeta>) => {
    let offset = start;
    while (offset > 0) {
      if (visited.has(offset)) return; // 壊れた目次で輪になっていても止まる
      visited.add(offset);
      const record = byOffset.get(offset);
      if (!record) return;

      // 0 は消された記録。書かない装置もあるので、属性が無いときは使われているものとする。
      const inUse = record.elements[IN_USE_FLAG] ? record.uint16(IN_USE_FLAG) !== 0 : true;
      if (inUse) {
        const charset = ascii(record, CHARACTER_SET) || inheritedCharset;
        const fields = { ...inherited, ...fieldsOf(record, charset) };
        const path = fileIdPath(record);
        if (path && fields.sop_instance_uid) {
          entries.push({ path, meta: { ...EMPTY_META, ...fields } });
        } else {
          walk(record.uint32(CHILD_RECORD_OFFSET) ?? 0, charset, fields);
        }
      }
      offset = record.uint32(NEXT_RECORD_OFFSET) ?? 0;
    }
  };

  walk(dataSet.uint32(FIRST_RECORD_OFFSET) ?? 0, "", {});
  return entries;
}
