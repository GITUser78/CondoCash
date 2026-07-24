// ---------------------------------------------------------------------------
// Condos (admin only) — create buildings and decide which cashier looks after
// which one. A cashier only ever sees the condos assigned here.
// ---------------------------------------------------------------------------
import * as api from "../api.js";
import { t } from "../i18n.js";
import {
  h, table, field, input, select, openModal, confirmDelete, toast,
} from "../ui.js";

const CURRENCIES = ["BGN", "EUR", "USD"];

export async function render(root, ctx) {
  const [condos, profiles, links] = await Promise.all([
    api.listCondos(),
    api.listProfiles(),
    api.listAllCondoCashiers(),
  ]);

  const cashiersOf = (condoId) =>
    links.filter((l) => l.condo_id === condoId)
      .map((l) => profiles.find((p) => p.id === l.user_id))
      .filter(Boolean);

  root.append(
    h("div.card", {},
      h("div.section-title", {},
        h("h2", {}, t("nav_condos")),
        h("button.btn", { onclick: () => openCondoModal({ ctx }) }, "＋ " + t("add_condo"))),
      table(
        [{ label: t("condo_name") }, { label: t("condo_address") }, { label: t("currency") },
         { label: t("assign_cashiers") }, { label: t("actions") }],
        condos,
        (c) => [
          c.name,
          c.address || "—",
          c.currency,
          h("div.chiplist", {},
            cashiersOf(c.id).length
              ? cashiersOf(c.id).map((p) => h("span.pill", {}, p.full_name || "—"))
              : h("span.muted", {}, "—")),
          h("div", { style: { display: "flex", gap: ".2rem" } },
            h("button.icon-btn", {
              title: t("manage_cashiers"),
              onclick: () => openCashiersModal({ ctx, condo: c, profiles, links }),
            }, "👥"),
            h("button.icon-btn", { title: t("edit"), onclick: () => openCondoModal({ ctx, condo: c }) }, "✎"),
            h("button.icon-btn.danger", {
              title: t("delete"),
              onclick: async () => {
                if (!confirmDelete()) return;
                await api.deleteCondo(c.id);
                toast(t("saved"));
                ctx.reloadCondos();
              },
            }, "🗑")),
        ]))
  );
}

function openCondoModal({ ctx, condo = null }) {
  const name = input({ required: true, value: condo?.name || "" });
  const address = input({ value: condo?.address || "" });
  const currency = select(CURRENCIES.map((c) => ({ value: c, label: c })), { value: condo?.currency || "BGN" });

  return openModal({
    title: condo ? t("edit_condo") : t("add_condo"),
    body: h("div.form-grid", {},
      field(t("condo_name"), name),
      field(t("condo_address"), address),
      field(t("currency"), currency)),
    onSave: async ({ fail }) => {
      if (!name.value.trim()) { fail(t("required")); return false; }
      await api.saveCondo({
        id: condo?.id,
        name: name.value.trim(),
        address: address.value.trim(),
        currency: currency.value,
      });
      toast(t("saved"));
      await ctx.reloadCondos();
    },
  });
}

function openCashiersModal({ ctx, condo, profiles, links }) {
  const assigned = new Set(links.filter((l) => l.condo_id === condo.id).map((l) => l.user_id));
  const chips = h("div.chiplist", {}, profiles.map((p) => {
    const chip = h("button.chip-toggle", {
      type: "button",
      class: assigned.has(p.id) ? "on" : null,
      onclick: () => {
        if (assigned.has(p.id)) { assigned.delete(p.id); chip.classList.remove("on"); }
        else { assigned.add(p.id); chip.classList.add("on"); }
      },
    }, `${p.full_name || "—"} · ${p.role === "admin" ? t("role_admin") : t("role_cashier")}`);
    return chip;
  }));

  return openModal({
    title: `${t("manage_cashiers")} — ${condo.name}`,
    body: h("div", {},
      h("p.muted", {}, t("assign_cashiers")),
      profiles.length ? chips : h("div.empty", {}, t("no_users"))),
    onSave: async () => {
      const before = new Set(links.filter((l) => l.condo_id === condo.id).map((l) => l.user_id));
      const changes = [];
      for (const p of profiles) {
        const now = assigned.has(p.id);
        if (now !== before.has(p.id)) changes.push(api.setCondoCashier(condo.id, p.id, now));
      }
      await Promise.all(changes);
      toast(t("saved"));
      await ctx.reloadCondos();
    },
  });
}
