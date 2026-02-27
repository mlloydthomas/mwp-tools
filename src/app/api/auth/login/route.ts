import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "mwp-auth";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export async function POST(req: NextRequest) {
  let body: { password?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { password } = body;
  const correctPassword = process.env.TEAM_PASSWORD;
  const sessionToken = process.env.AUTH_SESSION_TOKEN;

  if (!correctPassword || !sessionToken) {
    console.error("[auth] TEAM_PASSWORD or AUTH_SESSION_TOKEN not set");
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  if (!password || password !== correctPassword) {
    await new Promise((r) => setTimeout(r, 400));
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set(COOKIE_NAME, sessionToken, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });
  return response;
}
