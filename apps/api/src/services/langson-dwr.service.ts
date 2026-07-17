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

/** Parse the JSON array from a DWR `var s0="..."` response. */
export function parseDwrS0<T = unknown>(raw: string): T[] {
  const m = raw.match(/var s0="([\s\S]+?)";\s*DWR/);
  if (!m?.[1]) return [];
  try {
    return JSON.parse(m[1].replace(/\\"/g, '"')) as T[];
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
    const nguoiXuLyMatches = [...trContent.matchAll(/<td[^>]*style="[^"]*text-align:\s*center[^"]*"[^>]*>([\s\S]*?)<\/td>/gi)]
      .filter((m) => !m[1].includes('<a '));
    const nguoiXuLy = stripHtmlText(nguoiXuLyMatches.at(-1)?.[1] ?? '');

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

export interface TrackLogItem {
  id: string;
  sender: { username: string; fullName: string };
  receiver: { username: string; fullName: string };
  action: string;
  comment: string;
  receivedAt: string | null;
  processingAt: string | null;
  completedAt: string | null;
}

const COMPLETED_SENDER = 'Văn thư xã Thiện Tân (vanthu-xathientan)';
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

const TRACK_LOG_POINT_PATTERN = /(?:^|\s)\[p:(\d+)\]/i;

/**
 * A point tag belongs to the latest tracklog that contains a valid `[p:<integer>]` marker.
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
    const match = comment.match(TRACK_LOG_POINT_PATTERN);
    if (!match) continue;

    const point = Number(match[1]);
    if (Number.isSafeInteger(point)) {
      return { point, trackLogId: String(log.id ?? ''), comment };
    }
  }

  return null;
}

export function isCompletedTrackLogItem(log: TrackLogItem | null): boolean {
  if (!log) return false;

  return (
    normalizeText(log.sender.fullName) === normalizeText(COMPLETED_SENDER)
    && normalizeText(log.action) === normalizeText(COMPLETED_ACTION)
  );
}

export function isCompletedDocumentTrackLog(trackLogs: TrackLogItem[]): boolean {
  return isCompletedTrackLogItem(getLatestTrackLog(trackLogs));
}

/** Extract and unescape the HTML inside `var s0="..."` from a DWR response. */
function extractS0Html(raw: string): string {
  const s0start = raw.indexOf('var s0="');
  if (s0start === -1) return '';
  const dwrIdx = raw.indexOf('DWREngine._handleResponse', s0start);
  if (dwrIdx === -1) return '';
  const contentEnd = raw.lastIndexOf('"', dwrIdx);
  const contentStart = s0start + 8;
  if (contentEnd <= contentStart) return '';
  return raw.slice(contentStart, contentEnd)
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

export function parseTrackLogHtmlResponse(raw: string): TrackLogItem[] {
  const html = extractS0Html(raw);

  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  const results: TrackLogItem[] = [];

  for (const row of rows) {
    // Extract exact tds without completely stripping HTML so we can parse the last one.
    const tds = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
    if (tds.length < 8) continue; // skip header/empty rows

    const clean = (str: string) => decodeHtmlEntities(str.replace(/<[^>]+>/g, '').trim());

    const noidungHtml = decodeHtmlEntities(tds[7]);

    // A manual co-processing action uses the same person format under "Đồng xử lý:".
    const receiverMatch = noidungHtml.match(/(?:Chuyển tới|Đồng xử lý):\s*<span[^>]*>([\s\S]*?)<\/span>/i);
    const receiverText = clean(receiverMatch?.[1] ?? '');

    // Extract action from: <span...>Thao tác:\n</span>Chuyển tiếp văn bản
    const actionMatch = noidungHtml.match(/Thao tác:[\s\S]*?<\/span>\s*([\s\S]*?)(?:<div|$)/i);
    const actionText = clean(actionMatch?.[1] ?? '');

    // Extract comment from: <span seq='1' name="comment"...>Đ/c chí Tình tham mưu<br /></span>
    const commentMatch = noidungHtml.match(/<span[^>]*name="comment"[^>]*>([\s\S]*?)<\/span>/i);
    const commentText = clean(commentMatch?.[1] ?? '');

    results.push({
      id: clean(tds[0]),
      sender: { username: '', fullName: clean(tds[1]) },
      receiver: { username: '', fullName: receiverText },
      action: actionText,
      comment: commentText,
      receivedAt: clean(tds[3]) || null,
      processingAt: clean(tds[4]) || null,
      completedAt: clean(tds[5]) || null,
    });
  }

  return results;
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
