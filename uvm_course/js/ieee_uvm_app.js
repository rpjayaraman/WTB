/**
 * Practical UVM IEEE 1800.2 Edition — Interactive Digital Book & Simulator Application
 */

(function () {
  "use strict";

  const AppState = {
    currentTheme: "github",
    currentMode: "split",
    currentModuleIndex: 0,
    currentChapterIndex: 0,
    activeFile: "",
    files: {},
    fileOriginals: {},
    editor: null,
    engine: "verilator",
    serverOnline: false,
    showListingPointers: false
  };

  const THEME_META = {
    github: { icon: "🌌", name: "GitHub Dark" },
    nord: { icon: "❄️", name: "Nord Frost" },
    onedark: { icon: "🪐", name: "One Dark Pro" },
    dracula: { icon: "🧛", name: "Dracula Pro" },
    light: { icon: "☀️", name: "Pure Light" },
    batman: { icon: "🦇", name: "Batman Dark Knight" }
  };

  function init() {
    initTheme();
    initEditor();
    checkServerStatus();
    renderSidebar();
    loadModule(0);
    initListingPointers();
  }

  const THEME_KEYS = [
    'wtb_theme',
    'dv_prep_theme',
    'uvm_book_theme',
    'sv_book_theme',
    'practical_uvm_book_theme',
    'ieee_uvm_book_theme'
  ];

  function initTheme() {
    let savedTheme = "github";
    try {
      for (const k of THEME_KEYS) {
        const v = localStorage.getItem(k);
        if (v && THEME_META[v]) {
          savedTheme = v;
          break;
        }
      }
    } catch(e) {}
    setTheme(savedTheme, true);

    // Cross-tab real-time sync
    window.addEventListener("storage", e => {
      if (THEME_KEYS.includes(e.key)) {
        if (e.newValue && THEME_META[e.newValue]) {
          setTheme(e.newValue, true);
        }
      }
    });
  }

  function setTheme(themeName, isInit = false) {
    if (!THEME_META[themeName]) themeName = "github";
    AppState.currentTheme = themeName;
    document.documentElement.setAttribute("data-theme", themeName);
    document.documentElement.classList.toggle("light", themeName === "light");
    if (document.body) {
      document.body.classList.toggle("light", themeName === "light");
    }

    try {
      THEME_KEYS.forEach(k => localStorage.setItem(k, themeName));
    } catch(e) {}

    const meta = THEME_META[themeName];
    const iconEl = document.getElementById("theme_active_icon");
    const labelEl = document.getElementById("theme_active_label");
    if (iconEl && meta) iconEl.textContent = meta.icon;
    if (labelEl && meta) labelEl.textContent = meta.name;

    document.querySelectorAll(".theme-option").forEach(opt => opt.classList.remove("active"));
    const activeOpt = document.getElementById(`theme_opt_${themeName}`);
    if (activeOpt) activeOpt.classList.add("active");

    const container = document.getElementById("theme_dropdown_container");
    if (container && !isInit) container.classList.remove("open");

    const themeSelect = document.getElementById("theme_select");
    if (themeSelect && themeSelect.value !== themeName) themeSelect.value = themeName;

    if (AppState.editor) setTimeout(() => AppState.editor.refresh(), 50);
  }

  function toggleThemeMenu(e) {
    if (e) { e.stopPropagation(); e.preventDefault(); }
    const container = document.getElementById("theme_dropdown_container");
    if (container) container.classList.toggle("open");
  }

  function setViewMode(mode) {
    AppState.currentMode = mode;
    document.body.className = `mode-${mode}`;
    document.querySelectorAll(".mode-btn").forEach(btn => btn.classList.remove("active"));
    const activeBtn = document.getElementById(`btn_mode_${mode}`);
    if (activeBtn) activeBtn.classList.add("active");
    if (AppState.editor) setTimeout(() => AppState.editor.refresh(), 50);
  }

  function checkServerStatus() {
    fetch("/api/status")
      .then(res => res.json())
      .then(data => {
        AppState.serverOnline = (data.status === "online");
        const badge = document.getElementById("server_status_badge");
        if (badge) {
          badge.textContent = "🟢 Live Sim Active";
          badge.style.color = "var(--accent-green)";
        }
      })
      .catch(() => {
        AppState.serverOnline = false;
        const badge = document.getElementById("server_status_badge");
        if (badge) {
          badge.textContent = "⚪ Static Mode";
          badge.style.color = "var(--text-muted)";
        }
      });
  }

  function initEditor() {
    const textarea = document.getElementById("code_editor");
    if (!textarea) return;

    AppState.editor = CodeMirror.fromTextArea(textarea, {
      lineNumbers: true,
      mode: "verilog",
      theme: "default",
      matchBrackets: true,
      autoCloseBrackets: true,
      lineWrapping: true,
      indentUnit: 2,
      tabSize: 2
    });

    AppState.editor.on("change", () => {
      if (AppState.activeFile) {
        AppState.files[AppState.activeFile] = AppState.editor.getValue();
      }
    });
  }

  function renderSidebar() {
    const container = document.getElementById("sidebar_modules");
    if (!container || !window.IEEE_UVM_DATA) return;

    const modules = window.IEEE_UVM_DATA.modules || [];
    let html = "";

    modules.forEach((mod, idx) => {
      html += `
        <div class="chapter-item ${idx === AppState.currentModuleIndex ? 'active' : ''}" 
             onclick="IEEEUVMApp.loadModule(${idx})">
          <div style="display: flex; flex-direction: column; gap: 2px;">
            <div style="font-weight: 700; font-size: 0.78rem;">${mod.number}. ${escapeHtml(mod.title)}</div>
            <div style="font-size: 0.68rem; opacity: 0.7;">${escapeHtml(mod.category)}</div>
          </div>
        </div>
      `;
    });

    container.innerHTML = html;
  }

  function loadModule(modIdx) {
    if (!window.IEEE_UVM_DATA) return;
    const modules = window.IEEE_UVM_DATA.modules || [];
    if (modIdx < 0 || modIdx >= modules.length) return;

    AppState.currentModuleIndex = modIdx;
    const mod = modules[modIdx];

    document.querySelectorAll(".chapter-item").forEach((el, i) => {
      el.classList.toggle("active", i === modIdx);
    });


    // Render Textbook Content
    const textbookEl = document.getElementById("textbook_content");
    if (textbookEl) {
      textbookEl.innerHTML = `
        <div class="chapter-header">
          <div class="chapter-badge">IEEE 1800.2 • ${escapeHtml(mod.category)}</div>
          <h1>${escapeHtml(mod.title)}</h1>
          <p class="chapter-meta">📖 ${escapeHtml(mod.book_chapter)}</p>
        </div>
        <div class="markdown-body">
          ${formatMarkdown(mod.full_text)}
        </div>
      `;
    }

    // Load Files into Playground
    AppState.files = { ...(mod.files || {}) };
    AppState.fileOriginals = { ...(mod.files || {}) };
    renderFileTabs();

    // Select suitable main testbench file
    const fileKeys = Object.keys(AppState.files);
    let mainFile = mod.mainFile;
    if (!mainFile || !AppState.files[mainFile]) {
      mainFile = fileKeys.find(f => f.includes("top") || f.includes("tb") || f.includes("test")) || fileKeys[0] || "";
    }
    selectFile(mainFile);

    // Clear output console
    const consoleEl = document.getElementById("sim_output");
    if (consoleEl) {
      consoleEl.innerHTML = `<span style="color: var(--text-muted);">Simulator ready. Click 'Run Simulation' to execute with Verilator or Xezim.</span>`;
    }
  }

  function renderFileTabs() {
    const tabsContainer = document.getElementById("file_tabs");
    if (!tabsContainer) return;

    const fileNames = Object.keys(AppState.files);
    let html = "";
    fileNames.forEach(fn => {
      const active = (fn === AppState.activeFile) ? "active" : "";
      html += `
        <div class="file-tab ${active}" onclick="IEEEUVMApp.selectFile('${escapeHtml(fn)}')">
          <span class="file-icon">📄</span>
          <span>${escapeHtml(fn)}</span>
        </div>
      `;
    });
    tabsContainer.innerHTML = html;
  }

  function selectFile(fn) {
    if (!AppState.files.hasOwnProperty(fn)) {
      fn = Object.keys(AppState.files)[0] || "";
    }
    AppState.activeFile = fn;
    renderFileTabs();

    if (AppState.editor) {
      AppState.editor.setValue(AppState.files[fn] || "");
      AppState.editor.clearHistory();
    }
  }

  function resetCode() {
    if (AppState.activeFile && AppState.fileOriginals.hasOwnProperty(AppState.activeFile)) {
      AppState.files[AppState.activeFile] = AppState.fileOriginals[AppState.activeFile];
      if (AppState.editor) {
        AppState.editor.setValue(AppState.files[AppState.activeFile]);
      }
    }
  }

  function switchEngine(val) {
    AppState.engine = val;
  }

  function runSimulation() {
    const consoleEl = document.getElementById("sim_output");
    const runBtn = document.getElementById("btn_run_sim");
    if (runBtn) runBtn.disabled = true;

    if (consoleEl) {
      consoleEl.innerHTML = `<span style="color: var(--accent-primary);">⚡ Compiling and executing ${AppState.activeFile} with ${AppState.engine.toUpperCase()}...</span>\n`;
    }

    const payload = {
      files: AppState.files,
      engine: AppState.engine,
      active_file: AppState.activeFile,
      top: "top",
      is_sv: false
    };

    fetch("/api/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
      .then(res => res.json())
      .then(data => {
        if (runBtn) runBtn.disabled = false;
        if (!consoleEl) return;

        if (data.error) {
          let errDetail = data.stderr || data.stdout || data.error;
          consoleEl.innerHTML = `<span style="color: var(--accent-red);">❌ Simulation Failed:</span>\n${colorizeSimOutput(errDetail)}`;
          return;
        }

        let out = data.stdout || data.stderr || "Simulation completed cleanly.";
        let coloredOut = colorizeSimOutput(out);
        consoleEl.innerHTML = coloredOut;
        consoleEl.scrollTop = consoleEl.scrollHeight;
      })
      .catch(err => {
        if (runBtn) runBtn.disabled = false;
        if (consoleEl) {
          consoleEl.innerHTML = `<span style="color: var(--accent-red);">❌ Simulation request failed: ${escapeHtml(String(err))}</span>`;
        }
      });
  }

  function initListingPointers() {
    const lpList = (window.IEEE_UVM_DATA && window.IEEE_UVM_DATA.listing_pointers) || [];
    const container = document.getElementById("listing_pointers_modal_body");
    if (!container) return;

    let html = "";
    lpList.forEach(lp => {
      html += `
        <div class="lp-item" onclick="IEEEUVMApp.viewListingPointer('${escapeHtml(lp.name)}')">
          <div class="lp-name">📌 ${escapeHtml(lp.name)}</div>
          <div class="lp-filename">${escapeHtml(lp.filename)} (${lp.lines} lines)</div>
        </div>
      `;
    });
    container.innerHTML = html;
  }

  function toggleListingModal(show) {
    const modal = document.getElementById("listing_modal");
    if (modal) {
      modal.style.display = show ? "flex" : "none";
    }
  }

  function viewListingPointer(lpName) {
    const lpList = (window.IEEE_UVM_DATA && window.IEEE_UVM_DATA.listing_pointers) || [];
    const target = lpList.find(p => p.name === lpName);
    if (!target) return;

    toggleListingModal(false);
    AppState.files[target.filename] = target.content;
    renderFileTabs();
    selectFile(target.filename);
  }

  function colorizeSimOutput(text) {
    return escapeHtml(text)
      .replace(/(UVM_INFO[^\n]*)/g, '<span style="color: #58a6ff;">$1</span>')
      .replace(/(UVM_WARNING[^\n]*)/g, '<span style="color: #d29922;">$1</span>')
      .replace(/(UVM_ERROR[^\n]*)/g, '<span style="color: #f85149; font-weight: bold;">$1</span>')
      .replace(/(UVM_FATAL[^\n]*)/g, '<span style="color: #ff7b72; font-weight: bold; background: rgba(248,81,73,0.15);">$1</span>')
      .replace(/(Simulation finished[^\n]*)/g, '<span style="color: #3fb950; font-weight: bold;">$1</span>');
  }

  function formatMarkdown(md) {
    if (!md) return "";

    const codeBlocks = [];

    // 1. Extract fenced code blocks into placeholders first
    let html = md.replace(/```([a-z0-9_-]*)\n([\s\S]*?)```/gim, function (match, lang, code) {
      const id = `___CODE_BLOCK_${codeBlocks.length}___`;
      codeBlocks.push(`<pre class="code-block"><code class="language-${lang || 'verilog'}">${escapeHtml(code.trim())}</code></pre>`);
      return id;
    });

    // 2. Extract inline code blocks into placeholders
    const inlineCodes = [];
    html = html.replace(/`([^`\n]+)`/g, function (match, code) {
      const id = `___INLINE_CODE_${inlineCodes.length}___`;
      inlineCodes.push(`<code class="inline-code">${escapeHtml(code)}</code>`);
      return id;
    });

    // 3. Headers
    html = html.replace(/^### (.*$)/gim, '<h3 class="md-h3">$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2 class="md-h2">$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1 class="md-h1">$1</h1>');

    // 4. Bold and Italic
    html = html.replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/gim, '<em>$1</em>');

    // 5. Unordered list items (- item or * item)
    const lines = html.split('\n');
    let inList = false;
    let newLines = [];

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      let match = line.match(/^\s*[-\*]\s+(.*)$/);
      if (match) {
        if (!inList) {
          newLines.push('<ul>');
          inList = true;
        }
        newLines.push(`  <li>${match[1]}</li>`);
      } else {
        if (inList) {
          newLines.push('</ul>');
          inList = false;
        }
        newLines.push(line);
      }
    }
    if (inList) {
      newLines.push('</ul>');
    }
    html = newLines.join('\n');

    // 6. Split into paragraph blocks
    const rawBlocks = html.split(/\n\s*\n/);
    const parsedBlocks = rawBlocks.map(block => {
      block = block.trim();
      if (!block) return "";
      if (/^<h[1-6]|^<ul>|^<ol|^<div|^<pre|^___CODE_BLOCK_\d+___/.test(block)) {
        return block;
      }
      return `<p class="md-p">${block.replace(/\n/g, "<br>")}</p>`;
    });

    html = parsedBlocks.filter(b => b.length > 0).join("\n\n");

    // 7. Restore inline code placeholders
    inlineCodes.forEach((codeHtml, idx) => {
      html = html.replace(new RegExp(`___INLINE_CODE_${idx}___`, 'g'), codeHtml);
    });

    // 8. Restore fenced code block placeholders
    codeBlocks.forEach((codeHtml, idx) => {
      html = html.replace(new RegExp(`___CODE_BLOCK_${idx}___`, 'g'), codeHtml);
    });

    return html;
  }


  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  window.IEEEUVMApp = {
    init,
    setTheme,
    toggleThemeMenu,
    setViewMode,
    loadModule,
    selectFile,
    resetCode,
    switchEngine,
    runSimulation,
    toggleListingModal,
    viewListingPointer
  };

  document.addEventListener("DOMContentLoaded", init);
})();
