import { NextResponse } from "next/server";
import { dispatchDueMessages } from "@/lib/server/booking";

export const dynamic = "force-dynamic";

/** called by Vercel Cron (or any scheduler) with Authorization: Bearer $CRON_SECRET */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await dispatchDueMessages());
}
