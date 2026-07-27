import { chromium, type Browser, type BrowserContext } from "playwright";
import {
  deadlineDescendingFilter,
  parseDocListHtml,
  parseDwrS0,
  type DocumentListItem,
} from "./langson-dwr.service";

const APP_URL = process.env.LANGSON_APP_URL ?? "https://vanphongdientu.langson.gov.vn/";
const MAIN_URL = process.env.LANGSON_PROBE_URL
  ?? "https://vanphongdientu.langson.gov.vn/qlvbdh_lsn/main";
const DATA_PATH = "/qlvbdh_lsn/dwr/exec/DataRemoting.getDoc.dwr";
const RSET_PATH = "/qlvbdh_lsn/dwr/exec/NEORemoting.getRSet.dwr";
const REQUEST_TIMEOUT = Number(process.env.LANGSON_NAV_TIMEOUT ?? 45_000);
const USER_AGENT = process.env.LANGSON_USER_AGENT
  ?? "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
const PAGE_LIMIT = Math.min(Math.max(Number(process.env.LANGSON_DWR_DOC_PAGE_LIMIT ?? 50), 1), 100);

export type ConnectorCredentials = { username: string; password: string };

export type ConnectorLangsonClient = {
  listIncoming(): Promise<DocumentListItem[]>;
  dispose(): Promise<void>;
};

const createCallId = () => `${Math.floor(1000 + Math.random() * 9000)}_${Date.now()}`;

const onApplication = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return !/authenticationendpoint|login/i.test(parsed.pathname);
  } catch {
    return false;
  }
};

/** The named secret must be JSON; values are never logged, persisted, or returned. */
export const parseConnectorCredentials = (secret: string): ConnectorCredentials => {
  if (typeof secret !== "string" || secret.length < 2 || secret.length > 8_192) {
    throw new Error("CONNECTOR_SECRET_FORMAT_INVALID");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(secret);
  } catch {
    throw new Error("CONNECTOR_SECRET_FORMAT_INVALID");
  }
  const record = parsed as Record<string, unknown>;
  const username = typeof record?.username === "string" ? record.username.trim() : "";
  const password = typeof record?.password === "string" ? record.password : "";
  if (!username || username.length > 256 || !password || password.length > 1_024) {
    throw new Error("CONNECTOR_SECRET_FORMAT_INVALID");
  }
  return { username, password };
};

class EphemeralLangsonClient implements ConnectorLangsonClient {
  constructor(
    private readonly browser: Browser,
    private readonly context: BrowserContext,
  ) {}

  private async csrfToken(): Promise<string> {
    const response = await this.context.request.get(MAIN_URL, { timeout: REQUEST_TIMEOUT });
    const html = await response.text();
    if (!response.ok()) throw new Error("CONNECTOR_SOURCE_SESSION_INVALID");
    const token = html.match(/\bcsrf_token\s*=\s*['"]([^'"]+)['"]/i)?.[1];
    if (!token) throw new Error("CONNECTOR_SOURCE_CSRF_UNAVAILABLE");
    return token;
  }

  private async dwr(path: string, csrfToken: string, data: string): Promise<string> {
    const response = await this.context.request.post(new URL(path, APP_URL).toString(), {
      data,
      timeout: REQUEST_TIMEOUT,
      headers: {
        Accept: "*/*",
        "Content-Type": "text/plain",
        "csrf-token": csrfToken,
      },
    });
    if (!response.ok()) throw new Error("CONNECTOR_SOURCE_REQUEST_FAILED");
    return response.text();
  }

  async listIncoming(): Promise<DocumentListItem[]> {
    const csrfToken = await this.csrfToken();
    const filter = JSON.stringify(deadlineDescendingFilter());
    const countBody = [
      "callCount=1",
      "c0-scriptName=NEORemoting",
      "c0-methodName=getRSet",
      `c0-id=${createCallId()}`,
      `c0-param0=string:qlvb.van_ban_den.getTraCuuVanBanPaging(\"-1\",\"${PAGE_LIMIT}\",'${filter}')`,
      "c0-param1=boolean:false",
      "xml=true",
      "",
    ].join("\n");
    const countRaw = await this.dwr(RSET_PATH, csrfToken, countBody);
    const [count] = parseDwrS0<{ nop?: string }>(countRaw);
    const pages = Math.min(Math.max(Number(count?.nop ?? 0), 0), 100);
    const records: DocumentListItem[] = [];
    for (let page = 1; page <= pages; page += 1) {
      const listBody = [
        "callCount=1",
        "c0-scriptName=DataRemoting",
        "c0-methodName=getDoc",
        `c0-id=${createCallId()}`,
        `c0-param0=string:qlvb.van_ban_den.getDSVanBan(\"${page}\",\"${PAGE_LIMIT}\",'${filter}')`,
        "c0-param1=boolean:false",
        "xml=true",
        "",
      ].join("\n");
      records.push(...parseDocListHtml(await this.dwr(DATA_PATH, csrfToken, listBody)));
    }
    return records;
  }

  async dispose(): Promise<void> {
    await this.context.close().catch(() => undefined);
    await this.browser.close().catch(() => undefined);
  }
}

/**
 * Opens a brand-new, in-memory browser context for exactly one Connector run.
 * There is deliberately no persistent context, cookie store, profile path, or
 * process-global client; disposal drops all session material.
 */
export const openConnectorLangsonClient = async (
  secret: string,
): Promise<ConnectorLangsonClient> => {
  const credentials = parseConnectorCredentials(secret);
  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-blink-features=AutomationControlled"],
  });
  try {
    const context = await browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1280, height: 800 },
      locale: "vi-VN",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(REQUEST_TIMEOUT);
    await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: REQUEST_TIMEOUT });
    if (!onApplication(page.url())) {
      await page.fill("#username", credentials.username);
      await page.fill("#password", credentials.password);
      await page.check("#chkRemember").catch(() => undefined);
      await Promise.all([
        page.waitForURL((url) => onApplication(url.toString()), { timeout: REQUEST_TIMEOUT }),
        page.click("button[type=submit]"),
      ]);
    }
    return new EphemeralLangsonClient(browser, context);
  } catch (error) {
    await browser.close().catch(() => undefined);
    throw error instanceof Error ? error : new Error("CONNECTOR_SOURCE_AUTH_FAILED");
  }
};
