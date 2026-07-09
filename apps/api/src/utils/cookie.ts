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

export const getAuthCookieOptions = (maxAgeMs?: number) => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  ...(maxAgeMs ? { maxAge: maxAgeMs } : {}),
});
