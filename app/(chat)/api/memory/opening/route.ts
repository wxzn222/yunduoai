import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { buildOpeningMessage } from "@/lib/ai/yunduo/memory";
import { getLatestMemorySummaryByUserId } from "@/lib/db/queries";
import { ChatbotError } from "@/lib/errors";

const OPENING_VARIANT_COOKIE = "yunduo-opening-variant";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  const previousVariant = Number.parseInt(
    request.cookies.get(OPENING_VARIANT_COOKIE)?.value ?? "-1",
    10
  );
  const variant = Number.isFinite(previousVariant) ? previousVariant + 1 : 0;
  const memory = await getLatestMemorySummaryByUserId({
    userId: session.user.id,
  });
  const opening = buildOpeningMessage(memory, variant);
  const response = NextResponse.json({ opening });

  response.cookies.set(OPENING_VARIANT_COOKIE, String(variant), {
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}
