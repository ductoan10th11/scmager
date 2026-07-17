import { config as dotenvConfig } from 'dotenv';
import { chromium, request as pwRequest, type BrowserContext } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

function findEnv(start: string): string | undefined {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}
dotenvConfig({ path: findEnv(__dirname) });

const APP_URL = process.env.LANGSON_APP_URL ?? 'https://vanphongdientu.langson.gov.vn/';
const PROBE_URL =
  process.env.LANGSON_PROBE_URL ?? 'https://vanphongdientu.langson.gov.vn/qlvbdh_lsn/main';
const IDP_HOST = process.env.LANGSON_IDP_HOST ?? 'is.langson.gov.vn';
const USERNAME = process.env.LANGSON_USERNAME ?? '';
const PASSWORD = process.env.LANGSON_PASSWORD ?? '';
const PROFILE_DIR =
  process.env.LANGSON_PROFILE_DIR ?? path.resolve(process.cwd(), '.langson-profile');
const STORE_FILE =
  process.env.LANGSON_COOKIE_STORE ?? path.join(PROFILE_DIR, 'storage-state.json');
const USER_AGENT =
  process.env.LANGSON_USER_AGENT ??
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';
const NAV_TIMEOUT = Number(process.env.LANGSON_NAV_TIMEOUT ?? 45_000);

export type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;

export interface Session {
  storageState: StorageState;
  loggedInAt: number;
}

function loadStore(): Session | null {
  try {
    const s = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')) as Session;
    return s.storageState?.cookies?.length ? s : null;
  } catch {
    return null;
  }
}

function saveStore(s: Session): void {
  fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
  fs.writeFileSync(STORE_FILE, JSON.stringify(s), { mode: 0o600 });
}

export async function persist(storageState: StorageState): Promise<void> {
  saveStore({ storageState, loggedInAt: Date.now() });
}

async function silentProbe(state: StorageState): Promise<Session | null> {
  const rc = await pwRequest.newContext({ storageState: state, userAgent: USER_AGENT });
  try {
    const res = await rc.get(PROBE_URL);
    if (res.status() !== 200) return null;
    return { storageState: await rc.storageState(), loggedInAt: Date.now() };
  } catch {
    return null;
  } finally {
    await rc.dispose();
  }
}

function isOnApp(url: string): boolean {
  try {
    const u = new URL(url);
    return u.host !== IDP_HOST && !u.pathname.includes('/authenticationendpoint/');
  } catch {
    return false;
  }
}

async function fullLogin(): Promise<Session> {
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: true,
    userAgent: USER_AGENT,
    viewport: { width: 1280, height: 800 },
    locale: 'vi-VN',
    args: ['--disable-blink-features=AutomationControlled'],
  });
  try {
    const page = await ctx.newPage();
    page.setDefaultTimeout(NAV_TIMEOUT);
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });

    if (!isOnApp(page.url())) {
      if (!USERNAME || !PASSWORD) {
        throw new Error('Session expired and LANGSON_USERNAME / LANGSON_PASSWORD not set');
      }
      await page.fill('#username', USERNAME);
      await page.fill('#password', PASSWORD);
      await page.check('#chkRemember').catch(() => {});
      await Promise.all([
        page.waitForURL((url) => isOnApp(url.toString()), { timeout: NAV_TIMEOUT }),
        page.click('button[type="submit"]'),
      ]);
    }
    return { storageState: await ctx.storageState(), loggedInAt: Date.now() };
  } finally {
    await ctx.close();
  }
}

let inflight: Promise<Session> | null = null;

export async function getCookie(): Promise<Session> {
  const cached = loadStore();
  if (cached) {
    const live = await silentProbe(cached.storageState);
    if (live) {
      saveStore(live);
      return live;
    }
  }
  if (!inflight) {
    inflight = fullLogin()
      .then((s) => {
        saveStore(s);
        return s;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

// CLI smoke test: `pnpm exec tsx src/services/langson-auth.service.ts`
if (require.main === module) {
  getCookie()
    .then((r) => {
      console.log('Session OK at', new Date(r.loggedInAt).toISOString());
      console.log(`\n${r.storageState.cookies.length} cookies:`);
      for (const c of r.storageState.cookies) {
        const exp = c.expires === -1 ? 'session' : new Date(c.expires * 1000).toISOString();
        console.log(`  ${c.name} @ ${c.domain}`);
        console.log(`    path=${c.path} exp=${exp} httpOnly=${c.httpOnly} secure=${c.secure} sameSite=${c.sameSite}`);
      }
    })
    .catch((e) => {
      console.error('getCookie failed:', e);
      process.exit(1);
    });
}
