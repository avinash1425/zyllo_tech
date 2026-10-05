import { Briefcase, Brain, Code, Headset, Megaphone, Palette, Users, Wallet } from "lucide-react";

// Maps a free-text department to an icon + brand-palette gradient. Purely
// presentational; unknown departments fall back to a neutral navy briefcase.
const THEMES = [
  { test: /(\bai\b|\bml\b|data|analytic|research)/, icon: Brain, from: "#3089a6", to: "#1f4693" },
  { test: /(eng|develop|tech|software|\bit\b|devops|\bqa\b|product)/, icon: Code, from: "#1f4693", to: "#3089a6" },
  { test: /(design|\bux\b|\bui\b|creative|brand|content)/, icon: Palette, from: "#f96706", to: "#ffb15c" },
  { test: /(market|sales|growth|business|\bbd\b)/, icon: Megaphone, from: "#f7941e", to: "#f96706" },
  { test: /(\bhr\b|people|talent|recruit|culture)/, icon: Users, from: "#3089a6", to: "#173a52" },
  { test: /(financ|account|legal|compliance)/, icon: Wallet, from: "#173a52", to: "#1f4693" },
  { test: /(support|customer|success|operation|admin)/, icon: Headset, from: "#f7941e", to: "#3089a6" },
];

export function deptTheme(department) {
  const d = String(department || "").toLowerCase();
  const hit = THEMES.find((t) => t.test.test(d));
  return hit || { icon: Briefcase, from: "#1f4693", to: "#173a52" };
}
