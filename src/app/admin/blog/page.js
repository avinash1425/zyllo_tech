"use client";

import { useState } from "react";
import { Plus, Search, Pencil, Trash2, Eye } from "lucide-react";

const POSTS = [
  {
    id: 1,
    title: "Scaling Node.js APIs Without Losing Your Mind",
    category: "Engineering",
    author: "Zyllo Engineering Team",
    status: "Published",
    date: "2026-07-28",
    views: "2.4K",
  },
  {
    id: 2,
    title: "Designing for Trust: UI Patterns for Fintech",
    category: "Design",
    author: "Meera Nair",
    status: "Published",
    date: "2026-07-20",
    views: "1.8K",
  },
  {
    id: 3,
    title: "What We Learned Migrating to Kubernetes",
    category: "Cloud & DevOps",
    author: "Zyllo Engineering Team",
    status: "Draft",
    date: "—",
    views: "—",
  },
  {
    id: 4,
    title: "A Practical Guide to Prompt-Driven Features",
    category: "AI & Automation",
    author: "Arjun Rao",
    status: "Published",
    date: "2026-07-05",
    views: "3.1K",
  },
  {
    id: 5,
    title: "Security Reviews: What We Check Before Every Launch",
    category: "Security",
    author: "Zyllo Engineering Team",
    status: "Draft",
    date: "—",
    views: "—",
  },
  {
    id: 6,
    title: "From MVP to Series A: Lessons From Client Projects",
    category: "Product Strategy",
    author: "Ananya Iyer",
    status: "Published",
    date: "2026-06-18",
    views: "4.6K",
  },
];

const STATUS_STYLES = {
  Published: "bg-[#3b6d11]/10 text-[#3b6d11]",
  Draft: "bg-[#676b7a]/10 text-[#676b7a]",
};

export default function AdminBlogPage() {
  const [query, setQuery] = useState("");

  const filtered = POSTS.filter(
    (post) =>
      query.trim() === "" ||
      post.title.toLowerCase().includes(query.toLowerCase()) ||
      post.category.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#2b303b]">Blog Posts</h1>
          <p className="mt-1 text-sm text-[#676b7a]">
            {POSTS.length} posts — {POSTS.filter((p) => p.status === "Published").length}{" "}
            published, {POSTS.filter((p) => p.status === "Draft").length} drafts.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative w-full sm:w-56">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#676b7a]/50"
              aria-hidden="true"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search posts…"
              className="w-full rounded-lg border border-[#e7e9ee] bg-white py-2 pl-9 pr-3 text-sm text-[#2b303b] outline-none placeholder:text-[#676b7a]/50 focus:border-[#f7941e]/50"
            />
          </div>
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[#f7941e] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#db7d17]"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            New Post
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[#e7e9ee] bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-[#e7e9ee] bg-[#fafbfc] text-xs font-bold uppercase tracking-wide text-[#676b7a]">
                <th className="px-5 py-3">Title</th>
                <th className="px-5 py-3">Category</th>
                <th className="px-5 py-3">Author</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Views</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((post) => (
                <tr
                  key={post.id}
                  className="border-b border-[#e7e9ee] last:border-0 transition-colors hover:bg-[#fafbfc]"
                >
                  <td className="px-5 py-4">
                    <p className="font-semibold text-[#2b303b]">{post.title}</p>
                    <p className="mt-0.5 text-xs text-[#676b7a]">{post.date}</p>
                  </td>
                  <td className="px-5 py-4 text-[#676b7a]">{post.category}</td>
                  <td className="px-5 py-4 text-[#676b7a]">{post.author}</td>
                  <td className="px-5 py-4">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[post.status]}`}
                    >
                      {post.status}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-[#676b7a]">{post.views}</td>
                  <td className="px-5 py-4">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        aria-label={`Preview ${post.title}`}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-[#676b7a] transition-colors hover:bg-[#1f4693]/10 hover:text-[#1f4693]"
                      >
                        <Eye className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Edit ${post.title}`}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-[#676b7a] transition-colors hover:bg-[#f7941e]/10 hover:text-[#f7941e]"
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${post.title}`}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-[#676b7a] transition-colors hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 && (
          <div className="py-12 text-center text-sm text-[#676b7a]">
            No posts match your search.
          </div>
        )}
      </div>
    </div>
  );
}
