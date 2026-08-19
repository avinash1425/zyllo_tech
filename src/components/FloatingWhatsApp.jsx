export default function FloatingWhatsApp() {
  return (
    <a
      href="https://wa.me/917075773680?text=Hi%20Zyllo%20Tech%2C%20I%27d%20like%20to%20enquire%20about%20your%20services."
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Chat with Zyllo Tech on WhatsApp"
      className="group fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-lg shadow-black/20 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-[#25D366]/30 sm:bottom-6 sm:right-6"
    >
      <span
        aria-hidden="true"
        className="absolute inset-0 rounded-full bg-[#25D366] opacity-60 animate-ping"
      />
      <svg
        className="relative h-7 w-7"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
        <path d="M12.001 2C6.478 2 2 6.478 2 12c0 1.821.487 3.53 1.338 5.003L2.06 22l5.13-1.345A9.94 9.94 0 0 0 12.001 22c5.522 0 10-4.478 10-10S17.523 2 12.001 2zm0 18.031a8.02 8.02 0 0 1-4.085-1.11l-.293-.174-3.045.799.813-2.968-.191-.305A8.014 8.014 0 0 1 4 12c0-4.418 3.584-8.001 8.001-8.001 4.418 0 8.001 3.583 8.001 8.001 0 4.417-3.583 8.031-8.001 8.031z" />
      </svg>

      <span className="pointer-events-none absolute right-full mr-3 whitespace-nowrap rounded-lg bg-[#0b0e17] px-3 py-2 text-sm font-medium text-white opacity-0 shadow-lg transition-opacity duration-200 group-hover:opacity-100">
        Chat with us
      </span>
    </a>
  );
}
