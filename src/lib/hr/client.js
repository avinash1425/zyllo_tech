// HRMS data layer: thin wrappers over supabase-js. Row Level Security and the
// SECURITY DEFINER RPCs on the server are the real enforcement; nothing here
// grants access. Every call resolves to { data, error } with a human message.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/hr/platform/supabase";

export { supabase };

/** Normalise PostgREST / RPC / network errors into a short user-facing message. */
export function errorMessage(error, fallback = "Something went wrong. Please try again.") {
  if (!error) return null;
  if (typeof error === "string") return error;
  const msg = error.message || error.error_description || error.error || "";
  if (/permission denied|row-level security|not allowed/i.test(msg) && !/^[A-Z]/.test(msg.trim())) {
    return "You do not have permission to do that.";
  }
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return "Network error: could not reach the server.";
  if (/duplicate key value/i.test(msg)) return "That record already exists (duplicate value).";
  if (/violates check constraint/i.test(msg)) return "One of the values is not valid.";
  if (/violates foreign key/i.test(msg)) return "This record is linked to other data and cannot be changed that way.";
  return msg.trim() || fallback;
}

/** Call an RPC. Returns { data, error } where error is a message string or null. */
export async function rpc(name, params = {}) {
  try {
    const { data, error } = await supabase.rpc(name, params);
    return { data: error ? null : data, error: errorMessage(error) };
  } catch (e) {
    return { data: null, error: errorMessage(e) };
  }
}

/** Run a supabase-js query builder (from(...).select(...)...). */
export async function run(query) {
  try {
    const { data, error, count } = await query;
    return { data: error ? null : data, error: errorMessage(error), count: count ?? null };
  } catch (e) {
    return { data: null, error: errorMessage(e), count: null };
  }
}

export const from = (table) => supabase.from(table);

/** Invoke an Edge Function; success only when the function returned 2xx. */
export async function invokeFunction(name, body) {
  try {
    const { data, error } = await supabase.functions.invoke(name, { body });
    if (error) {
      let message = error.message;
      try { const ctx = await error.context?.json?.(); if (ctx?.error) message = ctx.error; } catch { /* not json */ }
      return { data: null, error: errorMessage(message) };
    }
    return { data, error: null };
  } catch (e) {
    return { data: null, error: errorMessage(e) };
  }
}

/**
 * Load data with explicit loading / error states.
 * `loader` returns { data, error, count? }. Returns { data, error, loading, count, reload, setData }.
 */
export function useHrQuery(loader, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true, count: null });
  const seq = useRef(0);
  const load = useCallback(async () => {
    const mine = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    const res = await loader();
    if (mine !== seq.current) return;           // a newer request superseded this one
    setState({ data: res.data ?? null, error: res.error ?? null, loading: false, count: res.count ?? null });
  }, deps);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load, setData: (d) => setState((s) => ({ ...s, data: typeof d === "function" ? d(s.data) : d })) };
}

/** Escape a value for CSV (RFC 4180) and neutralise spreadsheet formula injection. */
function csvCell(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";   // numbers (incl. negative) stay numeric
  let s = typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;   // formula guard; plain numeric text exempt
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Download rows as CSV. columns: [{ key, label, value?(row) }]. */
export function exportCsv(filename, rows, columns) {
  const header = columns.map((c) => csvCell(c.label)).join(",");
  const body = rows.map((r) => columns.map((c) => csvCell(c.value ? c.value(r) : r[c.key])).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + header + "\r\n" + body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Parse CSV text (RFC 4180 subset) into array of objects keyed by header. */
export function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}

export const fullName = (e) => (e ? (e.display_name || `${e.first_name ?? ""} ${e.last_name ?? ""}`).trim() : "");

export function formatDate(value, opts = { day: "2-digit", month: "short", year: "numeric" }) {
  if (!value) return "—";
  const d = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-IN", opts);
}

export function formatDateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
}

export function formatMoney(value, currency = "INR") {
  if (value === null || value === undefined || value === "") return "—";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(value));
}

export function minutesToHm(min) {
  if (min === null || min === undefined) return "—";
  const m = Math.max(0, Math.round(Number(min)));
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}
