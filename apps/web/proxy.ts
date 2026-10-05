import { NextResponse, type NextRequest } from 'next/server';

/**
 * Route protection: members-only areas require a session cookie. The API is
 * the source of truth (it validates the session on every call); this just
 * avoids flashing protected pages to signed-out visitors.
 */
export function proxy(request: NextRequest) {
  if (!request.cookies.has('ca_session')) {
    const next = encodeURIComponent(request.nextUrl.pathname + request.nextUrl.search);
    // Relative Location keeps the visitor on whatever public domain they used.
    return new NextResponse(null, { status: 307, headers: { Location: `/login?next=${next}` } });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/app/:path*', '/admin/:path*'],
};
