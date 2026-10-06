/* ==========================================================================
   Golden Bullet - agegate.js
   Age confirmation modal + consent persistence. No imports.
   ========================================================================== */

const AGE_KEY = "gb.ageOk";
const MIN_AGE = 18;

export function hasConfirmedAge() {
  try { return window.localStorage.getItem(AGE_KEY) === "true"; }
  catch (error) { return false; }
}

function remember() {
  try { window.localStorage.setItem(AGE_KEY, "true"); return true; }
  catch (error) { return false; }
}

export function clearAgeConfirmation() {
  try { window.localStorage.removeItem(AGE_KEY); } catch (error) { /* ignore */ }
}

/**
 * Block the page behind a full-screen age gate until the visitor confirms
 * they are 18 or older. Declining sends them away from the store.
 */
export function initAgeGate() {
  const gate = document.getElementById("gb-age-gate");
  if (!gate) return;

  if (hasConfirmedAge()) {
    gate.hidden = true;
    gate.setAttribute("aria-hidden", "true");
    document.documentElement.removeAttribute("data-gb-age-locked");
    return;
  }

  const dialog = gate.querySelector(".gb-modal__dialog") || gate;
  const confirmBtn = gate.querySelector("[data-age-confirm]");
  const exitBtn = gate.querySelector("[data-age-exit]");
  const rememberInput = gate.querySelector("[data-age-remember]");
  const main = document.querySelector("main");
  const header = document.querySelector(".gb-header");
  const footer = document.querySelector(".gb-footer");

  gate.hidden = false;
  gate.setAttribute("aria-hidden", "false");
  document.documentElement.setAttribute("data-gb-age-locked", "true");
  document.body.classList.add("gb-no-scroll");
  // Everything behind the gate is inert: no clicks, no tab stops, no scrolling.
  [main, header, footer, document.getElementById("gb-cookie-banner"), document.getElementById("gb-cart-drawer")]
    .filter(Boolean)
    .forEach((el) => el.setAttribute("inert", ""));

  function focusables() {
    return Array.from(gate.querySelectorAll('a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])'));
  }

  window.setTimeout(() => (confirmBtn || focusables()[0])?.focus(), 60);

  gate.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault(); return; }
    if (event.key !== "Tab") return;
    const items = focusables();
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });

  function unlock() {
    gate.hidden = true;
    gate.setAttribute("aria-hidden", "true");
    document.documentElement.removeAttribute("data-gb-age-locked");
    document.body.classList.remove("gb-no-scroll");
    [main, header, footer, document.getElementById("gb-cookie-banner"), document.getElementById("gb-cart-drawer")]
      .filter(Boolean)
      .forEach((el) => el.removeAttribute("inert"));
    document.dispatchEvent(new CustomEvent("gb:age-confirmed"));
  }

  confirmBtn?.addEventListener("click", () => {
    if (!rememberInput || rememberInput.checked) remember();
    unlock();
    document.getElementById("gb-cookie-banner")?.dispatchEvent(new CustomEvent("gb:cookie-show"));
  });

  exitBtn?.addEventListener("click", () => {
    gate.querySelector("[data-age-exit-panel]")?.removeAttribute("hidden");
    try {
      window.location.replace("https://www.google.com/");
    } catch (error) {
      /* If navigation is blocked we simply leave the gate closed and locked. */
    }
  });
}

export { MIN_AGE, AGE_KEY };
