import { Globe, MapPin, Sparkles } from "lucide-react";
import { useState, useRef, useEffect } from "react";

const languages = [
  { code: "en", label: "English" },
  { code: "ar", label: "Arabic" },
  { code: "hi", label: "Hindi" },
  { code: "te", label: "Telugu" },
];

const TopBar = () => {
  const [langOpen, setLangOpen] = useState(false);
  const [selectedLang, setSelectedLang] = useState("en");
  const dropdownRef = useRef<HTMLDivElement>(null);

  const currentLang = languages.find((l) => l.code === selectedLang);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setLangOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="bg-secondary text-white/60 text-[13px] hidden md:block">
      <div className="container mx-auto flex items-center justify-end px-4 sm:px-6 py-1.5 gap-6">
        {/* Language Selector */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setLangOpen(!langOpen)}
            className="flex items-center gap-1.5 hover:text-white transition-colors"
          >
            <Globe size={13} />
            {currentLang?.label}
          </button>
          {langOpen && (
            <div className="absolute right-0 top-full mt-1.5 bg-secondary border border-white/10 rounded-md shadow-xl py-1 min-w-[120px] z-50">
              {languages.map((lang) => (
                <button
                  key={lang.code}
                  onClick={() => {
                    setSelectedLang(lang.code);
                    setLangOpen(false);
                  }}
                  className={`block w-full text-left px-4 py-2 text-xs hover:bg-white/5 transition-colors ${
                    selectedLang === lang.code ? "text-primary font-medium" : "text-white/70"
                  }`}
                >
                  {lang.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <span className="w-px h-3.5 bg-white/15" />

        <span className="inline-flex items-center gap-1.5 text-white/70">
          <MapPin size={12} />
          Bengaluru, India
        </span>

        <span className="w-px h-3.5 bg-white/15" />

        <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/35 bg-gradient-to-r from-primary/15 to-[hsl(195,55%,42%,0.22)] px-2.5 py-0.5 text-primary">
          <Sparkles size={11} />
          AI-Powered
        </span>
      </div>
    </div>
  );
};

export default TopBar;
