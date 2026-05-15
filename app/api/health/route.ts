import { NextResponse } from "next/server";
import { buildHealthPayload } from "@/src/application/api/health";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(buildHealthPayload());
}
