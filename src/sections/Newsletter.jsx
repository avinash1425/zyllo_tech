import { useState } from "react";
import { Mail } from "lucide-react";
import { isValidEmail, subscribeToNewsletter } from "@/lib/newsletter";

export default function Newsletter() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("idle"); // "idle" | "loading" | "success" | "error"
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    if (status === "loading") return;

    if (!isValidEmail(email)) {
      setStatus("error");
      setErrorMessage("Please enter a valid email address.");
      return;
    }

    setStatus("loading");
    setErrorMessage("");
    try {
      await subscribeToNewsletter(email);
      setStatus("success");
    } catch (error) {
      setStatus("error");
      setErrorMessage(error.message);
    }
  }

  return (
    <section className="relative overflow-hidden border-t border-[#e7e9ee] bg-white py-6 lg:py-8">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 right-1/4 h-80 w-80 rounded-full bg-[#1f4693]/8 blur-[110px]" />
        <div className="absolute -bottom-24 left-1/4 h-80 w-80 rounded-full bg-[#f7941e]/8 blur-[110px]" />
      </div>

      <div className="relative mx-auto max-w-3xl px-6 text-center lg:px-8">
        <div className="rounded-[28px] border border-white/60 bg-white/60 p-10 shadow-xl backdrop-blur-xl sm:p-12">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[#1f4693]/15 to-[#f7941e]/15">
            <Mail className="h-6 w-6 text-[#1f4693]" aria-hidden="true" />
          </div>

          <h2 className="mt-5 text-2xl font-bold tracking-tight text-[#2b303b] sm:text-3xl">
            Get new articles in your inbox
          </h2>
          <p className="mx-auto mt-3 max-w-md text-base leading-relaxed text-[#676b7a]">
            No spam, just practical notes on engineering and product — sent
            when we actually have something worth sharing.
          </p>

          {status === "success" ? (
            <p className="mx-auto mt-6 max-w-md text-base font-semibold text-[#1f4693]" role="status">
              You&apos;re subscribed — thank you!
            </p>
          ) : (
            <>
              <form
                onSubmit={handleSubmit}
                className="mx-auto mt-6 flex max-w-md flex-col gap-3 sm:flex-row"
              >
                <input
                  type="email"
                  required
                  placeholder="you@company.com"
                  aria-label="Email address"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="w-full flex-1 rounded-lg border border-[#e7e9ee] bg-white px-4 py-3 text-sm text-[#2b303b] placeholder:text-[#676b7a]/60 outline-none transition-all duration-200 focus:border-[#f7941e]/60 focus:ring-4 focus:ring-[#f7941e]/10"
                />
                <button
                  type="submit"
                  disabled={status === "loading"}
                  className="shrink-0 rounded-full bg-[#c2410c] px-6 py-3 text-sm font-semibold text-white shadow-[0_18px_28px_-10px_rgba(194,65,12,0.55)] transition-all duration-200 hover:-translate-y-0.5 hover:scale-105 hover:bg-[#9a3412] disabled:pointer-events-none disabled:opacity-60"
                >
                  {status === "loading" ? "Subscribing..." : "Subscribe"}
                </button>
              </form>
              {status === "error" && (
                <p className="mt-3 text-sm font-medium text-[#c2410c]" role="alert">
                  {errorMessage}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
