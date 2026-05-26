import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const SESSION_COOKIE = 'dashboard_session';

function buildLogoutResponse(request: NextRequest) {
  const loginUrl = new URL('/login', request.url);
  const response = NextResponse.redirect(loginUrl);
  response.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  });
  return response;
}

export function GET(request: NextRequest) {
  return buildLogoutResponse(request);
}

export function POST(request: NextRequest) {
  return buildLogoutResponse(request);
}
