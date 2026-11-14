// LOCAL TEST HARNESS ONLY — a PostgREST-compatible SQL generator (subset).
// Copied unchanged in logic from scripts/hrms-local/postgrest.mjs (HRMS branch).
//
// Turns supabase-js / PostgREST request grammar into ONE SQL statement that
// returns a single jsonb value { rows, count }. Every identifier is validated
// against the catalog of the `public` schema and quoted; every value is passed
// as an escaped SQL literal (lib.mjs `lit`). Nothing user-supplied is ever
// concatenated unescaped.
import { ident, lit } from "./lib.mjs";

export class ApiError extends Error {
  constructor(status, code, message, details = null, hint = null) {
    super(message);
    this.status = status;
    this.body = { code, message, details, hint };
  }
}
const bad = (code, message, details = null, hint = null, status = 400) => new ApiError(status, code, message, details, hint);

// ------------------------------------------------------------------ catalog
export const CATALOG_SQL = `
with ext as (select objid from pg_depend where deptype = 'e')
select jsonb_build_object(
 'relations', (select jsonb_agg(jsonb_build_object('name', c.relname, 'kind', c.relkind,
     'columns', (select jsonb_agg(jsonb_build_object('name', a.attname, 'type', format_type(a.atttypid, a.atttypmod),
                   'generated', (a.attgenerated <> '' or a.attidentity = 'a')) order by a.attnum)
                 from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped),
     'pk', (select jsonb_agg(a.attname order by array_position(i.conkey, a.attnum)) from pg_constraint i
            join pg_attribute a on a.attrelid = i.conrelid and a.attnum = any(i.conkey) where i.conrelid = c.oid and i.contype = 'p'),
     'uniques', (select jsonb_agg((select jsonb_agg(a.attname) from pg_attribute a where a.attrelid = i.conrelid and a.attnum = any(i.conkey)))
                 from pg_constraint i where i.conrelid = c.oid and i.contype in ('p','u'))))
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r','v','m','p','f') and c.oid not in (select objid from ext)),
 'fks', (select jsonb_agg(jsonb_build_object('name', k.conname, 'from', cf.relname, 'to', ct.relname,
     'fromCols', (select jsonb_agg(a.attname order by x.ord) from unnest(k.conkey) with ordinality x(att, ord)
                  join pg_attribute a on a.attrelid = k.conrelid and a.attnum = x.att),
     'toCols', (select jsonb_agg(a.attname order by x.ord) from unnest(k.confkey) with ordinality x(att, ord)
                  join pg_attribute a on a.attrelid = k.confrelid and a.attnum = x.att)))
   from pg_constraint k
   join pg_class cf on cf.oid = k.conrelid join pg_namespace nf on nf.oid = cf.relnamespace
   join pg_class ct on ct.oid = k.confrelid join pg_namespace nt on nt.oid = ct.relnamespace
   where k.contype = 'f' and nf.nspname = 'public' and nt.nspname = 'public'),
 'functions', (select jsonb_agg(jsonb_build_object('name', p.proname,
     'args', coalesce((select jsonb_agg(jsonb_build_object('name', coalesce(p.proargnames[x.ord], ''), 'type', format_type(x.t, null),
                        'mode', coalesce(p.proargmodes[x.ord]::text, 'i')) order by x.ord)
                      from unnest(coalesce(p.proallargtypes, p.proargtypes::oid[])) with ordinality x(t, ord)), '[]'::jsonb),
     'nargs', p.pronargs, 'ndefaults', p.pronargdefaults, 'retset', p.proretset,
     'rettype', format_type(p.prorettype, null), 'rettyptype', t.typtype::text,
     'retcols', case when t.typrelid <> 0 then (select jsonb_agg(a.attname order by a.attnum) from pg_attribute a
                                                 where a.attrelid = t.typrelid and a.attnum > 0 and not a.attisdropped) end,
     'volatile', p.provolatile::text))
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_type t on t.oid = p.prorettype
   where n.nspname = 'public' and p.prokind = 'f' and p.oid not in (select objid from ext)
     and p.prorettype <> 'trigger'::regtype)
);`;

export function buildCatalog(raw) {
  const relations = new Map();
  for (const r of raw.relations ?? []) {
    relations.set(r.name, {
      name: r.name, kind: r.kind,
      columns: new Map((r.columns ?? []).map((c) => [c.name, c])),
      pk: r.pk ?? [],
      uniques: (r.uniques ?? []).filter(Boolean),
    });
  }
  const fks = raw.fks ?? [];
  const functions = new Map();
  for (const f of raw.functions ?? []) {
    if (!functions.has(f.name)) functions.set(f.name, []);
    functions.get(f.name).push(f);
  }
  return { relations, fks, functions };
}

// ------------------------------------------------------------------ helpers
const TYPE_RE = /^[A-Za-z_][A-Za-z0-9_ ]*(\[\])?$/;

function splitTopLevel(s, sep = ",") {
  const out = [];
  let depth = 0, quoted = false, cur = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      cur += ch;
      if (ch === "\\" && i + 1 < s.length) { cur += s[++i]; continue; }
      if (ch === '"') quoted = false;
      continue;
    }
    if (ch === '"') { quoted = true; cur += ch; continue; }
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (depth < 0) throw bad("PGRST100", `"failed to parse" (unbalanced parentheses in ${s})`);
    if (ch === sep && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (depth !== 0 || quoted) throw bad("PGRST100", `failed to parse: unbalanced parentheses or quotes in "${s}"`);
  out.push(cur);
  return out;
}

const unquote = (s) => (s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1).replace(/\\(.)/g, "$1") : s);

/** Parses a column reference with an optional JSON path: col, col->a->>b */
function parseColRef(raw) {
  const m = raw.match(/^([^-]+?)((?:->>?[^-]+?)*)$/);
  if (!m) throw bad("PGRST100", `failed to parse column "${raw}"`);
  const name = unquote(m[1]);
  const path = [];
  const re = /(->>?)([^-]+)/g;
  let p;
  while ((p = re.exec(m[2] || ""))) path.push({ op: p[1], key: unquote(p[2]) });
  return { name, path };
}

export class QueryBuilder {
  constructor(catalog) {
    this.cat = catalog;
    this.aliasN = 0;
  }
  nextAlias() { return `t${this.aliasN++}`; }

  relation(name) {
    const rel = this.cat.relations.get(name);
    if (!rel) throw bad("PGRST205", `Could not find the table 'public.${name}' in the schema cache`, null, null, 404);
    return rel;
  }

  colSql(node, ref, { allowPath = true } = {}) {
    const { name, path } = typeof ref === "string" ? parseColRef(ref) : ref;
    if (!node.columns.has(name)) {
      throw bad("42703", `column ${node.relName}.${name} does not exist`);
    }
    let sql = `${node.alias}.${ident(name)}`;
    if (path.length && !allowPath) throw bad("PGRST100", "JSON paths are not supported here");
    for (const seg of path) sql += `${seg.op}${/^-?\d+$/.test(seg.key) ? seg.key : lit(seg.key)}`;
    return sql;
  }

  // -------------------------------------------------------------- select tree
  /** node: { relName, columns:Map, alias, items, children:Map(key->child), filters:[], order, limit, offset } */
  makeNode(relName, columnsMap, alias) {
    return { relName, columns: columnsMap, alias, items: [], embeds: [], conds: [], orFilters: [], order: null, limit: null, offset: null };
  }

  parseSelect(node, selectStr) {
    const s = selectStr && selectStr.length ? selectStr : "*";
    for (const rawItem of splitTopLevel(s)) {
      const item = rawItem.trim();
      if (!item) continue;
      if (item.startsWith("...")) throw bad("PGRST100", "Spread embeds (...) are not supported by the local harness");
      const paren = item.indexOf("(");
      if (paren > 0 && item.endsWith(")")) {
        const head = item.slice(0, paren);
        const inner = item.slice(paren + 1, -1);
        const hm = head.match(/^(?:([A-Za-z_][A-Za-z0-9_]*):)?([A-Za-z_][A-Za-z0-9_]*)((?:![A-Za-z_][A-Za-z0-9_]*)*)$/);
        if (!hm) throw bad("PGRST100", `failed to parse select parameter (${item})`);
        const [, as, name, bangs] = hm;
        const marks = bangs ? bangs.split("!").filter(Boolean) : [];
        const inner_ = marks.includes("inner");
        const left = marks.includes("left");
        const hint = marks.find((m) => m !== "inner" && m !== "left") ?? null;
        void left;
        node.embeds.push({ as: as || name, name, hint, inner: inner_, select: inner });
        continue;
      }
      if (item === "*") { node.items.push({ type: "star" }); continue; }
      const m = item.match(/^(?:([A-Za-z_][A-Za-z0-9_]*):(?!:))?(.+?)(?:::([A-Za-z_][A-Za-z0-9_ ]*(?:\[\])?))?$/);
      if (!m) throw bad("PGRST100", `failed to parse select parameter (${item})`);
      const [, as, colRaw, cast] = m;
      if (/\(\)$/.test(colRaw)) throw bad("PGRST100", `Aggregate functions are not supported by the local harness (${item})`);
      const ref = parseColRef(colRaw);
      if (!node.columns.has(ref.name)) throw bad("42703", `column ${node.relName}.${ref.name} does not exist`);
      if (cast && !TYPE_RE.test(cast)) throw bad("PGRST100", `invalid cast ${cast}`);
      const key = as || (ref.path.length ? ref.path[ref.path.length - 1].key : ref.name);
      node.items.push({ type: "col", ref, as: key, cast });
    }
    // resolve embeds
    for (const e of node.embeds) {
      const rel = this.resolveRelationship(node.relName, e.name, e.hint);
      const childRel = this.relation(rel.target);
      e.rel = rel;
      e.node = this.makeNode(childRel.name, childRel.columns, this.nextAlias());
      this.parseSelect(e.node, e.select);
    }
  }

  resolveRelationship(parent, name, hint) {
    const cands = [];
    const isTable = this.cat.relations.has(name);
    const unique = (relName, cols) => {
      const r = this.cat.relations.get(relName);
      return (r?.uniques ?? []).some((u) => u.length === cols.length && u.every((c) => cols.includes(c)));
    };
    for (const fk of this.cat.fks) {
      if (isTable) {
        if (fk.from === parent && fk.to === name) cands.push({ kind: "m2o", fk, target: name });
        if (fk.to === parent && fk.from === name) cands.push({ kind: unique(fk.from, fk.fromCols) ? "o2o" : "o2m", fk, target: name });
      } else {
        // alias:fk_column(...) or alias:constraint_name(...)
        if (fk.from === parent && ((fk.fromCols.length === 1 && fk.fromCols[0] === name) || fk.name === name)) cands.push({ kind: "m2o", fk, target: fk.to });
        else if (fk.to === parent && fk.name === name) cands.push({ kind: unique(fk.from, fk.fromCols) ? "o2o" : "o2m", fk, target: fk.from });
      }
    }
    let list = cands;
    if (hint) {
      // hint = constraint name, or the (single) foreign-key column
      list = cands.filter((c) => c.fk.name === hint || (c.fk.fromCols.length === 1 && c.fk.fromCols[0] === hint));
    }
    // Self-referencing FK: one constraint matches both directions; resolve to
    // many-to-one (the referencing side), as PostgREST does for `!fk` hints.
    if (list.length === 2 && list[0].fk === list[1].fk && parent === name) {
      list = list.filter((c) => c.kind === "m2o");
    }
    if (!list.length) {
      throw bad("PGRST200", `Could not find a relationship between '${parent}' and '${name}' in the schema cache`,
        `Searched for a foreign key relationship between '${parent}' and '${name}'${hint ? ` using the hint '${hint}'` : ""} in the schema 'public', but no matches were found.`,
        null, 400);
    }
    if (list.length > 1) {
      throw bad("PGRST201", `Could not embed because more than one relationship was found for '${parent}' and '${name}'`,
        list.map((c) => ({ cardinality: c.kind === "m2o" ? "many-to-one" : c.kind === "o2o" ? "one-to-one" : "one-to-many", relationship: `${c.fk.name} using ${c.fk.from}(${c.fk.fromCols.join(", ")}) and ${c.fk.to}(${c.fk.toCols.join(", ")})`, embedding: `${parent} with ${name}` })),
        `Try changing '${name}' to one of the following: ${list.map((c) => `'${name}!${c.fk.name}'`).join(", ")}. Find the desired relationship in the 'details' key.`,
        300);
    }
    return list[0];
  }

  // -------------------------------------------------------------- filters
  /** Attach query-string filters / order / limit to the right node. */
  applyParams(root, entries, reserved = new Set()) {
    for (const [key, value] of entries) {
      if (reserved.has(key)) continue;
      const parts = key.split(".");
      let node = root;
      // walk embed path; last part is a column or a directive
      let i = 0;
      while (i < parts.length - 1) {
        const seg = parts[i];
        if ((seg === "not") && (parts[i + 1] === "or" || parts[i + 1] === "and")) break;
        const emb = node.embeds.find((e) => e.as === seg) ?? node.embeds.find((e) => e.name === seg);
        if (!emb) break;
        node = emb.node;
        i++;
      }
      const rest = parts.slice(i).join(".");
      if (rest === "order") { node.order = this.parseOrder(node, value); continue; }
      if (rest === "limit") { node.limit = this.parseInt(value, "limit"); continue; }
      if (rest === "offset") { node.offset = this.parseInt(value, "offset"); continue; }
      if (rest === "or" || rest === "and" || rest === "not.or" || rest === "not.and") {
        const neg = rest.startsWith("not.");
        const op = neg ? rest.slice(4) : rest;
        const inner = value.trim();
        if (!inner.startsWith("(") || !inner.endsWith(")")) throw bad("PGRST100", `failed to parse logic tree (${value})`);
        const sql = this.logicTree(node, op, inner.slice(1, -1));
        node.conds.push(neg ? `not (${sql})` : sql);
        continue;
      }
      node.conds.push(this.filterExpr(node, rest, value));
    }
  }

  parseInt(v, what) {
    if (!/^\d+$/.test(String(v))) throw bad("PGRST100", `"${what}" must be a non-negative integer`);
    return Number(v);
  }

  parseOrder(node, value) {
    return splitTopLevel(value).map((term) => {
      const segs = term.trim().split(".");
      let col = segs.shift();
      let dir = "asc", nulls = null;
      for (const s of segs) {
        if (s === "asc" || s === "desc") dir = s;
        else if (s === "nullsfirst") nulls = "nulls first";
        else if (s === "nullslast") nulls = "nulls last";
        else throw bad("PGRST100", `failed to parse order (${value})`);
      }
      if (/\(/.test(col)) throw bad("PGRST100", "Ordering by embedded resources is not supported by the local harness");
      return `${this.colSql(node, col)} ${dir}${nulls ? " " + nulls : ""}`;
    }).join(", ");
  }

  logicTree(node, op, body) {
    const parts = splitTopLevel(body).map((p) => p.trim()).filter(Boolean).map((cond) => {
      const lm = cond.match(/^(not\.)?(or|and)\((.*)\)$/s);
      if (lm) {
        const sql = this.logicTree(node, lm[2], lm[3]);
        return lm[1] ? `not (${sql})` : sql;
      }
      const dot = cond.indexOf(".");
      if (dot <= 0) throw bad("PGRST100", `failed to parse logic tree (${cond})`);
      return this.filterExpr(node, cond.slice(0, dot), cond.slice(dot + 1), { inLogic: true });
    });
    if (!parts.length) throw bad("PGRST100", "empty logic tree");
    return "(" + parts.join(op === "or" ? " or " : " and ") + ")";
  }

  filterExpr(node, colRaw, value, { inLogic = false } = {}) {
    let v = String(value);
    let neg = false;
    if (v.startsWith("not.")) { neg = true; v = v.slice(4); }
    const m = v.match(/^([a-z]+)(?:\((any|all)\))?\.(.*)$/s);
    if (!m) throw bad("PGRST100", `"failed to parse filter (${value})" (line 1, column 1)`);
    const [, op, quant, rawVal] = m;
    const col = this.colSql(node, colRaw);
    const val = inLogic ? unquote(rawVal) : rawVal;
    let sql;
    const cmp = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=", like: "like", ilike: "ilike", match: "~", imatch: "~*" };
    if (cmp[op]) {
      if (quant) {
        const list = parseList(val, "{", "}").map((x) => (op === "like" || op === "ilike" ? x.replace(/\*/g, "%") : x));
        sql = `${col} ${cmp[op]} ${quant} (${lit(toPgArray(list))})`;
      } else {
        const lv = op === "like" || op === "ilike" ? val.replace(/\*/g, "%") : val;
        sql = `${col} ${cmp[op]} ${lit(lv)}`;
      }
    } else if (op === "is") {
      const map = { null: "is null", not_null: "is not null", true: "is true", false: "is false", unknown: "is unknown" };
      const k = val.toLowerCase();
      if (!(k in map)) throw bad("PGRST100", `"failed to parse filter (is.${val})"`);
      sql = `${col} ${map[k]}`;
    } else if (op === "isdistinct") {
      sql = `${col} is distinct from ${lit(val)}`;
    } else if (op === "in") {
      const list = parseList(val, "(", ")");
      sql = list.length ? `${col} in (${list.map((x) => (x === null ? "NULL" : lit(x))).join(", ")})` : "false";
    } else if (op === "cs" || op === "cd" || op === "ov") {
      sql = `${col} ${{ cs: "@>", cd: "<@", ov: "&&" }[op]} ${lit(val)}`;
    } else if (["sl", "sr", "nxl", "nxr", "adj"].includes(op)) {
      sql = `${col} ${{ sl: "<<", sr: ">>", nxl: "&<", nxr: "&>", adj: "-|-" }[op]} ${lit(val)}`;
    } else if (["fts", "plfts", "phfts", "wfts"].includes(op)) {
      const fn = { fts: "to_tsquery", plfts: "plainto_tsquery", phfts: "phraseto_tsquery", wfts: "websearch_to_tsquery" }[op];
      const cm = colRaw; void cm;
      sql = `${col} @@ ${fn}(${lit(val)})`;
    } else {
      throw bad("PGRST100", `"failed to parse filter (${value})" unknown operator ${op}`);
    }
    return neg ? `not (${sql})` : sql;
  }

  // -------------------------------------------------------------- SQL output
  rowExpr(node) {
    const parts = [];
    let pairs = [];
    const flush = () => { if (pairs.length) { parts.push(`jsonb_build_object(${pairs.join(", ")})`); pairs = []; } };
    for (const it of node.items) {
      if (it.type === "star") { flush(); parts.push(`to_jsonb(${node.alias})`); continue; }
      let expr = this.colSql(node, it.ref);
      if (it.cast) expr = `(${expr})::${it.cast}`;
      pairs.push(`${lit(it.as)}, ${expr}`);
      if (pairs.length >= 45) flush();
    }
    for (const e of node.embeds) {
      pairs.push(`${lit(e.as)}, ${this.embedExpr(node, e)}`);
      if (pairs.length >= 45) flush();
    }
    flush();
    if (!parts.length) return "'{}'::jsonb";
    return parts.length === 1 ? parts[0] : "(" + parts.join(" || ") + ")";
  }

  joinCond(parent, e) {
    const c = e.node.alias, p = parent.alias, fk = e.rel.fk;
    if (e.rel.kind === "m2o") return fk.fromCols.map((fc, i) => `${c}.${ident(fk.toCols[i])} = ${p}.${ident(fc)}`).join(" and ");
    return fk.fromCols.map((fc, i) => `${c}.${ident(fc)} = ${p}.${ident(fk.toCols[i])}`).join(" and ");
  }

  embedExpr(parent, e) {
    const n = e.node;
    const where = [this.joinCond(parent, e), ...n.conds].join(" and ");
    const from = `public.${ident(n.relName)} ${n.alias}`;
    if (e.rel.kind === "m2o" || e.rel.kind === "o2o") {
      return `(select ${this.rowExpr(n)} from ${from} where ${where} limit 1)`;
    }
    const order = n.order ? ` order by ${n.order}` : "";
    const lim = n.limit != null ? ` limit ${n.limit}` : "";
    const off = n.offset != null ? ` offset ${n.offset}` : "";
    return `coalesce((select jsonb_agg(${this.rowExpr(n)}${order}) from (select ${n.alias}.* from ${from} where ${where}${order}${lim}${off}) ${n.alias}), '[]'::jsonb)`;
  }

  innerConds(node) {
    // `!inner` embeds filter the parent rows
    return node.embeds.filter((e) => e.inner).map((e) => {
      const n = e.node;
      const where = [this.joinCond(node, e), ...n.conds, ...this.innerConds(n)].join(" and ");
      return `exists (select 1 from public.${ident(n.relName)} ${n.alias} where ${where})`;
    });
  }

  /** GET/HEAD on a table or view. */
  read({ table, params, count, rangeHeader }) {
    const rel = this.relation(table);
    const root = this.makeNode(rel.name, rel.columns, this.nextAlias());
    this.parseSelect(root, params.get("select"));
    this.applyParams(root, [...params.entries()], new Set(["select", "columns", "on_conflict"]));
    applyRange(root, rangeHeader);
    const where = [...root.conds, ...this.innerConds(root)];
    const w = where.length ? ` where ${where.join(" and ")}` : "";
    const order = root.order ? ` order by ${root.order}` : "";
    const lim = root.limit != null ? ` limit ${root.limit}` : "";
    const off = root.offset != null ? ` offset ${root.offset}` : "";
    const base = `public.${ident(rel.name)} ${root.alias}`;
    const rows = `coalesce((select jsonb_agg(${this.rowExpr(root)}${order}) from (select ${root.alias}.* from ${base}${w}${order}${lim}${off}) ${root.alias}), '[]'::jsonb)`;
    const cnt = count ? `(select count(*) from ${base}${w})` : "null";
    return { sql: `select jsonb_build_object('rows', ${rows}, 'count', ${cnt})`, offset: root.offset ?? 0 };
  }

  /** POST insert / upsert. */
  insert({ table, params, body, prefer }) {
    const rel = this.relation(table);
    const rows = Array.isArray(body) ? body : [body];
    if (!rows.every((r) => r && typeof r === "object" && !Array.isArray(r))) throw bad("PGRST102", "All object keys must match");
    let cols;
    if (params.get("columns")) cols = params.get("columns").split(",").map((c) => unquote(c.trim()));
    else cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    for (const c of cols) if (!rel.columns.has(c)) throw bad("PGRST204", `Could not find the '${c}' column of '${table}' in the schema cache`);
    const root = this.makeNode(rel.name, rel.columns, "t0");
    this.aliasN = 1;
    const wantRows = prefer.return === "representation";
    if (wantRows) this.parseSelect(root, params.get("select"));
    const colList = cols.map(ident).join(", ");
    let sql;
    if (!cols.length) {
      sql = `insert into public.${ident(rel.name)} as t0 default values`;
    } else {
      sql = `insert into public.${ident(rel.name)} as t0 (${colList}) select ${colList} from jsonb_populate_recordset(null::public.${ident(rel.name)}, ${lit(JSON.stringify(rows))}::jsonb)`;
    }
    if (prefer.resolution) {
      const oc = params.get("on_conflict") ? params.get("on_conflict").split(",").map((c) => c.trim()) : rel.pk;
      if (!oc.length) throw bad("PGRST100", "on_conflict is required for a table without a primary key");
      for (const c of oc) if (!rel.columns.has(c)) throw bad("42703", `column ${table}.${c} does not exist`);
      if (prefer.resolution === "ignore-duplicates") sql += ` on conflict (${oc.map(ident).join(", ")}) do nothing`;
      else {
        const upd = cols.filter((c) => !oc.includes(c));
        sql += upd.length
          ? ` on conflict (${oc.map(ident).join(", ")}) do update set ${upd.map((c) => `${ident(c)} = excluded.${ident(c)}`).join(", ")}`
          : ` on conflict (${oc.map(ident).join(", ")}) do nothing`;
      }
    }
    return this.mutationResult(root, sql, wantRows, prefer);
  }

  update({ table, params, body, prefer }) {
    const rel = this.relation(table);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw bad("PGRST102", "Empty or invalid json");
    const cols = Object.keys(body);
    for (const c of cols) if (!rel.columns.has(c)) throw bad("PGRST204", `Could not find the '${c}' column of '${table}' in the schema cache`);
    if (!cols.length) throw bad("PGRST102", "Empty or invalid json");
    const root = this.makeNode(rel.name, rel.columns, "t0");
    this.aliasN = 1;
    const wantRows = prefer.return === "representation";
    if (wantRows) this.parseSelect(root, params.get("select"));
    this.applyParams(root, [...params.entries()], new Set(["select", "columns", "on_conflict", "order", "limit", "offset"]));
    const w = root.conds.length ? ` where ${root.conds.join(" and ")}` : "";
    const sql = `update public.${ident(rel.name)} t0 set ${cols.map((c) => `${ident(c)} = _b.${ident(c)}`).join(", ")} from jsonb_populate_record(null::public.${ident(rel.name)}, ${lit(JSON.stringify(body))}::jsonb) _b${w}`;
    return this.mutationResult(root, sql, wantRows, prefer);
  }

  remove({ table, params, prefer }) {
    const rel = this.relation(table);
    const root = this.makeNode(rel.name, rel.columns, "t0");
    this.aliasN = 1;
    const wantRows = prefer.return === "representation";
    if (wantRows) this.parseSelect(root, params.get("select"));
    this.applyParams(root, [...params.entries()], new Set(["select", "columns", "on_conflict", "order", "limit", "offset"]));
    const w = root.conds.length ? ` where ${root.conds.join(" and ")}` : "";
    return this.mutationResult(root, `delete from public.${ident(rel.name)} t0${w}`, wantRows, prefer);
  }

  mutationResult(root, sql, wantRows, prefer) {
    if (!wantRows) {
      // No RETURNING: like PostgREST return=minimal, SELECT policies are not involved.
      if (prefer.count) {
        return { sql: `with m as (${sql} returning 1) select jsonb_build_object('rows', null, 'count', (select count(*) from m))` };
      }
      return { sql: `with m as (${sql}) select jsonb_build_object('rows', null, 'count', null)` };
    }
    const single = prefer.single ? `, 'single', pt_harness.require_single((select count(*) from m))` : "";
    return { sql: `with m as (${sql} returning t0.*) select jsonb_build_object('rows', coalesce((select jsonb_agg(${this.rowExpr(root)}) from m t0), '[]'::jsonb), 'count', (select count(*) from m)${single})` };
  }

  // -------------------------------------------------------------- RPC
  rpc({ fn, args, params, count, rangeHeader }) {
    const cands = this.cat.functions.get(fn);
    const keys = Object.keys(args);
    const notFound = () => bad("PGRST202", `Could not find the function public.${fn}(${keys.join(", ")}) in the schema cache`,
      `Searched for the function public.${fn} with parameter${keys.length === 1 ? "" : "s"} ${keys.join(", ") || "(none)"} or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache.`, null, 404);
    if (!cands) throw notFound();
    const fits = cands.filter((f) => {
      const inArgs = f.args.filter((a) => ["i", "b", "v"].includes(a.mode));
      const names = inArgs.map((a) => a.name);
      const required = inArgs.slice(0, inArgs.length - f.ndefaults).map((a) => a.name);
      return keys.every((k) => names.includes(k)) && required.every((r) => keys.includes(r));
    }).sort((a, b) => a.nargs - b.nargs);
    if (!fits.length) throw notFound();
    const f = fits[0];
    const inArgs = f.args.filter((a) => ["i", "b", "v"].includes(a.mode));
    const argSql = keys.map((k) => {
      const a = inArgs.find((x) => x.name === k);
      return `${ident(k)} => ${valueExpr(args[k], a.type)}`;
    }).join(", ");
    const call = `public.${ident(fn)}(${argSql})`;

    // The call sits directly in the select list so it is always evaluated.
    if (f.rettype === "void") return { sql: `select jsonb_build_object('rows', null::jsonb, 'count', null, 'void', (${call}) is null)`, kind: "void" };

    const outCols = f.args.filter((a) => a.mode === "t" || a.mode === "o").map((a) => a.name);
    const cols = outCols.length ? outCols : f.retcols;
    if (!f.retset) {
      if (cols && cols.length && f.rettyptype !== "b") {
        return { sql: `select jsonb_build_object('rows', (select to_jsonb(_r) from ${call} _r), 'count', null)`, kind: "single" };
      }
      return { sql: `select jsonb_build_object('rows', to_jsonb(${call}), 'count', null)`, kind: "scalar" };
    }
    if (!cols || !cols.length) {
      return { sql: `select jsonb_build_object('rows', coalesce((select jsonb_agg(to_jsonb(_r.v)) from ${call} as _r(v)), '[]'::jsonb), 'count', null)`, kind: "set" };
    }
    const colMap = new Map(cols.map((c) => [c, { name: c }]));
    const root = this.makeNode(fn, colMap, this.nextAlias());
    this.parseSelect(root, params.get("select"));
    if (root.embeds.length) throw bad("PGRST100", "Embedding on RPC results is not supported by the local harness");
    this.applyParams(root, [...params.entries()].filter(([k]) => !keys.includes(k)), new Set(["select"]));
    applyRange(root, rangeHeader);
    const w = root.conds.length ? ` where ${root.conds.join(" and ")}` : "";
    const order = root.order ? ` order by ${root.order}` : "";
    const lim = root.limit != null ? ` limit ${root.limit}` : "";
    const off = root.offset != null ? ` offset ${root.offset}` : "";
    const src = `${call} ${root.alias}`;
    const rows = `coalesce((select jsonb_agg(${this.rowExpr(root)}${order}) from (select ${root.alias}.* from ${src}${w}${order}${lim}${off}) ${root.alias}), '[]'::jsonb)`;
    const cnt = count ? `(select count(*) from ${src}${w})` : "null";
    return { sql: `select jsonb_build_object('rows', ${rows}, 'count', ${cnt})`, kind: "set", offset: root.offset ?? 0 };
  }

  functionArgNames(fn) {
    const cands = this.cat.functions.get(fn) ?? [];
    return new Set(cands.flatMap((f) => f.args.filter((a) => ["i", "b", "v"].includes(a.mode)).map((a) => a.name)));
  }
}

function applyRange(node, rangeHeader) {
  if (!rangeHeader) return;
  const m = String(rangeHeader).match(/^(?:items=)?(\d+)-(\d*)$/);
  if (!m) return;
  const from = Number(m[1]);
  if (node.offset == null) node.offset = from;
  if (m[2] !== "" && node.limit == null) node.limit = Math.max(0, Number(m[2]) - from + 1);
}

/** Parses "(a,b,"c,d")" / "{a,b}" lists used by in./any/all. */
function parseList(val, open, close) {
  const s = val.trim();
  if (!s.startsWith(open) || !s.endsWith(close)) throw bad("PGRST100", `failed to parse list ${val}`);
  const inner = s.slice(1, -1);
  if (!inner.trim()) return [];
  return splitTopLevel(inner).map((x) => {
    const t = x.trim();
    if (t.startsWith('"')) return unquote(t);
    if (t.toLowerCase() === "null") return null;
    return t;
  });
}

function toPgArray(list) {
  return "{" + list.map((x) => (x === null ? "NULL" : `"${String(x).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)).join(",") + "}";
}

/** SQL expression for an RPC argument, cast to the declared parameter type. */
export function valueExpr(v, type) {
  if (!TYPE_RE.test(type.replace(/\(.*\)/, "")) && !/^[A-Za-z_][\w .]*(\(\d+(,\d+)?\))?(\[\])?$/.test(type)) throw bad("PGRST100", `unsupported parameter type ${type}`);
  if (v === null || v === undefined) return `NULL::${type}`;
  if (type === "json" || type === "jsonb") return `${lit(JSON.stringify(v))}::${type}`;
  if (type.endsWith("[]") && Array.isArray(v)) {
    return `coalesce((select array_agg(_x) from jsonb_array_elements_text(${lit(JSON.stringify(v))}::jsonb) _x), '{}')::${type}`;
  }
  if (typeof v === "object") return `${lit(JSON.stringify(v))}::${type}`;
  return `${lit(String(v))}::${type}`;
}

/** HTTP status for a Postgres SQLSTATE, following PostgREST's mapping. */
export function pgStatus(code, role) {
  if (!code) return 500;
  if (code === "PGRST116") return 406;
  if (code === "42501") return role === "anon" ? 401 : 403;
  if (code === "23505" || code === "23503") return 409;
  if (code === "P0001") return 400;
  if (code === "42883" || code === "42P01") return 404;
  if (code === "25006") return 405;
  if (code === "57014") return 504;
  if (code === "40001" || code === "40P01") return 409;
  if (code === "53400") return 500;
  if (/^(08|09|0L|0P|25|28|2D|38|39|3B|40|53|54|55|57|58|F0|HV|P0|XX)/.test(code)) return code.startsWith("P0") ? 400 : 500;
  if (/^(2[0-9A-Z]|42|22|23)/.test(code)) return 400;
  return 400;
}
