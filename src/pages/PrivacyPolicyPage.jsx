import PageHero from "@/components/PageHero";

export default function PrivacyPage() {
  return (
    <>
      <PageHero eyebrow="Legal" title="Privacy Policy" description="Last updated: August 2026" />

      <section className="bg-white py-6 lg:py-8">
        <div className="mx-auto max-w-3xl px-6 lg:px-8">
          <div className="prose-content flex flex-col gap-8 text-[#676b7a]">
            <p className="text-lg leading-relaxed">
              This Privacy Policy explains how Zyllo Tech (&quot;we&quot;,
              &quot;us&quot;) handles information when you visit
              zyllotech.com and how we use cookies. By using this website you
              agree to this policy.
            </p>

            <div>
              <h2 className="text-xl font-bold tracking-tight text-[#2b303b]">
                Information we collect
              </h2>
              <p className="mt-3 leading-relaxed">
                We only collect information you choose to give us — for
                example, when you submit our contact form or apply for a
                role. This may include your name, email, phone number,
                company, service of interest, and message. We use it solely
                to respond to your enquiry and provide our services.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-bold tracking-tight text-[#2b303b]">
                How we use your information
              </h2>
              <ul className="mt-3 flex flex-col gap-2 leading-relaxed">
                <li>To respond to enquiries and provide quotes or proposals.</li>
                <li>To communicate with you about our services.</li>
                <li>To review job applications submitted via our Careers page.</li>
                <li>To improve our website and understand how it is used.</li>
              </ul>
              <p className="mt-3 leading-relaxed">We do not sell your personal information.</p>
            </div>

            <div>
              <h2 className="text-xl font-bold tracking-tight text-[#2b303b]">
                Cookies & local storage
              </h2>
              <p className="mt-3 leading-relaxed">
                Cookies and similar technologies help the website function
                and let us understand usage:
              </p>
              <ul className="mt-3 flex flex-col gap-2 leading-relaxed">
                <li>
                  <span className="font-semibold text-[#2b303b]">Essential storage</span> —
                  remembers your cookie-consent choice so we don&apos;t ask again.
                </li>
                <li>
                  <span className="font-semibold text-[#2b303b]">Analytics (optional)</span> —
                  only set when you accept cookies, to measure traffic and improve the site.
                </li>
              </ul>
              <p className="mt-3 leading-relaxed">
                You can accept or decline non-essential cookies via the
                banner, and clear cookies anytime in your browser.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-bold tracking-tight text-[#2b303b]">
                Third-party services
              </h2>
              <ul className="mt-3 flex flex-col gap-2 leading-relaxed">
                <li>
                  <span className="font-semibold text-[#2b303b]">Contact form</span> — submitted
                  enquiries are delivered by email to our team.
                </li>
                <li>
                  <span className="font-semibold text-[#2b303b]">WhatsApp</span> — the chat button
                  opens WhatsApp, governed by its own privacy policy.
                </li>
              </ul>
            </div>

            <div>
              <h2 className="text-xl font-bold tracking-tight text-[#2b303b]">
                Data retention & security
              </h2>
              <p className="mt-3 leading-relaxed">
                We keep enquiry information only as long as needed to respond
                and maintain our records, and take reasonable measures to
                protect it.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-bold tracking-tight text-[#2b303b]">Your rights</h2>
              <p className="mt-3 leading-relaxed">
                You may request access to, correction of, or deletion of the
                personal information you have shared with us. To do so,
                contact us using the details below.
              </p>
            </div>

            <div className="rounded-2xl border border-[#e7e9ee] bg-[#fafbfc] p-6">
              <h2 className="text-xl font-bold tracking-tight text-[#2b303b]">Contact us</h2>
              <p className="mt-3 leading-relaxed">
                Zyllo Tech
                <br />
                Email: info@zyllotech.com
                <br />
                Phone: +91 70757 73680
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
