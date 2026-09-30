/**
 * Practical UVM: Step By Step — Digital Book & Lab Controller
 * Drives the interactive textbook, multi-file verification editor, and Verilator simulation.
 * Content based on "Practical UVM Step By Step" by Srivatsa Vasudevan
 */

(function() {
  const AppState = {
    currentMode: "split",
    currentTheme: localStorage.getItem("practical_uvm_book_theme") || "github",
    activeModuleId: null,
    activeChapterId: null,
    activeFileName: null,
    activeFiles: {},
    currentEngine: "verilator",
    completedChapters: new Set(JSON.parse(localStorage.getItem("practical_uvm_completed_chapters") || "[]")),
    moduleLogs: JSON.parse(localStorage.getItem("practical_uvm_module_logs") || "{}"),
    editor: null,
    isSimulating: false,
    serverStatus: null
  };

  // ─── Markdown Renderer ───
  function renderMarkdown(mdText) {
    if (!mdText) return "";

    let html = mdText
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    // Code blocks
    html = html.replace(/```(verilog|systemverilog|sv|text|)[\s\S]*?\n([\s\S]*?)```/g, function(match, lang, code) {
      return `<pre><code>${code.trim()}</code></pre>`;
    });

    // Inline code
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

    // Blockquotes
    html = html.replace(/^> (.*$)/gim, "<blockquote>$1</blockquote>");

    // Images
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width: 100%; border-radius: 8px; margin: 0.5rem 0;">');

    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" style="color: var(--accent-primary);">$1</a>');

    // Tables
    html = html.replace(/^\|(.+)\|$/gm, function(match, content) {
      const cells = content.split('|').map(c => c.trim());
      if (cells.every(c => /^-+$/.test(c) || /^:?-+:?$/.test(c))) {
        return ''; // separator row
      }
      return '<tr>' + cells.map(c => `<td style="padding: 6px 10px; border: 1px solid var(--border-medium);">${c}</td>`).join('') + '</tr>';
    });
    html = html.replace(/(<tr>[\s\S]*?<\/tr>[\s]*)+/g, function(match) {
      return `<table style="border-collapse: collapse; width: 100%; margin: 0.75rem 0; font-size: 0.85rem;">${match}</table>`;
    });

    // Headings
    html = html.replace(/^#### (.*$)/gim, "<h4>$1</h4>");
    html = html.replace(/^### (.*$)/gim, "<h3>$1</h3>");
    html = html.replace(/^## (.*$)/gim, "<h2>$1</h2>");
    html = html.replace(/^# (.*$)/gim, "<h1>$1</h1>");

    // Bold & italic
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");

    // Horizontal rules
    html = html.replace(/^---$/gim, "<hr style='border: none; border-top: 1px solid var(--border-medium); margin: 1.5rem 0;'>");

    // Bullet lists
    html = html.replace(/^\* (.*$)/gim, "<li>$1</li>");
    html = html.replace(/^- (.*$)/gim, "<li>$1</li>");
    html = html.replace(/(<li>[\s\S]*?<\/li>)/g, "<ul>$1</ul>");

    // Numbered lists
    html = html.replace(/^\d+\. (.*$)/gim, "<li>$1</li>");

    // Paragraphs
    html = html.split("\n\n").map(p => {
      p = p.trim();
      if (!p || p.startsWith("<h") || p.startsWith("<pre") || p.startsWith("<ul") || p.startsWith("<div") || p.startsWith("<table") || p.startsWith("<blockquote") || p.startsWith("<hr") || p.startsWith("<img")) {
        return p;
      }
      return `<p>${p}</p>`;
    }).join("\n");

    return html;
  }

  // ─── Log Colorizer ───
  function colorizeLog(text) {
    if (!text) return "";
    const lines = text.split("\n");
    return lines.map(line => {
      let escaped = line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      if (escaped.includes("UVM_ERROR") || escaped.includes("Error") || escaped.includes("ERROR") || escaped.includes("%Error")) {
        return `<span class="log-error">${escaped}</span>`;
      } else if (escaped.includes("UVM_WARNING") || escaped.includes("Warning") || escaped.includes("WARNING") || escaped.includes("%Warning")) {
        return `<span class="log-warning">${escaped}</span>`;
      } else if (escaped.includes("UVM_FATAL") || escaped.includes("FATAL")) {
        return `<span class="log-fatal">${escaped}</span>`;
      } else if (escaped.includes("UVM_INFO") || escaped.includes("$display") || escaped.includes("$monitor")) {
        return `<span class="log-info">${escaped}</span>`;
      } else if (escaped.includes("--- UVM Report Summary ---") || escaped.includes("** Report counts by severity") || escaped.includes("PASSED") || escaped.includes("SUCCESS")) {
        return `<span class="log-phase">${escaped}</span>`;
      }
      return escaped;
    }).join("\n");
  }

  // ─── Module Log Management ───
  function addModuleLog(chapterId, entry) {
    if (!AppState.moduleLogs[chapterId]) {
      AppState.moduleLogs[chapterId] = [];
    }
    AppState.moduleLogs[chapterId].unshift(entry);
    if (AppState.moduleLogs[chapterId].length > 20) {
      AppState.moduleLogs[chapterId] = AppState.moduleLogs[chapterId].slice(0, 20);
    }
    localStorage.setItem("practical_uvm_module_logs", JSON.stringify(AppState.moduleLogs));
  }

  function renderModuleLogs() {
    const logEl = document.getElementById("module_log_view");
    if (!logEl) return;

    const logs = AppState.moduleLogs[AppState.activeChapterId] || [];
    if (logs.length === 0) {
      logEl.innerHTML = '<span style="color: var(--text-muted);">No simulation logs yet for this module.\nRun a simulation to generate logs.</span>';
      return;
    }

    let html = `<span style="color: var(--accent-primary); font-weight: bold;">📜 Simulation History — ${AppState.activeChapterId} (${logs.length} runs)</span>\n`;
    html += '─'.repeat(70) + '\n\n';

    logs.forEach((log, i) => {
      const statusColor = log.exitCode === 0 ? 'var(--neon-green)' : 'var(--neon-red)';
      const statusText = log.exitCode === 0 ? '✅ PASS' : '❌ FAIL';
      html += `<span style="color: var(--text-muted);">Run #${logs.length - i}</span>  `;
      html += `<span style="color: var(--accent-primary);">${log.timestamp}</span>  `;
      html += `<span style="color: ${statusColor}; font-weight: bold;">${statusText}</span>  `;
      html += `<span style="color: var(--text-muted);">Engine: ${log.engine} | ${log.totalTime}ms</span>\n`;
      const preview = (log.output || '').split('\n').slice(0, 5).join('\n');
      html += `<span style="color: var(--text-secondary);">${preview.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</span>\n`;
      html += '─'.repeat(50) + '\n';
    });

    logEl.innerHTML = html;
  }

  // ─── Server Status ───
  async function checkServerStatus() {
    try {
      const resp = await fetch("/api/status", { method: "GET" });
      if (resp.ok) {
        AppState.serverStatus = await resp.json();
        const badge = document.getElementById("server_status_badge");
        if (badge) {
          badge.innerHTML = "🟢 Verilator Active";
          badge.title = "Connected to local Verilator server";
        }
      }
    } catch (e) {
      const badge = document.getElementById("server_status_badge");
      if (badge) {
        badge.innerHTML = "⚪ Standalone Mode";
        badge.title = "Local server not running. Run './run_book.sh' for live simulation.";
      }
    }
  }

  // ─── Theme System ───
  const THEME_META = {
    github: { icon: "🌌", name: "GitHub Dark" },
    nord: { icon: "❄️", name: "Nord Frost" },
    onedark: { icon: "🪐", name: "One Dark Pro" },
    dracula: { icon: "🧛", name: "Dracula Pro" },
    light: { icon: "☀️", name: "Paper Light" },
    batman: { icon: "🦇", name: "Batman Dark Knight" }
  };

  function setTheme(themeName) {
    if (!THEME_META[themeName]) themeName = "github";
    AppState.currentTheme = themeName;
    document.documentElement.setAttribute("data-theme", themeName);
    localStorage.setItem("practical_uvm_book_theme", themeName);

    const meta = THEME_META[themeName];
    const iconEl = document.getElementById("theme_active_icon");
    const labelEl = document.getElementById("theme_active_label");
    if (iconEl) iconEl.textContent = meta.icon;
    if (labelEl) labelEl.textContent = meta.name;

    document.querySelectorAll(".theme-option").forEach(opt => opt.classList.remove("active"));
    const activeOpt = document.getElementById(`theme_opt_${themeName}`);
    if (activeOpt) activeOpt.classList.add("active");

    const container = document.getElementById("theme_dropdown_container");
    if (container) container.classList.remove("open");

    if (AppState.editor) setTimeout(() => AppState.editor.refresh(), 50);
  }

  function toggleThemeMenu(e) {
    if (e) { e.stopPropagation(); e.preventDefault(); }
    const container = document.getElementById("theme_dropdown_container");
    if (container) container.classList.toggle("open");
  }

  // ─── CodeMirror Initialization ───
  function initCodeMirror() {
    const textarea = document.getElementById("code_editor");
    if (!textarea || !window.CodeMirror) return;

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

  // ─── Curriculum Sidebar ───
  function buildCurriculumSidebar() {
    const listEl = document.getElementById("curriculum_list");
    if (!listEl || !window.PRACTICAL_UVM_DATABASE) return;

    listEl.innerHTML = "";

    window.PRACTICAL_UVM_DATABASE.forEach(mod => {
      const modEl = document.createElement("div");
      modEl.className = "module-group";

      const headerEl = document.createElement("div");
      headerEl.className = "module-header";
      headerEl.innerHTML = `
        <span style="font-weight: 600;">${mod.title}</span>
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
            <input type="checkbox" ${isDone ? 'checked' : ''} onclick="event.stopPropagation(); PracticalUVMApp.toggleChapterDone('${ch.id}')" title="Mark as Mastered" style="cursor: pointer;">
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

  // ─── Chapter Selection ───
  function selectChapter(chapterId) {
    if (!window.PRACTICAL_UVM_DATABASE) return;

    let targetMod = null;
    let targetCh = null;

    for (const mod of window.PRACTICAL_UVM_DATABASE) {
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

    // Highlight nav item
    document.querySelectorAll(".chapter-item").forEach(el => el.classList.remove("active"));
    const navItem = document.getElementById(`nav_${chapterId}`);
    if (navItem) navItem.classList.add("active");

    // Update breadcrumbs
    const bcMod = document.getElementById("bc_module");
    const bcCh = document.getElementById("bc_chapter");
    if (bcMod) bcMod.textContent = targetMod.title;
    if (bcCh) bcCh.textContent = targetCh.title;

    // Render Textbook / Reader Content
    renderReaderContent(targetMod, targetCh);

    // Load Code Files into Editor
    loadCodeFiles(targetCh);

    // Set Golden Reference Log
    const refLogEl = document.getElementById("golden_log_view");
    if (refLogEl) {
      refLogEl.innerHTML = colorizeLog(targetCh.goldenLog || "No golden reference log available for this module.");
    }

    // Render Module Logs
    renderModuleLogs();

    // Update CLI command line
    updateCommandLine();
  }

  function renderReaderContent(mod, ch) {
    const bodyEl = document.getElementById("reader_body");
    if (!bodyEl) return;

    let markdown = `# ${ch.title}\n\n`;
    markdown += `> **Module**: ${mod.title} · **Estimated Time**: ${ch.readTime} · **Level**: ${ch.difficulty}\n\n`;

    if (mod.book_chapter) {
      markdown += `### 📖 ${mod.book_chapter}\n\n`;
    }

    if (mod.full_text) {
      markdown += mod.full_text + "\n\n";
    }

    // Lab Mission Card
    if (ch.mission) {
      markdown += `\n---\n### 🎯 Lab Verification Mission\n\n`;
      markdown += `**Objective**: ${ch.mission.task || "Run and verify the UVM components."}\n\n`;
      if (ch.mission.hint) {
        markdown += `💡 **Hint**: ${ch.mission.hint}\n\n`;
      }
    }

    if (mod.author_notes) {
      markdown += `\n---\n### 📝 Author Notes & Errata (Srivatsa Vasudevan)\n\n`;
      markdown += `\`\`\`text\n${mod.author_notes}\n\`\`\`\n\n`;
    }

    bodyEl.innerHTML = renderMarkdown(markdown);
  }

  // ─── Code Files & Multi-File Tabs ───
  function loadCodeFiles(ch) {
    AppState.activeFiles = {};
    if (ch.files && Object.keys(ch.files).length > 0) {
      AppState.activeFiles = JSON.parse(JSON.stringify(ch.files));
    } else {
      AppState.activeFiles = {
        "top.sv": 'module top;\n  initial begin\n    $display("Practical UVM Step By Step");\n    $finish;\n  end\nendmodule\n'
      };
    }

    const tabsContainer = document.getElementById("editor_tabs");
    if (!tabsContainer) return;

    tabsContainer.innerHTML = "";
    const fnames = Object.keys(AppState.activeFiles);

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
    if (AppState.activeFileName && AppState.activeFiles[AppState.activeFileName]) {
      const clean = stripComments(AppState.activeFiles[AppState.activeFileName]);
      const matches = [...clean.matchAll(/\bmodule\s+([a-zA-Z0-9_]+)/g)].map(m => m[1]).filter(m => m !== "uvm_pkg");
      if (matches.includes("top")) return "top";
      if (matches.length > 0) return matches[matches.length - 1];
    }
    const allMods = [];
    for (const [fname, content] of Object.entries(AppState.activeFiles || {})) {
      const clean = stripComments(content);
      const matches = [...clean.matchAll(/\bmodule\s+([a-zA-Z0-9_]+)/g)].map(m => m[1]).filter(m => m !== "uvm_pkg");
      for (const m of matches) {
        if (!allMods.includes(m)) allMods.push(m);
      }
    }
    if (allMods.includes("top")) return "top";
    if (allMods.includes("tb")) return "tb";
    if (allMods.includes("testbench")) return "testbench";
    if (allMods.length > 0) return allMods[0];
    return "top";
  }

  function updateCommandLine() {
    const input = document.getElementById("cli_command_input");
    if (!input) return;

    const activeFile = AppState.activeFileName || Object.keys(AppState.activeFiles || {})[0] || "top.sv";
    const topMod = detectTopModule();
    input.value = `verilator --binary --timing -Wno-fatal +define+UVM_NO_DPI ${activeFile} --top-module ${topMod} -j 4 && ./obj_dir/V${topMod} +UVM_VERBOSITY=UVM_MEDIUM`;
  }

  // ─── Simulation ───
  async function runSimulation() {
    if (AppState.isSimulating) return;

    const btn = document.getElementById("btn_run_sim");
    const term = document.getElementById("terminal_output");
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `⏳ Simulating...`;
    }

    AppState.isSimulating = true;
    switchOutputTab("console");

    // Save active editor buffer
    if (AppState.activeFileName && AppState.editor) {
      AppState.activeFiles[AppState.activeFileName] = AppState.editor.getValue();
    }

    term.innerHTML = `<span style="color: var(--neon-cyan);">⚡ Compiling and executing UVM simulation with ${AppState.currentEngine.toUpperCase()}...</span>\n`;

    const payload = {
      files: AppState.activeFiles,
      engine: AppState.currentEngine,
      top: detectTopModule(),
      active_file: AppState.activeFileName,
      plusargs: ["+UVM_VERBOSITY=UVM_MEDIUM"],
      is_sv: false
    };

    const startTime = Date.now();

    try {
      const resp = await fetch("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!resp.ok) throw new Error(`HTTP error ${resp.status}`);

      const res = await resp.json();
      AppState.isSimulating = false;
      if (btn) { btn.disabled = false; btn.innerHTML = `▶ Run Simulation`; }

      let out = "";
      if (res.compile_stdout) out += res.compile_stdout + "\n";
      if (res.compile_stderr) out += res.compile_stderr + "\n";
      if (res.stdout) out += res.stdout + "\n";
      if (res.stderr) out += res.stderr + "\n";

      if (!out.trim()) {
        out = `Simulation finished with exit code ${res.exit_code}. (No console output produced)`;
      }

      term.innerHTML = colorizeLog(out);

      // Save Module Log
      addModuleLog(AppState.activeChapterId, {
        timestamp: new Date().toLocaleString(),
        engine: res.engine || AppState.currentEngine,
        exitCode: res.exit_code,
        totalTime: res.total_time_ms || (Date.now() - startTime),
        output: out.substring(0, 500)
      });
      renderModuleLogs();

      // Stats
      const statEl = document.getElementById("stat_output");
      if (statEl) {
        statEl.innerHTML = `
          <div style="padding: 1rem; font-family: var(--font-mono); font-size: 0.8rem;">
            <div>⚙️ Engine: <span style="color: var(--neon-cyan); font-weight: bold;">${(res.engine || AppState.currentEngine).toUpperCase()}</span></div>
            <div>⏱️ Compile Time: <strong>${res.compile_time_ms || 0} ms</strong></div>
            <div>⚡ Simulation Time: <strong>${res.sim_time_ms || 0} ms</strong></div>
            <div>📊 Total Elapsed: <strong>${res.total_time_ms || 0} ms</strong></div>
            <div>🏁 Exit Status: <strong style="color: ${res.exit_code === 0 ? 'var(--neon-green)' : 'var(--neon-red)'};">${res.exit_code === 0 ? 'SUCCESS (0)' : 'FAILED (' + res.exit_code + ')'}</strong></div>
          </div>
        `;
      }

      // Auto-complete on success
      if (res.exit_code === 0 && !AppState.completedChapters.has(AppState.activeChapterId)) {
        AppState.completedChapters.add(AppState.activeChapterId);
        localStorage.setItem("practical_uvm_completed_chapters", JSON.stringify(Array.from(AppState.completedChapters)));
        updateProgressDisplay();
        const checkbox = document.querySelector(`#nav_${AppState.activeChapterId} input[type="checkbox"]`);
        if (checkbox) checkbox.checked = true;
      }

    } catch (err) {
      AppState.isSimulating = false;
      if (btn) { btn.disabled = false; btn.innerHTML = `▶ Run Simulation`; }

      // Offline fallback: display golden reference
      term.innerHTML = `
<span style="color: var(--neon-amber);">⚠️ Local server not detected at /api/simulate.</span>
<span style="color: #94a3b8;">Displaying golden reference output (if available):</span>
--------------------------------------------------------------------------------
${colorizeLog(document.getElementById("golden_log_view")?.innerText || "No reference log available.")}
`;
    }
  }

  // ─── UI Controls ───
  function switchOutputTab(tabKey) {
    document.querySelectorAll(".console-tab-btn").forEach(b => b.classList.remove("active"));
    const activeBtn = document.getElementById(`btn_tab_${tabKey}`);
    if (activeBtn) activeBtn.classList.add("active");

    const views = ["console", "reference", "log", "stats"];
    views.forEach(v => {
      const el = document.getElementById(`view_${v}`);
      if (el) el.style.display = (v === tabKey) ? "block" : "none";
    });
  }

  function setViewMode(mode) {
    AppState.currentMode = mode;
    document.body.className = `mode-${mode}`;

    document.querySelectorAll(".mode-btn").forEach(b => b.classList.remove("active"));
    const activeBtn = document.getElementById(`btn_mode_${mode}`);
    if (activeBtn) activeBtn.classList.add("active");

    if (AppState.editor) setTimeout(() => AppState.editor.refresh(), 100);
  }

  function switchEngine(eng) {
    AppState.currentEngine = eng;
  }

  function filterCurriculum(query) {
    const q = (query || "").toLowerCase();
    document.querySelectorAll(".chapter-item").forEach(item => {
      const text = item.textContent.toLowerCase();
      item.style.display = text.includes(q) ? "flex" : "none";
    });
  }

  function toggleChapterDone(chapterId) {
    if (AppState.completedChapters.has(chapterId)) {
      AppState.completedChapters.delete(chapterId);
    } else {
      AppState.completedChapters.add(chapterId);
    }
    localStorage.setItem("practical_uvm_completed_chapters", JSON.stringify(Array.from(AppState.completedChapters)));
    updateProgressDisplay();
  }

  function updateProgressDisplay() {
    let totalChapters = 16;
    if (window.PRACTICAL_UVM_DATABASE) {
      totalChapters = window.PRACTICAL_UVM_DATABASE.reduce((sum, m) => sum + m.chapters.length, 0);
    }
    const done = AppState.completedChapters.size;
    const pct = Math.round((done / totalChapters) * 100);

    const progEl = document.getElementById("progress_display");
    if (progEl) {
      progEl.innerHTML = `<span>⚡ Mastery:</span> <strong>${pct}%</strong> (${done}/${totalChapters})`;
    }
  }

  // ─── Resizer ───
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

    // Close dropdown on click outside
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

  // ─── Initialization ───
  function initApp() {
    setTheme(AppState.currentTheme);
    initCodeMirror();
    buildCurriculumSidebar();
    setupResizer();
    setupEventListeners();
    checkServerStatus();

    // Select first chapter
    if (window.PRACTICAL_UVM_DATABASE && window.PRACTICAL_UVM_DATABASE.length > 0) {
      const firstMod = window.PRACTICAL_UVM_DATABASE[0];
      if (firstMod.chapters && firstMod.chapters.length > 0) {
        AppState.activeModuleId = firstMod.id;
        AppState.activeChapterId = firstMod.chapters[0].id;
      }
    }

    selectChapter(AppState.activeChapterId);
    updateProgressDisplay();
  }

  // ─── Global API Export ───
  window.PracticalUVMApp = {
    setViewMode,
    setTheme,
    toggleThemeMenu,
    switchEngine,
    filterCurriculum,
    selectChapter,
    switchFileTab,
    runSimulation,
    switchOutputTab,
    toggleChapterDone,
    resetCurrentCode: function() {
      if (!confirm("Reset code files to chapter original?")) return;
      selectChapter(AppState.activeChapterId);
    },
    copyCommandLine: function() {
      const input = document.getElementById("cli_command_input");
      if (input) {
        navigator.clipboard.writeText(input.value);
        alert("CLI Command copied to clipboard!");
      }
    }
  };

  window.addEventListener("DOMContentLoaded", initApp);
})();
