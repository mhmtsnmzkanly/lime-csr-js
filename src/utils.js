/**
 * @module utils
 * @description Security helpers — output sanitization against XSS.
 *
 * Source: LimeVideo legacy index.js (this dependency was removed, converted to pure functions).
 */

/**
 * Makes a value safe against XSS by converting it to HTML entities.
 *
 * @param {*} value
 * @returns {string}
 */
export function escapeHtml(value = "") {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[char],
  );
}

/**
 * Returns a string safe for use as an HTML attribute value.
 * In addition to escapeHtml, also escapes backticks (against template injection).
 *
 * @param {*} value
 * @returns {string}
 */
export function safeAttr(value = "") {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

/**
 * Is a URL's protocol on the safe whitelist (http/https only, root-relative
 * paths (/), and #anchor)? Returns false for protocol-relative URLs (//) and
 * dangerous schemes (javascript:, data:, etc.).
 *
 * Does NOT escape (returns only a boolean) — a shared core for consumers that
 * need the raw value (e.g. bindings.js, which uses setAttribute); safeUrl
 * adds escaping on top of this.
 *
 * @param {*} value
 * @returns {boolean}
 */
export function isSafeUrlProtocol(value = "") {
  const url = String(value ?? "").trim();
  if (!url) return false;
  return (
    /^https?:\/\//i.test(url) ||
    (url.startsWith("/") && !url.startsWith("//")) ||
    url.startsWith("#")
  );
}

/**
 * Returns a safe URL; only allows http/https, root-relative paths (/), and #anchor.
 * Returns an empty string for protocol-relative URLs (//) and dangerous schemes
 * (javascript:, data:, etc.).
 *
 * @param {*} value
 * @returns {string}
 */
export function safeUrl(value = "") {
  const url = String(value ?? "").trim();
  return isSafeUrlProtocol(url) ? safeAttr(url) : "";
}

/**
 * Returns a safe `url('...')` for CSS style values like `background-image`.
 *
 * @param {*} value
 * @returns {string}
 */
export function safeStyleUrl(value = "") {
  const url = safeUrl(value);
  if (!url) return "";
  return `url('${url.replace(/'/g, "%27")}')`;
}
