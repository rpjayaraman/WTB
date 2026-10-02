/**
 * Universal Theme Initializer & Core Manager — What The Bug
 * Runs synchronously in <head> before DOM render to prevent theme flicker (FOUC).
 * Provides global ThemeManager and real-time cross-tab storage listener on ALL pages.
 */
(function() {
  const THEME_KEYS = [
    'wtb_theme',
    'dv_prep_theme',
    'uvm_book_theme',
    'sv_book_theme',
    'practical_uvm_book_theme',
    'ieee_uvm_book_theme'
  ];

  const THEME_META = {
    github: { icon: "🌌", name: "GitHub Dark" },
    nord: { icon: "❄️", name: "Nord Frost" },
    onedark: { icon: "🪐", name: "One Dark Pro" },
    dracula: { icon: "🧛", name: "Dracula Pro" },
    light: { icon: "☀️", name: "Pure Light" },
    batman: { icon: "🦇", name: "Batman Dark Knight" }
  };

  function getSavedTheme() {
    try {
      for (const k of THEME_KEYS) {
        const v = localStorage.getItem(k);
        if (v && THEME_META[v]) return v;
      }
    } catch(e) {}
    return 'github';
  }

  function applyTheme(themeName, isInit = false) {
    if (!THEME_META[themeName]) themeName = 'github';
    document.documentElement.setAttribute('data-theme', themeName);
    document.documentElement.classList.toggle('light', themeName === 'light');
    if (document.body) {
      document.body.classList.toggle('light', themeName === 'light');
    }

    try {
      THEME_KEYS.forEach(k => localStorage.setItem(k, themeName));
    } catch(e) {}

    const meta = THEME_META[themeName];
    const iconEl = document.getElementById("theme_active_icon");
    const labelEl = document.getElementById("theme_active_label");
    if (iconEl && meta) iconEl.textContent = meta.icon;
    if (labelEl && meta) labelEl.textContent = meta.name;

    document.querySelectorAll(".theme-option").forEach(opt => {
      opt.classList.remove("active");
    });
    const activeOpt = document.getElementById(`theme_opt_${themeName}`);
    if (activeOpt) activeOpt.classList.add("active");

    const themeSelect = document.getElementById("theme_select");
    if (themeSelect && themeSelect.value !== themeName) {
      themeSelect.value = themeName;
    }

    const container = document.getElementById("theme_dropdown_container");
    if (container && !isInit) container.classList.remove("open");

    // Refresh CodeMirror editor if active
    if (window.AppState && window.AppState.editor) {
      setTimeout(() => window.AppState.editor.refresh(), 50);
    }

    window.dispatchEvent(new CustomEvent('wtb-theme-change', { detail: { theme: themeName } }));
  }

  // 1. Immediately apply theme before first paint
  const initialTheme = getSavedTheme();
  document.documentElement.setAttribute('data-theme', initialTheme);
  if (initialTheme === 'light') {
    document.documentElement.classList.add('light');
  }

  // 2. Real-time cross-tab & cross-window theme synchronization
  window.addEventListener('storage', e => {
    if (THEME_KEYS.includes(e.key)) {
      if (e.newValue && THEME_META[e.newValue]) {
        applyTheme(e.newValue, true);
      }
    }
  });

  // 3. Close theme dropdown when clicking outside
  document.addEventListener('click', e => {
    const container = document.getElementById("theme_dropdown_container");
    if (container && !container.contains(e.target)) {
      container.classList.remove("open");
    }
  });

  // 4. Expose universal ThemeManager globally on all pages
  window.ThemeManager = {
    THEME_META,
    THEME_KEYS,
    getSavedTheme,
    setTheme: applyTheme,
    toggleThemeMenu: function(event) {
      if (event) event.stopPropagation();
      const container = document.getElementById('theme_dropdown_container');
      if (container) container.classList.toggle('open');
    }
  };

  // Sync active UI state on DOMContentLoaded
  document.addEventListener('DOMContentLoaded', () => {
    const current = getSavedTheme();
    applyTheme(current, true);
  });
})();
