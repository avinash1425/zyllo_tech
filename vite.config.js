import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// The first hero image is otherwise discovered only after the main bundle and
// the Home chunk have run. On the home page, start both downloads from <head>.
// An inline script (not static <link>s) so other routes do not fetch them.
function preloadHomePage() {
  return {
    name: "preload-home-page",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(_html, { bundle }) {
        const files = Object.values(bundle ?? {});
        const hero = files.find((f) => /^assets\/hero-home1-1408-.*\.webp$/.test(f.fileName));
        const home = files.find((f) => f.type === "chunk" && f.name === "Home");
        if (!hero || !home) throw new Error("preload-home-page: hero image or Home chunk not found");
        const code = `if(location.pathname==="/"){[{rel:"preload",as:"image",fetchPriority:"high",href:"/${hero.fileName}"},{rel:"modulepreload",href:"/${home.fileName}"}].forEach(function(a){document.head.appendChild(Object.assign(document.createElement("link"),a))})}`;
        return [{ tag: "script", children: code, injectTo: "head-prepend" }];
      },
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), preloadHomePage()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  server: { port: 8080, host: true },
});
