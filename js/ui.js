// ---------------------------------------------------------------------------
// DOM helpers, formatting, modal dialogs and printing.
// Everything builds real elements (no innerHTML with user data) so owner names
// and notes can never inject markup.
// ---------------------------------------------------------------------------
import { t, getLang } from "./i18n.js";
import { currency } from "./state.js";

/** h("div.card", {onclick}, child, child…) — the workhorse element builder. */
export function h(spec, props, ...children) {
  const [tagPart, ...classes] = String(spec).split(".");
  const el = document.createElement(tagPart || "div");
  if (classes.length) el.className = classes.join(" ");
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = [el.className, v].filter(Boolean).join(" ");
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k in el && k !== "list") el[k] = v;
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false || c === true) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------
const locale = () => (getLang() === "bg" ? "bg-BG" : "en-GB");

export function money(value, cur = currency()) {
  const n = Number(value || 0);
  try {
    return new Intl.NumberFormat(locale(), {
      style: "currency", currency: cur, maximumFractionDigits: 2, minimumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${n.toFixed(2)} ${cur}`;
  }
}

export function num(value) {
  return Number(value || 0).toFixed(2);
}

export function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString(locale(), { year: "numeric", month: "2-digit", day: "2-digit" });
}

export function fmtMonth(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString(locale(), { year: "numeric", month: "long" });
}

/** Local calendar date as YYYY-MM-DD — never via toISOString(), which is UTC
 *  and would report "yesterday" for anyone east of Greenwich after midnight. */
export function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export const todayISO = () => isoDate(new Date());
export const monthISO = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
/** "2026-07" → "2026-07-01" */
export const monthStart = (ym) => `${ym}-01`;
/** "2026-07" → "2026-07-31" */
export function monthEnd(ym) {
  const [y, m] = ym.split("-").map(Number);
  return isoDate(new Date(y, m, 0));
}
export function daysBetween(isoA, isoB) {
  return Math.floor((new Date(isoB) - new Date(isoA)) / 86400000);
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------
export function msg(text, kind = "ok") {
  return h(`div.msg.${kind}`, {}, text);
}

/** Floating confirmation, auto-fades. */
export function toast(text, kind = "ok") {
  const el = h(`div.toast.${kind}`, {}, text);
  document.body.append(el);
  setTimeout(() => el.classList.add("out"), 2200);
  setTimeout(() => el.remove(), 2800);
}

export function errorText(err) {
  if (!err) return "";
  return err.message || err.error_description || String(err);
}

// ---------------------------------------------------------------------------
// Form field helpers
// ---------------------------------------------------------------------------
export function field(labelText, input) {
  return h("div", {}, h("label", {}, labelText), input);
}

export function input(props = {}) {
  return h("input", { type: "text", ...props });
}

export function select(options, props = {}) {
  const el = h("select", props);
  for (const o of options) {
    el.append(h("option", { value: o.value, selected: o.value === props.value }, o.label));
  }
  if (props.value !== undefined) el.value = props.value;
  return el;
}

export function checkbox(labelText, checked, props = {}) {
  const box = h("input", { type: "checkbox", checked: !!checked, ...props });
  return { el: h("div.field-check", {}, box, h("label", { style: { margin: 0 } }, labelText)), box };
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------
/**
 * openModal({ title, body, onSave }) — `onSave` may return false to keep the
 * dialog open (validation failure). Returns a close() function.
 */
export function openModal({ title, body, onSave, saveLabel, wide }) {
  const errBox = h("div");
  const backdrop = h("div.modal-backdrop", {
    onclick: (e) => { if (e.target === backdrop) close(); },
  });
  const saveBtn = onSave
    ? h("button.btn", { type: "submit" }, saveLabel || t("save"))
    : null;
  const form = h("form", {
    onsubmit: async (e) => {
      e.preventDefault();
      if (!onSave) return close();
      saveBtn.disabled = true;
      try {
        const ok = await onSave({ fail: (m) => { clear(errBox).append(msg(m, "error")); } });
        if (ok !== false) close();
      } catch (err) {
        clear(errBox).append(msg(errorText(err), "error"));
      } finally {
        saveBtn.disabled = false;
      }
    },
  },
    body,
    errBox,
    h("div.btn-row", {},
      saveBtn,
      h("button.btn.secondary", { type: "button", onclick: () => close() },
        onSave ? t("cancel") : t("close"))));

  const modal = h("div.modal", { class: wide ? "wide" : null }, h("h3", {}, title), form);
  backdrop.append(modal);
  document.body.append(backdrop);
  document.body.classList.add("modal-open");
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  setTimeout(() => modal.querySelector("input, select, textarea")?.focus(), 30);

  function close() {
    document.removeEventListener("keydown", onKey);
    backdrop.remove();
    if (!document.querySelector(".modal-backdrop")) document.body.classList.remove("modal-open");
  }
  return close;
}

export function confirmDelete(message = t("confirm_delete")) {
  return window.confirm(message);
}

// ---------------------------------------------------------------------------
// Table helper
// ---------------------------------------------------------------------------
/**
 * table(columns, rows, rowFn) where columns = [{label, num?}] and rowFn returns
 * an array of cells (strings or nodes). Cells may be {v, num, class}.
 */
export function table(columns, rows, rowFn, opts = {}) {
  if (!rows.length) return h("div.empty", {}, opts.empty || t("none"));
  const thead = h("thead", {}, h("tr", {}, columns.map((c) =>
    h("th", { class: c.num ? "num" : null }, c.label))));
  const tbody = h("tbody", {}, rows.map((r, i) => {
    const cells = rowFn(r, i);
    const tr = h("tr", {}, cells.map((cell, ci) => {
      const col = columns[ci] || {};
      if (cell && typeof cell === "object" && !(cell instanceof Node) && "v" in cell) {
        return h("td", { class: [col.num || cell.num ? "num" : "", cell.class || ""].join(" ").trim() || null }, cell.v);
      }
      return h("td", { class: col.num ? "num" : null }, cell);
    }));
    if (opts.rowClass) {
      const c = opts.rowClass(r);
      if (c) tr.className = c;
    }
    return tr;
  }));
  const tfoot = opts.foot ? h("tfoot", {}, h("tr", {}, opts.foot.map((cell, ci) =>
    h("td", { class: (columns[ci] || {}).num ? "num" : null }, cell)))) : null;
  return h("div.table-wrap", {}, h("table", {}, thead, tbody, tfoot));
}

// ---------------------------------------------------------------------------
// Printing — a document is rendered into #print-root and the page switches to
// print mode via a body class (see the @media print block in css/styles.css).
// ---------------------------------------------------------------------------
export function printDocument(node) {
  let root = document.getElementById("print-root");
  if (!root) {
    root = h("div", { id: "print-root" });
    document.body.append(root);
  }
  clear(root).append(node);
  document.body.classList.add("printing");
  const cleanup = () => {
    document.body.classList.remove("printing");
    clear(root);
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  // Give the browser a tick to lay the document out before opening the dialog.
  setTimeout(() => {
    window.print();
    // Safari/Firefox fire afterprint reliably; this is a belt-and-braces reset.
    setTimeout(() => { if (document.body.classList.contains("printing")) cleanup(); }, 1000);
  }, 60);
}
