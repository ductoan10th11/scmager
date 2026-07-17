import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
  type Method,
  type RawAxiosRequestHeaders,
} from 'axios';
import { Cookie, CookieJar } from 'tough-cookie';
import { getCookie, persist, type StorageState } from './langson-auth.service';

const APP_ORIGIN =
  process.env.LANGSON_APP_ORIGIN ?? 'https://vanphongdientu.langson.gov.vn';
const PROBE_URL =
  process.env.LANGSON_PROBE_URL ?? `${APP_ORIGIN}/qlvbdh_lsn/main`;
const IDP_HOST = process.env.LANGSON_IDP_HOST ?? 'is.langson.gov.vn';
const IDP_ORIGIN = `https://${IDP_HOST}`;
const USER_AGENT =
  process.env.LANGSON_USER_AGENT ??
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';
const REQUEST_TIMEOUT = Number(process.env.LANGSON_REQUEST_TIMEOUT ?? 60_000);
const MAX_REDIRECTS = Number(process.env.LANGSON_MAX_REDIRECTS ?? 10);

type AxiosWithJarConfig<D = unknown> = AxiosRequestConfig<D> & { jar?: CookieJar };

interface ClientContext {
  http: AxiosInstance;
  jar: CookieJar;
  storageState: StorageState;
}

let client: ClientContext | null = null;
let building: Promise<ClientContext> | null = null;
let wrapperLoader: Promise<(instance: AxiosInstance) => AxiosInstance> | null = null;

function appHost(): string {
  return new URL(APP_ORIGIN).host;
}

function resolveUrl(pathOrUrl: string): string {
  return /^https?:\/\//.test(pathOrUrl) ? pathOrUrl : APP_ORIGIN + pathOrUrl;
}

function sameSiteFor(url: string): 'same-origin' | 'same-site' | 'cross-site' {
  const host = new URL(url).host;
  if (host === appHost()) return 'same-origin';
  if (host === IDP_HOST) return 'same-site';
  return 'cross-site';
}

function browserHints(url: string): RawAxiosRequestHeaders {
  return {
    'User-Agent': USER_AGENT,
    'Accept-Language': 'vi',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
    'sec-ch-ua': '"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"',
    'sec-fetch-site': sameSiteFor(url),
  };
}

function documentHeaders(url: string): RawAxiosRequestHeaders {
  return {
    ...browserHints(url),
    Accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    Referer: `${APP_ORIGIN}/`,
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-user': '?1',
    'Upgrade-Insecure-Requests': '1',
  };
}

function ajaxHeaders(method: Method, url: string): RawAxiosRequestHeaders {
  const headers: RawAxiosRequestHeaders = {
    ...browserHints(url),
    Accept: 'application/json, text/plain, */*',
    Referer: `${APP_ORIGIN}/qlvbdh_lsn/main`,
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'X-Requested-With': 'XMLHttpRequest',
  };

  if (!['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())) {
    headers.Origin = APP_ORIGIN;
  }
  return headers;
}

function cookieUrl(domain: string, cookiePath: string): string {
  return `https://${domain.replace(/^\./, '')}${cookiePath || '/'}`;
}

function normalizeSameSite(value: unknown): 'Strict' | 'Lax' | 'None' {
  const s = String(value ?? '').toLowerCase();
  if (s === 'strict') return 'Strict';
  if (s === 'none') return 'None';
  return 'Lax';
}

export async function storageStateToJar(storageState: StorageState): Promise<CookieJar> {
  const jar = new CookieJar();

  for (const c of storageState.cookies) {
    const cookie = new Cookie({
      key: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expires === -1 ? undefined : new Date(c.expires * 1000),
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: c.sameSite?.toLowerCase(),
    });

    await jar.setCookie(cookie, cookieUrl(c.domain, c.path), { ignoreError: true });
  }

  return jar;
}

function isManagedCookieDomain(domain?: string | null): boolean {
  const normalized = (domain ?? '').replace(/^\./, '');
  return normalized === appHost() || normalized === IDP_HOST;
}

function toStorageCookie(c: Cookie, fallbackHost: string): StorageState['cookies'][number] {
  const expires = c.expires instanceof Date ? c.expires.getTime() / 1000 : -1;
  return {
    name: c.key,
    value: c.value,
    domain: c.domain ?? fallbackHost,
    path: c.path ?? '/',
    expires,
    httpOnly: c.httpOnly,
    secure: c.secure,
    sameSite: normalizeSameSite(c.sameSite),
  };
}

function cookieKey(c: StorageState['cookies'][number]): string {
  return `${c.domain};${c.path};${c.name}`;
}

export async function mergeJarIntoStorageState(
  baseState: StorageState,
  jar: CookieJar,
): Promise<StorageState> {
  const merged = new Map<string, StorageState['cookies'][number]>();

  for (const c of baseState.cookies) {
    if (!isManagedCookieDomain(c.domain)) merged.set(cookieKey(c), c);
  }

  for (const origin of [APP_ORIGIN, IDP_ORIGIN]) {
    const host = new URL(origin).host;
    const cookies = await jar.getCookies(origin, { allPaths: true });
    for (const c of cookies) {
      const storageCookie = toStorageCookie(c, host);
      merged.set(cookieKey(storageCookie), storageCookie);
    }
  }

  return {
    cookies: [...merged.values()],
    origins: baseState.origins,
  };
}

async function loadWrapper(): Promise<(instance: AxiosInstance) => AxiosInstance> {
  if (!wrapperLoader) {
    wrapperLoader = import('axios-cookiejar-support').then((m) => m.wrapper);
  }
  return wrapperLoader;
}

export function finalUrl(res: AxiosResponse): string {
  return (
    res.request?.res?.responseUrl ??
    res.request?.responseURL ??
    new URL(res.config.url ?? '', res.config.baseURL ?? APP_ORIGIN).toString()
  );
}

function looksLikeLoginHtml(res: AxiosResponse): boolean {
  const contentType = String(res.headers['content-type'] ?? '');
  if (!contentType.includes('text/html') || typeof res.data !== 'string') return false;
  return /id=["']loginForm["']|authenticationendpoint\/login\.do|name=["']sessionDataKey["']/i.test(
    res.data,
  );
}

function isUnauthenticated(res: AxiosResponse): boolean {
  if ([401, 403].includes(res.status)) return true;

  try {
    const u = new URL(finalUrl(res));
    if (u.host === IDP_HOST && /authenticationendpoint|login/i.test(u.pathname)) {
      return true;
    }
  } catch {
    // ignore
  }

  return looksLikeLoginHtml(res);
}

async function persistJar(c: ClientContext): Promise<void> {
  c.storageState = await mergeJarIntoStorageState(c.storageState, c.jar);
  await persist(c.storageState).catch(() => {});
}

async function ensureAppSession(c: ClientContext): Promise<void> {
  const res = await c.http.get(PROBE_URL, {
    headers: documentHeaders(PROBE_URL),
    jar: c.jar,
  } as AxiosWithJarConfig);

  if (isUnauthenticated(res) || res.status >= 400) {
    throw new Error(`Langson session probe failed: ${res.status} ${finalUrl(res)}`);
  }

  await persistJar(c);
}

async function context(forceRefresh = false): Promise<ClientContext> {
  if (client && !forceRefresh) return client;

  if (!building) {
    building = (async () => {
      client = null;

      const { storageState } = await getCookie();
      const jar = await storageStateToJar(storageState);
      const wrapper = await loadWrapper();
      const http = wrapper(
        axios.create({
          baseURL: APP_ORIGIN,
          jar,
          maxRedirects: MAX_REDIRECTS,
          timeout: REQUEST_TIMEOUT,
          validateStatus: () => true,
          withCredentials: true,
        } as AxiosWithJarConfig),
      );

      client = { http, jar, storageState };
      await ensureAppSession(client);
      return client;
    })().finally(() => {
      building = null;
    });
  }

  return building;
}

type LangsonRequestConfig<D = unknown> = AxiosRequestConfig<D>;

function requestHeaders(
  method: Method,
  url: string,
  overrides?: AxiosRequestConfig['headers'],
): RawAxiosRequestHeaders {
  const headers = {
    ...ajaxHeaders(method, url),
    ...overrides,
  } as Record<string, unknown>;

  return Object.fromEntries(
    Object.entries(headers).filter(([, value]) => value !== undefined),
  ) as RawAxiosRequestHeaders;
}

async function call<D = unknown>(
  method: Method,
  pathOrUrl: string,
  opts: LangsonRequestConfig<D> = {},
): Promise<AxiosResponse> {
  const url = resolveUrl(pathOrUrl);
  let c = await context();
  let res = await c.http.request({
    ...opts,
    method,
    url,
    headers: requestHeaders(method, url, opts.headers),
    jar: c.jar,
  } as AxiosWithJarConfig<D>);

  if (isUnauthenticated(res)) {
    c = await context(true);
    res = await c.http.request({
      ...opts,
      method,
      url,
      headers: requestHeaders(method, url, opts.headers),
      jar: c.jar,
    } as AxiosWithJarConfig<D>);
  }

  await persistJar(c);
  return res;
}

export const langson = {
  get: (p: string, o?: LangsonRequestConfig) => call('GET', p, o),
  post: <D = unknown>(p: string, o?: LangsonRequestConfig<D>) => call<D>('POST', p, o),
  put: <D = unknown>(p: string, o?: LangsonRequestConfig<D>) => call<D>('PUT', p, o),
  delete: (p: string, o?: LangsonRequestConfig) => call('DELETE', p, o),
  patch: <D = unknown>(p: string, o?: LangsonRequestConfig<D>) => call<D>('PATCH', p, o),

  async json<T = unknown>(p: string, o?: LangsonRequestConfig): Promise<T> {
    const res = await call('GET', p, o);
    if (res.status < 200 || res.status >= 300) throw new Error(`GET ${p} -> ${res.status}`);
    return res.data as T;
  },

  async dispose(): Promise<void> {
    client = null;
    building = null;
  },
};

// CLI smoke test: `pnpm exec tsx src/services/langson-client.service.ts`
if (require.main === module) {
  langson
    .get('/qlvbdh_lsn/main')
    .then(async (r) => {
      const c = await context();
      const state = await mergeJarIntoStorageState(c.storageState, c.jar);
      const cookieNamesByDomain: Record<string, string[]> = {};
      for (const cookie of state.cookies) {
        cookieNamesByDomain[cookie.domain] ??= [];
        cookieNamesByDomain[cookie.domain].push(cookie.name);
      }
      console.log('status:', r.status, '(200 = client healthy)');
      console.log('finalUrl:', finalUrl(r));
      console.log('cookieNamesByDomain:', cookieNamesByDomain);
      await langson.dispose();
    })
    .catch(async (e) => {
      console.error('client failed:', e);
      await langson.dispose();
      process.exit(1);
    });
}
