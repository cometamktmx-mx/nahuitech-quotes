import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

function redirectWithSessionCookies(
  request: NextRequest,
  path: string,
  supabaseResponse: NextResponse
) {
  const url = request.nextUrl.clone();
  url.pathname = path;
  url.search = "";

  const redirectResponse = NextResponse.redirect(url);

  supabaseResponse.cookies
    .getAll()
    .forEach((cookie) => redirectResponse.cookies.set(cookie));

  ["cache-control", "expires", "pragma"].forEach((headerName) => {
    const value = supabaseResponse.headers.get(headerName);
    if (value) redirectResponse.headers.set(headerName, value);
  });

  return redirectResponse;
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabasePublishableKey) {
    return supabaseResponse;
  }

  const supabase = createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );

        supabaseResponse = NextResponse.next({ request });

        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );

        Object.entries(headers).forEach(([name, value]) =>
          supabaseResponse.headers.set(name, value)
        );
      },
    },
  });

  const { data: claimsData } = await supabase.auth.getClaims();
  const userId =
    typeof claimsData?.claims.sub === "string" ? claimsData.claims.sub : null;
  const { pathname } = request.nextUrl;
  const isLoginRoute = pathname === "/login";
  const isAdminRoute = pathname.startsWith("/admin");
  const isSellerRoute = pathname.startsWith("/seller");
  const isProtectedRoute = isAdminRoute || isSellerRoute;

  if (!isLoginRoute && !isProtectedRoute) {
    return supabaseResponse;
  }

  if (!userId) {
    return isProtectedRoute
      ? redirectWithSessionCookies(request, "/login", supabaseResponse)
      : supabaseResponse;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, active")
    .eq("id", userId)
    .maybeSingle();

  if (!profile || !profile.active) {
    return isProtectedRoute
      ? redirectWithSessionCookies(request, "/login", supabaseResponse)
      : supabaseResponse;
  }

  const defaultPath = profile.role === "admin" ? "/admin" : "/seller";
  const hasSellerFlowAccess =
    profile.role === "seller" || profile.role === "expo";

  if (isLoginRoute || (isAdminRoute && profile.role !== "admin")) {
    return redirectWithSessionCookies(request, defaultPath, supabaseResponse);
  }

  if (isSellerRoute && !hasSellerFlowAccess) {
    return redirectWithSessionCookies(request, defaultPath, supabaseResponse);
  }

  return supabaseResponse;
}
