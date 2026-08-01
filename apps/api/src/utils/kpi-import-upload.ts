import multer from 'multer';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { badRequest } from './http-error';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_XLSX_BYTES = 2 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 120;
const MAX_UNCOMPRESSED_BYTES = 20 * 1024 * 1024;

type ZipEntry = {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
};

const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_SIGNATURE = 0x04034b50;

const zipError = () => badRequest('Tệp Excel không an toàn hoặc không đúng cấu trúc .xlsx.');

const findEndOfCentralDirectory = (buffer: Buffer) => {
  const lowerBound = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= lowerBound; offset -= 1) {
    if (buffer.readUInt32LE(offset) === ZIP_EOCD_SIGNATURE) return offset;
  }
  throw zipError();
};

const readZipEntries = (buffer: Buffer): ZipEntry[] => {
  if (buffer.length < 22 || buffer.subarray(0, 4).toString('binary') !== 'PK\x03\x04') {
    throw zipError();
  }

  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset + 22 > buffer.length) throw zipError();
  const diskNumber = buffer.readUInt16LE(eocdOffset + 4);
  const centralDisk = buffer.readUInt16LE(eocdOffset + 6);
  const entriesOnDisk = buffer.readUInt16LE(eocdOffset + 8);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralSize = buffer.readUInt32LE(eocdOffset + 12);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (
    diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount
    || entryCount === 0 || entryCount > MAX_ZIP_ENTRIES
    || centralOffset + centralSize > eocdOffset
  ) throw zipError();

  let offset = centralOffset;
  let totalUncompressed = 0;
  const entries: ZipEntry[] = [];
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== ZIP_CENTRAL_SIGNATURE) throw zipError();
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const nextOffset = offset + 46 + nameLength + extraLength + commentLength;
    if (
      flags & 0x1 || method !== 0 && method !== 8
      || compressedSize === 0xffffffff || uncompressedSize === 0xffffffff
      || localHeaderOffset === 0xffffffff || nextOffset > buffer.length
    ) throw zipError();
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    if (!name || name.includes('..') || name.startsWith('/') || name.includes('\\')) throw zipError();
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_UNCOMPRESSED_BYTES || (compressedSize > 0 && uncompressedSize / compressedSize > 100)) throw zipError();
    entries.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset });
    offset = nextOffset;
  }
  if (offset !== centralOffset + centralSize) throw zipError();
  return entries;
};

const readZipEntry = (buffer: Buffer, entry: ZipEntry) => {
  const offset = entry.localHeaderOffset;
  if (offset + 30 > buffer.length || buffer.readUInt32LE(offset) !== ZIP_LOCAL_SIGNATURE) throw zipError();
  const nameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const start = offset + 30 + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (end > buffer.length) throw zipError();
  const compressed = buffer.subarray(start, end);
  try {
    const result = entry.method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: MAX_UNCOMPRESSED_BYTES });
    if (result.length !== entry.uncompressedSize) throw zipError();
    return result;
  } catch (error) {
    if ((error as any)?.statusCode) throw error;
    throw zipError();
  }
};

/** Validate the OOXML container before ExcelJS expands and parses it. */
export const assertSafeKpiWorkbookBuffer = (buffer: Buffer) => {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_XLSX_BYTES) throw zipError();
  const entries = readZipEntries(buffer);
  const names = new Set(entries.map((entry) => entry.name));
  const required = ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/worksheets/sheet1.xml'];
  if (required.some((name) => !names.has(name))) throw zipError();
  if ([...names].filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/iu.test(name)).length !== 1) throw zipError();
  if ([...names].some((name) => /(^|\/)(vbaProject\.bin|macrosheets|activeX|embeddings|externalLinks|connections|queryTables|customXml)(\/|$)/iu.test(name))) throw zipError();

  for (const entry of entries.filter((item) => item.name.endsWith('.rels'))) {
    const relationshipXml = readZipEntry(buffer, entry).toString('utf8');
    if (/TargetMode\s*=\s*["']External["']/iu.test(relationshipXml)) throw zipError();
  }
};

export const kpiImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_XLSX_BYTES, files: 1 },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    if (extension !== '.xlsx' || file.mimetype !== XLSX_MIME) {
      callback(badRequest('Chỉ nhận tệp Excel .xlsx đúng định dạng PL4.'));
      return;
    }
    callback(null, true);
  },
});
