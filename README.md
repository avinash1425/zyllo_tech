This is the [Zyllo Tech](https://zyllotech.com) website, built with [Vite](https://vitejs.dev), React, React Router, and [shadcn/ui](https://ui.shadcn.com), and developed/published through [Lovable](https://lovable.dev).

## Getting Started

Install dependencies and run the dev server:

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) with your browser to see the result.

## Backend

Supabase provides auth, Postgres, and storage. The project is connected to Supabase as a Lovable Connector (Project → More → Connectors → Supabase) — the connector must stay attached for `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY` to be present in production builds.

## Deploying

Publishing happens through Lovable, which builds and deploys to the connected custom domains (see Project → More → Domains). Pushes to the GitHub `main` branch sync into Lovable and vice versa.
