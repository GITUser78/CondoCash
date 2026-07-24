// ---------------------------------------------------------------------------
// Users (admin only) — promote/demote and grant condo access. Accounts
// themselves are created through Supabase Auth (invite from the dashboard, or
// the user signs up); a profile row appears here automatically.
// ---------------------------------------------------------------------------
import * as api from "../api.js";
import { t } from "../i18n.js";
import { state } from "../state.js";
import { h, table, field, input, openModal, toast } from "../ui.js";

export async function render(root, ctx) {
  const [profiles, condos, links] = await Promise.all([
    api.listProfiles(),
    api.listCondos(),
    api.listAllCondoCashiers(),
  ]);

  root.append(
    h("div.card", {},
      h("h2", {}, t("nav_users")),
      profiles.length <= 1 ? h("p.muted", {}, t("no_users")) : null,
      table(
        [{ label: t("full_name") }, { label: t("role") }, { label: t("user_condos") }, { label: t("actions") }],
        profiles,
        (p) => [
          h("span", {}, p.full_name || "—",
            p.id === state.session?.user?.id
              ? h("span.pill", { style: { marginLeft: ".4rem" } }, t("you"))
              : null),
          p.role === "admin"
            ? h("span.pill.admin", {}, t("role_admin"))
            : h("span.pill", {}, t("role_cashier")),
          h("div.chiplist", {},
            links.filter((l) => l.user_id === p.id).length
              ? links.filter((l) => l.user_id === p.id).map((l) =>
                  h("span.pill", {}, condos.find((c) => c.id === l.condo_id)?.name || "—"))
              : h("span.muted", {}, "—")),
          h("div", { style: { display: "flex", gap: ".2rem", flexWrap: "wrap" } },
            h("button.icon-btn", {
              title: t("edit"), onclick: () => openProfileModal({ ctx, profile: p }),
            }, "✎"),
            h("button.icon-btn", {
              title: t("user_condos"),
              onclick: () => openAccessModal({ ctx, profile: p, condos, links }),
            }, "🏢"),
            p.id === state.session?.user?.id
              ? null
              : h("button.btn.secondary.small", {
                  onclick: async () => {
                    const role = p.role === "admin" ? "cashier" : "admin";
                    await api.updateProfile(p.id, { role });
                    toast(t("saved"));
                    ctx.refresh();
                  },
                }, p.role === "admin" ? t("make_cashier") : t("make_admin"))),
        ]))
  );
}

function openProfileModal({ ctx, profile }) {
  const name = input({ value: profile.full_name || "" });
  return openModal({
    title: t("edit"),
    body: h("div.form-grid", {}, field(t("full_name"), name)),
    onSave: async () => {
      await api.updateProfile(profile.id, { full_name: name.value.trim() });
      toast(t("saved"));
      ctx.refresh();
    },
  });
}

function openAccessModal({ ctx, profile, condos, links }) {
  const assigned = new Set(links.filter((l) => l.user_id === profile.id).map((l) => l.condo_id));
  const chips = h("div.chiplist", {}, condos.map((c) => {
    const chip = h("button.chip-toggle", {
      type: "button",
      class: assigned.has(c.id) ? "on" : null,
      onclick: () => {
        if (assigned.has(c.id)) { assigned.delete(c.id); chip.classList.remove("on"); }
        else { assigned.add(c.id); chip.classList.add("on"); }
      },
    }, c.name);
    return chip;
  }));

  return openModal({
    title: `${t("user_condos")} — ${profile.full_name || ""}`,
    body: condos.length ? chips : h("div.empty", {}, t("none")),
    onSave: async () => {
      const before = new Set(links.filter((l) => l.user_id === profile.id).map((l) => l.condo_id));
      const changes = [];
      for (const c of condos) {
        const now = assigned.has(c.id);
        if (now !== before.has(c.id)) changes.push(api.setCondoCashier(c.id, profile.id, now));
      }
      await Promise.all(changes);
      toast(t("saved"));
      await ctx.reloadCondos();
    },
  });
}
