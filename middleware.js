// Runs on every request. Its one job is to keep the Supabase auth session
// cookie alive: calling getUser() refreshes the access token when it's
// close to expiry, and — unlike a Server Component — middleware can write
// the refreshed cookie onto the actual outgoing response. Without this,
// Server Components can read cookies but their cookie *writes* are
// silently dropped (see ssr-server.js), so refreshed tokens never reach
// the browser and sessions quietly die as soon as the access token expires.
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(request) {
  let response = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Write to both the incoming request (so this same middleware
          // pass sees the fresh cookies if it reads them again) and to a
          // fresh response object (so the browser actually receives them).
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Touching auth here is what triggers the refresh. The result IS used
  // below now, to gate /admin/* behind a valid session.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;
  const isAdminRoute = pathname === "/admin" || pathname.startsWith("/admin/");

  if (isAdminRoute && !user) {
    const loginUrl = new URL("/login", request.url);
    // Preserve where they were headed so login/page.js's NextRedirectField
    // + signIn() server action can send them straight back after auth.
    loginUrl.searchParams.set("next", pathname + search);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: [
    // Run on everything except static assets/images, so cookies stay
    // fresh whether you're on a page, an admin route, or an API call.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
