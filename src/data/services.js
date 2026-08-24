// Single source of truth for every service: used by the header dropdown,
// the homepage/services marquee grid, and each individual /services/[slug] page.
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
    icon: Lightbulb,
    image:
      "https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=1200&q=70&auto=format",
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
    icon: Code2,
    image:
      "https://images.unsplash.com/photo-1547658719-da2b51169166?w=1200&q=70&auto=format",
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
    icon: Smartphone,
    image:
      "https://images.unsplash.com/photo-1592899677977-9c10ca588bbd?w=1200&q=70&auto=format",
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
    icon: Palette,
    image:
      "https://images.unsplash.com/photo-1559028006-448665bd7c7f?w=1200&q=70&auto=format",
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
    icon: Cloud,
    image:
      "https://images.unsplash.com/photo-1544197150-b99a580bb7a8?w=1200&q=70&auto=format",
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
    icon: Sparkles,
    image:
      "https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&q=70&auto=format",
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
    icon: Wrench,
    image:
      "https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=1200&q=70&auto=format",
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
    icon: ShieldCheck,
    image:
      "https://images.unsplash.com/photo-1563013544-824ae1b704d3?w=1200&q=70&auto=format",
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
    icon: TestTube2,
    image:
      "https://images.unsplash.com/photo-1516110833967-0b5716ca1387?w=1200&q=70&auto=format",
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
