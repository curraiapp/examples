"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { FormEvent, useEffect, useRef, useState } from "react";

const transport = new DefaultChatTransport({
  api: "/api/chat",
  prepareSendMessagesRequest({ messages }) {
    const sessionId = messages.find((message) => message.role === "user")?.id;

    return {
      body: { messages, sessionId },
    };
  },
});

function messageText(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

export default function Home() {
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const {
    messages,
    sendMessage,
    status,
    stop,
    error,
    clearError,
    setMessages,
  } = useChat({
    transport,
    generateId: () => crypto.randomUUID(),
  });

  const isBusy = status === "submitted" || status === "streaming";

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, status]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (!text || isBusy) return;

    clearError();
    setInput("");
    void sendMessage({ text });
  }

  function clearConversation() {
    if (isBusy) void stop();
    clearError();
    setInput("");
    setMessages([]);
  }

  return (
    <main className="chat-shell">
      <section className="chat-panel" aria-label="OpenAI chatbot">
        <header className="chat-header">
          <div className="brand-lockup">
            <span className="brand-mark" aria-hidden="true">
              O
            </span>
            <div>
              <p className="eyebrow">Streaming playground</p>
              <h1>OpenAI Chat Lab</h1>
            </div>
          </div>
          <div className="header-actions">
            <span className="connection-state">
              <span className="status-dot" aria-hidden="true" />
              AI SDK stream
            </span>
            <button
              className="text-button"
              type="button"
              onClick={clearConversation}
              disabled={messages.length === 0 && !error}
            >
              Clear chat
            </button>
          </div>
        </header>

        <div className="conversation" aria-live="polite">
          {messages.length === 0 ? (
            <div className="empty-state">
              <span className="empty-index">01 / ASK</span>
              <h2>Start with a real question.</h2>
              <p>
                This intentionally small chatbot streams responses directly
                from OpenAI and keeps the conversation in this browser tab.
              </p>
              <div className="prompt-suggestions" aria-label="Example prompts">
                {["Explain retrieval augmented generation simply", "Write a launch checklist for an AI feature"].map(
                  (prompt) => (
                    <button
                      type="button"
                      key={prompt}
                      onClick={() => setInput(prompt)}
                    >
                      {prompt}
                      <span aria-hidden="true">↗</span>
                    </button>
                  ),
                )}
              </div>
            </div>
          ) : (
            <div className="message-list">
              {messages.map((message, index) => {
                const text = messageText(message);
                return (
                  <article
                    className={`message message-${message.role}`}
                    key={message.id}
                  >
                    <div className="message-meta">
                      <span>{message.role === "user" ? "You" : "Assistant"}</span>
                      <span>{String(index + 1).padStart(2, "0")}</span>
                    </div>
                    <div className="message-copy">
                      {text || (message.role === "assistant" ? "Thinking…" : "")}
                    </div>
                  </article>
                );
              })}
              {status === "submitted" ? (
                <div className="thinking-row" role="status">
                  <span />
                  <span />
                  <span />
                  <span className="sr-only">Assistant is thinking</span>
                </div>
              ) : null}
            </div>
          )}
          <div ref={endRef} />
        </div>

        {error ? (
          <div className="error-banner" role="alert">
            <span>OpenAI request failed. Check your API key and try again.</span>
            <button type="button" onClick={clearError}>
              Dismiss
            </button>
          </div>
        ) : null}

        <form className="composer" onSubmit={submit}>
          <label htmlFor="chat-message">Message</label>
          <textarea
            id="chat-message"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder="Ask the assistant anything…"
            rows={3}
            disabled={isBusy}
          />
          <div className="composer-footer">
            <span>Enter to send · Shift + Enter for a new line</span>
            {isBusy ? (
              <button className="stop-button" type="button" onClick={() => void stop()}>
                <span aria-hidden="true" /> Stop
              </button>
            ) : (
              <button className="send-button" type="submit" disabled={!input.trim()}>
                Send message <span aria-hidden="true">→</span>
              </button>
            )}
          </div>
        </form>
      </section>
    </main>
  );
}
