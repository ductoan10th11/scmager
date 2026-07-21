import { langson } from './langson-client.service';

const DWR_PATH = '/qlvbdh_lsn/dwr/exec/NEORemoting.getDoc.dwr';
const DWR_RSET_PATH = '/qlvbdh_lsn/dwr/exec/NEORemoting.getRSet.dwr';
const DWR_DATA_PATH = '/qlvbdh_lsn/dwr/exec/DataRemoting.getDoc.dwr';
const MAIN_PATH = '/qlvbdh_lsn/main';
const DOC_PAGE_LIMIT = Number(process.env.LANGSON_DWR_DOC_PAGE_LIMIT ?? 50);

// Menu labels keyed by id_key (from docs/nav.md)
// in-work = Văn bản đến | out-work = Văn bản đi
const NAV_LABELS: Record<string, string> = {
  '2261': 'out-work_draft',
  '2282': 'out-work_pending',
  '2262': 'out-work_processed',
  '2284': 'out-work_issued',
  '2268': 'in-work_registered',
  '2269': 'in-work_draft',
  '2267': 'in-work_pending',
  '2270': 'in-work_issued',
  '2289': 'in-work_processed',
  '2828': 'in-work_remain',
  '2767': 'in-work_done',
  '2297': 'out-work_remain',
  '2829': 'out-work_published',
  '2797': 'out-work_done',
};

function createCallId(): string {
  return `${Math.floor(1000 + Math.random() * 9000)}_${Date.now()}`;
}

function extractCsrfToken(html: string): string {
  const match = html.match(/\bcsrf_token\s*=\s*['"]([^'"]+)['"]/);
  if (!match?.[1]) throw new Error('csrf_token not found in Langson main page');
  return match[1];
}

export async function getCsrfToken(): Promise<string> {
  const res = await langson.get(MAIN_PATH, {
    responseType: 'text',
    transformResponse: [(data) => data],
  });
  if (res.status < 200 || res.status >= 300) throw new Error(`GET ${MAIN_PATH} -> ${res.status}`);
  return extractCsrfToken(String(res.data));
}

export interface DwrCallOptions {
  script?: string;
  async?: boolean;
  callId?: string;
  csrfToken?: string;
}

function decodeDwrJavaScriptString(value: string): string {
  return value
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, '\\');
}

/**
 * Decode the JavaScript string assigned to DWR's `var s0` without executing it.
 * DWR also emits `\'`, which is valid in JavaScript but invalid JSON.
 */
export function extractDwrS0String(raw: string): string | null {
  const start = raw.indexOf('var s0="');
  if (start === -1) return null;

  const responseMarker = raw.indexOf('DWREngine._handleResponse', start);
  if (responseMarker === -1) return null;

  const end = raw.lastIndexOf('"', responseMarker);
  const contentStart = start + 'var s0="'.length;
  if (end <= contentStart) return null;

  return decodeDwrJavaScriptString(raw.slice(contentStart, end));
}

/** Parse the JSON array from a DWR `var s0="..."` response. */
export function parseDwrS0<T = unknown>(raw: string): T[] {
  const decoded = extractDwrS0String(raw);
  if (!decoded) return [];

  try {
    const parsed = JSON.parse(decoded) as unknown;
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

/**
 * Fetch menu item counts via doCountMenu.
 * Returns `{ [menu_name]: nor }` for known menus only (see docs/nav.md).
 */
export async function menuItem(options: DwrCallOptions = {}): Promise<Record<string, number>> {
  const csrfToken = options.csrfToken ?? (await getCsrfToken());
  const callId = options.callId ?? createCallId();

  const body = [
    'callCount=1',
    'c0-scriptName=NEORemoting',
    'c0-methodName=getDoc',
    `c0-id=${callId}`,
    'c0-param0=string:quantrihethong.Menu.doCountMenu()',
    `c0-param1=boolean:${options.async ?? false}`,
    'xml=true',
    '',
  ].join('\n');

  const res = await langson.post(DWR_PATH, {
    data: body,
    responseType: 'text',
    transformResponse: [(data) => data],
    headers: {
      Accept: '*/*',
      'Content-Type': 'text/plain',
      'csrf-token': csrfToken,
      Origin: undefined,
      'X-Requested-With': undefined,
    },
  });

  if (res.status < 200 || res.status >= 300) throw new Error(`POST ${DWR_PATH} -> ${res.status}`);

  const items = parseDwrS0<{ id_key: string; nor: string }>(String(res.data));
  return Object.fromEntries(
    items
      .filter((item) => item.id_key in NAV_LABELS)
      .map((item) => [NAV_LABELS[item.id_key], Number(item.nor)]),
  );
}

export interface DocCountResult {
  totalRecords: number;
  totalPages: number;
}

export interface DocumentListItem {
  documentId: string;
  processKey: string;
  soDen: string;
  soKyHieu: string;
  trichYeu: string;
  donViBanHanh: string;
  hinhThuc: string;
  ngayVanBan: string;
  ngayDen: string;
  doKhan: string;
  doMat: string;
  nguoiXuLy: string;
  trangThai: number;
  deadline: Date | null;
}

export function newestNgayDenFilter(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    vanban_lichsu: '',
    don_vi: '',
    trich_yeu: '',
    trich_yeu_org: '',
    ma_duthao: '',
    so_kyhieu: '',
    so_kyhieu_org: '',
    nguoixuly: '',
    Kho_htvb: '',
    nguoisoan: '',
    nguoiky: '',
    donvixuly: '',
    dcm_type: '',
    dcm_linhvuc: '',
    dcm_priority: '',
    dcm_confidential: '',
    start_date_banhanh: '',
    end_date_banhanh: '',
    start_date_soanthao: '',
    end_date_soanthao: '',
    search_doc_id: '',
    coquan_banhanh: '',
    start_date_han_xuly: '',
    end_date_han_xuly: '',
    txt_toanvan: '',
    fulltext_search: '',
    dcm_sovanban_avs: '',
    dcm_sovb_avs: '',
    dcm_sovb_avs_range_dau: '',
    dcm_sovb_avs_range_cuoi: '',
    loai_vanban: '',
    loaitracuu: '',
    chk_search_toanvan: '0',
    condition: '',
    conditionType: '',
    qlvb_baocao_vbden_kynhan: '0',
    hinhthucvb: '',
    chk_search_chinhxac: '0',
    txt_start_date_ngayden: '',
    txt_end_date_ngayden: '',
    fieldSort: 'sortNgayDen',
    sort: 'desc',
    search_khongdau: '0',
    doc_type: '',
    is_read: '',
    ioffice_number: '',
    vanban_dientu_giay: '',
    noi_nhan: '',
    phanloai_vanban_luongxanh: '',
    txt_tukhoa_any: '',
    txt_nguoi_xlc: '',
    vb_kyso: '',
    doc_nam: '-1',
    config_tim_kiem_chinh_xac_skh: '1',
    TRACUU_VALIDATE_CONTROL: '0',
    hinhthuc_chuyen: '',
    xulychinh_cuoi: '',
    sel_year_search: '',
    is_current_year: '',
    thu_tuc_hanh_chinh: '',
    txt_ngay_hop: '',
    txt_start_date_theoky: '',
    txt_end_date_theoky: '',
    isVBDungChung: '',
    vt_tthc: '',
    thuctuc_hsmc_id: '',
    CONFIG_VBDEN_HIENTHI_COT_TTVANBAN: '0',
    isConfigFuncHanchexem: '0',
    para_tooltip: '0',
    phanloaivb: '',
    ...overrides,
  };
}

/**
 * Incoming-document query sorted by the processing deadline, latest first.
 * Callers can pass the arrival-date range through `txt_start_date_ngayden`
 * and `txt_end_date_ngayden`.
 */
export function deadlineDescendingFilter(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return newestNgayDenFilter({
    fieldSort: 'sortHanXuLy',
    sort: 'desc',
    ...overrides,
  });
}

/**
 * Get total document count and page count for a given filter.
 * Calls qlvb.van_ban_den.getTraCuuVanBanPaging (see docs/flow-crawl.md §3.1).
 */
export async function getDocCount(
  filterJson: Record<string, unknown> = {},
  csrfToken?: string,
  limit: number = DOC_PAGE_LIMIT,
): Promise<DocCountResult> {
  const csrf = csrfToken ?? (await getCsrfToken());
  const callId = createCallId();
  const filter = JSON.stringify(filterJson);

  const body = [
    'callCount=1',
    'c0-scriptName=NEORemoting',
    'c0-methodName=getRSet',
    `c0-id=${callId}`,
    `c0-param0=string:qlvb.van_ban_den.getTraCuuVanBanPaging("-1","${limit}",'${filter}')`,
    'c0-param1=boolean:false',
    'xml=true',
    '',
  ].join('\n');

  const res = await langson.post(DWR_RSET_PATH, {
    data: body,
    responseType: 'text',
    transformResponse: [(data) => data],
    headers: {
      Accept: '*/*',
      'Content-Type': 'text/plain',
      'csrf-token': csrf,
      Origin: undefined,
      'X-Requested-With': undefined,
    },
  });

  if (res.status < 200 || res.status >= 300)
    throw new Error(`POST ${DWR_RSET_PATH} -> ${res.status}`);

  const [item] = parseDwrS0<{ nor: string; nop: string }>(String(res.data));
  return {
    totalRecords: Number(item?.nor ?? 0),
    totalPages: Number(item?.nop ?? 0),
  };
}

/** Decode numeric HTML entities and common named entities. */
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&comma;/g, ',');
}

/** Extract a single attribute value from an HTML tag string. */
function trAttr(tag: string, name: string): string {
  const m = tag.match(new RegExp(`\\b${name}=(?:"([^"]*?)"|'([^']*?)')`));
  return decodeHtmlEntities(m?.[1] ?? m?.[2] ?? '');
}

function stripHtmlText(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim());
}

function parseDateOnly(value: string): Date | null {
  const match = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;

  const [, day, month, year] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

function extractDocumentId(trTag: string): string {
  const flyId = trAttr(trTag, 'FlyID');
  if (flyId) return flyId;

  const onclick = trAttr(trTag, 'onclick');
  const match = onclick.match(/\bshowDocDetail\((\d+)/);
  return match?.[1] ?? '';
}

interface HtmlCell {
  tag: string;
  html: string;
  text: string;
  className: string;
}

function extractTdCells(trContent: string): HtmlCell[] {
  return [...trContent.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)].map((m) => {
    const tag = `<td${m[1] ?? ''}>`;
    const html = m[2] ?? '';
    return {
      tag,
      html,
      text: stripHtmlText(html),
      className: trAttr(tag, 'class'),
    };
  });
}

function extractDeadline(cells: HtmlCell[]): Date | null {
  const iofficeIndex = cells.findIndex((cell) => /\bclassIofficeNumber\b/i.test(cell.className));
  if (iofficeIndex === -1) return null;

  // Current Langson row layout:
  // index | hidden ioffice number | subject | deadline | ...
  return parseDateOnly(cells[iofficeIndex + 2]?.text ?? '');
}

/** Parse the HTML table from a getDoc DWR response into a document list. */
export function parseDocListHtml(raw: string): DocumentListItem[] {
  // Extract s0 content — the DWR string ends just before DWREngine._handleResponse
  const s0start = raw.indexOf('var s0="');
  if (s0start === -1) return [];
  const dwrIdx = raw.indexOf('DWREngine._handleResponse', s0start);
  if (dwrIdx === -1) return [];
  const contentEnd = raw.lastIndexOf('"', dwrIdx);
  const contentStart = s0start + 8;
  if (contentEnd <= contentStart) return [];

  // Unescape the DWR JS string encoding
  const html = raw.slice(contentStart, contentEnd)
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '');

  // Walk through <tr> tags tracking quote state to find the correct closing >
  const results: DocumentListItem[] = [];
  let pos = 0;

  while (true) {
    const trStart = html.indexOf('<tr ', pos);
    if (trStart === -1) break;

    let i = trStart + 4;
    let inQuote = '';
    while (i < html.length) {
      const ch = html[i];
      if (inQuote) {
        if (ch === inQuote) inQuote = '';
      } else if (ch === '"' || ch === "'") {
        inQuote = ch;
      } else if (ch === '>') {
        break;
      }
      i++;
    }

    const trTagEnd = i + 1;
    const trCloseIdx = html.indexOf('</tr>', trTagEnd);
    const trContent = trCloseIdx !== -1 ? html.slice(trTagEnd, trCloseIdx) : '';
    pos = trCloseIdx !== -1 ? trCloseIdx + 5 : trTagEnd;

    const trTag = html.slice(trStart, trTagEnd);
    const documentId = extractDocumentId(trTag);
    if (!documentId) continue;

    const sodenMatch = trContent.match(/<td[^>]*class="[^"]*sodendi[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
    const soDen = stripHtmlText(sodenMatch?.[1] ?? '');
    if (!soDen) continue; // User request: bỏ qua nếu không có số đến

    const cells = extractTdCells(trContent);
    // XLC is the final non-empty centered cell before the actions column. The
    // table ends with an empty hidden sort cell, so selecting the last centered
    // cell directly would otherwise lose the current main processor.
    const nguoiXuLy = cells
      .filter((cell) => /text-align\s*:\s*center/i.test(trAttr(cell.tag, 'style')))
      .filter((cell) => !/<a\b/i.test(cell.html) && Boolean(cell.text))
      .at(-1)?.text ?? '';

    results.push({
      documentId,
      processKey: '', // populated by getDocDetail (API 3.3)
      soDen,
      soKyHieu: trAttr(trTag, 'so_ky_hieu'),
      trichYeu: trAttr(trTag, 'trich_yeu'),
      donViBanHanh: trAttr(trTag, 'don_vi_ban_hanh'),
      hinhThuc: trAttr(trTag, 'hinh_thuc'),
      ngayVanBan: trAttr(trTag, 'ngay_van_ban'),
      ngayDen: trAttr(trTag, 'ngay_den'),
      doKhan: trAttr(trTag, 'do_khan'),
      doMat: trAttr(trTag, 'do_mat'),
      nguoiXuLy,
      trangThai: Number(trAttr(trTag, 'isDenDi')),
      deadline: extractDeadline(cells),
    });
  }

  return results;
}

/**
 * Get document list for a given page.
 * Calls qlvb.van_ban_den.getDSVanBan (see docs/flow-crawl.md §3.2).
 */
export async function getDocList(
  page: number = 1,
  limit: number = DOC_PAGE_LIMIT,
  filterJson: Record<string, unknown> = {},
  csrfToken?: string,
): Promise<DocumentListItem[]> {
  const csrf = csrfToken ?? (await getCsrfToken());
  const callId = createCallId();
  const filter = JSON.stringify(filterJson);

  const body = [
    'callCount=1',
    'c0-scriptName=DataRemoting',
    'c0-methodName=getDoc',
    `c0-id=${callId}`,
    `c0-param0=string:qlvb.van_ban_den.getDSVanBan("${page}","${limit}",'${filter}')`,
    'c0-param1=boolean:false',
    'xml=true',
    '',
  ].join('\n');

  const res = await langson.post(DWR_DATA_PATH, {
    data: body,
    responseType: 'text',
    transformResponse: [(data) => data],
    headers: {
      Accept: '*/*',
      'Content-Type': 'text/plain',
      'csrf-token': csrf,
      Origin: undefined,
      'X-Requested-With': undefined,
    },
  });

  if (res.status < 200 || res.status >= 300)
    throw new Error(`POST ${DWR_DATA_PATH} -> ${res.status}`);

  const raw = String(res.data);
  return parseDocListHtml(raw);
}

export interface DocDetailResult {
  id: string;
  soDen: string;
  soKyHieu: string;
  trichYeu: string;
  donViBanHanh: string;
  ngayVanBan: string;
  ngayDen: string;
  hinhThuc: string;
  doKhan: string;
  doMat: string;
  nguoiSoan: string;
  nguoiKy: string;
}

export type DocumentDirection = 'incoming' | 'outgoing' | 'unknown';

export interface RelatedDocumentSummary {
  documentId: string;
  documentDirection: DocumentDirection;
  congvanDendi: string | null;
  documentNumber: string | null;
  symbol: string | null;
  summary: string | null;
  documentDate: string | null;
  createdAt: string | null;
  createdBy: string | null;
}

export interface RelatedDocumentFile {
  id: string | null;
  name: string | null;
  isPrimary: boolean;
  uploadedBy: string | null;
}

export interface RelatedDocumentDetail {
  parentId: string | null;
  originalDocumentIds: string[];
  identifier: string | null;
  issuedDate: string | null;
  createdDate: string | null;
  issuingOrganization: string | null;
  draftingOrganization: string | null;
  originalStorageUnit: string | null;
  documentType: string | null;
  documentTypeCode: string | null;
  businessDocumentType: string | null;
  priority: string | null;
  priorityCode: string | null;
  securityLevel: string | null;
  drafter: { username: string | null; fullName: string | null };
  signer: { username: string | null; fullName: string | null; position: string | null };
  enteredBy: string | null;
  assigner: string | null;
  pageCount: number | null;
  copyCount: number | null;
  status: string | null;
  processingStatus: string | null;
  processKey: string | null;
  processInstanceId: string | null;
  taskId: string | null;
  files: RelatedDocumentFile[];
}

export interface RelatedDocumentResult extends RelatedDocumentSummary {
  detail: RelatedDocumentDetail;
  trackLogs: TrackLogItem[];
}

export interface TrackLogItem {
  id: string;
  sequence?: number | null;
  sender: { username: string; fullName: string };
  receiver: { username: string; fullName: string };
  recipients?: Array<{ username: string; fullName: string }>;
  action: string;
  comment: string;
  content: string;
  receivedAt: string | null;
  processingAt: string | null;
  completedAt: string | null;
  updatedAt?: string | null;
}

const COMPLETED_SENDER_USERNAME = 'vanthu-xathientan';
const COMPLETED_SENDER_FULL_NAME = 'Văn thư xã Thiện Tân';
const COMPLETED_ACTION = 'Đã tạo phúc đáp';
export const LANGSON_COMPLETED_RULE = 'LATEST_TRACKLOG_VANTHU_TAO_PHUC_DAP';

function normalizeText(value: string): string {
  return value
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function trackLogTime(log: TrackLogItem): number {
  const raw = log.completedAt ?? log.processingAt ?? log.receivedAt;
  const match = raw?.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/);
  if (!match) return Number.NaN;

  const [, day, month, year, hour, minute] = match;
  return new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
  ).getTime();
}

export function getLatestTrackLog(trackLogs: TrackLogItem[]): TrackLogItem | null {
  if (trackLogs.length === 0) return null;

  return [...trackLogs].sort((a, b) => {
    const bTime = trackLogTime(b);
    const aTime = trackLogTime(a);
    if (Number.isFinite(bTime) && Number.isFinite(aTime) && bTime !== aTime) return bTime - aTime;

    const bId = Number(b.id);
    const aId = Number(a.id);
    if (Number.isFinite(bId) && Number.isFinite(aId) && bId !== aId) return bId - aId;

    return trackLogs.indexOf(a) - trackLogs.indexOf(b);
  })[0];
}

export type ExtractedTrackLogPoint = {
  point: number;
  trackLogId: string;
  comment: string;
};

const TRACK_LOG_POINT_PATTERNS = [
  /\[\s*p\s*:\s*(\d+)\s*\]/i,
  /(?:^|\s)điểm\s*:\s*(\d+)\b/iu,
];

/**
 * A point belongs to the latest tracklog that contains either `[p:<integer>]`
 * or `Điểm: <integer>`.
 * This makes a later correction in eOffice supersede an earlier point declaration.
 */
export function getLatestTrackLogPoint(trackLogs: TrackLogItem[]): ExtractedTrackLogPoint | null {
  const ordered = [...trackLogs].sort((a, b) => {
    const bTime = trackLogTime(b);
    const aTime = trackLogTime(a);
    if (Number.isFinite(bTime) && Number.isFinite(aTime) && bTime !== aTime) return bTime - aTime;

    const bId = Number(b.id);
    const aId = Number(a.id);
    if (Number.isFinite(bId) && Number.isFinite(aId) && bId !== aId) return bId - aId;
    return trackLogs.indexOf(a) - trackLogs.indexOf(b);
  });

  for (const log of ordered) {
    const comment = String(log.comment ?? '').trim();
    const content = String(log.content ?? comment).trim();
    const match = TRACK_LOG_POINT_PATTERNS
      .map((pattern) => content.match(pattern) ?? comment.match(pattern))
      .find(Boolean);
    if (!match) continue;

    const point = Number(match[1]);
    if (Number.isSafeInteger(point)) {
      return { point, trackLogId: String(log.id ?? ''), comment: content };
    }
  }

  return null;
}

export function isCompletedTrackLogItem(log: TrackLogItem | null): boolean {
  if (!log) return false;

  return (
    (
      normalizeText(log.sender.username) === COMPLETED_SENDER_USERNAME
      || normalizeText(log.sender.fullName) === normalizeText(COMPLETED_SENDER_FULL_NAME)
    )
    && normalizeText(log.action) === normalizeText(COMPLETED_ACTION)
  );
}

export function isCompletedDocumentTrackLog(trackLogs: TrackLogItem[]): boolean {
  return isCompletedTrackLogItem(getLatestTrackLog(trackLogs));
}

/** Extract and unescape the HTML inside `var s0="..."` from a DWR response. */
function extractS0Html(raw: string): string {
  // Some DWR HTML payloads have a second escape layer for tag attributes.
  return (extractDwrS0String(raw) ?? '')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '');
}

export function parseTrackLogHtmlResponse(raw: string): TrackLogItem[] {
  const html = extractS0Html(raw);
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  const results: TrackLogItem[] = [];

  const cleanHtml = (value: string) => decodeHtmlEntities(
    value
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
  );
  const dateFromCell = (value: string): string | null => (
    cleanHtml(value).match(/\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}/)?.[0] ?? null
  );
  const cleanUsername = (value: string) => value.trim().replace(/^\(/, '').replace(/\)$/, '') || '';
  const personFromLabel = (value: string) => {
    const cleaned = cleanHtml(value).replace(/[.;\s]+$/, '');
    const match = cleaned.match(/^(.*?)\s*\(([^()]+)\)$/);
    return {
      fullName: (match?.[1] ?? cleaned).trim(),
      username: cleanUsername(match?.[2] ?? ''),
    };
  };
  const recipientsFromContent = (content: string, label: 'Chuyển tới' | 'Đồng xử lý') => {
    const recipients: Array<{ username: string; fullName: string }> = [];
    const paragraphs = [...content.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)];
    const labelPattern = label === 'Chuyển tới'
      ? /^(chuyển tới|chuyen toi):/i
      : /^(đồng xử lý|dong xu ly):/i;
    for (const paragraph of paragraphs) {
      if (!labelPattern.test(cleanHtml(paragraph[1]))) continue;
      for (const span of paragraph[1].matchAll(/<span\b[^>]*>([\s\S]*?)<\/span>/gi)) {
        const recipient = personFromLabel(span[1]);
        if (recipient.fullName) recipients.push(recipient);
      }
    }
    return recipients;
  };
  const withoutCoProcessingParagraphs = (content: string) => content.replace(
    /<p\b[^>]*>([\s\S]*?)<\/p>/giu,
    (paragraph, inner: string) => /^(đồng\s*xử\s*lý|dong\s*xu\s*ly)\s*:/iu.test(cleanHtml(inner))
      ? ''
      : paragraph,
  );

  for (const row of rows) {
    const rowTag = row[0].match(/^<tr\b[^>]*>/i)?.[0] ?? '';
    if (!/\blog_role_type_received\b/i.test(trAttr(rowTag, 'class'))) continue;

    const tds = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
    if (tds.length < 8) continue;

    const content = tds[7];
    const primaryRecipients = recipientsFromContent(content, 'Chuyển tới');
    // Keep the current incoming-document workflow compatible with manual co-processing.
    const recipients = primaryRecipients.length ? primaryRecipients : recipientsFromContent(content, 'Đồng xử lý');
    const actorCell = tds[1];
    const senderUsername = cleanUsername(
      trAttr(rowTag, 'updated_by')
      || trAttr(actorCell.match(/<input\b[^>]*id=["']hid_lux_updated_by["'][^>]*>/i)?.[0] ?? '', 'value'),
    );
    const senderName = cleanHtml(
      trAttr(actorCell.match(/<input\b[^>]*id=["']hid_lux_full_name["'][^>]*>/i)?.[0] ?? '', 'value')
      || actorCell,
    ).replace(/\s*\([^()]+\)\s*$/, '');

    const actionElement = content.match(/<[^>]+class=["']([^"']*\blog-action-data\S*[^"']*)["'][^>]*>/i);
    const actionClass = actionElement?.[1].split(/\s+/).find((name) => name.startsWith('log-action-data'));
    const actionAfterLabel = cleanHtml(
      content.match(/Thao\s+t(?:á|a)c:[\s\S]*?<\/span>\s*([\s\S]*?)(?:<div|$)/i)?.[1] ?? '',
    );
    const action = actionAfterLabel || actionClass?.slice('log-action-data'.length) || '';
    const comment = cleanHtml(content.match(/<span\b[^>]*name=["']comment["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? '');
    // The source folds direct recipients and co-processors into one routing block.
    // Persist only the business comment/action; routing remains available above for
    // workflow derivation and can never leak co-processor lists into a document.
    const cleanedComment = cleanHtml(withoutCoProcessingParagraphs(
      content.match(/<span\b[^>]*name=["']comment["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? '',
    ));
    const cleanedContent = cleanedComment || (action ? `Thao tác: ${action}` : '');

    results.push({
      id: trAttr(rowTag, 'act_id') || cleanHtml(tds[0]),
      sequence: parseOptionalInteger(trAttr(rowTag, 'stt') || cleanHtml(tds[0])),
      sender: { username: senderUsername, fullName: senderName },
      receiver: recipients[0] ?? { username: '', fullName: '' },
      recipients,
      action,
      comment,
      content: cleanedContent,
      receivedAt: dateFromCell(tds[3]),
      processingAt: dateFromCell(tds[4]),
      completedAt: dateFromCell(tds[5]),
      updatedAt: trAttr(rowTag, 'updated_date') || dateFromCell(tds[6]),
    });
  }

  return results.sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
}

function nullableText(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text || null;
}

function parseOptionalInteger(value: unknown): number | null {
  const text = nullableText(value);
  if (!text) return null;

  const parsed = Number.parseInt(text, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function documentDirection(congvanDendi: unknown): DocumentDirection {
  if (String(congvanDendi ?? '') === '1') return 'incoming';
  if (String(congvanDendi ?? '') === '2') return 'outgoing';
  return 'unknown';
}

function parseRelatedDocumentFiles(value: unknown): RelatedDocumentFile[] {
  if (typeof value !== 'string') return [];

  return value
    .split('|')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [id, name, primaryFlag, uploadedBy] = entry.split(';');
      return {
        id: nullableText(id),
        name: nullableText(name),
        isPrimary: primaryFlag === '1',
        uploadedBy: nullableText(uploadedBy),
      };
    });
}

function parseRelatedDocumentSummary(item: Record<string, unknown>): RelatedDocumentSummary | null {
  const decoded = (value: unknown) => nullableText(decodeHtmlEntities(String(value ?? '')));
  const documentId = decoded(item.id);
  if (!documentId) return null;

  return {
    documentId,
    documentDirection: documentDirection(item.congvan_dendi),
    congvanDendi: decoded(item.congvan_dendi),
    documentNumber: decoded(item.so_den_di) ?? decoded(item.so_den),
    symbol: decoded(item.so_kyhieu),
    summary: decoded(item.trich_yeu),
    documentDate: decoded(item.ngay_van_ban_full) ?? decoded(item.ngay_van_ban),
    createdAt: decoded(item.create_time),
    createdBy: decoded(item.create_by),
  };
}

function emptyRelatedDocumentDetail(): RelatedDocumentDetail {
  return {
    parentId: null,
    originalDocumentIds: [],
    identifier: null,
    issuedDate: null,
    createdDate: null,
    issuingOrganization: null,
    draftingOrganization: null,
    originalStorageUnit: null,
    documentType: null,
    documentTypeCode: null,
    businessDocumentType: null,
    priority: null,
    priorityCode: null,
    securityLevel: null,
    drafter: { username: null, fullName: null },
    signer: { username: null, fullName: null, position: null },
    enteredBy: null,
    assigner: null,
    pageCount: null,
    copyCount: null,
    status: null,
    processingStatus: null,
    processKey: null,
    processInstanceId: null,
    taskId: null,
    files: [],
  };
}

function normalizeIncomingRelatedDocumentDetail(detail: DocDetailResult): RelatedDocumentDetail {
  return {
    ...emptyRelatedDocumentDetail(),
    issuingOrganization: nullableText(detail.donViBanHanh),
    documentType: nullableText(detail.hinhThuc),
    documentTypeCode: nullableText(detail.hinhThuc),
    priority: nullableText(detail.doKhan),
    priorityCode: nullableText(detail.doKhan),
    securityLevel: nullableText(detail.doMat),
    drafter: { username: null, fullName: nullableText(detail.nguoiSoan) },
    signer: { username: null, fullName: nullableText(detail.nguoiKy), position: null },
  };
}

function normalizeOutgoingRelatedDocumentDetail(item: Record<string, unknown>): RelatedDocumentDetail {
  const originalDocumentIds = String(item.ds_id_vanban_goc ?? '')
    .split(';')
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    ...emptyRelatedDocumentDetail(),
    parentId: nullableText(item.parent_id),
    originalDocumentIds,
    identifier: nullableText(item.ma_dinh_danh),
    issuedDate: nullableText(item.ngay_ban_hanh),
    createdDate: nullableText(item.ngay_tao_doc),
    issuingOrganization: nullableText(item.donvi_banhanh),
    draftingOrganization: nullableText(item.donvi_soanthao),
    originalStorageUnit: nullableText(item.donvi_luugoc),
    documentType: nullableText(item.hinhthuc_vanban),
    documentTypeCode: nullableText(item.dcmtype_code),
    businessDocumentType: nullableText(item.bussiness_doc_type_name),
    priority: nullableText(item.do_uutien),
    priorityCode: nullableText(item.priority_code),
    securityLevel: nullableText(item.domat) ?? nullableText(item.confidential_code),
    drafter: {
      username: nullableText(item.nguoi_soanthao),
      fullName: nullableText(item.ten_nguoi_soanthao) ?? nullableText(item.nguoi_vaoso),
    },
    signer: {
      username: nullableText(item.userid_nguoi_ky_chinh),
      fullName: nullableText(item.nguoi_ky_chinh),
      position: nullableText(item.chucvu_nguoiky),
    },
    enteredBy: nullableText(item.nguoi_vaoso),
    assigner: nullableText(item.assigner),
    pageCount: parseOptionalInteger(item.so_trang),
    copyCount: parseOptionalInteger(item.so_ban),
    status: nullableText(item.trang_thai),
    processingStatus: nullableText(item.xu_ly),
    processKey: nullableText(item.process_key),
    processInstanceId: nullableText(item.process_instance_id),
    taskId: nullableText(item.taskid),
    files: parseRelatedDocumentFiles(item.files),
  };
}

/**
 * Fetch every eOffice document linked to an incoming document. The endpoint may
 * return both incoming and outgoing records; direction is kept rather than filtered.
 */
export async function getRelatedDocumentList(
  originalDocumentId: string,
  csrfToken?: string,
): Promise<RelatedDocumentSummary[]> {
  const csrf = csrfToken ?? (await getCsrfToken());
  const body = [
    'callCount=1',
    'c0-scriptName=NEORemoting',
    'c0-methodName=getRSet',
    `c0-id=${createCallId()}`,
    `c0-param0=string:qlvb.van_ban_den.getDocRelated(%22${originalDocumentId}%22%2C%220%22)`,
    'c0-param1=boolean:false',
    'xml=true',
    '',
  ].join('\n');

  const res = await langson.post(DWR_RSET_PATH, {
    data: body,
    responseType: 'text',
    transformResponse: [(data) => data],
    headers: { Accept: '*/*', 'Content-Type': 'text/plain', 'csrf-token': csrf, Origin: undefined, 'X-Requested-With': undefined },
  });
  if (res.status < 200 || res.status >= 300) throw new Error(`POST ${DWR_RSET_PATH} -> ${res.status}`);

  return parseDwrS0<Record<string, unknown>>(String(res.data))
    .map(parseRelatedDocumentSummary)
    .filter((item): item is RelatedDocumentSummary => item !== null);
}

/** Fetch the full detail record for an outgoing eOffice document. */
export async function getOutgoingDocumentDetail(
  documentId: string,
  csrfToken?: string,
): Promise<RelatedDocumentDetail> {
  const csrf = csrfToken ?? (await getCsrfToken());
  const body = [
    'callCount=1',
    'c0-scriptName=NEORemoting',
    'c0-methodName=getRSet',
    `c0-id=${createCallId()}`,
    `c0-param0=string:qlvb.vanban_di.act_activiti.sf_get_detail_doc('${documentId}')`,
    'c0-param1=boolean:false',
    'xml=true',
    '',
  ].join('\n');

  const res = await langson.post(DWR_RSET_PATH, {
    data: body,
    responseType: 'text',
    transformResponse: [(data) => data],
    headers: { Accept: '*/*', 'Content-Type': 'text/plain', 'csrf-token': csrf, Origin: undefined, 'X-Requested-With': undefined },
  });
  if (res.status < 200 || res.status >= 300) throw new Error(`POST ${DWR_RSET_PATH} -> ${res.status}`);

  const detail = parseDwrS0<Record<string, unknown>>(String(res.data))[0];
  if (!detail) throw new Error(`Outgoing document detail is empty for document ${documentId}`);
  return normalizeOutgoingRelatedDocumentDetail(detail);
}

/**
 * Fetch document detail by id.
 * Calls qlvb.ds_van_ban.getDocDetail (see docs/flow-crawl.md §3.3).
 */
export async function getDocDetail(
  documentId: string,
  csrfToken?: string,
): Promise<DocDetailResult> {
  const csrf = csrfToken ?? (await getCsrfToken());
  const body = [
    'callCount=1',
    'c0-scriptName=DataRemoting',
    'c0-methodName=getDoc',
    `c0-id=${createCallId()}`,
    `c0-param0=string:qlvb.ds_van_ban.getDocDetail("1","1",'{"id":${documentId}}',\"${documentId}\",\"\")`,
    'c0-param1=boolean:false',
    'xml=true',
    '',
  ].join('\n');

  const res = await langson.post(DWR_DATA_PATH, {
    data: body,
    responseType: 'text',
    transformResponse: [(d) => d],
    headers: { Accept: '*/*', 'Content-Type': 'text/plain', 'csrf-token': csrf, Origin: undefined, 'X-Requested-With': undefined },
  });
  if (res.status < 200 || res.status >= 300) throw new Error(`POST ${DWR_DATA_PATH} -> ${res.status}`);

  const html = extractS0Html(String(res.data));

  function tdById(id: string): string {
    const m = html.match(new RegExp(`<td[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)<\\/td>`, 'i'));
    return decodeHtmlEntities((m?.[1] ?? '').replace(/<[^>]+>/g, '').trim());
  }

  function tdNextToId(id: string): string {
    const m = html.match(new RegExp(`id="${id}"[^>]*>.*?<\\/(?:td|b|span)>\\s*(?:<!--[\\s\\S]*?-->\\s*)*<td[^>]*>([\\s\\S]*?)<\\/td>`, 'i'));
    return decodeHtmlEntities((m?.[1] ?? '').replace(/<[^>]+>/g, '').trim());
  }

  function tdNextToText(text: string): string {
    // Match <b>text</b></td> then next <td>
    const m = html.match(new RegExp(`<b[^>]*>\\s*${text}\\s*<\\/b><\\/td>\\s*(?:<!--[\\s\\S]*?-->\\s*)*<td[^>]*>([\\s\\S]*?)<\\/td>`, 'i'));
    return decodeHtmlEntities((m?.[1] ?? '').replace(/<[^>]+>/g, '').trim());
  }

  // soDen: 2nd <td class="class_detail_soden"> (first one is the label with <b>)
  const sodenTds = [...html.matchAll(/<td[^>]*class="[^"]*class_detail_soden[^"]*"[^>]*>([\s\S]*?)<\/td>/gi)];
  const soDen = decodeHtmlEntities(
    (sodenTds.find((m) => !m[1].includes('<b>')))?.[1]?.replace(/<[^>]+>/g, '').trim() ?? '',
  );

  return {
    id: documentId,
    soDen,
    soKyHieu: tdById('detailSoKyHieu'),
    trichYeu: tdById('detailTrichYeu'),
    donViBanHanh: tdById('div_donvi_soanthao'),
    ngayVanBan: tdById('detailNgayVanBan') || tdById('detail_ngay_van_ban') || tdNextToText('Ngày văn bản'),
    ngayDen: tdById('detail_ngay_den_banhanh_data'),
    hinhThuc: tdById('detailHinhThuc') || tdNextToId('loaiVBBLU'),
    doKhan: tdById('detailDoKhan') || tdNextToText('Độ khẩn'),
    doMat: tdById('td_secret_level'),
    nguoiSoan: tdById('id_nguoi_soan') || tdById('detailNguoiSoan'),
    nguoiKy: tdById('id_nguoi_ky') || tdById('detailNguoiKy'),
  };
}

/**
 * Fetch activity log (track history) for a document.
 * Calls qlvb.van_ban_den.getDcmTrackActivitiLog (see docs/flow-crawl.md §3.4).
 */
export async function getTrackLog(
  documentId: string,
  orgPrefix: string = '',
  csrfToken?: string,
): Promise<TrackLogItem[]> {
  const csrf = csrfToken ?? (await getCsrfToken());
  const body = [
    'callCount=1',
    'c0-scriptName=DataRemoting',
    'c0-methodName=getDoc',
    `c0-id=${createCallId()}`,
    `c0-param0=string:qlvb.van_ban_den.getDcmTrackActivitiLog("${documentId}","${orgPrefix}","","","","${documentId}")`,
    'c0-param1=boolean:false',
    'xml=true',
    '',
  ].join('\n');

  const res = await langson.post(DWR_DATA_PATH, {
    data: body,
    responseType: 'text',
    transformResponse: [(d) => d],
    headers: { Accept: '*/*', 'Content-Type': 'text/plain', 'csrf-token': csrf, Origin: undefined, 'X-Requested-With': undefined },
  });
  if (res.status < 200 || res.status >= 300) throw new Error(`POST ${DWR_DATA_PATH} -> ${res.status}`);

  return parseTrackLogHtmlResponse(String(res.data));
}

/**
 * Resolve outgoing documents related to one incoming document. A related item
 * without a tracklog is not a usable response document and is intentionally
 * excluded before its detail is requested or persisted.
 */
export async function getRelatedDocuments(
  originalDocumentId: string,
  orgPrefix: string = '',
  csrfToken?: string,
): Promise<RelatedDocumentResult[]> {
  const csrf = csrfToken ?? (await getCsrfToken());
  const summaries = await getRelatedDocumentList(originalDocumentId, csrf);

  const outgoing = summaries.filter((summary) => summary.documentDirection === 'outgoing');
  const withTrackLogs = await Promise.all(outgoing.map(async (summary) => ({
    summary,
    trackLogs: await getTrackLog(summary.documentId, orgPrefix, csrf),
  })));

  return Promise.all(withTrackLogs
    .filter(({ trackLogs }) => trackLogs.length > 0)
    .map(async ({ summary, trackLogs }) => ({
      ...summary,
      detail: await getOutgoingDocumentDetail(summary.documentId, csrf),
      trackLogs,
    })));
}

// CLI smoke test: `pnpm exec tsx src/services/langson-dwr.service.ts`
if (require.main === module) {
  (async () => {
    try {
      const csrf = await getCsrfToken();

      const menus = await menuItem({ csrfToken: csrf });
      console.log('menuItem:', JSON.stringify(menus, null, 2));

      const filter = newestNgayDenFilter();
      const count = await getDocCount(filter, csrf);
      console.log('getDocCount:', JSON.stringify(count, null, 2));

      const docs = await getDocList(1, 50, filter, csrf);
      console.log(`getDocList page 1 (${docs.length} items):`, JSON.stringify(docs, null, 2));

      const docWithSoDen = docs.find((d) => d.soDen);
      if (docWithSoDen) {
        console.log(`\nFound doc with soDen (${docWithSoDen.soDen}), testing detail API...`);
        const detail = await getDocDetail(docWithSoDen.documentId, csrf);
        console.log('getDocDetail:', JSON.stringify(detail, null, 2));

        const log = await getTrackLog(docWithSoDen.documentId, 'QLVB_LSN_XATHIENTAN.', csrf);
        console.log('getTrackLog:', JSON.stringify(log, null, 2));
        console.log('isCompleted:', isCompletedDocumentTrackLog(log));
      } else {
        console.log('\nNo document with soDen found on page 1.');
      }
    } catch (e) {
      console.error('smoke test failed:', e);
      process.exit(1);
    } finally {
      await langson.dispose();
    }
  })();
}
