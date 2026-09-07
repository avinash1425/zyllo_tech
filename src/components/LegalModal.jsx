import { useEffect, useRef, useState } from "react";
import Modal from "@/components/Modal";

export default function LegalModal({ isOpen, onClose, title, lastUpdated, sections }) {
  const [reachedEnd, setReachedEnd] = useState(false);
  const scrollRef = useRef(null);

  // Content short enough to fit without scrolling never fires a scroll
  // event, so "read to the end" must be granted upfront in that case.
  useEffect(() => {
    if (!isOpen) return;
    const el = scrollRef.current;
    if (el && el.scrollHeight <= el.clientHeight + 24) {
      setReachedEnd(true);
    }
  }, [isOpen, sections]);

  function handleScroll(event) {
    if (reachedEnd) return;
    const el = event.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 24) {
      setReachedEnd(true);
    }
  }

  function handleClose() {
    setReachedEnd(false);
    onClose();
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      maxWidthClassName="max-w-2xl"
      labelledBy="legal-modal-title"
    >
      <div className="flex max-h-[85vh] flex-col">
        <div className="shrink-0 border-b border-[#d9dde2] bg-gradient-to-br from-[#fff2e2] via-white to-[#e6f1f4] px-6 py-6 sm:px-8">
          <h2 id="legal-modal-title" className="text-xl font-bold text-[#1d2735] sm:text-2xl">{title}</h2>
          <p className="mt-1 text-sm text-[#6c7889]">Last updated: {lastUpdated}</p>
        </div>

        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex-1 space-y-6 overflow-y-auto px-6 py-6 text-sm leading-relaxed text-[#6c7889] sm:px-8"
        >
          {sections.map((section) => (
            <div key={section.title}>
              <h3 className="text-base font-bold text-[#1d2735]">{section.title}</h3>
              {section.body && <p className="mt-2">{section.body}</p>}
              {section.list && (
                <ul className="mt-2 list-disc space-y-1.5 pl-5">
                  {section.list.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
              {section.afterList && <p className="mt-2">{section.afterList}</p>}
            </div>
          ))}
        </div>

        <div className="shrink-0 border-t border-[#d9dde2] px-6 py-4 sm:px-8">
          <p
            className={`mb-3 text-xs font-medium transition-colors duration-200 ${
              reachedEnd ? "text-[#3089a6]" : "text-[#6c7889]"
            }`}
          >
            {reachedEnd ? "You've read to the end." : "Read to the end before accepting."}
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleClose}
              className="flex-1 rounded-lg border border-[#d9dde2] bg-white px-4 py-2.5 text-sm font-semibold text-[#6c7889] transition-colors duration-200 hover:border-[#1d2735]/20 hover:text-[#1d2735]"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!reachedEnd}
              onClick={handleClose}
              className="flex-1 rounded-lg bg-[#c2410c] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-200 enabled:hover:-translate-y-0.5 enabled:hover:bg-[#9a3412] disabled:cursor-not-allowed disabled:opacity-50"
            >
              I Agree
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
