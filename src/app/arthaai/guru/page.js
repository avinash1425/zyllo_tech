"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Send, GraduationCap, AlertCircle, Languages, Zap, ShieldCheck } from "lucide-react";
import Disclaimer from "@/components/arthaai/Disclaimer";

const STARTER_QUESTIONS = [
  "What's the difference between a mutual fund and an ETF?",
  "How does compound interest actually work?",
  "Should I pay off debt first or start investing?",
  "What does diversification mean, and why does it matter?",
];

const FEATURES = [
  {
    icon: Languages,
    title: "Multilingual",
    description: "Chat in your own language — dozens are supported, worldwide.",
  },
  {
    icon: Zap,
    title: "Instant Answers",
    description: "AI responds in seconds, any time of day.",
  },
  {
    icon: ShieldCheck,
    title: "Zero Bias",
    description: "No commission, no product push, ever.",
  },
];

// Renders **bold** spans inside a single line of text.
function InlineText({ text }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return <span key={i}>{part}</span>;
  });
}

// Lightweight markdown renderer for ArthaGuru replies — the system prompt
// asks the model for "## Heading" sections and "- bullet" lists, so this
// turns those into real elements instead of showing raw markdown symbols.
// Deliberately minimal: headings, bullets, bold, and plain paragraphs only.
function FormattedReply({ content }) {
  const lines = content.split("\n");
  const blocks = [];
  let listBuffer = [];

  const flushList = () => {
    if (listBuffer.length > 0) {
      blocks.push(
        <ul key={`list-${blocks.length}`} className="mt-2 list-disc space-y-1 pl-5">
          {listBuffer.map((item, i) => (
            <li key={i}>
              <InlineText text={item} />
            </li>
          ))}
        </ul>
      );
      listBuffer = [];
    }
  };

  lines.forEach((rawLine, i) => {
    const line = rawLine.trim();

    if (line === "") {
      flushList();
      return;
    }

    const headingMatch = line.match(/^#{1,3}\s+(.*)/);
    if (headingMatch) {
      flushList();
      blocks.push(
        <p key={i} className="mt-3 text-sm font-bold first:mt-0">
          <InlineText text={headingMatch[1]} />
        </p>
      );
      return;
    }

    const bulletMatch = line.match(/^[-*]\s+(.*)/);
    if (bulletMatch) {
      listBuffer.push(bulletMatch[1]);
      return;
    }

    flushList();
    blocks.push(
      <p key={i} className="mt-2 first:mt-0">
        <InlineText text={line} />
      </p>
    );
  });

  flushList();
  return <>{blocks}</>;
}

function ChatBubble({ role, content }) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? "bg-[#1f4693] text-white"
            : "border border-[#e3e8ee] bg-white text-[#1c2333]"
        }`}
      >
        {isUser ? (
          content.split("\n").map((line, i) => (
            <p key={i} className={i > 0 ? "mt-2" : ""}>
              {line}
            </p>
          ))
        ) : (
          <FormattedReply content={content} />
        )}
      </div>
    </div>
  );
}

export default function ArthaGuruPage() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  async function sendMessage(text) {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;

    const nextMessages = [...messages, { role: "user", content: trimmed }];
    setMessages(nextMessages);
    setInput("");
    setError(null);
    setIsLoading(true);

    try {
      const res = await fetch("/api/arthaguru/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages }),
      });

      const data = await res.json();

      if (res.status === 503) {
        setNotConfigured(true);
        setMessages(messages); // roll back the optimistic user message
        return;
      }

      if (!res.ok) {
        setError(data?.error || "Something went wrong. Please try again.");
        setMessages(messages);
        return;
      }

      setMessages([...nextMessages, { role: "assistant", content: data.reply }]);
    } catch {
      setError("Couldn't reach ArthaGuru. Check your connection and try again.");
      setMessages(messages);
    } finally {
      setIsLoading(false);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    sendMessage(input);
  }

  return (
    <section className="bg-[#fbfaf7] py-10 lg:py-14">
      <div className="mx-auto max-w-3xl px-6 lg:px-8">
        <Link
          href="/arthaai"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#1f4693] transition-all hover:gap-2.5"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          ArthaAI Home
        </Link>

        <div className="mt-4 flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#1f4693] to-[#163570]">
            <GraduationCap className="h-5.5 w-5.5 text-white" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[#1c2333] sm:text-3xl">
              ArthaGuru
            </h1>
            <p className="text-sm text-[#6b7280]">
              Ask a question about financial concepts — no jargon, no sales pitch.
            </p>
          </div>
        </div>

        <div className="mt-4">
          <Disclaimer compact />
        </div>

        {notConfigured ? (
          <div className="mt-8 flex flex-col items-center gap-3 rounded-2xl border border-[#e3e8ee] bg-white p-10 text-center">
            <AlertCircle className="h-8 w-8 text-amber-500" aria-hidden="true" />
            <p className="text-sm font-semibold text-[#1c2333]">ArthaGuru isn&apos;t set up yet</p>
            <p className="max-w-sm text-sm text-[#6b7280]">
              The site owner needs to add an AI API key to enable chat. Check
              back soon.
            </p>
          </div>
        ) : (
          <>
            <div className="mt-6 flex h-[24rem] flex-col gap-3 overflow-y-auto rounded-2xl border border-[#e3e8ee] bg-[#f5f6f7] p-4">
              {messages.length === 0 && !isLoading && (
                <div className="flex flex-1 flex-col items-center justify-center gap-4 py-8 text-center">
                  <p className="text-sm text-[#6b7280]">
                    Try one of these, or ask your own question:
                  </p>
                  <div className="flex flex-wrap justify-center gap-2">
                    {STARTER_QUESTIONS.map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => sendMessage(q)}
                        className="rounded-full border border-[#e3e8ee] bg-white px-3.5 py-2 text-xs font-medium text-[#4b5563] transition-colors hover:border-[#1f4693]/30 hover:text-[#1f4693]"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((m, i) => (
                <ChatBubble key={i} role={m.role} content={m.content} />
              ))}

              {isLoading && (
                <div className="flex justify-start">
                  <div className="flex items-center gap-1.5 rounded-2xl border border-[#e3e8ee] bg-white px-4 py-3">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#1f4693] [animation-delay:-0.3s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#1f4693] [animation-delay:-0.15s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#1f4693]" />
                  </div>
                </div>
              )}

              <div ref={scrollRef} />
            </div>

            {error && <p className="mt-2 text-sm font-medium text-red-600">{error}</p>}

            <form onSubmit={handleSubmit} className="mt-4 flex items-center gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about a financial concept…"
                disabled={isLoading}
                className="w-full rounded-full border border-[#e3e8ee] bg-white px-5 py-3 text-sm text-[#1c2333] outline-none placeholder:text-[#9ca3af] focus:border-[#1f4693]/60 disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={isLoading || !input.trim()}
                aria-label="Send"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#1f4693] text-white transition-all hover:bg-[#163570] disabled:opacity-40"
              >
                <Send className="h-4 w-4" aria-hidden="true" />
              </button>
            </form>

            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {FEATURES.map(({ icon: Icon, title, description }) => (
                <div
                  key={title}
                  className="flex items-start gap-3 rounded-xl border border-[#e3e8ee] bg-white p-4"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#1f4693]/10">
                    <Icon className="h-4.5 w-4.5 text-[#1f4693]" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-[#1c2333]">{title}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-[#6b7280]">
                      {description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
