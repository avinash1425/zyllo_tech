// Single source of truth for every service: used by the header dropdown,
// the homepage/services marquee grid, and each individual /services/[slug] page.
// seoTitle / seoDescription feed the page's <title> and meta description,
// pageTitle (optional) overrides the on-page heading, and faqs are shown on the
// service page and mirrored in its FAQPage structured data.
import {
  Lightbulb,
  Code2,
  Smartphone,
  Palette,
  Cloud,
  Sparkles,
  Wrench,
  ShieldCheck,
  TestTube2,
} from "lucide-react";

export const SERVICES = [
  {
    slug: "product-strategy-consulting",
    pageTitle:
      "Custom Software Development & Product Strategy Consulting",
    seoTitle:
      "Custom Software Development & Product Strategy",
    seoDescription:
      "Custom software development and product strategy consulting: discovery, feasibility studies, roadmaps and business applications, delivered remotely from India.",
    faqs: [
      {
        q: "What does custom software development with Zyllo Tech include?",
        a: "We start with product strategy: discovery workshops to define scope and priorities, a feasibility study before you commit budget, and a buildable roadmap. We then design and build the software itself, such as enterprise software and business applications, and recommend the technology and platform that fit.",
      },
      {
        q: "Do I need a finished specification before contacting you?",
        a: "No. A short description of the problem you want to solve is enough. Scoping the right first version and planning the roadmap is part of the service.",
      },
      {
        q: "Can you work with a company outside India?",
        a: "We are based in Guntur, Andhra Pradesh, India and work remotely with clients worldwide. Collaboration runs over video calls, shared boards and written updates, and we reply to every enquiry within one business day.",
      },
    ],
    icon: Lightbulb,
    image:
      "https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=1200&q=80",
    title: "Software Development",
    tagline: "From idea to roadmap",
    description:
      "Custom software solutions designed to streamline operations, improve productivity, and support business growth.",
    subServices: [
      "Enterprise Software",
      "Business Applications",
      "Custom Software Development",
    ],
    overview:
      "Before any code gets written, we help you validate the idea, scope the right first version, and plan a roadmap that fits your budget and timeline.",
    highlights: [
      "Discovery workshops to define scope and priorities",
      "Feasibility studies before you commit budget",
      "Clear, buildable product roadmaps",
      "Technology and platform recommendations",
    ],
  },
  {
    slug: "web-development",
    seoTitle:
      "Web Development Services & Custom Web Applications",
    seoDescription:
      "Web development services for business websites, custom web applications and e-commerce. Responsive, fast and scalable builds, delivered remotely worldwide.",
    faqs: [
      {
        q: "What kinds of web projects do you build?",
        a: "Business websites, custom web applications and e-commerce solutions. Every build is responsive, performance-first and written as clean, documented code on an architecture that can grow.",
      },
      {
        q: "Will my website work well on phones and tablets?",
        a: "Yes. Responsive builds that work on every device are a standard part of our web development, along with fast-loading pages and accessibility.",
      },
      {
        q: "Can you build our web application remotely?",
        a: "We are based in Guntur, Andhra Pradesh, India and work remotely with clients worldwide. Collaboration runs over video calls, shared boards and written updates, and we reply to every enquiry within one business day.",
      },
    ],
    icon: Code2,
    image:
      "https://images.unsplash.com/photo-1547658719-da2b51169166?w=1200&q=80",
    title: "Web Development",
    tagline: "Built fast, built to grow",
    description:
      "Modern, secure, and scalable websites and web applications built for performance and user experience.",
    subServices: [
      "Business Websites",
      "Web Applications",
      "E-Commerce Solutions",
    ],
    overview:
      "We design and build web applications using modern frameworks, with performance, accessibility, and scalability built in from the start.",
    highlights: [
      "Responsive builds that work on every device",
      "Performance-first, fast-loading pages",
      "Clean, maintainable, well-documented code",
      "Scalable architecture ready to grow",
    ],
  },
  {
    slug: "mobile-app-development",
    seoTitle:
      "Mobile App Development Services for iOS & Android",
    seoDescription:
      "Mobile app development for iOS, Android and cross-platform apps, from first wireframe to App Store and Play Store launch. Delivered remotely worldwide.",
    faqs: [
      {
        q: "Do you build native or cross-platform apps?",
        a: "Both. We build native iOS and Android apps as well as cross-platform apps, and recommend the approach that suits your users, budget and timeline.",
      },
      {
        q: "Do you help with App Store and Play Store release?",
        a: "Yes. App Store and Play Store launch support is part of the service, from the first wireframe through to store launch.",
      },
      {
        q: "Can you develop our app if we are in another country?",
        a: "We are based in Guntur, Andhra Pradesh, India and work remotely with clients worldwide. Collaboration runs over video calls, shared boards and written updates, and we reply to every enquiry within one business day.",
      },
    ],
    icon: Smartphone,
    image:
      "https://images.unsplash.com/photo-1592899677977-9c10ca588bbd?w=1200&q=80",
    title: "Mobile App Development",
    tagline: "Apps people actually use",
    description:
      "Native and cross-platform mobile applications that deliver seamless experiences across devices.",
    subServices: ["Android Apps", "iOS Apps", "Cross-Platform Apps"],
    overview:
      "We build native and cross-platform mobile apps that feel fast and familiar on every device, from first wireframe to store launch.",
    highlights: [
      "Native iOS, Android, and cross-platform builds",
      "Smooth navigation and low load times",
      "App Store and Play Store launch support",
      "Built around real usage patterns",
    ],
  },
  {
    slug: "ui-ux-design",
    seoTitle:
      "UI/UX Design Services for Web & Mobile Apps",
    seoDescription:
      "UI/UX design services for web and mobile: UX research, wireframes, prototypes, usability testing and design systems. Delivered remotely from India.",
    faqs: [
      {
        q: "What is included in your UI/UX design service?",
        a: "UX research, wireframes and interactive prototypes, usability testing with real users, and design systems that keep an interface consistent as the product grows.",
      },
      {
        q: "Can you redesign an existing product?",
        a: "Yes. We can review how people use your current product and redesign the interface around what usability testing shows.",
      },
      {
        q: "How do remote design reviews work?",
        a: "We are based in Guntur, Andhra Pradesh, India and work remotely with clients worldwide. Collaboration runs over video calls, shared boards and written updates, and we reply to every enquiry within one business day.",
      },
    ],
    icon: Palette,
    image:
      "https://images.unsplash.com/photo-1559028006-448665bd7c7f?w=1200&q=80",
    title: "UI/UX Design",
    tagline: "Designed to convert",
    description:
      "Intuitive, user-focused designs that enhance usability and create engaging digital experiences.",
    subServices: ["UI Design", "UX Research", "Wireframing & Prototyping"],
    overview:
      "Good design is more than visuals — it's how easily someone can get what they came for. We design around real usability testing, not guesswork.",
    highlights: [
      "Wireframes and interactive prototypes",
      "Usability testing with real users",
      "Design systems for consistency at scale",
      "Interfaces built to convert, not just look good",
    ],
  },
  {
    slug: "cloud-solutions",
    seoTitle:
      "Cloud Solutions, Migration & DevOps Services",
    seoDescription:
      "Cloud solutions and DevOps services: cloud migration, scalable infrastructure, CI/CD pipelines, monitoring and cost optimization. Delivered remotely worldwide.",
    faqs: [
      {
        q: "What cloud services do you provide?",
        a: "Cloud migration, cloud infrastructure set-up, and DevOps with CI/CD pipelines for reliable deployments, plus 24/7 monitoring and alerting and cost optimization as you grow.",
      },
      {
        q: "Can you move an existing application to the cloud?",
        a: "Yes. Cloud migration is one of our core cloud services. We plan the move, set up scalable and secure infrastructure, and automate deployments.",
      },
      {
        q: "Can you manage our cloud infrastructure remotely?",
        a: "We are based in Guntur, Andhra Pradesh, India and work remotely with clients worldwide. Collaboration runs over video calls, shared boards and written updates, and we reply to every enquiry within one business day.",
      },
    ],
    icon: Cloud,
    image:
      "https://images.unsplash.com/photo-1544197150-b99a580bb7a8?w=1200&q=80",
    title: "Cloud Solutions",
    tagline: "Scales as you grow",
    description:
      "Scalable cloud infrastructure and deployment solutions for secure, reliable, and high-performing applications.",
    subServices: ["Cloud Migration", "Cloud Infrastructure", "DevOps & CI/CD"],
    overview:
      "We architect and manage cloud infrastructure that scales with your traffic instead of falling over during it.",
    highlights: [
      "Scalable, secure infrastructure setup",
      "CI/CD pipelines for reliable deployments",
      "24/7 monitoring and alerting",
      "Cost optimization as you grow",
    ],
  },
  {
    slug: "ai-solutions",
    seoTitle:
      "AI Development Services, Chatbots & Automation",
    seoDescription:
      "AI development services: AI chatbots, process automation, in-product copilots and AI integration built around your data. Delivered remotely worldwide.",
    faqs: [
      {
        q: "What AI solutions do you build?",
        a: "AI chatbots, workflow and process automation, in-product AI copilots and assistants, and AI integration into existing software, including custom models built around your data.",
      },
      {
        q: "How do you decide where AI is worth using?",
        a: "We integrate AI where it saves real time or solves a real problem, and judge the result on measurable product impact rather than novelty.",
      },
      {
        q: "Can you add AI to software we already have?",
        a: "Yes. AI integration into existing products and workflows is part of the service. We are based in Guntur, Andhra Pradesh, India and work remotely with clients worldwide. Collaboration runs over video calls, shared boards and written updates, and we reply to every enquiry within one business day.",
      },
    ],
    icon: Sparkles,
    image:
      "https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&q=80",
    title: "AI Solutions",
    tagline: "Practical, not novelty",
    description:
      "AI-powered applications and automation that improve efficiency and enable smarter business decisions.",
    subServices: ["AI Chatbots", "Process Automation", "AI Integration"],
    overview:
      "We integrate AI where it actually saves time — smart automation, in-product copilots, and workflow assistants built around a real problem.",
    highlights: [
      "Workflow automation that saves real time",
      "In-product AI copilots and assistants",
      "Custom models built around your data",
      "Judged on measurable product impact",
    ],
  },
  {
    slug: "maintenance-support",
    seoTitle:
      "Software Maintenance & Support Services",
    seoDescription:
      "Software maintenance and support: application maintenance, performance monitoring, bug fixes, security updates and technical support, delivered remotely.",
    faqs: [
      {
        q: "What does software maintenance and support cover?",
        a: "Monitoring and uptime tracking, bug fixes and issue resolution, regular dependency and security updates, ongoing performance tuning, and technical support.",
      },
      {
        q: "Can you maintain software that another team built?",
        a: "Get in touch with a short description of the application and its technology. We will review it and tell you plainly whether and how we can take it on.",
      },
      {
        q: "How does support work across time zones?",
        a: "We are based in Guntur, Andhra Pradesh, India and work remotely with clients worldwide. Collaboration runs over video calls, shared boards and written updates, and we reply to every enquiry within one business day.",
      },
    ],
    icon: Wrench,
    image:
      "https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=1200&q=80",
    title: "Maintenance & Support",
    tagline: "Healthy, long after launch",
    description:
      "Reliable maintenance and continuous support to keep your applications secure, updated, and running smoothly.",
    subServices: [
      "Application Maintenance",
      "Performance Monitoring",
      "Technical Support",
    ],
    overview:
      "Launch is the start, not the finish line. We keep your application running smoothly with a team that already knows your codebase.",
    highlights: [
      "24/7 monitoring and uptime tracking",
      "Fast bug fixes and issue resolution",
      "Regular dependency and security updates",
      "Ongoing performance tuning",
    ],
  },
  {
    slug: "cybersecurity-engineering",
    seoTitle:
      "Cybersecurity & Application Security Services",
    seoDescription:
      "Cybersecurity services: security assessments, application security, access control and data protection with OWASP-aligned practices. Delivered remotely.",
    faqs: [
      {
        q: "What cybersecurity services do you offer?",
        a: "Security assessments, application security and data protection. We build with OWASP-aligned secure development practices, secure authentication and access control.",
      },
      {
        q: "When should security be considered in a software project?",
        a: "From the first commit. We build security and data protection in from day one instead of adding them at the end, with controls that are ready for audits.",
      },
      {
        q: "Can a security assessment be done remotely?",
        a: "We are based in Guntur, Andhra Pradesh, India and work remotely with clients worldwide. Collaboration runs over video calls, shared boards and written updates, and we reply to every enquiry within one business day.",
      },
    ],
    icon: ShieldCheck,
    image:
      "https://images.unsplash.com/photo-1563013544-824ae1b704d3?w=1200&q=80",
    title: "Cybersecurity",
    tagline: "Security-first delivery",
    description:
      "Comprehensive security solutions to protect your applications, systems, and business data.",
    subServices: [
      "Security Assessments",
      "Application Security",
      "Data Protection",
    ],
    overview:
      "Security isn't bolted on at the end — we build with OWASP-aligned practices and data protection from the first commit.",
    highlights: [
      "OWASP-aligned secure development",
      "Secure authentication and access control",
      "Data protection built in from day one",
      "Compliance-ready controls for audits",
    ],
  },
  {
    slug: "quality-engineering-qa",
    seoTitle:
      "QA & Software Testing Services",
    seoDescription:
      "QA and software testing services: manual testing, automated unit and end-to-end tests, regression and performance testing. Delivered remotely worldwide.",
    faqs: [
      {
        q: "What testing services do you provide?",
        a: "Manual testing, automated unit and end-to-end test suites, performance testing, and regression testing before every launch, with structured bug tracking and reporting.",
      },
      {
        q: "Can you test software built by another team?",
        a: "Yes. Send us a short description of the product and how it is released, and we will propose a QA approach that fits it.",
      },
      {
        q: "How do you work with a remote development team?",
        a: "We are based in Guntur, Andhra Pradesh, India and work remotely with clients worldwide. Collaboration runs over video calls, shared boards and written updates, and we reply to every enquiry within one business day.",
      },
    ],
    icon: TestTube2,
    image:
      "https://images.unsplash.com/photo-1516110833967-0b5716ca1387?w=1200&q=80",
    title: "Quality Assurance",
    tagline: "Caught before it ships",
    description:
      "End-to-end testing services to ensure reliable, secure, and high-quality software delivery.",
    subServices: ["Manual Testing", "Automated Testing", "Performance Testing"],
    overview:
      "We build automated test suites and structured QA processes that catch regressions before they ever reach production.",
    highlights: [
      "Automated unit and end-to-end test suites",
      "Continuous QA through every release",
      "Regression testing before every launch",
      "Structured bug tracking and reporting",
    ],
  },
];

export function getServiceBySlug(slug) {
  return SERVICES.find((service) => service.slug === slug);
}
