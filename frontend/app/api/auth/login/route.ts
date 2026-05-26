import { NextResponse } from 'next/server';

const SESSION_COOKIE = 'dashboard_session';
const COOKIE_MAX_AGE = 60 * 60 * 8; // 8 hours

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

export async function POST(request: Request) {
  const expectedUsername = process.env.DASHBOARD_USERNAME;
  const expectedPassword = process.env.DASHBOARD_PASSWORD;
  const secret = process.env.DASHBOARD_SECRET;

  if (!expectedUsername || !expectedPassword || !secret) {
    return NextResponse.json({ error: 'Authentication not configured' }, { status: 500 });
  }

  let body: { username?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { username, password } = body;

  if (
    !username ||
    !password ||
    username !== expectedUsername ||
    password !== expectedPassword
  ) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const token = await computeSessionToken(username, password, secret);

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });
  return response;
}
