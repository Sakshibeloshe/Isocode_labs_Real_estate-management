import { NextResponse, type NextRequest } from "next/server";

// Fast gate only: no session cookie → login. Real checks (signature, role, active user) run on the server.
export function proxy(req: NextRequest) {
  if (!req.cookies.get("la_session")) {
    const url = new URL("/login", req.url);
    url.searchParams.set("next", req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/staff/:path*"] };
