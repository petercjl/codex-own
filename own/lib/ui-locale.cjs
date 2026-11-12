'use strict';
// UI language policy only; model output and document languages are unchanged.
const installed = Symbol.for('codex-own.ui-locale');
function normalizeUiLocale(value) {
  const locale = typeof value === 'string' ? value.trim().replace(/_/g, '-').toLowerCase() : '';
  return /^zh(?:-|$)/.test(locale) ? 'zh-CN' : 'en-US';
}
function install(app) {
  if (app[installed]) return;
  const locale = app.getLocale?.bind(app);
  const preferred = app.getPreferredSystemLanguages?.bind(app);
  if (locale) app.getLocale = () => normalizeUiLocale(locale());
  if (preferred) app.getPreferredSystemLanguages = () => {
    const values = preferred();
    return [...new Set((Array.isArray(values) && values.length ? values : ['en-US']).map(normalizeUiLocale))];
  };
  Object.defineProperty(app, installed, {value: true});
}
module.exports = {normalizeUiLocale, install};
