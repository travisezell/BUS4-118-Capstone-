"use client";

import { useState } from "react";

export default function Home() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<{ role: string; content: string }[]>(
    []
  );

  async function sendMessage() {
    if (!input) return;

    const userText = input;

    setMessages((prev) => [
      ...prev,
      { role: "user", content: userText },
      { role: "assistant", content: "Checking request..." },
    ]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: userText }),
      });

      const data = await res.json();

      setMessages((prev) => [
        ...prev.slice(0, -1),
        { role: "assistant", content: data.response },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev.slice(0, -1),
        { role: "assistant", content: "Error getting response." },
      ]);
    }

    setInput("");
  }

  return (
    <div style={{ padding: 20 }}>
      <h1>IT Support Chat</h1>

      <div
        style={{
          border: "1px solid gray",
          height: 300,
          marginBottom: 10,
          padding: 10,
          overflowY: "auto",
        }}
      >
        {messages.map((m, i) => (
          <div key={i}>
            <b>{m.role}:</b> {m.content}
          </div>
        ))}
      </div>

      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Ask something..."
        style={{ marginRight: 8 }}
      />
      <button onClick={sendMessage}>Send</button>
    </div>
  );
}