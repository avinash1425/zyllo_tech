import { useState } from "react";
import { Mail, Phone, MapPin, Send } from "lucide-react";
import { Link } from "react-router-dom";
import logo from "@/assets/zyllo-logo.png";
import { CONTACT_PHONE_DISPLAY, CONTACT_PHONE_E164 } from "@/lib/contact";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const Footer = () => {
  const [email, setEmail] = useState("");
  const [subscribed, setSubscribed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return;

    setSubmitting(true);
    try {
      const { error } = await supabase.from("newsletter_subscribers").insert({ email: trimmed });
      if (error) {
        if (error.code === "23505") {
          // Already subscribed
          toast({ title: "Already subscribed", description: "This email is already on our list." });
        } else {
          throw error;
        }
      } else {
        // Send admin notification (fire and forget)
        supabase.functions.invoke("notify-admin", {
          body: { type: "newsletter", data: { email: trimmed } },
        }).catch(() => {});
      }
      setSubscribed(true);
      setEmail("");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Please try again.";
      toast({ title: "Failed", description: message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <footer className="border-t border-border bg-[hsl(215,25%,15%)] text-white py-12">
      <div className="container mx-auto px-4 sm:px-6">
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-5">
          {/* Brand */}
          <div className="lg:col-span-2">
            <img src={logo} alt="Zyllo Tech" className="h-10 max-w-[180px] object-contain rounded-md bg-white/95 px-2 py-1 mb-4" />
            <p className="text-sm text-white/60 leading-relaxed mb-6">
              Reliable software engineering for enterprises — web, mobile, cloud, AI, cybersecurity, and quality engineering. India-based, globally delivered.
            </p>

            {/* Newsletter */}
            <div>
              <p className="text-xs font-semibold text-white/80 uppercase tracking-wider mb-3">Stay Updated</p>
              {subscribed ? (
                <p className="text-xs text-primary font-medium">Thanks for subscribing!</p>
              ) : (
                <form onSubmit={handleSubscribe} className="flex gap-2">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Your email"
                    required
                    className="flex-1 min-w-0 rounded-lg bg-white/10 border border-white/20 px-3 py-2 text-xs text-white placeholder-white/40 focus:outline-none focus:border-primary transition-colors"
                  />
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex items-center justify-center h-8 w-8 rounded-lg bg-primary text-white hover:opacity-90 transition-opacity flex-shrink-0 disabled:opacity-50"
                    aria-label="Subscribe"
                  >
                    <Send size={13} />
                  </button>
                </form>
              )}
            </div>
          </div>

          {/* Company */}
          <div>
            <h4 className="font-display font-semibold text-white mb-4">Company</h4>
            <div className="flex flex-col gap-2">
              {[
                { label: "Home", to: "/" },
                { label: "About Us", to: "/about" },
                { label: "Services", to: "/services" },
                { label: "Industries", to: "/industries" },
                { label: "Resources", to: "/resources" },
                { label: "Contact Us", to: "/contact" },
              ].map((link) => (
                <Link key={link.label} to={link.to} className="text-sm text-white/50 hover:text-primary transition-colors">
                  {link.label}
                </Link>
              ))}
            </div>
          </div>

          {/* Services */}
          <div>
            <h4 className="font-display font-semibold text-white mb-4">Services</h4>
            <div className="flex flex-col gap-2">
              {[
                { label: "Web & App Development", to: "/services#web-engineering" },
                { label: "Mobile App Development", to: "/services#mobile-apps" },
                { label: "Cloud Solutions & DevOps", to: "/services#cloud-platform" },
                { label: "Cybersecurity Engineering", to: "/services#cybersecurity" },
                { label: "Quality Engineering & QA", to: "/services#qa-testing" },
                { label: "Data Engineering & AI", to: "/services#data-ai" },
                { label: "Dedicated Teams", to: "/services#dedicated-team" },
                { label: "App Support & Maintenance", to: "/services#support-maintenance" },
              ].map((link) => (
                <Link key={link.label} to={link.to} className="text-sm text-white/50 hover:text-primary transition-colors">
                  {link.label}
                </Link>
              ))}
            </div>
          </div>

          {/* Contact + Social */}
          <div>
            <h4 className="font-display font-semibold text-white mb-4">Get in Touch</h4>
            <div className="flex flex-col gap-3 mb-6">
              <a href="mailto:info@zyllotech.com" className="flex items-center gap-2 text-sm text-white/60 hover:text-primary transition-colors">
                <Mail size={14} className="text-primary shrink-0" /> info@zyllotech.com
              </a>
              <a href={`tel:${CONTACT_PHONE_E164}`} className="flex items-center gap-2 text-sm text-white/60 hover:text-primary transition-colors">
                <Phone size={14} className="text-primary shrink-0" /> {CONTACT_PHONE_DISPLAY}
              </a>
              <div className="flex items-center gap-2 text-sm text-white/60">
                <MapPin size={14} className="text-primary shrink-0" /> India
              </div>
            </div>

            <h4 className="font-display font-semibold text-white mb-3">Follow Us</h4>
            <div className="flex gap-2">
              {[
                { label: "Instagram", href: "https://www.instagram.com/zyllotechsoftwaresolutions/", icon: "M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" },
                { label: "Facebook", href: "https://www.facebook.com/profile.php?id=61588192247341", icon: "M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" },
                { label: "LinkedIn", href: "https://www.linkedin.com/company/zyllo-tech", icon: "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" },
                { label: "YouTube", href: "https://www.youtube.com/@zylloTechSoftwareSolutions", icon: "M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" },
              ].map((social) => (
                <a key={social.label} href={social.href} target="_blank" rel="noopener noreferrer" className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/10 text-white/60 hover:bg-primary hover:text-primary-foreground transition-colors" aria-label={social.label}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d={social.icon} /></svg>
                </a>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-10 border-t border-white/10 pt-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-white/40">
          <span>© {new Date().getFullYear()} Zyllo Tech Software Solutions Pvt. Ltd. All rights reserved.</span>
          <div className="flex flex-wrap justify-center gap-4">
            <Link to="/privacy-policy" className="hover:text-white/70 transition-colors">Privacy Policy</Link>
            <Link to="/terms-of-service" className="hover:text-white/70 transition-colors">Terms of Service</Link>
            <Link to="/cookie-policy" className="hover:text-white/70 transition-colors">Cookie Policy</Link>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
