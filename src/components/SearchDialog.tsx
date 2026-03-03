import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, X, Sparkles, ArrowRight, Loader2, Clock, TrendingUp } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface SearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const siteContent = [
  { title: "Home", href: "/", keywords: ["home", "main", "landing", "welcome", "zyllo"] },
  { title: "Software Development", href: "/services", keywords: ["software", "development", "web", "mobile", "app", "custom", "code", "programming"] },
  { title: "AI & Machine Learning", href: "/services", keywords: ["ai", "artificial intelligence", "machine learning", "ml", "deep learning", "automation"] },
  { title: "Cloud Solutions", href: "/services", keywords: ["cloud", "aws", "azure", "infrastructure", "devops", "hosting", "server"] },
  { title: "UI/UX Design", href: "/services", keywords: ["design", "ui", "ux", "user experience", "interface", "branding", "creative"] },
  { title: "Digital Marketing", href: "/services", keywords: ["marketing", "digital", "seo", "ads", "social media", "content"] },
  { title: "Industries", href: "/industries", keywords: ["industry", "healthcare", "finance", "education", "retail", "manufacturing"] },
  { title: "About Zyllo Tech", href: "/about", keywords: ["about", "team", "company", "mission", "vision", "who we are", "history"] },
  { title: "Careers", href: "/careers", keywords: ["careers", "jobs", "hiring", "work", "opportunities", "join", "employment"] },
  { title: "Contact Us", href: "/contact", keywords: ["contact", "email", "phone", "reach", "get in touch", "support", "help"] },
];

const trendingSearches = ["AI Solutions", "Cloud Services", "Software Development", "Careers"];

const SearchDialog = ({ open, onOpenChange }: SearchDialogProps) => {
  const [query, setQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [aiResponse, setAiResponse] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
      setQuery("");
      setAiResponse("");
    }
  }, [open]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onOpenChange]);

  const filteredResults = query.trim()
    ? siteContent.filter((item) => {
        const q = query.toLowerCase();
        return (
          item.title.toLowerCase().includes(q) ||
          item.keywords.some((k) => k.includes(q))
        );
      })
    : [];

  const handleSearch = async () => {
    if (!query.trim()) return;
    setIsSearching(true);
    await new Promise((r) => setTimeout(r, 800));
    const matches = filteredResults;
    if (matches.length > 0) {
      setAiResponse(
        `Based on your search for "${query}", I recommend checking out our ${matches.map((m) => m.title).join(", ")} section${matches.length > 1 ? "s" : ""}. Click any result below to navigate there.`
      );
    } else {
      setAiResponse(
        `I couldn't find specific content matching "${query}". Try searching for our services, industries, careers, or contact information.`
      );
    }
    setIsSearching(false);
  };

  const handleNavigate = (href: string) => {
    navigate(href);
    onOpenChange(false);
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => onOpenChange(false)}
          />

          {/* Dialog */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -20 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            className="relative z-10 w-[90%] max-w-2xl"
          >
            <div className="rounded-2xl border border-border bg-background shadow-2xl overflow-hidden">
              {/* Search Header */}
              <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
                <Sparkles size={18} className="text-primary shrink-0" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setAiResponse("");
                  }}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  placeholder="Ask AI anything about Zyllo Tech..."
                  className="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground outline-none text-base"
                />
                {query && (
                  <button onClick={() => { setQuery(""); setAiResponse(""); }} className="text-muted-foreground hover:text-foreground transition-colors">
                    <X size={18} />
                  </button>
                )}
                <button
                  onClick={handleSearch}
                  disabled={!query.trim() || isSearching}
                  className="shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-40"
                >
                  {isSearching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
                </button>
              </div>

              {/* AI Response */}
              <AnimatePresence>
                {aiResponse && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="border-b border-border overflow-hidden"
                  >
                    <div className="px-5 py-4 bg-primary/5">
                      <div className="flex items-start gap-3">
                        <Sparkles size={14} className="text-primary mt-0.5 shrink-0" />
                        <p className="text-sm text-foreground/80 leading-relaxed">{aiResponse}</p>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Results / Default state */}
              <div className="max-h-80 overflow-y-auto">
                {query.trim() && filteredResults.length > 0 ? (
                  <div className="py-1">
                    {filteredResults.map((item) => (
                      <button
                        key={item.title}
                        onClick={() => handleNavigate(item.href)}
                        className="w-full flex items-center justify-between px-5 py-3 hover:bg-muted/50 transition-colors text-left group"
                      >
                        <div className="flex items-center gap-3">
                          <Search size={14} className="text-muted-foreground" />
                          <span className="text-sm font-medium text-foreground">{item.title}</span>
                        </div>
                        <ArrowRight size={14} className="text-muted-foreground/40 group-hover:text-primary transition-colors" />
                      </button>
                    ))}
                  </div>
                ) : query.trim() && !aiResponse ? (
                  <div className="px-5 py-10 text-center text-muted-foreground text-sm">
                    Press <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] mx-1">Enter</kbd> or click search to ask AI
                  </div>
                ) : !query.trim() ? (
                  <div className="px-5 py-6 text-center text-muted-foreground text-sm">
                    Search for services, industries, careers, and more...
                  </div>
                ) : null}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between px-5 py-3 border-t border-border bg-muted/30">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Sparkles size={10} className="text-primary" />
                  <span>Powered by AI</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <kbd className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px]">⌘K</kbd>
                  <span>to toggle</span>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

export default SearchDialog;
