import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const { message } = await req.json();

  let response = "I can help with IT support.";

  if (message.toLowerCase().includes("ticket")) {
    response =
      "Your ticket is currently in progress and assigned to IT support.";
  } else if (message.toLowerCase().includes("access")) {
    response = "Access requires approval. A request can be submitted.";
  } else if (
    message.toLowerCase().includes("account") ||
    message.toLowerCase().includes("locked")
  ) {
    response =
      "Try account recovery steps first. If that fails, we can create a support ticket.";
  }

  return NextResponse.json({ response });
}