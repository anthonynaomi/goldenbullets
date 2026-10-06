/* ==========================================================================
   Golden Bullet - validation.js
   Reusable field validators, a password strength meter and form wiring.
   No imports.
   ========================================================================== */

/* --------------------------------------------------------------------------
   Primitive validators
   -------------------------------------------------------------------------- */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const PHONE_RE = /^[+]?[\d\s().-]{7,20}$/;

export function isEmail(value) { return EMAIL_RE.test(String(value || "").trim()); }

export function isPhone(value) { return PHONE_RE.test(String(value || "").trim()); }

export function yearsBetween(date, now = new Date()) {
  let years = now.getFullYear() - date.getFullYear();
  const monthDiff = now.getMonth() - date.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < date.getDate())) years -= 1;
  return years;
}

export function isAtLeast18(value, now = new Date()) {
  const raw = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const date = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(date.getTime())) return false;
  if (date > now) return false;
  if (date.getFullYear() < 1900) return false;
  return yearsBetween(date, now) >= 18;
}

/* --------------------------------------------------------------------------
   Password strength (score 0-4)
   -------------------------------------------------------------------------- */
const COMMON_PASSWORDS = new Set([
  "password", "password1", "password123", "12345678", "123456789", "qwerty123",
  "letmein", "iloveyou", "welcome1", "admin123", "goldenbullet"
]);

export function passwordScore(value) {
  const password = String(value || "");
  if (!password) return { score: 0, label: "Enter a password", hints: [] };
  const hints = [];
  let score = 0;

  if (password.length >= 8) score += 1; else hints.push("at least 8 characters");
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1; else hints.push("upper and lower case letters");
  if (/\d/.test(password)) score += 1; else hints.push("a number");
  if (/[^A-Za-z0-9]/.test(password)) score += 1; else hints.push("a symbol");

  if (COMMON_PASSWORDS.has(password.toLowerCase())) { score = 1; hints.push("a less common password"); }
  if (/^(.)\1+$/.test(password)) score = 1;

  score = Math.max(0, Math.min(4, score - 1));
  if (password.length < 8) score = Math.min(score, 1);

  const labels = ["Too short", "Weak", "Fair", "Good", "Strong"];
  return { score, label: labels[score], hints };
}

export function initStrengthMeter(input, { meter, label } = {}) {
  if (!input) return;
  const wrapper = meter?.closest(".gb-strength") || meter?.parentElement;
  const bar = meter;
  function update() {
    const { score, label: text, hints } = passwordScore(input.value);
    if (wrapper) wrapper.dataset.score = String(score);
    if (bar) bar.style.width = `${input.value ? Math.max(6, score * 25) : 0}%`;
    if (label) {
      label.textContent = input.value
        ? `Password strength: ${text}${hints.length ? ` — add ${hints.slice(0, 2).join(", ")}` : ""}`
        : "Use at least 8 characters with a mix of letters, numbers and symbols.";
    }
  }
  input.addEventListener("input", update);
  update();
}

/* --------------------------------------------------------------------------
   Rules
   -------------------------------------------------------------------------- */
export const rules = {
  required: (message = "This field is required.") => (value) =>
    (Array.isArray(value) ? value.length > 0 : String(value ?? "").trim().length > 0) ? null : message,

  email: (message = "Enter a valid email address.") => (value) =>
    !String(value || "").trim() || isEmail(value) ? null : message,

  phone: (message = "Enter a valid phone number.") => (value) =>
    !String(value || "").trim() || isPhone(value) ? null : message,

  minLength: (length, message) => (value) =>
    !String(value || "").length || String(value).length >= length ? null : (message || `Use at least ${length} characters.`),

  maxLength: (length, message) => (value) =>
    String(value || "").length <= length ? null : (message || `Use ${length} characters or fewer.`),

  adult: (message = "You must be 18 or older to create an account.") => (value) =>
    isAtLeast18(value) ? null : message,

  matches: (other, message = "The values do not match.") => (value) =>
    String(value || "") === String((typeof other === "function" ? other() : other) || "") ? null : message,

  accepted: (message = "Please confirm to continue.") => (value) =>
    value === true || value === "true" || value === "on" ? null : message,

  password: (message = "Choose a stronger password (at least 8 characters).") => (value) => {
    const { score } = passwordScore(value);
    return score >= 2 && String(value).length >= 8 ? null : message;
  },

  pattern: (re, message = "Check the format of this field.") => (value) =>
    !String(value || "").trim() || re.test(String(value).trim()) ? null : message
};

/* --------------------------------------------------------------------------
   Field level helpers
   -------------------------------------------------------------------------- */
function fieldOf(control) {
  return control.closest(".gb-field") || control.closest("[data-field]") || control.parentElement;
}

export function setFieldError(control, message) {
  const field = fieldOf(control);
  const errorEl = field?.querySelector(".gb-field__error");
  field?.setAttribute("data-invalid", "true");
  field?.removeAttribute("data-valid");
  control.setAttribute("aria-invalid", "true");
  if (errorEl) {
    errorEl.textContent = message;
    errorEl.hidden = false;
    if (errorEl.id) control.setAttribute("aria-describedby", [control.dataset.describedby || "", errorEl.id].filter(Boolean).join(" ").trim());
  }
}

export function clearFieldError(control, { valid = false } = {}) {
  const field = fieldOf(control);
  const errorEl = field?.querySelector(".gb-field__error");
  field?.removeAttribute("data-invalid");
  if (valid) field?.setAttribute("data-valid", "true");
  else field?.removeAttribute("data-valid");
  control.removeAttribute("aria-invalid");
  control.removeAttribute("aria-describedby");
  if (errorEl) { errorEl.textContent = ""; errorEl.hidden = true; }
}

export function validateControl(control, fieldRules = []) {
  const value = control.type === "checkbox" || control.type === "radio" ? control.checked : control.value;
  for (const rule of fieldRules) {
    const message = rule(value, control);
    if (message) { setFieldError(control, message); return false; }
  }
  clearFieldError(control, { valid: String(value ?? "").trim().length > 0 });
  return true;
}

/* --------------------------------------------------------------------------
   Form wiring
   -------------------------------------------------------------------------- */
/**
 * Attach validation to a form.
 * @param {HTMLFormElement} form
 * @param {Record<string, Function[]>} schema keyed by control name
 * @param {{onSubmit?: Function, validateOn?: "blur"|"input"}} options
 */
export function wireForm(form, schema, { onSubmit, validateOn = "blur" } = {}) {
  if (!form) return null;
  const state = { submitted: false, valid: true };

  function controlsFor(name) {
    return Array.from(form.elements).filter((el) => el.name === name && el.type !== "submit");
  }

  function runField(name, { silent = false } = {}) {
    const list = controlsFor(name);
    if (!list.length || !schema[name]) return true;
    const results = list.map((control) => validateControl(control, schema[name]));
    const ok = results.every(Boolean);
    if (silent) return ok;
    return ok;
  }

  function validateAll() {
    let ok = true;
    let firstInvalid = null;
    for (const name of Object.keys(schema)) {
      const passed = runField(name);
      if (!passed) {
        ok = false;
        if (!firstInvalid) firstInvalid = controlsFor(name)[0];
      }
    }
    state.valid = ok;
    if (firstInvalid) {
      firstInvalid.focus({ preventScroll: false });
      firstInvalid.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    return ok;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    state.submitted = true;
    if (!validateAll()) {
      const summary = form.querySelector("[data-form-error]");
      if (summary) {
        summary.hidden = false;
        summary.textContent = "Please fix the highlighted fields and try again.";
        summary.focus?.();
      }
      return;
    }
    const summary = form.querySelector("[data-form-error]");
    if (summary) { summary.hidden = true; summary.textContent = ""; }
    if (typeof onSubmit === "function") await onSubmit(new FormData(form), form);
  });

  form.addEventListener(validateOn === "input" ? "input" : "focusout", (event) => {
    const control = event.target;
    if (!control?.name || !schema[control.name]) return;
    if (validateOn === "blur" && event.type === "focusout") runField(control.name);
    else if (validateOn === "input") runField(control.name);
  });

  form.addEventListener("input", (event) => {
    if (!state.submitted) return;
    const control = event.target;
    if (!control?.name || !schema[control.name]) return;
    runField(control.name);
  });

  return {
    validateAll,
    runField,
    reset() { form.reset(); Object.keys(schema).forEach((name) => controlsFor(name).forEach((c) => clearFieldError(c))); },
    get isValid() { return state.valid; }
  };
}

export function formToObject(formData) {
  const out = {};
  for (const [key, value] of formData.entries()) {
    if (key in out) {
      if (!Array.isArray(out[key])) out[key] = [out[key]];
      out[key].push(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}
