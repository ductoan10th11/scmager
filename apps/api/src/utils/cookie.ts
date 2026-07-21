export const AUTH_COOKIE_NAME = 'scmager_session';

export const parseCookies = (cookieHeader?: string) => {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;

  for (const part of cookieHeader.split(';')) {
    const [rawKey, ...rawValue] = part.trim().split('=');
    if (!rawKey || rawValue.length === 0) continue;
    const value = rawValue.join('=');
    try {
      cookies[rawKey] = decodeURIComponent(value);
    } catch {
      cookies[rawKey] = value;
    }
  }

  return cookies;
};

const isProduction = process.env.NODE_ENV === 'production';

export const getAuthCookieOptions = (maxAgeMs?: number) => ({
  httpOnly: true,
  // The extension renders the compact workspace in an eWork iframe. Production
  // needs a cross-site cookie for that embedded, HTTPS-only context.
  sameSite: isProduction ? 'none' as const : 'lax' as const,
  secure: isProduction,
  path: '/',
  ...(maxAgeMs ? { maxAge: maxAgeMs } : {}),
});
