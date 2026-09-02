/* CigCig theme engine
 * Keeps the selected mode separate from the resolved mode so "Otomatik"
 * can follow the operating system without causing a flash of the wrong theme.
 */
(function (window, document) {
  'use strict';

  const STORAGE_KEY = 'cigcig_theme';
  const VALID_MODES = new Set(['auto', 'dark', 'light']);
  const DEFAULTS = {
    primary_color: '#BDA275',
    background_color: '#121212',
    light_primary_color: '#dc2626',
    light_background_color: '#f8f9fa'
  };
  let settings = {};
  let mediaQuery = null;

  function validHex(value, fallback) {
    return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : fallback;
  }

  function rgb(hex) {
    const value = validHex(hex, '#000000').slice(1);
    return {
      r: parseInt(value.slice(0, 2), 16),
      g: parseInt(value.slice(2, 4), 16),
      b: parseInt(value.slice(4, 6), 16)
    };
  }

  function hex({ r, g, b }) {
    return '#' + [r, g, b].map(value => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')).join('');
  }

  function blend(first, second, amount) {
    const a = rgb(first);
    const b = rgb(second);
    return hex({
      r: a.r + (b.r - a.r) * amount,
      g: a.g + (b.g - a.g) * amount,
      b: a.b + (b.b - a.b) * amount
    });
  }

  function rgba(value, alpha) {
    const color = rgb(value);
    return `rgba(${color.r},${color.g},${color.b},${alpha})`;
  }

  function luminance(value) {
    const color = rgb(value);
    const channels = [color.r, color.g, color.b].map(channel => {
      const normalized = channel / 255;
      return normalized <= 0.03928 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  }

  function contrastColor(background) {
    return luminance(background) > 0.48 ? '#111318' : '#f8fafc';
  }

  function preference() {
    let stored = '';
    try { stored = localStorage.getItem(STORAGE_KEY) || ''; } catch {}
    return VALID_MODES.has(stored) ? stored : 'auto';
  }

  function systemMode() {
    return mediaQuery && mediaQuery.matches ? 'dark' : 'light';
  }

  function resolvedMode(mode) {
    return mode === 'auto' ? systemMode() : mode;
  }

  function writeVariables(target, variables) {
    Object.entries(variables).forEach(([name, value]) => target.style.setProperty(name, value));
  }

  function palette(mode) {
    const isLight = mode === 'light';
    const background = validHex(
      isLight ? settings.light_background_color : settings.background_color,
      isLight ? DEFAULTS.light_background_color : DEFAULTS.background_color
    );
    const accent = validHex(
      isLight ? (settings.light_primary_color || settings.primary_color) : settings.primary_color,
      isLight ? DEFAULTS.light_primary_color : DEFAULTS.primary_color
    );
    const text = contrastColor(background);
    const secondaryText = blend(text, background, isLight ? 0.38 : 0.30);
    const mutedText = blend(text, background, isLight ? 0.58 : 0.55);
    const surfaceDirection = isLight ? '#ffffff' : '#ffffff';

    return {
      '--theme-bg': background,
      '--theme-accent': accent,
      '--bg-primary': background,
      '--bg-secondary': isLight ? blend(background, '#ffffff', 0.30) : blend(background, '#000000', 0.38),
      '--bg-card': isLight ? blend(background, '#ffffff', 0.48) : blend(background, surfaceDirection, 0.035),
      '--bg-card2': isLight ? blend(background, '#ffffff', 0.68) : blend(background, surfaceDirection, 0.085),
      '--bg-tertiary': isLight ? blend(background, '#ffffff', 0.58) : blend(background, surfaceDirection, 0.06),
      '--bg-active': rgba(accent, isLight ? 0.11 : 0.13),
      '--bg-hover': rgba(text, isLight ? 0.055 : 0.07),
      '--accent-red': accent,
      '--accent-red2': isLight ? blend(accent, '#000000', 0.18) : blend(accent, '#ffffff', 0.18),
      '--accent-red-dark': isLight ? blend(accent, '#000000', 0.38) : blend(accent, '#000000', 0.34),
      '--accent-contrast': contrastColor(accent),
      '--text-primary': text,
      '--text-secondary': secondaryText,
      '--text-muted': mutedText,
      '--border': rgba(accent, isLight ? 0.24 : 0.23),
      '--border-hover': rgba(accent, 0.58),
      '--grad-red': `linear-gradient(135deg, ${accent}, ${blend(accent, '#000000', isLight ? 0.38 : 0.34)})`,
      '--glow': `0 0 20px ${rgba(accent, isLight ? 0.13 : 0.17)}`,
      '--shadow': isLight ? '0 4px 24px rgba(15, 23, 42, 0.14)' : '0 4px 24px rgba(0, 0, 0, 0.52)',
      '--light-accent': validHex(settings.light_primary_color, DEFAULTS.light_primary_color),
      '--light-bg': validHex(settings.light_background_color, DEFAULTS.light_background_color),
      '--dark-accent': validHex(settings.primary_color, DEFAULTS.primary_color),
      '--dark-bg': validHex(settings.background_color, DEFAULTS.background_color),
      '--theme-text-on-accent': contrastColor(accent)
    };
  }

  function apply(mode) {
    const selected = VALID_MODES.has(mode) ? mode : preference();
    const resolved = resolvedMode(selected);
    const root = document.documentElement;
    const variables = palette(resolved);

    root.dataset.theme = resolved;
    root.dataset.themePreference = selected;
    root.style.colorScheme = resolved;
    writeVariables(root, variables);

    if (document.body) {
      document.body.dataset.theme = resolved;
      document.body.dataset.themePreference = selected;
      writeVariables(document.body, variables);
    }

    window.dispatchEvent(new CustomEvent('cigcig:themechange', {
      detail: { preference: selected, resolved, settings: { ...settings } }
    }));
    return resolved;
  }

  function configure(nextSettings) {
    settings = { ...settings, ...(nextSettings || {}) };
    const selected = preference();
    const autoAllowed = settings.device_theme_enabled !== '0';
    apply(!autoAllowed && selected === 'auto' ? 'dark' : selected);
    window.CigCigPublicSettings = { ...settings };
    return { preference: selected, resolved: document.documentElement.dataset.theme };
  }

  function setPreference(next) {
    const selected = VALID_MODES.has(next) ? next : 'auto';
    try { localStorage.setItem(STORAGE_KEY, selected); } catch {}
    const autoAllowed = settings.device_theme_enabled !== '0';
    return apply(!autoAllowed && selected === 'auto' ? 'dark' : selected);
  }

  function isAutoAllowed() {
    return settings.device_theme_enabled !== '0';
  }

  mediaQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  if (mediaQuery) {
    const onSystemChange = () => {
      if (preference() === 'auto') apply('auto');
    };
    if (mediaQuery.addEventListener) mediaQuery.addEventListener('change', onSystemChange);
    else if (mediaQuery.addListener) mediaQuery.addListener(onSystemChange);
  }

  window.CigCigTheme = {
    apply,
    configure,
    getPreference: preference,
    getResolvedMode: () => document.documentElement.dataset.theme || resolvedMode(preference()),
    isAutoAllowed,
    setPreference,
    getSettings: () => ({ ...settings })
  };

  // Apply immediately to avoid a light/dark flash before the stylesheet loads.
  apply(preference());
  document.addEventListener('DOMContentLoaded', () => apply(preference()), { once: true });
})(window, document);