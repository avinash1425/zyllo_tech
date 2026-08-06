"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import { Plus, Pencil, Trash2, ExternalLink, X, ImageOff } from "lucide-react";
import { createProject, updateProject, toggleProjectStatus, deleteProject } from "./actions";

const STATUS_STYLES = {
  published: "bg-[#3b6d11]/10 text-[#3b6d11]",
  draft: "bg-[#676b7a]/10 text-[#676b7a]",
};

const STATUS_LABELS = {
  published: "Published",
  draft: "Draft",
};

function emptyForm() {
  return {
    title: "",
    tag: "",
    description: "",
    status: "draft",
  };
}

export default function PortfolioManager({ initialProjects }) {
  const [projects, setProjects] = useState(initialProjects);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [formError, setFormError] = useState("");
  const [isPending, startTransition] = useTransition();

  function openCreate() {
    setEditingProject(null);
    setFormError("");
    setModalOpen(true);
  }

  function openEdit(project) {
    setEditingProject(project);
    setFormError("");
    setModalOpen(true);
  }

  function handleFormSubmit(e) {
    e.preventDefault();
    setFormError("");
    const formData = new FormData(e.currentTarget);

    startTransition(async () => {
      const result = editingProject
        ? await updateProject(editingProject.id, null, formData)
        : await createProject(null, formData);

      if (result.status === "error") {
        setFormError(result.message);
        return;
      }

      setModalOpen(false);
      window.location.reload();
    });
  }

  function handleDelete(id) {
    startTransition(async () => {
      const result = await deleteProject(id);
      if (result.status === "error") {
        alert(result.message);
        return;
      }
      setProjects((prev) => prev.filter((p) => p.id !== id));
      setDeletingId(null);
    });
  }

  function handleToggleStatus(project) {
    const newStatus = project.status === "published" ? "draft" : "published";
    setProjects((prev) =>
      prev.map((p) => (p.id === project.id ? { ...p, status: newStatus } : p))
    );
    startTransition(async () => {
      const result = await toggleProjectStatus(project.id, newStatus);
      if (result.status === "error") alert(result.message);
    });
  }

  const form = editingProject ?? emptyForm();
  const published = projects.filter((p) => p.status === "published").length;
  const draft = projects.filter((p) => p.status === "draft").length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#2b303b]">Portfolio</h1>
          <p className="mt-1 text-sm text-[#676b7a]">
            {published} published project{published === 1 ? "" : "s"}, {draft} in draft.
          </p>
        </div>

        <button
          type="button"
          onClick={openCreate}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[#f7941e] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#db7d17]"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          New Featured Project
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#e7e9ee] bg-white py-16 text-center">
          <p className="text-sm text-[#676b7a]">
            No projects yet — click &quot;New Featured Project&quot; to add your first one.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <div
              key={project.id}
              className="group relative overflow-hidden rounded-2xl border border-[#e7e9ee] bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-transparent hover:shadow-lg hover:shadow-[#f7941e]/10"
            >
              <div className="relative h-40 w-full overflow-hidden bg-[#f5f6f8]">
                {project.image_url ? (
                  <Image
                    src={project.image_url}
                    alt={project.title}
                    fill
                    sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                    className="object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[#676b7a]/40">
                    <ImageOff className="h-8 w-8" aria-hidden="true" />
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => handleToggleStatus(project)}
                  disabled={isPending}
                  className={`absolute left-3 top-3 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold backdrop-blur-sm transition-opacity hover:opacity-80 ${STATUS_STYLES[project.status]}`}
                >
                  {STATUS_LABELS[project.status]}
                </button>
              </div>

              <div className="p-4">
                <span className="text-xs font-bold uppercase tracking-wide text-[#f7941e]">
                  {project.tag}
                </span>
                <h3 className="mt-1.5 line-clamp-2 text-sm font-semibold leading-snug text-[#2b303b]">
                  {project.title}
                </h3>

                <div className="mt-4 flex items-center gap-1.5 border-t border-[#e7e9ee] pt-3">
                  {project.status === "published" && (
                    <a
                      href="/portfolio"
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`View ${project.title} on the live site`}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-[#676b7a] transition-colors hover:bg-[#1f4693]/10 hover:text-[#1f4693]"
                    >
                      <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => openEdit(project)}
                    aria-label={`Edit ${project.title}`}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-[#676b7a] transition-colors hover:bg-[#f7941e]/10 hover:text-[#f7941e]"
                  >
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeletingId(project.id)}
                    aria-label={`Delete ${project.title}`}
                    className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-[#676b7a] transition-colors hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8"
          onClick={() => setModalOpen(false)}
        >
          <div
            className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-[#e7e9ee] bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-[#2b303b]">
                {editingProject ? "Edit Featured Project" : "New Featured Project"}
              </h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-[#676b7a] transition-colors hover:bg-[#f5f6f8] hover:text-[#2b303b]"
              >
                <X className="h-4.5 w-4.5" aria-hidden="true" />
              </button>
            </div>

            <form onSubmit={handleFormSubmit} className="mt-5 flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="title" className="mb-1.5 block text-sm font-medium text-[#2b303b]">
                    Title
                  </label>
                  <input
                    id="title"
                    name="title"
                    type="text"
                    required
                    defaultValue={form.title}
                    placeholder="e.g. Bringing inventory and orders into one system"
                    className="w-full rounded-lg border border-[#e7e9ee] bg-white px-3.5 py-2.5 text-sm text-[#2b303b] outline-none focus:border-[#f7941e]/60"
                  />
                </div>
                <div>
                  <label htmlFor="tag" className="mb-1.5 block text-sm font-medium text-[#2b303b]">
                    Industry / Tag
                  </label>
                  <input
                    id="tag"
                    name="tag"
                    type="text"
                    required
                    defaultValue={form.tag}
                    placeholder="e.g. E-commerce & Retail"
                    className="w-full rounded-lg border border-[#e7e9ee] bg-white px-3.5 py-2.5 text-sm text-[#2b303b] outline-none focus:border-[#f7941e]/60"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="description" className="mb-1.5 block text-sm font-medium text-[#2b303b]">
                  Short Description
                </label>
                <textarea
                  id="description"
                  name="description"
                  rows={2}
                  required
                  defaultValue={form.description}
                  placeholder="One or two sentences shown on the Featured Projects card."
                  className="w-full resize-none rounded-lg border border-[#e7e9ee] bg-white px-3.5 py-2.5 text-sm text-[#2b303b] outline-none focus:border-[#f7941e]/60"
                />
              </div>

              <div>
                <label htmlFor="image" className="mb-1.5 block text-sm font-medium text-[#2b303b]">
                  Project Image
                </label>
                {editingProject?.image_url && (
                  <div className="relative mb-2 h-32 w-full overflow-hidden rounded-lg border border-[#e7e9ee]">
                    <Image src={editingProject.image_url} alt="" fill className="object-cover" />
                  </div>
                )}
                <input
                  id="image"
                  name="image"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="w-full rounded-lg border border-[#e7e9ee] bg-white px-3.5 py-2.5 text-sm text-[#2b303b] outline-none file:mr-3 file:rounded-md file:border-0 file:bg-[#f7941e]/10 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-[#f7941e] focus:border-[#f7941e]/60"
                />
                <p className="mt-1 text-xs text-[#676b7a]">
                  {editingProject ? "Leave empty to keep the current image. " : ""}JPG, PNG, or WEBP, up to 5MB.
                </p>
              </div>

              <div>
                <label htmlFor="status" className="mb-1.5 block text-sm font-medium text-[#2b303b]">
                  Status
                </label>
                <select
                  id="status"
                  name="status"
                  defaultValue={form.status}
                  className="w-full rounded-lg border border-[#e7e9ee] bg-white px-3.5 py-2.5 text-sm text-[#2b303b] outline-none focus:border-[#f7941e]/60"
                >
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                </select>
                <p className="mt-1 text-xs text-[#676b7a]">
                  Only published projects appear on the public Portfolio page.
                </p>
              </div>

              {formError && <p className="text-sm font-medium text-red-600">{formError}</p>}

              <div className="mt-1 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-lg border border-[#e7e9ee] px-4 py-2 text-sm font-medium text-[#676b7a] transition-colors hover:bg-[#fafbfc]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="rounded-lg bg-[#f7941e] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#db7d17] disabled:opacity-60"
                >
                  {isPending ? "Saving..." : editingProject ? "Save Changes" : "Create Project"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deletingId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={() => setDeletingId(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-[#e7e9ee] bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-bold text-[#2b303b]">Delete this project?</h2>
            <p className="mt-2 text-sm text-[#676b7a]">This can&apos;t be undone.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeletingId(null)}
                className="rounded-lg border border-[#e7e9ee] px-4 py-2 text-sm font-medium text-[#676b7a] transition-colors hover:bg-[#fafbfc]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleDelete(deletingId)}
                disabled={isPending}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-60"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
