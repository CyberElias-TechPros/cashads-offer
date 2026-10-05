import { NextResponse, type NextRequest } from 'next/server';

/** Referral deep link: remembers the code for 30 days, then sends the visitor to sign-up. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const clean = code.replace(/[^A-Za-z0-9]/g, '').slice(0, 24).toUpperCase();
  // Relative Location: correct behind any proxy / preview domain.
  const res = new NextResponse(null, { status: 307, headers: { Location: `/signup?ref=${encodeURIComponent(clean)}` } });
  const secure = request.nextUrl.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https';
  res.cookies.set('ca_ref', clean, { path: '/', maxAge: 60 * 60 * 24 * 30, sameSite: secure ? 'none' : 'lax', secure, partitioned: secure });
  return res;
}
