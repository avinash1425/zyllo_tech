"use client";

import { useState, useTransition } from "react";
import { useActionState } from "react";
import Link from "next/link";
import { Plus, MapPin, Pencil, Trash2, Users, X, Briefcase, CheckCircle2, XCircle } from "lucide-react";
import {
  createJobPosting,
  updateJobPosting,
  toggleJobStatus,
  deleteJobPosting,
} from "./actions";

const STATUS_STYLES = {
  open: "bg-[#3b6d11]/10 text-[#3b6d11]",
  closed: "bg-[#676b7a]/10 text-[#676b7a]",
};

const initialFormState = { status: "idle", message: "" };

function PositionForm({ position, onClose }) {
  const isEditing = Boolean(position);
  const action = isEditing ? updateJobPosting : createJobPosting;
  const [state, formAction, isPending] = useActionState(action, initialFormState);

  if (state.status === "success") {
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-lg text-[#676b7a] hover:bg-[#f5f6f8]"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>

        <h2 className="text-lg font-bold text-[#2b303b]">
          {isEditing ? "Edit Position" : "New Position"}
        </h2>

        <form action={formAction} className="mt-5 flex flex-col gap-4">
          {isEditing && <input type="hidden" name="id" value={position.id} />}

          <div>
            <label htmlFor="title" className="mb-1.5 block text-sm font-medium text-[#2b303b]">
              Job Title
            </label>
            <input
              id="title"
              name="title"
              type="text"
              required
              defaultValue={position?.title ?? ""}
              className="w-full rounded-lg border border-[#e7e9ee] px-3.5 py-2.5 text-sm text-[#2b303b] outline-none focus:border-[#f7941e]/60"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="department" className="mb-1.5 block text-sm font-medium text-[#2b303b]">
                Department
              </label>
              <input
                id="department"
                name="department"
                type="text"
                required
                defaultValue={position?.department ?? ""}
                className="w-full rounded-lg border border-[#e7e9ee] px-3.5 py-2.5 text-sm text-[#2b303b] outline-none focus:border-[#f7941e]/60"
              />
            </div>
            <div>
              <label htmlFor="employmentType" className="mb-1.5 block text-sm font-medium text-[#2b303b]">
                Type
              </label>
              <input
                id="employmentType"
                name="employmentType"
                type="text"
                defaultValue={position?.employment_type ?? "Full-time"}
                className="w-full rounded-lg border border-[#e7e9ee] px-3.5 py-2.5 text-sm text-[#2b303b] outline-none focus:border-[#f7941e]/60"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="location" className="mb-1.5 block text-sm font-medium text-[#2b303b]">
                Location
              </label>
              <input
                id="location"
                name="location"
                type="text"
                defaultValue={position?.location ?? "Remote / India"}
                className="w-full rounded-lg border border-[#e7e9ee] px-3.5 py-2.5 text-sm text-[#2b303b] outline-none focus:border-[#f7941e]/60"
              />
            </div>
            <div>
              <label htmlFor="totalOpenings" className="mb-1.5 block text-sm font-medium text-[#2b303b]">
                Total Openings
              </label>
              <input
                id="totalOpenings"
                name="totalOpenings"
                type="number"
                min="1"
                required
                defaultValue={position?.total_openings ?? 1}
                className="w-full rounded-lg border border-[#e7e9ee] px-3.5 py-2.5 text-sm text-[#2b303b] outline-none focus:border-[#f7941e]/60"
              />
            </div>
          </div>

          <div>
            <label htmlFor="description" className="mb-1.5 block text-sm font-medium text-[#2b303b]">
              Description
            </label>
            <textarea
              id="description"
              name="description"
              rows={4}
              defaultValue={position?.description ?? ""}
              className="w-full resize-none rounded-lg border border-[#e7e9ee] px-3.5 py-2.5 text-sm text-[#2b303b] outline-none focus:border-[#f7941e]/60"
            />
          </div>

          {state.status === "error" && (
            <p className="text-sm font-medium text-red-600">{state.message}</p>
          )}

          <div className="mt-1 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-semibold text-[#676b7a] hover:bg-[#f5f6f8]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="rounded-lg bg-[#f7941e] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-[#db7d17] disabled:opacity-60"
            >
              {isPending ? "Saving..." : isEditing ? "Save Changes" : "Create Position"}
            </button>
          </div>
        </form>
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

export default function CareersManager({ initialPositions }) {
  const [positions, setPositions] = useState(initialPositions);
  const [formOpen, setFormOpen] = useState(false);
  const [editingPosition, setEditingPosition] = useState(null);
  const [isPending, startTransition] = useTransition();

  function openCreateForm() {
    setEditingPosition(null);
    setFormOpen(true);
  }

  function openEditForm(position) {
    setEditingPosition(position);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingPosition(null);
    window.location.reload();
  }

  function handleToggleStatus(position) {
    startTransition(async () => {
      await toggleJobStatus(position.id, position.status);
      setPositions((prev) =>
        prev.map((p) =>
          p.id === position.id
            ? { ...p, status: p.status === "open" ? "closed" : "open" }
            : p
        )
      );
    });
  }

  function handleDelete(position) {
    if (!window.confirm(`Delete "${position.title}"? This cannot be undone.`)) return;
    startTransition(async () => {
      await deleteJobPosting(position.id);
      setPositions((prev) => prev.filter((p) => p.id !== position.id));
    });
  }

  const totalPositions = positions.length;
  const openCount = positions.filter((p) => p.status === "open").length;
  const closedCount = totalPositions - openCount;
  const totalOpenings = positions.reduce((sum, p) => sum + p.total_openings, 0);
  const totalFilled = positions.reduce((sum, p) => sum + p.selected, 0);
  const totalApplicants = positions.reduce((sum, p) => sum + p.applicants, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#2b303b]">Careers</h1>
          <p className="mt-1 text-sm text-[#676b7a]">
            {totalApplicants} total applicant{totalApplicants === 1 ? "" : "s"} across{" "}
            {totalPositions} position{totalPositions === 1 ? "" : "s"}.
          </p>
        </div>

        <button
          type="button"
          onClick={openCreateForm}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[#f7941e] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#db7d17]"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          New Position
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard icon={Briefcase} label="Total Positions" value={totalPositions} accent="#1f4693" />
        <StatCard icon={CheckCircle2} label="Open" value={openCount} accent="#3b6d11" />
        <StatCard icon={XCircle} label="Closed" value={closedCount} accent="#676b7a" />
        <StatCard icon={Users} label="Total Openings" value={totalOpenings} accent="#f7941e" />
        <StatCard icon={CheckCircle2} label="Filled" value={totalFilled} accent="#5b7fd4" />
      </div>

      {positions.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#e7e9ee] bg-white p-10 text-center">
          <p className="text-sm text-[#676b7a]">
            No positions yet. Create your first job posting to get started.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {positions.map((position) => (
            <div
              key={position.id}
              className={`group relative flex flex-col overflow-hidden rounded-2xl border shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-transparent hover:shadow-lg hover:shadow-[#f7941e]/10 ${
                position.status === "open"
                  ? "border-[#f7941e]/15 bg-gradient-to-br from-[#f7941e]/[0.06] via-white to-[#1f4693]/[0.05]"
                  : "border-[#e7e9ee] bg-gradient-to-br from-[#676b7a]/[0.05] via-white to-white"
              }`}
            >
              <span
                aria-hidden="true"
                className="absolute inset-x-0 top-0 h-[3px] origin-left scale-x-0 bg-gradient-to-r from-[#f7941e] to-[#1f4693] transition-transform duration-300 group-hover:scale-x-100"
              />

              <Link href={`/admin/careers/${position.id}`} className="flex-1 p-5">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-base font-semibold leading-snug text-[#2b303b] group-hover:text-[#f7941e]">
                    {position.title}
                  </h3>
                  <span
                    className={`inline-flex shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[position.status]}`}
                  >
                    {position.status === "open" ? "Open" : "Closed"}
                  </span>
                </div>

                <p className="mt-1.5 text-sm font-medium text-[#f7941e]">{position.department}</p>

                <div className="mt-3 flex flex-col gap-1.5 text-sm text-[#676b7a]">
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    {position.location} · {position.employment_type}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    {position.selected}/{position.total_openings} filled · {position.remaining}{" "}
                    remaining
                  </span>
                </div>

                <p className="mt-3 text-xs font-medium text-[#676b7a]">
                  {position.applicants} applicant{position.applicants === 1 ? "" : "s"}
                </p>
              </Link>

              <div className="flex items-center gap-1.5 border-t border-[#e7e9ee] px-5 py-3">
                <button
                  type="button"
                  onClick={() => handleToggleStatus(position)}
                  disabled={isPending}
                  title="Manually toggle open/closed (auto-managed by selections)"
                  className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-[#676b7a] transition-colors hover:bg-[#f5f6f8] disabled:opacity-50"
                >
                  Toggle
                </button>
                <button
                  type="button"
                  onClick={() => openEditForm(position)}
                  aria-label={`Edit ${position.title}`}
                  className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-[#676b7a] transition-colors hover:bg-[#f7941e]/10 hover:text-[#f7941e]"
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(position)}
                  disabled={isPending}
                  aria-label={`Delete ${position.title}`}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-[#676b7a] transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {formOpen && <PositionForm position={editingPosition} onClose={closeForm} />}
    </div>
  );
}
