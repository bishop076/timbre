import { NextResponse, type NextRequest } from "next/server";

import { guard } from "@/lib/api";

export function proxy(request: NextRequest) {
  return guard(request, "pages") ?? NextResponse.next();
}

export const config = {
  matcher: ["/artist/:path*", "/album/:path*", "/collection/:path*"],
};
