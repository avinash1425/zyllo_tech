import Seo from "@/components/Seo";
import PageHero from "@/components/PageHero";
import { openCookieSettings } from "@/lib/consent";

// Keep in sync with PRIVACY_SECTIONS in src/data/legal-content.js (the
// footer/banner modal shows the same policy).
function Section({ title, children }) {
  return (
    <div>
      <h2 className="text-xl font-bold tracking-tight text-[#2b303b]">{title}</h2>
      {children}
    </div>
  );
}

function Term({ children }) {
  return <span className="font-semibold text-[#2b303b]">{children}</span>;
}

function GooglePrivacyLink() {
  return (
    <a
      href="https://policies.google.com/privacy"
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-2"
    >
      Google&apos;s privacy policy
    </a>
  );
}

export default function PrivacyPage() {
  return (
    <>
      <Seo
        title="Privacy Policy"
        description="How Zyllo Tech collects, uses, and protects your information."
        path="/privacy"
       />
      <PageHero eyebrow="Legal" title="Privacy Policy" description="Last updated: August 2026" />

      <section className="bg-white py-6 lg:py-8">
        <div className="mx-auto max-w-3xl px-6 lg:px-8">
          <div className="prose-content flex flex-col gap-8 text-[#676b7a]">
            <p className="text-lg leading-relaxed">
              This Privacy Policy explains how Zyllo Tech (&quot;we&quot;,
              &quot;us&quot;) handles information when you visit
              zyllotech.com, and how we use cookies and similar technologies.
            </p>

            <Section title="Information we collect">
              <p className="mt-3 leading-relaxed">We collect information in the following ways:</p>
              <ul className="mt-3 flex flex-col gap-2 leading-relaxed">
                <li>
                  <Term>Information you give us</Term> — when you send our
                  contact form: your name, email address and message, and, if
                  you provide them, your phone number, company and the service
                  you are interested in. When you apply for a job: your name,
                  email address, years of experience and CV (PDF), and, if you
                  provide them, your phone number and cover note.
                </li>
                <li>
                  <Term>Website statistics from our hosting platform (always active)</Term> —
                  our website hosting platform automatically records
                  information about each visit to report on website traffic
                  and monitor how the website performs: the page address, the
                  referring page, your browser type, your language and an
                  approximate country; when a visit starts, which pages are
                  viewed and time spent on pages; and page loading speed and
                  technical errors. This is not controlled by the cookie
                  banner.
                </li>
                <li>
                  <Term>Google Analytics (optional, only with your consent)</Term> —
                  if you choose &quot;Accept&quot; in our cookie banner, Google
                  Analytics collects information about how you use our
                  website, as described under &quot;Cookies and similar
                  technologies&quot;. If you choose &quot;Decline&quot; or make
                  no choice, Google Analytics does not collect any data.
                </li>
                <li>
                  <Term>AI search</Term> — if you use the AI search box, the
                  question you type is sent to our server and, when AI search
                  is available, to Google&apos;s Gemini service to generate an
                  answer. We do not store your question.
                </li>
                <li>
                  <Term>Page counters</Term> — we count views of blog articles
                  and job pages. These counts contain no information about
                  you.
                </li>
              </ul>
            </Section>

            <Section title="How we use your information">
              <ul className="mt-3 flex flex-col gap-2 leading-relaxed">
                <li>To respond to enquiries and provide quotes or proposals.</li>
                <li>To communicate with you about our services.</li>
                <li>To review job applications submitted via our Careers page.</li>
                <li>
                  To operate and monitor our website and understand how it is
                  used, so we can improve it. Google Analytics data is used
                  only if you have consented.
                </li>
              </ul>
              <p className="mt-3 leading-relaxed">We do not sell your personal information.</p>
            </Section>

            <Section title="Where your information is stored">
              <p className="mt-3 leading-relaxed">
                Contact form messages and job applications, including CVs, are
                stored in our database, which is provided by Supabase.
              </p>
            </Section>

            <Section title="Cookies and similar technologies">
              <p className="mt-3 leading-relaxed">
                We use the following cookies and similar technologies:
              </p>
              <ul className="mt-3 flex flex-col gap-2 leading-relaxed">
                <li>
                  <Term>Essential</Term> — your cookie choice, stored in your
                  browser&apos;s local storage so we remember it; the __cf_bm
                  cookie, set by Cloudflare, which delivers our website; the
                  __dpl cookie, set by our website hosting platform; and, if
                  you sign in to a staff account, your login session, kept in
                  your browser&apos;s local storage.
                </li>
                <li>
                  <Term>Hosting platform statistics (always active)</Term> — the
                  session-id cookie, used by our hosting platform&apos;s website
                  statistics to group the pages viewed during one visit.
                </li>
                <li>
                  <Term>Google Analytics (optional, only with your consent)</Term> —
                  the _ga and _ga_LQYNCZH7K1 cookies. Google Analytics records
                  the pages you view and how you use them — scrolling, clicks
                  on links to other websites, and starting or submitting our
                  forms (not what you type into them) — along with your
                  device, browser and approximate location. Google&apos;s
                  advertising features are switched off on our website.
                </li>
              </ul>
            </Section>

            <Section title="Your cookie choices">
              <p className="mt-3 leading-relaxed">
                When you first visit, a banner asks whether you accept optional
                Google Analytics cookies.
              </p>
              <ul className="mt-3 flex flex-col gap-2 leading-relaxed">
                <li>&quot;Accept&quot; turns on Google Analytics.</li>
                <li>
                  &quot;Decline&quot; keeps Google Analytics off, and no data is
                  sent to Google Analytics.
                </li>
                <li>
                  The banner does not control essential cookies and storage, or
                  our hosting platform&apos;s website statistics, which remain
                  active whichever you choose.
                </li>
              </ul>
              <p className="mt-3 leading-relaxed">
                You can change your choice at any time with{" "}
                <button
                  type="button"
                  onClick={openCookieSettings}
                  className="font-semibold text-[#2b303b] underline underline-offset-2"
                >
                  Cookie Settings
                </button>{" "}
                (also in the website footer). If you withdraw consent, Google
                Analytics stops collecting data from that moment and its
                cookies are removed from your browser; data already collected
                is not deleted. You can also delete cookies at any time in your
                browser settings.
              </p>
            </Section>

            <Section title="Service providers and third-party content">
              <ul className="mt-3 flex flex-col gap-2 leading-relaxed">
                <li>
                  <Term>Website hosting platform</Term> — hosts and serves our
                  website, records the website statistics described above and
                  sets the __dpl and session-id cookies.
                </li>
                <li>
                  <Term>Cloudflare</Term> — delivers our website and sets the
                  __cf_bm cookie.
                </li>
                <li>
                  <Term>Supabase</Term> — stores contact form messages, job
                  applications and CVs, and provides staff sign-in.
                </li>
                <li>
                  <Term>Google Analytics</Term> — a web analytics service
                  provided by Google, used only with your consent. Google
                  processes this data on our behalf; see{" "}
                  <GooglePrivacyLink />.
                </li>
                <li>
                  <Term>Google Maps</Term> — the map on our Contact page is
                  embedded from Google Maps. When it loads, your browser
                  connects to Google, which receives standard connection
                  information such as your IP address.
                </li>
                <li>
                  <Term>Google Gemini</Term> — generates answers to questions
                  typed into our AI search box, when AI search is available.
                </li>
                <li>
                  <Term>Unsplash</Term> — some images are loaded from
                  Unsplash&apos;s servers, which receive standard connection
                  information such as your IP address.
                </li>
                <li>
                  <Term>WhatsApp</Term> — the chat button opens WhatsApp,
                  governed by its own privacy policy.
                </li>
              </ul>
            </Section>

            <Section title="International processing">
              <p className="mt-3 leading-relaxed">
                Google states that it maintains servers around the world, so
                Google Analytics data may be processed outside the country
                where you live.
              </p>
            </Section>

            <Section title="Data retention & security">
              <p className="mt-3 leading-relaxed">
                We keep enquiry information and job applications only as long
                as needed to respond to you, consider your application and
                maintain our records, and take reasonable measures to protect
                them. Google Analytics data is kept according to the data
                retention setting of our Google Analytics account.
              </p>
            </Section>

            <Section title="Your rights">
              <p className="mt-3 leading-relaxed">
                You may request access to, correction of, or deletion of the
                personal information you have shared with us. To do so,
                contact us using the details below. Google Analytics data does
                not include your name or contact details, so we may not be
                able to link it to you. You can stop further Google Analytics
                collection at any time with Cookie Settings.
              </p>
            </Section>

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
