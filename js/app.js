// ---------------------------------------------------------------------------
// CondoCash — application shell: auth, chrome (condo picker, tabs, language)
// and view dispatch. Each view module owns its own data loading and rendering.
// ---------------------------------------------------------------------------
import { sb, initSupabase, isConfigured } from "./supabase.js";
import * as api from "./api.js";
import { t, setLang, getLang, LANGUAGES } from "./i18n.js";
import { DEFAULT_LANGUAGE } from "./config.js";
import {
  state, isAdmin, rememberCondo, recalledCondo, rememberLang, recalledLang,
} from "./state.js";
import { h, clear, msg, field, input, select, errorText, toast } from "./ui.js";

import * as dashboard from "./views/dashboard.js";
import * as payments from "./views/payments.js";
import * as expenses from "./views/expenses.js";
import * as apartments from "./views/apartments.js";
import * as fees from "./views/fees.js";
import * as protocols from "./views/protocols.js";
import * as condosView from "./views/condos.js";
import * as usersView from "./views/users.js";

const app = document.getElementById("app");

const VIEWS = {
  dashboard:  { label: () => t("nav_dashboard"),  module: dashboard,  needsCondo: true },
  payments:   { label: () => t("nav_payments"),   module: payments,   needsCondo: true },
  expenses:   { label: () => t("nav_expenses"),   module: expenses,   needsCondo: true },
  apartments: { label: () => t("nav_apartments"), module: apartments, needsCondo: true },
  fees:       { label: () => t("nav_fees"),       module: fees,       needsCondo: true },
  protocols:  { label: () => t("nav_protocols"),  module: protocols,  needsCondo: true },
  condos:     { label: () => t("nav_condos"),     module: condosView, adminOnly: true },
  users:      { label: () => t("nav_users"),      module: usersView,  adminOnly: true },
};

const ctx = {
  refresh: () => renderMain(),
  reloadCondos: async () => { await loadCondos(); renderShell(); },
  go: (view) => { state.view = view; renderShell(); },
};

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
setLang(recalledLang() || DEFAULT_LANGUAGE);

(async function boot() {
  if (!isConfigured) return fatal(t("not_configured"));

  try {
    await initSupabase();
  } catch (err) {
    console.error(err);
    return fatal(t("lib_failed"));
  }

  state.session = await api.getSession();
  sb().auth.onAuthStateChange((event, session) => {
    state.session = session;
    // Only react to real transitions; token refreshes must not reload the UI,
    // and the login form drives its own start() call.
    if (event === "SIGNED_OUT") renderLogin();
    else if (event === "SIGNED_IN" && !state.profile) start();
  });

  await start();
})();

/** Whole-app dead end: we cannot talk to the backend at all. */
function fatal(text) {
  clear(app).append(
    h("div.login-wrap", {},
      h("div.card.login-card", {},
        h("span.brand", {}, "🏢 " + t("app_name")),
        h("div.tagline", {}, t("tagline")),
        msg(text, "error"))));
}

async function start() {
  if (!state.session) return renderLogin();
  clear(app).append(h("div.boot", {}, t("loading")));
  try {
    state.profile = await api.getProfile(state.session.user.id);
    if (!state.profile) {
      // The signup trigger should have created it; create it lazily if not.
      state.profile = { id: state.session.user.id, role: "cashier", full_name: "" };
    }
    if (!recalledLang() && state.profile.preferred_language) {
      setLang(state.profile.preferred_language);
    }
    await loadCondos();
    renderShell();
  } catch (err) {
    clear(app).append(
      h("div.login-wrap", {},
        h("div.card.login-card", {},
          msg(errorText(err), "error"),
          h("button.btn", { onclick: signOut }, t("sign_out")))));
  }
}

async function loadCondos() {
  state.condos = await api.listCondos();
  const remembered = recalledCondo();
  if (!state.condos.some((c) => c.id === state.condoId)) {
    state.condoId = state.condos.some((c) => c.id === remembered)
      ? remembered
      : state.condos[0]?.id || null;
    rememberCondo(state.condoId);
  }
}

async function signOut() {
  await api.signOut();
  state.profile = null;
  state.condos = [];
  state.condoId = null;
  renderLogin();
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------
function renderLogin() {
  const email = input({ type: "email", required: true, autocomplete: "username" });
  const password = input({ type: "password", required: true, autocomplete: "current-password" });
  const errBox = h("div");
  const btn = h("button.btn", { type: "submit", style: { width: "100%" } }, t("sign_in"));

  const form = h("form", {
    onsubmit: async (e) => {
      e.preventDefault();
      clear(errBox);
      btn.disabled = true;
      btn.textContent = t("signing_in");
      try {
        await api.signIn(email.value.trim(), password.value);
        state.session = await api.getSession();
        await start();
      } catch (err) {
        errBox.append(msg(errorText(err) || t("login_failed"), "error"));
        btn.disabled = false;
        btn.textContent = t("sign_in");
      }
    },
  },
    field(t("email"), email),
    field(t("password"), password),
    errBox,
    h("div.btn-row", {}, btn));

  clear(app).append(
    h("div.login-wrap", {},
      h("div.card.login-card", {},
        h("span.brand", {}, "🏢 " + t("app_name")),
        h("div.tagline", {}, t("tagline")),
        form,
        h("div", { style: { marginTop: "1rem" } }, langPicker()))));
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------
function visibleViews() {
  return Object.entries(VIEWS).filter(([, v]) => !v.adminOnly || isAdmin());
}

function renderShell() {
  const views = visibleViews();
  if (!views.some(([k]) => k === state.view)) state.view = views[0][0];

  const condoSelect = select(
    state.condos.map((c) => ({ value: c.id, label: c.name })),
    {
      value: state.condoId || "",
      disabled: state.condos.length < 2,
      onchange: (e) => { rememberCondo(e.target.value); renderMain(); },
    });

  const topbar = h("header.topbar", {},
    h("div.brand", {}, h("span.logo", {}, "🏢"), t("app_name")),
    state.condos.length
      ? h("label.inline", { style: { display: "flex", alignItems: "center", gap: ".4rem" } },
          h("span.muted", {}, t("condo")), condoSelect)
      : null,
    h("div.spacer", {}),
    h("span.pill", { class: isAdmin() ? "admin" : null },
      state.profile?.full_name || state.session?.user?.email || "",
      " · ", isAdmin() ? t("role_admin") : t("role_cashier")),
    langPicker(),
    h("button.btn.secondary.small", { onclick: signOut }, t("sign_out")));

  const tabs = h("nav.tabs", {}, views.map(([key, v]) =>
    h("button", {
      class: key === state.view ? "active" : null,
      onclick: () => { state.view = key; renderShell(); },
    }, v.label())));

  const main = h("main", { id: "main" });
  clear(app).append(topbar, tabs, main);
  renderMain();
}

async function renderMain() {
  const main = document.getElementById("main");
  if (!main) return;
  const view = VIEWS[state.view];
  clear(main).append(h("div.boot", {}, t("loading")));

  if (view.needsCondo && !state.condoId) {
    clear(main).append(h("div.card", {}, msg(t("no_condo"), "error")));
    return;
  }

  try {
    const container = h("div");
    await view.module.render(container, ctx);
    clear(main).append(container);
  } catch (err) {
    clear(main).append(h("div.card", {}, msg(errorText(err), "error")));
    console.error(err);
  }
}

// ---------------------------------------------------------------------------
function langPicker() {
  return select(
    Object.entries(LANGUAGES).map(([value, label]) => ({ value, label })),
    {
      class: "lang",
      value: getLang(),
      onchange: async (e) => {
        setLang(e.target.value);
        rememberLang(e.target.value);
        if (state.profile?.id) {
          try {
            await api.updateProfile(state.profile.id, { preferred_language: e.target.value });
          } catch { /* language preference is cosmetic; ignore failures */ }
        }
        state.session ? renderShell() : renderLogin();
      },
    });
}
