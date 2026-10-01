/**
 * UVM Digital Book & Verification Battle Station - Main Application Controller
 * Modeled after WhatTheBug with Tri-Mode Reader & Verilator-First Simulation
 */

(function() {
  const AppState = {
    currentMode: "split", // 'reader', 'split', 'studio'
    currentTheme: localStorage.getItem("uvm_book_theme") || "github",
    activeModuleId: "mod-03",
    activeChapterId: "03-severity",
    activeFileName: null,
    activeFiles: {}, // filename -> content
    currentEngine: "verilator",
    completedChapters: new Set(JSON.parse(localStorage.getItem("uvm_completed_chapters") || "[]")),
    moduleLogs: JSON.parse(localStorage.getItem("uvm_module_logs") || "{}"),
    editor: null,
    isSimulating: false,
    serverStatus: null
  };

  // Helper to format Markdown with alerts and styling
  function renderMarkdown(mdText) {
    if (!mdText) return "";

    let html = mdText
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    // Code blocks
    html = html.replace(/```(verilog|systemverilog|sv|)([\s\S]*?)```/g, function(match, lang, code) {
      return `<pre><code>${code.trim()}</code></pre>`;
    });

    // Inline code
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

    // Alerts: > [!NOTE], > [!TIP], > [!IMPORTANT], > [!WARNING]
    html = html.replace(/&gt; \[!NOTE\]\s*([\s\S]*?)(?=(\n\n|&gt; \[!|$))/g, function(match, content) {
      return `<div class="callout callout-note"><div class="callout-title">ℹ️ Note</div>${content.trim()}</div>`;
    });
    html = html.replace(/&gt; \[!TIP\]\s*([\s\S]*?)(?=(\n\n|&gt; \[!|$))/g, function(match, content) {
      return `<div class="callout callout-tip"><div class="callout-title">💡 Pro Tip</div>${content.trim()}</div>`;
    });
    html = html.replace(/&gt; \[!IMPORTANT\]\s*([\s\S]*?)(?=(\n\n|&gt; \[!|$))/g, function(match, content) {
      return `<div class="callout callout-important"><div class="callout-title">⚠️ Important</div>${content.trim()}</div>`;
    });
    html = html.replace(/&gt; \[!WARNING\]\s*([\s\S]*?)(?=(\n\n|&gt; \[!|$))/g, function(match, content) {
      return `<div class="callout callout-warning"><div class="callout-title">🚨 Warning</div>${content.trim()}</div>`;
    });

    // Headings
    html = html.replace(/^### (.*$)/gim, "<h3>$1</h3>");
    html = html.replace(/^## (.*$)/gim, "<h2>$1</h2>");
    html = html.replace(/^# (.*$)/gim, "<h1>$1</h1>");

    // Bold & italic
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");

    // Bullet lists
    html = html.replace(/^\* (.*$)/gim, "<li>$1</li>");
    html = html.replace(/(<li>[\s\S]*?<\/li>)/g, "<ul>$1</ul>");

    // Paragraphs
    html = html.split("\n\n").map(p => {
      p = p.trim();
      if (!p.startsWith("<h") && !p.startsWith("<pre") && !p.startsWith("<ul") && !p.startsWith("<div")) {
        return `<p>${p}</p>`;
      }
      return p;
    }).join("\n");

    return html;
  }

  // Colorize UVM logs with high readability
  function colorizeUvmLog(text) {
    if (!text) return "";
    const lines = text.split("\n");
    return lines.map(line => {
      let escaped = line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      if (escaped.includes("UVM_FATAL")) {
        return `<span class="log-fatal">${escaped}</span>`;
      } else if (escaped.includes("UVM_ERROR")) {
        return `<span class="log-error">${escaped}</span>`;
      } else if (escaped.includes("UVM_WARNING")) {
        return `<span class="log-warning">${escaped}</span>`;
      } else if (escaped.includes("UVM_INFO")) {
        return `<span class="log-info">${escaped}</span>`;
      } else if (escaped.includes("--- UVM Report Summary ---") || escaped.includes("Report counts by severity")) {
        return `<span class="log-report">${escaped}</span>`;
      } else if (escaped.includes("[PHASE]") || escaped.includes("phase") || escaped.includes("Running test")) {
        return `<span class="log-phase">${escaped}</span>`;
      }
      return escaped;
    }).join("\n");
  }

  // Per-Module Log Management
  function addModuleLog(chapterId, entry) {
    if (!AppState.moduleLogs[chapterId]) {
      AppState.moduleLogs[chapterId] = [];
    }
    AppState.moduleLogs[chapterId].unshift(entry);
    if (AppState.moduleLogs[chapterId].length > 20) {
      AppState.moduleLogs[chapterId] = AppState.moduleLogs[chapterId].slice(0, 20);
    }
    localStorage.setItem("uvm_module_logs", JSON.stringify(AppState.moduleLogs));
  }

  function renderModuleLogs() {
    const logEl = document.getElementById("module_log_view");
    if (!logEl) return;

    const logs = AppState.moduleLogs[AppState.activeChapterId] || [];
    if (logs.length === 0) {
      logEl.innerHTML = '<span style="color: var(--text-muted);">No simulation logs yet for this module.\nRun a simulation to generate logs.</span>';
      return;
    }

    let html = `<span style="color: var(--neon-cyan); font-weight: bold;">\u{1f4dc} Simulation History \u2014 ${AppState.activeChapterId} (${logs.length} runs)</span>\n`;
    html += '\u2500'.repeat(70) + '\n\n';

    logs.forEach((log, i) => {
      const statusColor = log.exitCode === 0 ? 'var(--neon-green)' : 'var(--neon-red)';
      const statusText = log.exitCode === 0 ? '\u2705 PASS' : '\u274c FAIL';
      html += `<span style="color: var(--text-muted);">Run #${logs.length - i}</span>  `;
      html += `<span style="color: var(--neon-cyan);">${log.timestamp}</span>  `;
      html += `<span style="color: ${statusColor}; font-weight: bold;">${statusText}</span>  `;
      html += `<span style="color: var(--text-muted);">Engine: ${log.engine} | ${log.totalTime}ms</span>\n`;
      const preview = (log.output || '').split('\n').slice(0, 5).join('\n');
      html += `<span style="color: var(--text-secondary);">${preview.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</span>\n`;
      html += '\u2500'.repeat(50) + '\n';
    });

    logEl.innerHTML = html;
  }

  // Check Backend Server Availability
  async function checkServerStatus() {
    try {
      const resp = await fetch("/api/status", { method: "GET" });
      if (resp.ok) {
        AppState.serverStatus = await resp.json();
        const badge = document.getElementById("server_status_badge");
        if (badge) {
          badge.innerHTML = "🟢 Live Verilator Server";
          badge.title = "Connected to local Verilator 5.050 & Xezim server";
        }
      }
    } catch (e) {
      const badge = document.getElementById("server_status_badge");
      if (badge) {
        badge.innerHTML = "⚪ Standalone Mode";
        badge.title = "Local server not running. Run './run_book.sh' for live Verilator execution.";
      }
    }
  }

  const THEME_META = {
    github: { icon: "🌌", name: "GitHub Dark" },
    nord: { icon: "❄️", name: "Nord Frost" },
    onedark: { icon: "🪐", name: "One Dark Pro" },
    dracula: { icon: "🧛", name: "Dracula Pro" },
    light: { icon: "☀️", name: "Pure Light" },
    batman: { icon: "🦇", name: "Batman Dark Knight" }
  };

  function setTheme(themeName) {
    if (!THEME_META[themeName]) themeName = "github";
    AppState.currentTheme = themeName;
    document.documentElement.setAttribute("data-theme", themeName);
    localStorage.setItem("uvm_book_theme", themeName);

    // Update active trigger badge
    const meta = THEME_META[themeName];
    const iconEl = document.getElementById("theme_active_icon");
    const labelEl = document.getElementById("theme_active_label");
    if (iconEl) iconEl.textContent = meta.icon;
    if (labelEl) labelEl.textContent = meta.name;

    // Update active class in dropdown options
    document.querySelectorAll(".theme-option").forEach(opt => {
      opt.classList.remove("active");
    });
    const activeOpt = document.getElementById(`theme_opt_${themeName}`);
    if (activeOpt) activeOpt.classList.add("active");

    // Close menu if open
    const container = document.getElementById("theme_dropdown_container");
    if (container) container.classList.remove("open");

    const themeSelect = document.getElementById("theme_select");
    if (themeSelect && themeSelect.value !== themeName) {
      themeSelect.value = themeName;
    }

    if (AppState.editor) {
      setTimeout(() => AppState.editor.refresh(), 50);
    }
  }

  function toggleThemeMenu(e) {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    const container = document.getElementById("theme_dropdown_container");
    if (container) {
      container.classList.toggle("open");
    }
  }

  // UI Setup & Event Listeners
  function initApp() {
    setTheme(AppState.currentTheme);
    initCodeMirror();
    buildCurriculumSidebar();
    setupEventListeners();
    setupResizer();
    checkServerStatus();

    // Select initial chapter
    selectChapter(AppState.activeChapterId);
    updateProgressDisplay();
  }

  function initCodeMirror() {
    const textarea = document.getElementById("code_editor");
    if (!textarea) return;

    if (window.CodeMirror) {
      AppState.editor = CodeMirror.fromTextArea(textarea, {
        lineNumbers: true,
        mode: "verilog",
        theme: "uvm-studio",
        tabSize: 2,
        indentUnit: 2,
        matchBrackets: true,
        styleActiveLine: true,
        lineWrapping: true
      });

      AppState.editor.on("change", function() {
        if (AppState.activeFileName && AppState.activeFiles) {
          AppState.activeFiles[AppState.activeFileName] = AppState.editor.getValue();
        }
      });
    }
  }

  function buildCurriculumSidebar() {
    const listEl = document.getElementById("curriculum_list");
    if (!listEl || !window.UVM_COURSE_DATABASE) return;

    listEl.innerHTML = "";

    window.UVM_COURSE_DATABASE.forEach(mod => {
      const modEl = document.createElement("div");
      modEl.className = "module-group";

      const headerEl = document.createElement("div");
      headerEl.className = "module-header";
      headerEl.innerHTML = `
        <span>${mod.title}</span>
        <span style="font-size: 0.65rem; opacity: 0.7;">${mod.chapters.length} labs ▾</span>
      `;

      const chaptersContainer = document.createElement("div");
      chaptersContainer.className = "module-chapters";

      mod.chapters.forEach(ch => {
        const itemEl = document.createElement("div");
        itemEl.className = `chapter-item ${ch.id === AppState.activeChapterId ? 'active' : ''}`;
        itemEl.id = `nav_${ch.id}`;
        
        const isDone = AppState.completedChapters.has(ch.id);

        itemEl.innerHTML = `
          <div style="display: flex; align-items: center; gap: 0.5rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            <input type="checkbox" ${isDone ? 'checked' : ''} onclick="event.stopPropagation(); window.App.toggleChapterDone('${ch.id}')" title="Mark as Mastered" style="cursor: pointer;">
            <span>${ch.title}</span>
          </div>
          <span class="chapter-badge">${ch.readTime}</span>
        `;

        itemEl.onclick = () => selectChapter(ch.id);
        chaptersContainer.appendChild(itemEl);
      });

      headerEl.onclick = () => {
        chaptersContainer.style.display = chaptersContainer.style.display === "none" ? "block" : "none";
      };

      modEl.appendChild(headerEl);
      modEl.appendChild(chaptersContainer);
      listEl.appendChild(modEl);
    });
  }

  function selectChapter(chapterId) {
    if (!window.UVM_COURSE_DATABASE) return;

    let targetMod = null;
    let targetCh = null;

    for (const mod of window.UVM_COURSE_DATABASE) {
      for (const ch of mod.chapters) {
        if (ch.id === chapterId) {
          targetMod = mod;
          targetCh = ch;
          break;
        }
      }
      if (targetCh) break;
    }

    if (!targetCh) return;

    AppState.activeModuleId = targetMod.id;
    AppState.activeChapterId = targetCh.id;

    // Update active nav styling
    document.querySelectorAll(".chapter-item").forEach(el => el.classList.remove("active"));
    const navItem = document.getElementById(`nav_${chapterId}`);
    if (navItem) navItem.classList.add("active");

    // Update breadcrumbs
    const bcMod = document.getElementById("bc_module");
    const bcCh = document.getElementById("bc_chapter");
    if (bcMod) bcMod.textContent = targetMod.title;
    if (bcCh) bcCh.textContent = targetCh.title;

    // Render Digital Book Reader Pane
    renderReaderContent(targetMod, targetCh);

    // Load Files into Code Lab Editor
    loadCodeFiles(targetCh);

    // Render Topology & Phasing Diagram
    if (window.UVMVisualizer) {
      window.UVMVisualizer.renderTopology("topology_view", targetCh.id);
      window.UVMVisualizer.renderPhaseTimeline("phase_timeline_view");
    }

    // Set Golden Reference Log
    const refLogEl = document.getElementById("golden_log_view");
    if (refLogEl) {
      refLogEl.innerHTML = colorizeUvmLog(targetCh.goldenLog || "No golden log captured for this chapter.");
    }

    // Update Dynamic CLI input
    updateCommandLine();

    // Render Module Logs
    renderModuleLogs();
  }

  function renderReaderContent(mod, ch) {
    const bodyEl = document.getElementById("reader_body");
    if (!bodyEl) return;

    let markdown = `# ${ch.title}\n\n`;
    markdown += `> [!NOTE]\n> **Module**: ${mod.title} · **Estimated Time**: ${ch.readTime} · **Level**: ${ch.difficulty}\n\n`;

    // Theory excerpts from wiki
    if (mod.full_wiki_text) {
      // Extract relevant section
      const lines = mod.full_wiki_text.split("\n");
      const filtered = lines.slice(0, 75).join("\n");
      markdown += filtered + "\n\n";
    }

    // Embed Mission Card
    if (ch.mission) {
      markdown += `\n\n### 🎯 Student Lab Mission\n`;
      markdown += `> [!TIP]\n> **Objective**: ${ch.mission.task}\n>\n> **Hint**: ${ch.mission.hint}\n\n`;
    }

    bodyEl.innerHTML = renderMarkdown(markdown);
  }

  function loadCodeFiles(ch) {
    AppState.activeFiles = {};
    if (ch.files && Object.keys(ch.files).length > 0) {
      AppState.activeFiles = JSON.parse(JSON.stringify(ch.files));
    } else {
      AppState.activeFiles = {
        "top.sv": "`include \"uvm_macros.svh\"\nimport uvm_pkg::*;\n\nmodule top;\n  initial begin\n    `uvm_info(\"TOP\", \"Hello UVM!\", UVM_NONE)\n  end\nendmodule\n"
      };
    }

    // Build file tabs
    const tabsContainer = document.getElementById("editor_tabs");
    if (!tabsContainer) return;

    tabsContainer.innerHTML = "";
    const fnames = Object.keys(AppState.activeFiles);
    
    // Choose primary active file
    AppState.activeFileName = ch.mainFile && AppState.activeFiles[ch.mainFile] ? ch.mainFile : fnames[0];

    fnames.forEach(fn => {
      const tab = document.createElement("div");
      tab.className = `file-tab ${fn === AppState.activeFileName ? 'active' : ''}`;
      tab.id = `tab_${fn.replace(/[^a-zA-Z0-9]/g, '_')}`;
      tab.innerHTML = `<span>📄</span> ${fn}`;
      tab.onclick = () => switchFileTab(fn);
      tabsContainer.appendChild(tab);
    });

    if (AppState.editor) {
      AppState.editor.setValue(AppState.activeFiles[AppState.activeFileName] || "");
      AppState.editor.refresh();
    }
  }

  function switchFileTab(fileName) {
    if (!AppState.activeFiles[fileName]) return;

    // Save current file text
    if (AppState.activeFileName && AppState.editor) {
      AppState.activeFiles[AppState.activeFileName] = AppState.editor.getValue();
    }

    AppState.activeFileName = fileName;

    document.querySelectorAll(".file-tab").forEach(t => t.classList.remove("active"));
    const tabEl = document.getElementById(`tab_${fileName.replace(/[^a-zA-Z0-9]/g, '_')}`);
    if (tabEl) tabEl.classList.add("active");

    if (AppState.editor) {
      AppState.editor.setValue(AppState.activeFiles[fileName]);
      AppState.editor.refresh();
    }

    updateCommandLine();
  }

  function stripComments(code) {
    if (!code) return "";
    return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  }

  function detectTopModule() {
    for (const [fname, content] of Object.entries(AppState.activeFiles || {})) {
      const clean = stripComments(content);
      const match = clean.match(/\bmodule\s+([a-zA-Z0-9_]+)/);
      if (match && match[1] && match[1] !== "uvm_pkg") {
        return match[1];
      }
    }
    return "top";
  }

  function updateCommandLine() {
    const input = document.getElementById("cli_command_input");
    if (!input) return;

    const verbosity = document.getElementById("sel_verbosity")?.value || "UVM_MEDIUM";
    const files = Object.keys(AppState.activeFiles || {}).join(" ");
    const engine = AppState.currentEngine;
    const topMod = detectTopModule();

    if (engine === "verilator") {
      input.value = `verilator --binary --timing -Wno-fatal +define+UVM_NO_DPI -I$UVM_SRC $UVM_PKG ${files} --top-module ${topMod} -j 4 && ./obj_dir/V${topMod} +UVM_VERBOSITY=${verbosity}`;
    } else {
      input.value = `xezim -I$UVM_SRC $UVM_PKG ${files} +UVM_VERBOSITY=${verbosity}`;
    }
  }

  async function runSimulation() {
    if (AppState.isSimulating) return;

    const btn = document.getElementById("btn_run_sim");
    const term = document.getElementById("terminal_output");
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `⏳ Simulating (${AppState.currentEngine.toUpperCase()})...`;
    }

    AppState.isSimulating = true;
    switchOutputTab("console");

    // Save editor value
    if (AppState.activeFileName && AppState.editor) {
      AppState.activeFiles[AppState.activeFileName] = AppState.editor.getValue();
    }

    const verbosity = document.getElementById("sel_verbosity")?.value || "UVM_MEDIUM";
    const plusargs = [`+UVM_VERBOSITY=${verbosity}`];

    term.innerHTML = `<span style="color: var(--neon-cyan);">⚡ Starting compilation & simulation with ${AppState.currentEngine.toUpperCase()} engine...</span>\n`;

    const payload = {
      files: AppState.activeFiles,
      engine: AppState.currentEngine,
      top: detectTopModule(),
      plusargs: plusargs
    };

    try {
      const resp = await fetch("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!resp.ok) {
        throw new Error(`HTTP error ${resp.status}`);
      }

      const res = await resp.json();
      AppState.isSimulating = false;
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `▶ Run Simulation`;
      }

      let out = "";
      if (res.compile_stdout) out += res.compile_stdout + "\n";
      if (res.compile_stderr) out += res.compile_stderr + "\n";
      if (res.stdout) out += res.stdout + "\n";
      if (res.stderr) out += res.stderr + "\n";

      if (!out.trim()) {
        out = `Simulation finished with exit code ${res.exit_code}. (No output produced)`;
      }

      term.innerHTML = colorizeUvmLog(out);

      // Handle Waveform in Surfer
      const vcdData = res.vcd || res.vcd_text;
      if (vcdData && window.SurferBridge) {
        window.SurferBridge.loadVcd(vcdData);
        const surferBtn = document.getElementById("btn_tab_surfer");
        if (surferBtn) {
          surferBtn.style.color = "#c4b5fd";
          surferBtn.style.borderColor = "rgba(167,139,250,0.8)";
        }
      }

      // Update Benchmark Stats
      const statEl = document.getElementById("stat_output");
      if (statEl) {
        statEl.innerHTML = `
          <div style="padding: 1rem; font-family: var(--font-mono); font-size: 0.8rem;">
            <div>⚙️ Engine: <span style="color: var(--neon-cyan); font-weight: bold;">${res.engine.toUpperCase()}</span></div>
            <div>⏱️ Compile Time: <strong>${res.compile_time_ms || 0} ms</strong></div>
            <div>⚡ Simulation Time: <strong>${res.sim_time_ms || 0} ms</strong></div>
            <div>📊 Total Elapsed: <strong>${res.total_time_ms || 0} ms</strong></div>
            <div>🏁 Exit Status: <strong style="color: ${res.exit_code === 0 ? 'var(--neon-green)' : 'var(--neon-red)'};">${res.exit_code === 0 ? 'SUCCESS (0)' : 'FAILED (' + res.exit_code + ')'}</strong></div>
          </div>
        `;
      }

      // Automatically offer to mark completed on success
      if (res.exit_code === 0 && !AppState.completedChapters.has(AppState.activeChapterId)) {
        AppState.completedChapters.add(AppState.activeChapterId);
        localStorage.setItem("uvm_completed_chapters", JSON.stringify(Array.from(AppState.completedChapters)));
        updateProgressDisplay();
        const checkbox = document.querySelector(`#nav_${AppState.activeChapterId} input[type="checkbox"]`);
        if (checkbox) checkbox.checked = true;
      }

      // Save Module Log
      addModuleLog(AppState.activeChapterId, {
        timestamp: new Date().toLocaleString(),
        engine: res.engine || AppState.currentEngine,
        exitCode: res.exit_code,
        totalTime: res.total_time_ms || 0,
        output: (out || '').substring(0, 500)
      });
      renderModuleLogs();

    } catch (err) {
      AppState.isSimulating = false;
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `▶ Run Simulation`;
      }

      // Offline Fallback using golden reference log
      term.innerHTML = `
<span style="color: var(--neon-amber);">⚠️ Local server not detected at /api/simulate.</span>
<span style="color: #94a3b8;">Displaying verified golden reference simulation output:</span>
--------------------------------------------------------------------------------
${colorizeUvmLog(document.getElementById("golden_log_view")?.innerText || "No reference log.")}
`;
    }
  }

  function switchOutputTab(tabKey) {
    document.querySelectorAll(".console-tab-btn").forEach(b => b.classList.remove("active"));
    const activeBtn = document.getElementById(`btn_tab_${tabKey}`);
    if (activeBtn) activeBtn.classList.add("active");

    const views = ["console", "surfer", "waveform", "topology", "reference", "log", "stats"];
    views.forEach(v => {
      const el = document.getElementById(`view_${v}`);
      if (el) el.style.display = (v === tabKey) ? (v === "surfer" ? "flex" : "block") : "none";
    });
  }

  function setViewMode(mode) {
    AppState.currentMode = mode;
    document.body.className = `mode-${mode}`;

    document.querySelectorAll(".mode-btn").forEach(b => b.classList.remove("active"));
    const activeBtn = document.getElementById(`btn_mode_${mode}`);
    if (activeBtn) activeBtn.classList.add("active");

    if (AppState.editor) {
      setTimeout(() => AppState.editor.refresh(), 100);
    }
  }

  function toggleChapterDone(chapterId) {
    if (AppState.completedChapters.has(chapterId)) {
      AppState.completedChapters.delete(chapterId);
    } else {
      AppState.completedChapters.add(chapterId);
    }
    localStorage.setItem("uvm_completed_chapters", JSON.stringify(Array.from(AppState.completedChapters)));
    updateProgressDisplay();
  }

  function updateProgressDisplay() {
    const totalChapters = 28;
    const done = AppState.completedChapters.size;
    const pct = Math.round((done / totalChapters) * 100);

    const progEl = document.getElementById("progress_display");
    if (progEl) {
      progEl.innerHTML = `<span>⚡ Mastery:</span> <strong>${pct}%</strong> (${done}/${totalChapters})`;
    }
  }

  function setupResizer() {
    const resizer = document.getElementById("console_resizer");
    const drawer = document.getElementById("console_drawer");
    if (!resizer || !drawer) return;

    let isResizing = false;
    let startY, startHeight;

    resizer.addEventListener("mousedown", e => {
      isResizing = true;
      startY = e.clientY;
      startHeight = drawer.offsetHeight;
      document.body.style.cursor = "ns-resize";
    });

    window.addEventListener("mousemove", e => {
      if (!isResizing) return;
      const delta = startY - e.clientY;
      const newH = Math.max(80, Math.min(window.innerHeight - 200, startHeight + delta));
      drawer.style.height = `${newH}px`;
    });

    window.addEventListener("mouseup", () => {
      if (isResizing) {
        isResizing = false;
        document.body.style.cursor = "";
      }
    });
  }

  function setupEventListeners() {
    // Search filter
    const searchInput = document.getElementById("search_input");
    if (searchInput) {
      searchInput.addEventListener("input", e => {
        const query = e.target.value.toLowerCase();
        document.querySelectorAll(".chapter-item").forEach(item => {
          const text = item.textContent.toLowerCase();
          item.style.display = text.includes(query) ? "flex" : "none";
        });
      });
    }

    // Theme selector
    const themeSelect = document.getElementById("theme_select");
    if (themeSelect) {
      themeSelect.addEventListener("change", e => {
        setTheme(e.target.value);
      });
    }

    // Engine selector
    const engineSelect = document.getElementById("engine_select");
    if (engineSelect) {
      engineSelect.addEventListener("change", e => {
        AppState.currentEngine = e.target.value;
        updateCommandLine();
      });
    }

    // Verbosity selector
    const verbSelect = document.getElementById("sel_verbosity");
    if (verbSelect) {
      verbSelect.addEventListener("change", updateCommandLine);
    }

    // Close theme dropdown when clicking outside or pressing Escape
    document.addEventListener("click", e => {
      const container = document.getElementById("theme_dropdown_container");
      if (container && !container.contains(e.target)) {
        container.classList.remove("open");
      }
    });

    document.addEventListener("keydown", e => {
      if (e.key === "Escape") {
        const container = document.getElementById("theme_dropdown_container");
        if (container) container.classList.remove("open");
      }
    });
  }

  // Expose global API for inline button handlers
  window.App = {
    setViewMode,
    setTheme,
    toggleThemeMenu,
    selectChapter,
    switchFileTab,
    runSimulation,
    switchOutputTab,
    toggleChapterDone,
    resetCurrentCode: function() {
      if (!confirm("Reset code to chapter original?")) return;
      selectChapter(AppState.activeChapterId);
    },
    copyCommandLine: function() {
      const input = document.getElementById("cli_command_input");
      if (input) {
        navigator.clipboard.writeText(input.value);
        alert("Command copied to clipboard!");
      }
    }
  };

  window.addEventListener("DOMContentLoaded", initApp);
})();
