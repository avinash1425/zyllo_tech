import PageHero from "@/components/PageHero";

export default function TermsPage() {
  return (
    <>
      <PageHero
        eyebrow="Legal"
        title="Terms of Service"
        description="Last updated: August 2026"
      />

      <section className="bg-white py-6 lg:py-8">
        <div className="mx-auto max-w-3xl px-6 lg:px-8">
          <div className="prose-content flex flex-col gap-8 text-[#676b7a]">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-[#2b303b]">
                Acceptance of terms
              </h2>
              <p className="mt-3 leading-relaxed">
                By accessing and using this website, you agree to comply with
                and be bound by these Terms of Service. If you do not agree
                with these terms, please discontinue use of the website
                immediately.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-bold tracking-tight text-[#2b303b]">Services</h2>
              <p className="mt-3 leading-relaxed">
                Zyllo Tech provides software design, development, and support
                services, including web, mobile, AI, and cloud solutions.
                Information on this website is provided for general guidance
                and does not constitute a binding quotation or contract.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-bold tracking-tight text-[#2b303b]">
                Account responsibilities
              </h2>
              <p className="mt-3 leading-relaxed">
                Where accounts are provided, you are responsible for
                maintaining the confidentiality of your credentials. Any
                activity under your account is your responsibility, and you
                must notify us immediately of any unauthorized access.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-bold tracking-tight text-[#2b303b]">
                Content usage and restrictions
              </h2>
              <p className="mt-3 leading-relaxed">
                This website and its original content are protected by
                intellectual property laws. You may not reproduce,
                distribute, modify, create derivative works from, or
                commercially exploit any content without our explicit
                written permission.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-bold tracking-tight text-[#2b303b]">
                Limitation of liability
              </h2>
              <p className="mt-3 leading-relaxed">
                This website is provided &quot;as is&quot; without
                warranties of any kind. We are not liable for any direct,
                indirect, incidental, consequential, or punitive damages
                arising from your use of the website.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-bold tracking-tight text-[#2b303b]">
                User conduct guidelines
              </h2>
              <ul className="mt-3 flex flex-col gap-2 leading-relaxed">
                <li>Do not upload harmful or malicious content.</li>
                <li>Respect the rights of other users.</li>
                <li>Avoid activities that could disrupt website functionality.</li>
                <li>Comply with applicable local and international laws.</li>
              </ul>
            </div>

            <div>
              <h2 className="text-xl font-bold tracking-tight text-[#2b303b]">
                Modifications to terms
              </h2>
              <p className="mt-3 leading-relaxed">
                We reserve the right to modify these terms at any time.
                Continued use of the website after changes constitutes
                acceptance of the new terms.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-bold tracking-tight text-[#2b303b]">Termination</h2>
              <p className="mt-3 leading-relaxed">
                We may suspend or terminate access without prior notice for
                violations of these terms or for any other reason deemed
                appropriate.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-bold tracking-tight text-[#2b303b]">Governing law</h2>
              <p className="mt-3 leading-relaxed">
                These terms are governed by the laws of India, without regard
                to conflict of law principles.
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
