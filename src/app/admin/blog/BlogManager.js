"use client";

import { useState, useTransition, useActionState } from "react";
import Link from "next/link";
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  Eye,
  X,
  FileText,
  CheckCircle2,
  FileEdit,
} from "lucide-react";
import { createBlogPost, updateBlogPost, togglePostStatus, deleteBlogPost } from "./actions";

const STATUS_STYLES = {
  published: "bg-[#3b6d11]/10 text-[#3b6d11]",
  draft: "bg-[#676b7a]/10 text-[#676b7a]",
};

const CATEGORY_OPTIONS = [
  "Engineering",
  "Design",
  "AI & Automation",
  "Cloud & DevOps",
  "Security",
  "Product Strategy",
];

const initialFormState = { status: "idle", message: "" };

function PostForm({ post, onClose }) {
  const isEditing = Boolean(post);
  const action = isEditing ? updateBlogPost : createBlogPost;
  const [state, formAction, isPending] = useActionState(action, initialFormState);

  if (state.status === "success") {
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0b0e17]/50 p-4 backdrop-blur-sm">
      <div className="relative flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-[#e7e9ee] px-6 py-4">
          <h2 className="text-lg font-bold text-[#2b303b]">
            {isEditing ? "Edit Post" : "New Post"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[#676b7a] hover:bg-[#fafbfc]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <form
          id="blog-post-form"
          action={formAction}
          className="flex flex-col gap-4 overflow-y-auto px-6 py-5"
        >
          {isEditing && <input type="hidden" name="id" value={post.id} />}

          <div>
            <label htmlFor="title" className="mb-1.5 block text-sm font-medium text-[#2b303b]">
              Title
            </label>
            <input
              id="title"
              name="title"
              type="text"
              required
              defaultValue={post?.title ?? ""}
              className="w-full rounded-lg border border-[#e7e9ee] px-3.5 py-2.5 text-sm text-[#2b303b] outline-none focus:border-[#1f4693]/60"
            />
          </div>

          <div>
            <label htmlFor="slug" className="mb-1.5 block text-sm font-medium text-[#2b303b]">
              URL Slug <span className="font-normal text-[#676b7a]">(optional — auto-generated from title if left blank)</span>
            </label>
            <input
              id="slug"
              name="slug"
              type="text"
              placeholder="my-post-title"
              defaultValue={post?.slug ?? ""}
              className="w-full rounded-lg border border-[#e7e9ee] px-3.5 py-2.5 text-sm text-[#2b303b] outline-none placeholder:text-[#676b7a]/40 focus:border-[#1f4693]/60"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="category" className="mb-1.5 block text-sm font-medium text-[#2b303b]">
                Category
              </label>
              <select
                id="category"
                name="category"
                defaultValue={post?.category ?? CATEGORY_OPTIONS[0]}
                className="w-full rounded-lg border border-[#e7e9ee] bg-white px-3.5 py-2.5 text-sm text-[#2b303b] outline-none focus:border-[#1f4693]/60"
              >
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="author" className="mb-1.5 block text-sm font-medium text-[#2b303b]">
                Author
              </label>
              <input
                id="author"
                name="author"
                type="text"
                defaultValue={post?.author ?? "Zyllo Engineering Team"}
                className="w-full rounded-lg border border-[#e7e9ee] px-3.5 py-2.5 text-sm text-[#2b303b] outline-none focus:border-[#1f4693]/60"
              />
            </div>
          </div>

          <div>
            <label htmlFor="featuredImageUrl" className="mb-1.5 block text-sm font-medium text-[#2b303b]">
              Featured Image URL <span className="font-normal text-[#676b7a]">(optional)</span>
            </label>
            <input
              id="featuredImageUrl"
              name="featuredImageUrl"
              type="url"
              placeholder="https://..."
              defaultValue={post?.featured_image_url ?? ""}
              className="w-full rounded-lg border border-[#e7e9ee] px-3.5 py-2.5 text-sm text-[#2b303b] outline-none placeholder:text-[#676b7a]/40 focus:border-[#1f4693]/60"
            />
          </div>

          <div>
            <label htmlFor="excerpt" className="mb-1.5 block text-sm font-medium text-[#2b303b]">
              Excerpt <span className="font-normal text-[#676b7a]">(short summary shown on listing cards)</span>
            </label>
            <textarea
              id="excerpt"
              name="excerpt"
              rows={2}
              defaultValue={post?.excerpt ?? ""}
              className="w-full resize-none rounded-lg border border-[#e7e9ee] px-3.5 py-2.5 text-sm text-[#2b303b] outline-none focus:border-[#1f4693]/60"
            />
          </div>

          <div>
            <label htmlFor="content" className="mb-1.5 block text-sm font-medium text-[#2b303b]">
              Content
            </label>
            <textarea
              id="content"
              name="content"
              rows={8}
              defaultValue={post?.content ?? ""}
              className="w-full resize-none rounded-lg border border-[#e7e9ee] px-3.5 py-2.5 text-sm text-[#2b303b] outline-none focus:border-[#1f4693]/60"
            />
          </div>

          <div>
            <label htmlFor="postStatus" className="mb-1.5 block text-sm font-medium text-[#2b303b]">
              Status
            </label>
            <select
              id="postStatus"
              name="status"
              defaultValue={post?.status ?? "draft"}
              className="w-full rounded-lg border border-[#e7e9ee] bg-white px-3.5 py-2.5 text-sm text-[#2b303b] outline-none focus:border-[#1f4693]/60"
            >
              <option value="draft">Draft</option>
              <option value="published">Published</option>
            </select>
          </div>

          {state.status === "error" && (
            <p className="text-sm font-medium text-red-600">{state.message}</p>
          )}
        </form>

        <div className="flex shrink-0 items-center justify-end gap-3 border-t border-[#e7e9ee] px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-[#676b7a] hover:bg-[#fafbfc]"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="blog-post-form"
            disabled={isPending}
            className="rounded-lg bg-[#f7941e] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-[#db7d17] disabled:opacity-60"
          >
            {isPending ? "Saving..." : isEditing ? "Save Changes" : "Create Post"}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, accent }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-[#e7e9ee] bg-white p-4 shadow-sm">
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
        style={{ backgroundColor: `${accent}18` }}
      >
        <Icon className="h-5 w-5" style={{ color: accent }} aria-hidden="true" />
      </span>
      <div>
        <p className="text-xl font-bold text-[#2b303b]">{value}</p>
        <p className="text-xs text-[#676b7a]">{label}</p>
      </div>
    </div>
  );
}

export default function BlogManager({ initialPosts }) {
  const [posts, setPosts] = useState(initialPosts);
  const [query, setQuery] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingPost, setEditingPost] = useState(null);
  const [isPending, startTransition] = useTransition();

  function openCreateForm() {
    setEditingPost(null);
    setFormOpen(true);
  }

  function openEditForm(post) {
    setEditingPost(post);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingPost(null);
    window.location.reload();
  }

  function handleToggleStatus(post) {
    startTransition(async () => {
      await togglePostStatus(post.id, post.status);
      setPosts((prev) =>
        prev.map((p) =>
          p.id === post.id
            ? { ...p, status: p.status === "published" ? "draft" : "published" }
            : p
        )
      );
    });
  }

  function handleDelete(post) {
    if (!window.confirm(`Delete "${post.title}"? This cannot be undone.`)) return;
    startTransition(async () => {
      await deleteBlogPost(post.id);
      setPosts((prev) => prev.filter((p) => p.id !== post.id));
    });
  }

  const filtered = posts.filter(
    (post) =>
      query.trim() === "" ||
      post.title.toLowerCase().includes(query.toLowerCase()) ||
      post.category.toLowerCase().includes(query.toLowerCase())
  );

  const totalPosts = posts.length;
  const publishedCount = posts.filter((p) => p.status === "published").length;
  const draftCount = totalPosts - publishedCount;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#2b303b]">Blog Posts</h1>
          <p className="mt-1 text-sm text-[#676b7a]">
            {totalPosts} post{totalPosts === 1 ? "" : "s"} — {publishedCount} published,{" "}
            {draftCount} draft{draftCount === 1 ? "" : "s"}.
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
              className="w-full rounded-lg border border-[#e7e9ee] bg-white py-2 pl-9 pr-3 text-sm text-[#2b303b] outline-none placeholder:text-[#676b7a]/50 focus:border-[#1f4693]/50"
            />
          </div>
          <button
            type="button"
            onClick={openCreateForm}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[#f7941e] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#db7d17]"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            New Post
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatCard icon={FileText} label="Total Posts" value={totalPosts} accent="#1f4693" />
        <StatCard icon={CheckCircle2} label="Published" value={publishedCount} accent="#3b6d11" />
        <StatCard icon={FileEdit} label="Drafts" value={draftCount} accent="#f7941e" />
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
                    <p className="mt-0.5 text-xs text-[#676b7a]">
                      {new Date(post.created_at).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </p>
                  </td>
                  <td className="px-5 py-4 text-[#676b7a]">{post.category}</td>
                  <td className="px-5 py-4 text-[#676b7a]">{post.author}</td>
                  <td className="px-5 py-4">
                    <button
                      type="button"
                      onClick={() => handleToggleStatus(post)}
                      disabled={isPending}
                      title="Toggle published/draft"
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold transition-opacity hover:opacity-80 disabled:opacity-50 ${STATUS_STYLES[post.status]}`}
                    >
                      {post.status === "published" ? "Published" : "Draft"}
                    </button>
                  </td>
                  <td className="px-5 py-4 text-[#676b7a]">{post.views}</td>
                  <td className="px-5 py-4">
                    <div className="flex items-center justify-end gap-1">
                      {post.status === "published" && (
                        <Link
                          href={`/blog/${post.slug}`}
                          target="_blank"
                          aria-label={`Preview ${post.title}`}
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-[#676b7a] transition-colors hover:bg-[#1f4693]/10 hover:text-[#1f4693]"
                        >
                          <Eye className="h-4 w-4" aria-hidden="true" />
                        </Link>
                      )}
                      <button
                        type="button"
                        onClick={() => openEditForm(post)}
                        aria-label={`Edit ${post.title}`}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-[#676b7a] transition-colors hover:bg-[#f7941e]/10 hover:text-[#f7941e]"
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(post)}
                        disabled={isPending}
                        aria-label={`Delete ${post.title}`}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-[#676b7a] transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
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
            {posts.length === 0
              ? "No posts yet. Create your first post to get started."
              : "No posts match your search."}
          </div>
        )}
      </div>

      {formOpen && <PostForm post={editingPost} onClose={closeForm} />}
    </div>
  );
}
