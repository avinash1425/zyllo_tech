import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import FloatingButtons from "@/components/FloatingButtons";
import PageHero from "@/components/PageHero";

const CookiePolicy = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <PageHero
        title="Cookie"
        highlight="Policy"
        description="How cookies and similar technologies are used on Zyllo Tech digital experiences."
        breadcrumb="Cookie Policy"
      />

      <section className="py-14">
        <div className="container mx-auto max-w-4xl px-4 sm:px-6 space-y-8">
          <article>
            <h2 className="text-lg font-semibold text-foreground sm:text-xl">1. What Are Cookies</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground sm:text-base">
              Cookies are small text files stored in your browser when you visit a website. They help websites remember preferences,
              improve functionality, and understand usage patterns.
            </p>
          </article>

          <article>
            <h2 className="text-lg font-semibold text-foreground sm:text-xl">2. Cookies We Use</h2>
            <div className="mt-3 space-y-3 text-sm text-muted-foreground sm:text-base">
              <p><span className="font-medium text-foreground">Essential Cookies:</span> Required for core functionality such as security, navigation, and form handling.</p>
              <p><span className="font-medium text-foreground">Analytics Cookies:</span> Help us understand page performance and user journeys so we can improve the site.</p>
              <p><span className="font-medium text-foreground">Marketing Cookies:</span> May be used to measure campaign effectiveness and deliver relevant messaging.</p>
            </div>
          </article>

          <article>
            <h2 className="text-lg font-semibold text-foreground sm:text-xl">3. How to Manage Cookies</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground sm:text-base">
              You can choose cookie preferences through our cookie consent settings. Essential cookies remain active because they are required
              for website operation. You can also adjust browser settings to block or delete cookies.
            </p>
          </article>

          <article>
            <h2 className="text-lg font-semibold text-foreground sm:text-xl">4. Third-Party Services</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground sm:text-base">
              We may use trusted third-party tools for analytics and infrastructure. These providers may set their own cookies subject to
              their respective privacy and cookie terms.
            </p>
          </article>

          <article>
            <h2 className="text-lg font-semibold text-foreground sm:text-xl">5. Updates</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground sm:text-base">
              We may update this Cookie Policy from time to time. Any changes are effective when posted here.
            </p>
          </article>

          <article>
            <h2 className="text-lg font-semibold text-foreground sm:text-xl">6. Contact</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground sm:text-base">
              For questions about our cookie usage, contact info@zyllotech.com.
            </p>
          </article>
        </div>
      </section>

      <Footer />
      <FloatingButtons />
    </div>
  );
};

export default CookiePolicy;
