import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const SESSION_COOKIE = 'dashboard_session';

async function computeSessionToken(username: string, password: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const payload = `${username}:${password}`;
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Always allow the login page, auth API routes, and static assets
  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/_next/static') ||
    pathname.startsWith('/_next/image') ||
    pathname === '/favicon.ico' ||
    /\.(?:png|jpg|jpeg|gif|svg|ico|webp)$/.test(pathname)
  ) {
    return NextResponse.next();
  }

  const username = process.env.DASHBOARD_USERNAME;
  const password = process.env.DASHBOARD_PASSWORD;
  const secret   = process.env.DASHBOARD_SECRET;

  // If auth is not configured, allow through (dev convenience)
  if (!username || !password || !secret) {
    return NextResponse.next();
  }

  const cookieValue = request.cookies.get(SESSION_COOKIE)?.value;
  const expected    = await computeSessionToken(username, password, secret);

  if (cookieValue !== expected) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico).*)'],
};
