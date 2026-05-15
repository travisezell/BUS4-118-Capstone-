import { NextResponse } from "next/server";
import {
  handleMessage,
  handleMessageStreaming,
  type Message,
} from "@/src/application/api/chat";

export const runtime = "nodejs";

interface ChatRequest {
  message: string;
  history?: Message[];
}

export async function POST(req: Request) {
  let body: ChatRequest;
  try {
    body = (await req.json()) as ChatRequest;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body." },
      { status: 400 }
    );
  }

  const { message, history = [] } = body;
  if (!message || typeof message !== "string") {
    return NextResponse.json(
      { error: "`message` is required and must be a string." },
      { status: 400 }
    );
  }

  const trimmed = message.trim();
  if (trimmed.length === 0) {
    return NextResponse.json(
      { error: "`message` cannot be empty." },
      { status: 400 }
    );
  }
  if (trimmed.length > 2000) {
    return NextResponse.json(
      { error: "`message` is too long (max 2000 characters)." },
      { status: 400 }
    );
  }

  const url = new URL(req.url);
  const isStream = url.searchParams.get("stream") === "1";

  if (isStream) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of handleMessageStreaming(trimmed, history)) {
            const payload = `data: ${JSON.stringify(event)}\n\n`;
            controller.enqueue(encoder.encode(payload));
          }
          controller.close();
        } catch (err) {
          const errEvent = {
            kind: "error",
            message: err instanceof Error ? err.message : "Stream failed",
          };
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(errEvent)}\n\n`)
          );
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }

  const result = await handleMessage(trimmed, history);
  return NextResponse.json({
    response: result.answer,
    intent: result.intent,
    entities: result.entities,
    confidence: result.confidence,
    retrievedSources: result.retrievedSources,
    toolResults: result.toolResults,
    escalated: result.escalated,
    escalationReason: result.escalationReason,
    statusEvents: result.statusEvents,
    latencyMs: result.latencyMs,
  });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    info: "POST a JSON body { message: string, history?: Message[] } to chat with the agent. Append ?stream=1 to receive Server-Sent Events.",
  });
}
