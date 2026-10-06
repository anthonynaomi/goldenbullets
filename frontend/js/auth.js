/* ==========================================================================
   Golden Bullet - auth.js
   JWT storage, session state and protected-route guards.
   ========================================================================== */

import { CONFIG, api, storage, setToken, getToken, clearSession, getStoredUser, setStoredUser } from "./api.js";

/* --------------------------------------------------------------------------
   JWT helpers
   -------------------------------------------------------------------------- */
function base64UrlDecode(segment) {
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(segment.length / 4) * 4, "=");
  const binary = window.atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

export function decodeJwt(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  try { return JSON.parse(base64UrlDecode(parts[1])); }
  catch (error) { return null; }
}

export function isTokenExpired(token) {
  const payload = decodeJwt(token);
  if (!payload) return true;
  if (!payload.exp) return false;
  return payload.exp * 1000 <= Date.now();
}

export function isAuthenticated() {
  const token = getToken();
  return Boolean(token) && !isTokenExpired(token);
}

export function getDisplayName() {
  const user = getStoredUser();
  if (!user) return "";
  return user.firstName || user.name || user.email || "";
}

/* --------------------------------------------------------------------------
   Session mutations
   -------------------------------------------------------------------------- */
export async function login(email, password) {
  const result = await api.auth.login(email, password);
  const token = result?.token || result?.accessToken;
  if (!token) throw new Error("The sign-in response did not include a token.");
  setToken(token, result?.refreshToken);
  setStoredUser(result?.user || { email, name: email });
  document.dispatchEvent(new CustomEvent("gb:auth-changed", { detail: { user: getStoredUser() } }));
  return result;
}

export async function register(payload) {
  const result = await api.auth.register(payload);
  const token = result?.token || result?.accessToken;
  if (token) {
    setToken(token, result?.refreshToken);
    setStoredUser(result?.user || { email: payload.email, name: payload.firstName || payload.email });
    document.dispatchEvent(new CustomEvent("gb:auth-changed", { detail: { user: getStoredUser() } }));
  }
  return result;
}

export function logout({ redirect = "" } = {}) {
  clearSession();
  document.dispatchEvent(new CustomEvent("gb:auth-changed", { detail: { user: null } }));
  if (redirect) window.location.assign(redirect);
}

/* --------------------------------------------------------------------------
   Route guard
   -------------------------------------------------------------------------- */
export function currentUrl() {
  return `${window.location.pathname.split("/").pop() || "index.html"}${window.location.search}${window.location.hash}`;
}

/**
 * Redirect anonymous visitors to the login page, preserving where they wanted
 * to go. Returns the stored user when the session is valid.
 */
export function requireAuth({ redirectTo = "login.html" } = {}) {
  if (isAuthenticated()) return getStoredUser();
  const next = encodeURIComponent(currentUrl());
  window.location.replace(`${redirectTo}?next=${next}`);
  return null;
}

export function redirectIfAuthenticated(to = "account.html") {
  if (isAuthenticated()) window.location.replace(to);
}

export function safeNextUrl(fallback = "account.html") {
  const raw = new URLSearchParams(window.location.search).get("next");
  if (!raw) return fallback;
  try {
    const url = new URL(raw, document.baseURI);
    // Only allow same-origin, non-protocol-relative redirects.
    if (url.origin !== window.location.origin) return fallback;
    if (/^[a-z]+:/i.test(raw)) return fallback;
    return `${url.pathname.split("/").pop()}${url.search}${url.hash}` || fallback;
  } catch (error) {
    return fallback;
  }
}

/* --------------------------------------------------------------------------
   Header account link
   -------------------------------------------------------------------------- */
export function initAuthUI() {
  const links = document.querySelectorAll("[data-account-link]");
  function render() {
    const authed = isAuthenticated();
    const name = getDisplayName();
    links.forEach((link) => {
      const label = link.querySelector("[data-account-label]");
      link.setAttribute("href", authed ? "account.html" : "login.html");
      if (label) label.textContent = authed ? `Hi, ${String(name).split(" ")[0] || "Account"}` : "Sign in";
      link.setAttribute("aria-label", authed ? "Your account" : "Sign in or create an account");
    });
  }
  render();
  document.addEventListener("gb:auth-changed", render);
  return { render };
}

export { storage, CONFIG };
