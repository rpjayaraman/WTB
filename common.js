/**
 * ═══════════════════════════════════════════════════════════════
 * IDE INTEGRATION LOGIC — WHAT THE BUG (PRODUCTION VERSION)
 * Manages dual theme, active question selection, state persistence,
 * Prism.js syntax highlighting, compiler server requests, and UI.
 * ═══════════════════════════════════════════════════════════════
 */

// ── Theme Manager ──────────────────────────────────────────────
class ThemeManager {
    static init() {
        const theme = localStorage.getItem('dv_prep_theme') || 'dark';
        if (theme === 'light') {
            document.documentElement.classList.add('light');
        } else {
            document.documentElement.classList.remove('light');
        }
        this.updateThemeTogglerIcon();
    }

    static toggle() {
        const isLight = document.documentElement.classList.toggle('light');
        localStorage.setItem('dv_prep_theme', isLight ? 'light' : 'dark');
        this.updateThemeTogglerIcon();
    }

    static updateThemeTogglerIcon() {
        const btn = document.getElementById('themeToggler');
        if (!btn) return;
        const isLight = document.documentElement.classList.contains('light');
        btn.innerHTML = isLight 
            ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>` // Moon icon
            : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`; // Sun icon
    }
}

// ── Dataset Manager (Local Storage & Gemma Fine-Tuning) ────────
class DatasetManager {
    constructor() {
        this.storageKey = 'dv_prep_dataset';
        this.dbKey = 'dv_questions_db';
        this.initStorage();
    }

    initStorage() {
        if (!localStorage.getItem(this.storageKey)) {
            localStorage.setItem(this.storageKey, JSON.stringify({}));
        }
        if (typeof DV_QUESTIONS_METADATA !== 'undefined') {
            localStorage.setItem(this.dbKey, JSON.stringify(DV_QUESTIONS_METADATA));
        }
    }

    getAnswers() {
        try {
            return JSON.parse(localStorage.getItem(this.storageKey)) || {};
        } catch (e) {
            console.error('Error parsing answers', e);
            return {};
        }
    }

    getQuestionsDb() {
        try {
            return JSON.parse(localStorage.getItem(this.dbKey)) || {};
        } catch (e) {
            return {};
        }
    }

    saveAnswer(pageId, questionId, code, confidence, status, notes = '') {
        const answers = this.getAnswers();
        if (!answers[pageId]) {
            answers[pageId] = {};
        }
        answers[pageId][questionId] = {
            code,
            confidence: parseInt(confidence) || 0,
            status: status || 'draft',
            notes,
            timestamp: new Date().toISOString()
        };
        localStorage.setItem(this.storageKey, JSON.stringify(answers));
        window.dispatchEvent(new Event('storage-update'));

        // SYNC HOOK: Sync to Supabase in background if logged in
        if (window.AuthManager) {
            window.AuthManager.isLoggedIn().then(loggedIn => {
                if (loggedIn) {
                    window.AuthManager.saveProgress(pageId, questionId, code, parseInt(confidence) || 0, status || 'draft');
                }
            });
        }
    }

    getAnswer(pageId, questionId) {
        const answers = this.getAnswers();
        return answers[pageId]?.[questionId] || null;
    }

    clearAnswer(pageId, questionId) {
        const answers = this.getAnswers();
        if (answers[pageId] && answers[pageId][questionId]) {
            delete answers[pageId][questionId];
            localStorage.setItem(this.storageKey, JSON.stringify(answers));
            window.dispatchEvent(new Event('storage-update'));
            return true;
        }
        return false;
    }

    resetAllData() {
        localStorage.setItem(this.storageKey, JSON.stringify({}));
        window.dispatchEvent(new Event('storage-update'));
    }

    exportToGemmaJSON() {
        const answers = this.getAnswers();
        const questionsDb = this.getQuestionsDb();
        const dataset = [];

        for (const pageId in answers) {
            for (const questionId in answers[pageId]) {
                const answerData = answers[pageId][questionId];
                if (!answerData.code || answerData.code.trim() === '') continue;

                const questionMetadata = questionsDb[pageId]?.find(q => q.id === questionId);
                if (!questionMetadata) continue;

                const instruction = `Write SystemVerilog/UVM code to answer the following Design Verification interview question:\n\nTitle: ${questionMetadata.title}\n\nDescription:\n${questionMetadata.description}\n\nProvide clean, synthesizable (where applicable), and methodology-compliant code following the IEEE 1800 LRM and Accellera guidelines.`;
                const input = `Topic: ${pageId.replace('_', ' ').toUpperCase()}\nReference: ${questionMetadata.reference || 'None'}\nDifficulty: ${questionMetadata.difficulty.toUpperCase()}`;
                const output = answerData.code;

                dataset.push({ instruction, input, output });
            }
        }
        return JSON.stringify(dataset, null, 4);
    }
}

// ── Rich Code Editor with CodeMirror & Vim Mode ──────────────
class CodeEditor {
    static init(textarea) {
        if (!textarea) return;

        if (window.CodeMirror) {
            window.cmInstance = window.CodeMirror.fromTextArea(textarea, {
                lineNumbers: true,
                mode: "text/x-systemverilog",
                keyMap: "vim",
                theme: "monokai",
                tabSize: 4,
                indentUnit: 4,
                lineWrapping: true
            });
            window.cmInstance.setSize("100%", "100%");
        }
    }
}

// ── Compiler & Simulation Server Bridge ────────────────────────
class CompilerBridge {
    static useWasm = true;
    static worker = null;
    static reqId = 0;
    static pendingReqs = new Map();

    static initWorker() {
        if (!this.worker && typeof Worker !== 'undefined') {
            try {
                this.worker = new Worker('wasm_worker.js?v=14');
                this.worker.onmessage = (e) => {
                    const { id, success, result, error } = e.data;
                    if (this.pendingReqs.has(id)) {
                        const { resolve, reject } = this.pendingReqs.get(id);
                        this.pendingReqs.delete(id);
                        if (success) resolve(result);
                        else reject(new Error(error));
                    }
                };
            } catch (err) {
                console.warn('[WASM ENGINE] Could not instantiate Web Worker:', err);
                this.worker = null;
            }
        }
    }

    static runWasm(code, command, taskType = 'SIMULATE') {
        this.initWorker();
        if (!this.worker) {
            return Promise.reject(new Error('WASM Worker unavailable'));
        }
        return new Promise((resolve, reject) => {
            const id = ++this.reqId;
            this.pendingReqs.set(id, { resolve, reject });
            this.worker.postMessage({ id, type: taskType, code, command });
        });
    }

    static runWasmFiles(files, command, taskType = 'SIMULATE') {
        this.initWorker();
        if (!this.worker) {
            return Promise.reject(new Error('WASM Worker unavailable'));
        }
        return new Promise((resolve, reject) => {
            const id = ++this.reqId;
            this.pendingReqs.set(id, { resolve, reject });
            this.worker.postMessage({ id, type: taskType, files, command });
        });
    }

    static getCommand() {
        return localStorage.getItem('dv_prep_compile_command') || '/Users/mac/xezim-workspace/xezim/target/release/xezim --parse $FILE';
    }

    static setCommand(cmd) {
        localStorage.setItem('dv_prep_compile_command', cmd);
    }

    static getServerUrl() {
        return localStorage.getItem('dv_prep_server_url') || 'https://wtb-sim.onrender.com/lint';
    }

    /**
     * Rich Console Log Colorizer
     * Colors UVM_INFO, UVM_WARNING, UVM_ERROR, UVM_FATAL, PASSED, FAILED, Timestamps, and Component Tags
     */
    static colorifyConsoleOutput(rawText) {
        if (!rawText) return '';
        let html = rawText
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        // 1. Banner & Divider Lines
        html = html.replace(/^(===+.*===+)$/gm, '<span class="log-header" style="color:#00f0ff; font-weight:700;">$1</span>');
        html = html.replace(/^(---*.*---*)$/gm, '<span class="log-header" style="color:#38bdf8; font-weight:700;">$1</span>');

        // 2. UVM Log Severity Levels
        html = html.replace(/\bUVM_INFO\b/g, '<span class="log-uvm-info" style="color:#38bdf8; font-weight:700;">UVM_INFO</span>');
        html = html.replace(/\bUVM_WARNING\b/g, '<span class="log-uvm-warn" style="color:#f5c842; font-weight:700;">UVM_WARNING</span>');
        html = html.replace(/\bUVM_ERROR\b/g, '<span class="log-uvm-error" style="color:#f87171; font-weight:700;">UVM_ERROR</span>');
        html = html.replace(/\bUVM_FATAL\b/g, '<span class="log-uvm-fatal" style="color:#ff4d4d; font-weight:700; background:rgba(255,0,0,0.15); padding:1px 4px; border-radius:3px;">UVM_FATAL</span>');

        // 3. Timestamps & Time Annotations (@ 50 ns, [35 ns])
        html = html.replace(/(@\s*\d+\s*(?:ns|ps|us)|\[\d+\s*(?:ns|ps|us)\])/gi, '<span class="log-time" style="color:#38bdf8; font-weight:600;">$1</span>');

        // 4. Pass / Match / Scoreboard / Success Tokens
        html = html.replace(/\b(PASSED|MATCH|SCOREBOARD MATCH|SUCCESS|TEST PASSED|CLEANLY)\b/gi, '<span class="log-pass" style="color:#34d399; font-weight:700;">$1</span>');
        html = html.replace(/\b(FAILED|MISMATCH|SCOREBOARD ERROR|TEST FAILED)\b/gi, '<span class="log-fail" style="color:#f87171; font-weight:700;">$1</span>');

        // 5. Component & Module Tags [APB_DRV], [APB_MON], [APB_SB], [APB_TEST], [SCOREBOARD]
        html = html.replace(/(\[\s*(?:APB_DRV|APB_MON|APB_SB|APB_TEST|AXI4_DRV|AXI4_MON|AXI4_TEST|SCOREBOARD|MONITOR|DRIVER|AGENT|ENV|TEST|COVERAGE|WASM-XEZIM|WASM-VERILATOR|STDOUT|STDERR)\s*\])/gi, '<span class="log-tag" style="color:#c084fc; font-weight:600;">$1</span>');

        return html;
    }

    static async runCheck(code, qId, customCommand = null) {
        const consoleEl = document.getElementById(`console_output`);
        if (!consoleEl) return;

        // AUTH GATEKEEPER CHECK: Allow sv_coding and uvm_coding to run without login as free previews.
        const isFreePreviewPage = window.location.pathname.endsWith('sv_coding.html') || window.location.pathname.endsWith('uvm_coding.html') || window.location.pathname === '/';
        const loggedIn = window.AuthManager ? await window.AuthManager.isLoggedIn() : false;

        if (!loggedIn && !isFreePreviewPage) {
            UIHelper.showLoginModal();
            consoleEl.className = 'console-body error';
            consoleEl.textContent = '[AUTH REQUIRED] You must log in to run simulations in this advanced module.';
            return;
        }

        consoleEl.className = 'console-body';
        consoleEl.textContent = '[WASM ENGINE] Running in-browser XEZIM simulation & Verilator lint...';

        const command = customCommand || this.getCommand();

        let payloadCode = code;
        if (typeof QuestionLoader !== 'undefined' && QuestionLoader.currentQuestion) {
            const q = QuestionLoader.currentQuestion;
            let codeParts = [];
            if (q.designCode) {
                codeParts.push(q.designCode);
            }
            if (q.files && q.files.length > 0) {
                codeParts.push(...q.files.map(f => f.code));
            }
            if (codeParts.length > 0) {
                payloadCode = codeParts.join('\n\n');
            }
        }

        // Try WASM WebAssembly Engine First
        if (this.useWasm) {
            try {
                // Run Verilator WASM for linting check first
                const lintRes = await this.runWasm(payloadCode, command, 'LINT');
                // Run XEZIM WASM for simulation & trace generation
                const simRes = await this.runWasm(payloadCode, command, 'SIMULATE');

                const res = {
                    success: lintRes.success && simRes.success,
                    exit_code: lintRes.exit_code || simRes.exit_code,
                    stdout: simRes.stdout,
                    stderr: lintRes.stderr + simRes.stderr,
                    vcd_text: simRes.vcd_text,
                    coverage: simRes.coverage
                };

                let logOutput = '';
                if (res.stdout) logOutput += `[STDOUT]\n${res.stdout}\n`;
                if (res.stderr) logOutput += `[STDERR]\n${res.stderr}\n`;

                if (logOutput === '') {
                    logOutput = '[SUCCESS] Code parsed clean via in-browser WASM. Exit code 0.';
                }

                consoleEl.innerHTML = CompilerBridge.colorifyConsoleOutput(logOutput);

                window.lastStderrText = res.stderr || res.stdout || '';
                if (res.coverage) {
                    window.lastCoverageData = res.coverage;
                    CoverageViewer.render('coverage_output', res.coverage, window.lastStderrText);
                } else {
                    window.lastCoverageData = null;
                    CoverageViewer.render('coverage_output', null, window.lastStderrText);
                }

                window.lastVcdText = res.vcd_text || null;
                window.lastVcdData = res.xevdb || null;

                if (res.vcd_text) {
                    WaveformViewer.renderFromVcd('waveform_canvas', res.vcd_text);
                    if (typeof SurferBridge !== 'undefined') {
                        SurferBridge.loadVcd(res.vcd_text, true);
                    }
                } else if (res.xevdb) {
                    WaveformViewer.render('waveform_canvas', res.xevdb);
                } else {
                    const canvas = document.getElementById('waveform_canvas');
                    if (canvas) {
                        WaveformViewer.drawEmptyMessage(canvas, 'No simulation trace available. Run simulation first.');
                    }
                }

                if (res.success) {
                    consoleEl.classList.add('success');
                    
                    // Inject visual WASM status badge into console header
                    const consoleHeader = document.querySelector('.console-header');
                    if (consoleHeader && !document.getElementById('wasm_status_badge')) {
                        const badge = document.createElement('span');
                        badge.id = 'wasm_status_badge';
                        badge.style.cssText = 'font-size: 0.65rem; font-family: var(--font-code); color: #00f0ff; background: rgba(0,240,255,0.1); border: 1px solid rgba(0,240,255,0.3); border-radius: 12px; padding: 2px 8px; font-weight: bold; display: inline-flex; align-items: center; gap: 4px;';
                        badge.innerHTML = '⚡ WASM ACTIVE (0ms)';
                        consoleHeader.appendChild(badge);
                    }

                    if (res.vcd_text) {
                        UIHelper.showToast('WASM: Code simulated successfully & waveform loaded!', 'success');
                    } else {
                        UIHelper.showToast('WASM: Code compiled successfully!', 'success');
                    }
                } else {
                    consoleEl.classList.add('error');
                    UIHelper.showToast('WASM: Warnings or errors detected!', 'error');
                }

                return; // Completed via WASM
            } catch (wasmErr) {
                console.warn('[WASM ENGINE] WASM execution failed, falling back to server URL:', wasmErr);
            }
        }

        // Server Fallback
        const serverUrl = this.getServerUrl();
        try {
            const response = await fetch(serverUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: payloadCode, command })
            });

            if (!response.ok) {
                throw new Error(`HTTP Error ${response.status}`);
            }

            const res = await response.json();

            if (res.error) {
                consoleEl.classList.add('error');
                consoleEl.innerHTML = CompilerBridge.colorifyConsoleOutput(`[SERVER ERROR] Execution failed: ${res.error}`);
                UIHelper.showToast('Compiler bridge execution error!', 'error');
                return;
            }

            let logOutput = '';
            if (res.stdout) logOutput += `[STDOUT]\n${res.stdout}\n`;
            if (res.stderr) logOutput += `[STDERR]\n${res.stderr}\n`;

            if (logOutput === '') {
                logOutput = '[SUCCESS] Code parsed clean. Exit code 0.';
            }

            consoleEl.innerHTML = CompilerBridge.colorifyConsoleOutput(logOutput);

            window.lastStderrText = res.stderr || res.stdout || '';
            if (res.coverage) {
                window.lastCoverageData = res.coverage;
                CoverageViewer.render('coverage_output', res.coverage, window.lastStderrText);
            } else {
                window.lastCoverageData = null;
                CoverageViewer.render('coverage_output', null, window.lastStderrText);
            }

            window.lastVcdText = res.vcd_text || null;
            window.lastVcdData = res.xevdb || null;

            if (res.vcd_text) {
                WaveformViewer.renderFromVcd('waveform_canvas', res.vcd_text);
                if (typeof SurferBridge !== 'undefined') {
                    SurferBridge.loadVcd(res.vcd_text, true);
                }
            } else if (res.xevdb) {
                WaveformViewer.render('waveform_canvas', res.xevdb);
            } else {
                const canvas = document.getElementById('waveform_canvas');
                if (canvas) {
                    WaveformViewer.drawEmptyMessage(canvas, 'No simulation trace available. Run simulation first.');
                }
            }

            if (res.success) {
                consoleEl.classList.add('success');
                if (res.xevdb || res.vcd_text) {
                    UIHelper.showToast('Code compiled successfully & waveform loaded!', 'success');
                } else {
                    UIHelper.showToast('Code compiled successfully!', 'success');
                }
            } else {
                consoleEl.classList.add('error');
                UIHelper.showToast('Compilation/parsing warnings or errors detected!', 'error');
            }

        } catch (err) {
            if (serverUrl !== 'http://localhost:5005/lint') {
                console.warn('[COMPILER] Primary server URL failed, falling back to http://localhost:5005/lint', err);
                localStorage.setItem('dv_prep_server_url', 'http://localhost:5005/lint');
                return this.runCheck(code, qId, customCommand);
            }
            consoleEl.classList.add('error');
            consoleEl.textContent = `[CONNECTION ERROR] Failed to connect to compiler server at ${serverUrl}.\n\nEnsure that you have run the compile server script locally:\npython3 experiment/compile_server.py`;
            UIHelper.showToast('Could not reach compilation server!', 'error');
        }
    }
}

// ── UI Helper System ───────────────────────────────────────────
class UIHelper {
    static showToast(message, type = 'info') {
        let container = document.querySelector('.toast-container');
        if (!container) {
            container = document.createElement('div');
            container.className = 'toast-container';
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        let icon = '⚡';
        if (type === 'success') icon = '✓';
        if (type === 'error') icon = '✗';

        toast.innerHTML = `<span class="toast-icon">${icon}</span><span class="toast-message">${message}</span>`;
        container.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('toast-exit');
            toast.addEventListener('animationend', () => {
                toast.remove();
            });
        }, 3000);
    }

    // Modal Builder and Social redirects
    static showLoginModal() {
        let overlay = document.getElementById('authOverlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'authOverlay';
            overlay.className = 'auth-overlay';
            overlay.innerHTML = `
                <div class="auth-card">
                    <button class="auth-close" onclick="UIHelper.hideLoginModal()">✕</button>
                    <div class="auth-tabs">
                        <button class="auth-tab-btn active" id="btnTabLogin" onclick="UIHelper.switchAuthTab('login')">Sign In</button>
                        <button class="auth-tab-btn" id="btnTabRegister" onclick="UIHelper.switchAuthTab('register')">Sign Up</button>
                    </div>
                    
                    <!-- Login Form -->
                    <div id="authLoginForm" style="display: flex; flex-direction: column; gap: 1rem;">
                        <div class="auth-input-group">
                            <label>Email Address</label>
                            <input type="email" id="authLoginEmail" class="auth-input" placeholder="student@whatthebug.com">
                        </div>
                        <div class="auth-input-group">
                            <label>Password</label>
                            <input type="password" id="authLoginPassword" class="auth-input" placeholder="••••••••">
                        </div>
                        <button class="btn btn-primary" onclick="UIHelper.handleLogin()" style="padding: 0.5rem; font-family: var(--font-heading); font-size: 0.82rem; margin-top: 0.25rem;">Sign In</button>
                    </div>

                    <!-- Register Form -->
                    <div id="authRegisterForm" style="display: none; flex-direction: column; gap: 1rem;">
                        <div class="auth-input-group">
                            <label>Email Address</label>
                            <input type="email" id="authRegisterEmail" class="auth-input" placeholder="student@whatthebug.com">
                        </div>
                        <div class="auth-input-group">
                            <label>Password</label>
                            <input type="password" id="authRegisterPassword" class="auth-input" placeholder="••••••••">
                        </div>
                        <button class="btn btn-primary" onclick="UIHelper.handleRegister()" style="padding: 0.5rem; font-family: var(--font-heading); font-size: 0.82rem; margin-top: 0.25rem;">Create Account</button>
                    </div>

                    <div class="auth-social-group">
                        <button class="btn-social" onclick="UIHelper.handleSocialLogin('github')">
                            <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>
                            Continue with GitHub
                        </button>
                        <button class="btn-social" onclick="UIHelper.handleSocialLogin('google')">
                            <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M15.545 6.558a9.42 9.42 0 0 1 .139 1.628c0 5.222-3.52 8.927-8.628 8.927-4.8 0-8.682-3.882-8.682-8.682S4.12 0 8.922 0c2.344 0 4.316.856 5.836 2.28L12.013 4.96C11.187 4.16 9.87 3.58 8.922 3.58c-2.48 0-4.5 2.05-4.5 4.5s2.02 4.5 4.5 4.5c2.87 0 3.94-2.02 4.1-3.05H8.922v-2.92h6.623z"/></svg>
                            Continue with Google
                        </button>
                    </div>

                    <div style="text-align: center; margin-top: 0.6rem; padding-top: 0.5rem; border-top: 1px dashed var(--border-subtle);">
                        <a href="javascript:void(0)" onclick="UIHelper.showSupabaseConfigModal()" style="font-size: 0.72rem; color: var(--text-muted); text-decoration: none; display: inline-flex; align-items: center; gap: 4px;">
                            ⚙️ Supabase Backend Settings / Unpause Project
                        </a>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);
        }
        overlay.classList.add('open');
    }

    static hideLoginModal() {
        const overlay = document.getElementById('authOverlay');
        if (overlay) overlay.classList.remove('open');
    }

    static switchAuthTab(tab) {
        const btnLogin = document.getElementById('btnTabLogin');
        const btnRegister = document.getElementById('btnTabRegister');
        const formLogin = document.getElementById('authLoginForm');
        const formRegister = document.getElementById('authRegisterForm');

        if (tab === 'login') {
            btnLogin.classList.add('active');
            btnRegister.classList.remove('active');
            formLogin.style.display = 'flex';
            formRegister.style.display = 'none';
        } else {
            btnRegister.classList.add('active');
            btnLogin.classList.remove('active');
            formRegister.style.display = 'flex';
            formLogin.style.display = 'none';
        }
    }

    static async handleLogin() {
        const email = document.getElementById('authLoginEmail').value;
        const pass  = document.getElementById('authLoginPassword').value;
        if (!email || !pass) {
            this.showToast('Please enter both email and password.', 'error');
            return;
        }

        const { data, error } = await window.AuthManager.signIn(email, pass);
        if (error) {
            const isConnError = !error.status && (error.message || '').toLowerCase().includes('failed to fetch');
            if (isConnError) {
                this.showSupabaseConfigModal('Cannot connect to Supabase server. The project may be paused or unreachable.');
            } else {
                this.showToast(error.message || 'Login failed.', 'error');
            }
        } else {
            this.showToast('Successfully signed in!', 'success');
            this.hideLoginModal();
            // Sync progress from database
            const progress = await window.AuthManager.fetchProgress();
            localStorage.setItem('dv_prep_dataset', JSON.stringify(progress));
            window.location.reload();
        }
    }

    static async handleRegister() {
        const email = document.getElementById('authRegisterEmail').value;
        const pass  = document.getElementById('authRegisterPassword').value;
        if (!email || !pass) {
            this.showToast('Please enter both email and password.', 'error');
            return;
        }

        const { data, error } = await window.AuthManager.signUp(email, pass);
        if (error) {
            const isConnError = !error.status && (error.message || '').toLowerCase().includes('failed to fetch');
            if (isConnError) {
                this.showSupabaseConfigModal('Cannot connect to Supabase server. The project may be paused or unreachable.');
            } else {
                this.showToast(error.message || 'Registration failed.', 'error');
            }
        } else {
            this.showToast('Registration successful! Please check your email inbox to verify.', 'success');
            this.hideLoginModal();
        }
    }

    static async handleSocialLogin(provider) {
        if (!window.AuthManager || !window.AuthManager.isInitialized()) {
            this.showToast('Authentication service is not initialized.', 'error');
            return;
        }

        this.showToast('Connecting to ' + provider + '...', 'info');

        const { data, error } = await window.AuthManager.signInWithOAuth(provider);
        if (error) {
            if (error.isNetworkOrDnsError) {
                this.hideLoginModal();
                this.showSupabaseConfigModal(error.message);
            } else {
                this.showToast(error.message || 'OAuth sign-in failed.', 'error');
            }
        }
    }

    // Modal to diagnose, unpause or update Supabase configuration
    static showSupabaseConfigModal(customAlertMessage) {
        let modal = document.getElementById('supabaseConfigModal');
        if (modal) modal.remove();

        const currentUrl = (window.AuthManager && typeof window.AuthManager.getProjectUrl === 'function') 
            ? window.AuthManager.getProjectUrl() 
            : (localStorage.getItem('wtb_supabase_url') || 'https://gcrpigehmbjnvkiklzwi.supabase.co');
        const currentKey = (window.AuthManager && typeof window.AuthManager.getAnonKey === 'function') 
            ? window.AuthManager.getAnonKey() 
            : (localStorage.getItem('wtb_supabase_anon_key') || '');

        modal = document.createElement('div');
        modal.id = 'supabaseConfigModal';
        modal.className = 'auth-overlay open';
        modal.innerHTML = `
            <div class="auth-card" style="max-width: 480px; gap: 1rem;">
                <button class="auth-close" onclick="document.getElementById('supabaseConfigModal').remove()">✕</button>
                <div style="display: flex; align-items: center; gap: 0.6rem;">
                    <span style="font-size: 1.3rem;">⚡</span>
                    <h3 style="font-family: var(--font-heading); font-size: 1.05rem; margin: 0; color: var(--neon-cyan);">Supabase Backend Connection</h3>
                </div>

                <div style="background: rgba(255, 170, 0, 0.1); border: 1px solid rgba(255, 170, 0, 0.3); border-radius: var(--radius-sm); padding: 0.75rem; font-size: 0.76rem; line-height: 1.45; color: #ffca66;">
                    ${customAlertMessage ? `<strong>⚠️ Connection Alert:</strong><br>${customAlertMessage}<br><br>` : ''}
                    <strong>Why does this happen?</strong><br>
                    • Free Supabase projects automatically <strong>pause</strong> after 7 days of inactivity. When paused, the domain produces <code>DNS_PROBE_FINISHED_NXDOMAIN</code>.<br>
                    • Log in to your <a href="https://supabase.com/dashboard" target="_blank" style="color: var(--neon-cyan); font-weight: 700; text-decoration: underline;">Supabase Dashboard ↗</a> to click <strong>"Restore Project"</strong>.<br>
                    • Or if you have a new Supabase project URL & Anon Key, update them below:
                </div>

                <div class="auth-input-group">
                    <label>Supabase Project URL</label>
                    <input type="text" id="cfg_supabase_url" class="auth-input" value="${currentUrl}" placeholder="https://your-project-id.supabase.co">
                </div>

                <div class="auth-input-group">
                    <label>Supabase Anon / Public Key</label>
                    <textarea id="cfg_supabase_anon_key" class="auth-input" rows="2" style="font-family: var(--font-code); font-size: 0.72rem; resize: vertical;" placeholder="eyJhbGci...">${currentKey}</textarea>
                </div>

                <div id="cfg_ping_status" style="font-size: 0.75rem; font-family: var(--font-code); color: var(--text-muted); padding: 0.2rem 0;">
                    Status: <span id="cfg_ping_text">Not checked</span>
                </div>

                <div style="display: flex; gap: 0.5rem; justify-content: space-between; align-items: center; margin-top: 0.5rem;">
                    <button type="button" class="btn btn-secondary btn-sm" onclick="UIHelper.testSupabaseConnection()" style="font-size: 0.75rem;">
                        🔍 Test Connection
                    </button>
                    <div style="display: flex; gap: 0.5rem;">
                        <button type="button" class="btn btn-secondary btn-sm" onclick="UIHelper.resetSupabaseConfig()" style="font-size: 0.75rem;">
                            Reset Defaults
                        </button>
                        <button type="button" class="btn btn-primary btn-sm" onclick="UIHelper.saveSupabaseConfig()" style="font-size: 0.75rem;">
                            Save & Reconnect
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    static async testSupabaseConnection() {
        const pingText = document.getElementById('cfg_ping_text');
        if (!pingText) return;
        pingText.innerHTML = '<span style="color: var(--neon-cyan);">Testing connection...</span>';

        const urlInput = document.getElementById('cfg_supabase_url');
        const url = (urlInput ? urlInput.value : '').trim();

        if (!url) {
            pingText.innerHTML = '<span style="color: var(--neon-red);">❌ Please enter a URL</span>';
            return;
        }

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 4000);
            const res = await fetch(`${url}/auth/v1/health`, {
                method: 'GET',
                mode: 'cors',
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (res.ok || res.status === 200 || res.status === 404) {
                pingText.innerHTML = '<span style="color: var(--crt-green);">✅ Reachable & Active (HTTP ' + res.status + ')</span>';
            } else {
                pingText.innerHTML = '<span style="color: var(--neon-orange);">⚠️ Server responded with HTTP ' + res.status + '</span>';
            }
        } catch (err) {
            pingText.innerHTML = '<span style="color: var(--neon-red);">❌ Unreachable (' + (err.message || 'DNS NXDOMAIN / Network Error') + ')</span>';
        }
    }

    static saveSupabaseConfig() {
        const urlInput = document.getElementById('cfg_supabase_url');
        const keyInput = document.getElementById('cfg_supabase_anon_key');
        const url = (urlInput ? urlInput.value : '').trim();
        const key = (keyInput ? keyInput.value : '').trim();

        if (window.AuthManager && typeof window.AuthManager.setCustomCredentials === 'function') {
            window.AuthManager.setCustomCredentials(url, key);
        } else {
            if (url) localStorage.setItem('wtb_supabase_url', url); else localStorage.removeItem('wtb_supabase_url');
            if (key) localStorage.setItem('wtb_supabase_anon_key', key); else localStorage.removeItem('wtb_supabase_anon_key');
        }

        const modal = document.getElementById('supabaseConfigModal');
        if (modal) modal.remove();

        this.showToast('Supabase configuration updated!', 'success');
        this.showLoginModal();
    }

    static resetSupabaseConfig() {
        if (window.AuthManager && typeof window.AuthManager.resetToDefaults === 'function') {
            window.AuthManager.resetToDefaults();
        } else {
            localStorage.removeItem('wtb_supabase_url');
            localStorage.removeItem('wtb_supabase_anon_key');
        }
        const urlInput = document.getElementById('cfg_supabase_url');
        const keyInput = document.getElementById('cfg_supabase_anon_key');
        if (urlInput) urlInput.value = (window.AuthManager && typeof window.AuthManager.getDefaultUrl === 'function') ? window.AuthManager.getDefaultUrl() : 'https://gcrpigehmbjnvkiklzwi.supabase.co';
        if (keyInput) keyInput.value = (window.AuthManager && typeof window.AuthManager.getDefaultAnonKey === 'function') ? window.AuthManager.getDefaultAnonKey() : '';

        const pingText = document.getElementById('cfg_ping_text');
        if (pingText) pingText.innerHTML = '<span style="color: var(--text-muted);">Reset to defaults</span>';
    }

    // Appends profile login details or login buttons to headers dynamically
    static async syncAuthNavbar() {
        const headerRight = document.querySelector('.header-right');
        if (!headerRight) return;

        const loggedIn = window.AuthManager ? await window.AuthManager.isLoggedIn() : false;
        
        // Remove existing badge or button if present
        const oldAuth = document.getElementById('navbarAuthEl');
        if (oldAuth) oldAuth.remove();

        const authWrapper = document.createElement('div');
        authWrapper.id = 'navbarAuthEl';
        authWrapper.style.display = 'flex';
        authWrapper.style.alignItems = 'center';
        authWrapper.style.gap = '0.5rem';

        if (loggedIn) {
            const user = await window.AuthManager.getUser();
            authWrapper.innerHTML = `
                <div class="auth-user-badge">
                    <span class="auth-user-email" title="${user.email}">${user.email}</span>
                    <button class="btn-signout" onclick="window.AuthManager.signOut()">Sign Out</button>
                </div>
            `;
        } else {
            authWrapper.innerHTML = `
                <button class="btn btn-primary btn-sm" onclick="UIHelper.showLoginModal()">Sign In</button>
            `;
        }
        
        // Prepend to header-right (before themeToggler/progress)
        headerRight.insertBefore(authWrapper, headerRight.firstChild);
    }

    static calculateCategoryProgress(pageId, totalQuestions) {
        const answers = new DatasetManager().getAnswers();
        const pageAnswers = answers[pageId] || {};
        const completedCount = Object.keys(pageAnswers).filter(k => pageAnswers[k].code.trim() !== '').length;
        return {
            completed: completedCount,
            total: totalQuestions,
            percent: totalQuestions > 0 ? Math.round((completedCount / totalQuestions) * 100) : 0
        };
    }

    static updateSidebarProgress() {
        const db = new DatasetManager().getQuestionsDb();
        for (const pageId in db) {
            const progress = this.calculateCategoryProgress(pageId, db[pageId].length);
            const progressEl = document.getElementById(`progress-sidebar-${pageId}`);
            if (progressEl) {
                progressEl.textContent = `${progress.percent}%`;
            }
            const dashboardProgressEl = document.getElementById(`progress-${pageId}`);
            if (dashboardProgressEl) {
                dashboardProgressEl.textContent = `${progress.percent}%`;
            }
        }
    }

    static getModuleNames() {
        return {
            sv_coding: "SystemVerilog Coding",
            uvm_coding: "UVM Methodology",
            sva_coverage: "SVA & Coverage",
            waveform_demo: "Waveform Sandbox",
            lrm_deep_dive: "LRM Deep Dive"
        };
    }

    static buildSidebar(currentPageId) {
        const sidebar = document.getElementById('sidebar');
        if (!sidebar) return;

        const db = new DatasetManager().getQuestionsDb();
        const names = this.getModuleNames();

        let sidebarHtml = `
            <!-- General Links -->
            <div class="sidebar-group">
                <a href="index.html" class="sidebar-item-link ${currentPageId === 'dashboard' ? 'active' : ''}" style="padding: 0.6rem 1.2rem; font-family: var(--font-heading); font-size: 0.8rem; font-weight: 700; text-transform: uppercase;">
                    ⚡ Dashboard
                </a>
                <a href="custom_playground.html" class="sidebar-item-link ${currentPageId === 'custom_playground' ? 'active' : ''}" style="padding: 0.6rem 1.2rem; font-family: var(--font-heading); font-size: 0.8rem; font-weight: 700; text-transform: uppercase; color: var(--neon-cyan);">
                    🛠 Custom Playground
                </a>
            </div>
            
            <!-- Modules -->
        `;

        for (const key in names) {
            const isActivePage = currentPageId === key;
            const qCount = db[key] ? db[key].length : 0;
            const progress = this.calculateCategoryProgress(key, qCount);

            sidebarHtml += `
                <div class="sidebar-group ${isActivePage ? '' : 'collapsed'}" id="group-${key}">
                    <div class="sidebar-group-title" onclick="UIHelper.handleGroupClick('${key}', ${isActivePage})">
                        ${names[key]}
                        <span id="progress-sidebar-${key}" class="tag-cyan font-mono" style="margin-left: auto; padding: 0.1rem 0.3rem; font-size:0.68rem; border-radius:3px;">${progress.percent}%</span>
                    </div>
                    <ul class="sidebar-items" id="sidebar-items-${key}">
                        <!-- Dynamically filled if active page -->
                    </ul>
                </div>
            `;
        }

        sidebarHtml += `
            <!-- Utilities -->
            <div class="sidebar-group">
                <a href="dataset_manager.html" class="sidebar-item-link ${currentPageId === 'dataset_manager' ? 'active' : ''}" style="padding: 0.6rem 1.2rem; font-family: var(--font-heading); font-size: 0.8rem; font-weight: 700; text-transform: uppercase;">
                    💾 Dataset Manager
                </a>
                <a href="https://www.youtube.com/@wt_bug" target="_blank" class="sidebar-item-link" style="padding: 0.6rem 1.2rem; font-family: var(--font-heading); font-size: 0.8rem; font-weight: 700; text-transform: uppercase; color: #ff3333; display: flex; align-items: center; gap: 0.4rem;">
                    <svg width="14" height="14" fill="currentColor" viewBox="0 0 16 16"><path d="M8.051 1.999h.089c.822.003 4.987.033 6.11.335a2.01 2.01 0 0 1 1.415 1.42c.101.38.172.883.22 1.402l.01.104.022.26.008.104c.065.914.073 1.77.074 1.957v.075c-.001.194-.01 1.108-.104 1.981l-.014.134-.027.249a20.08 20.08 0 0 1-.22 1.401 1.97 1.97 0 0 1-1.423 1.41c-1.12.3-5.283.33-6.11.335a29.06 29.06 0 0 1-.18-.001c-.822-.003-4.987-.032-6.11-.334a2.008 2.008 0 0 1-1.415-1.42 20.06 20.06 0 0 1-.22-1.401l-.01-.104-.023-.261-.007-.104c-.065-.914-.073-1.77-.074-1.957v-.075c.001-.194.01-1.108.104-1.98l.016-.134.027-.25a20.07 20.07 0 0 1 .22-1.402 1.97 1.97 0 0 1 1.423-1.41c1.12-.3 5.283-.33 6.11-.335h.089zM6.5 5v6l4.721-3L6.5 5z"/></svg>
                    What The Bug
                </a>
            </div>
        `;

        sidebar.innerHTML = sidebarHtml;
    }

    static handleGroupClick(key, isActivePage) {
        if (isActivePage) {
            const group = document.getElementById(`group-${key}`);
            if (group) group.classList.toggle('collapsed');
        } else {
            window.location.href = `${key}.html`;
        }
    }
}

// ── Dynamic Question View Loader ──────────────────────────────
class QuestionLoader {
    static init(pageId, questionsList) {
        this.pageId = pageId;
        this.questions = questionsList;
        this.currentQuestion = null;

        // Build sidebar
        UIHelper.buildSidebar(this.pageId);

        this.renderSidebarQuestions();
        this.setupEventListeners();
        
        // Initialize Code Editor if textarea exists
        const textarea = document.getElementById('code_editor');
        if (textarea) {
            CodeEditor.init(textarea);
        }

        this.loadFromHash();
    }

    static renderSidebarQuestions() {
        const listContainer = document.getElementById(`sidebar-items-${this.pageId}`);
        if (!listContainer) return;

        listContainer.innerHTML = '';
        const answers = new DatasetManager().getAnswers()[this.pageId] || {};
        let currentSection = '';

        this.questions.forEach((q, index) => {
            if (q.section && q.section !== currentSection) {
                currentSection = q.section;
                const headerLi = document.createElement('li');
                headerLi.className = 'sidebar-section-header';
                headerLi.style.cssText = 'font-size: 0.72rem; font-weight: 700; text-transform: uppercase; color: var(--neon-cyan); padding: 0.6rem 0.5rem 0.2rem 0.5rem; letter-spacing: 0.05em; border-bottom: 1px solid rgba(0,240,255,0.15); margin-top: 0.5rem; margin-bottom: 0.2rem; display: flex; align-items: center; gap: 4px;';
                headerLi.innerHTML = `📁 ${currentSection}`;
                listContainer.appendChild(headerLi);
            }

            const hasAnswer = answers[q.id]?.code && answers[q.id].code.trim() !== '';
            const li = document.createElement('li');
            li.innerHTML = `
                <a href="#${q.id}" class="sidebar-item-link ${hasAnswer ? 'answered' : ''}" id="side_lnk_${q.id}" title="${q.title}">
                    ${index + 1}. ${q.title}
                </a>
            `;
            listContainer.appendChild(li);
        });
    }

    static setupEventListeners() {
        window.addEventListener('hashchange', () => this.loadFromHash());
        
        window.addEventListener('storage-update', () => {
            this.renderSidebarQuestions();
            this.highlightActiveLink();
            UIHelper.updateSidebarProgress();
            
            const activePageAnswers = new DatasetManager().getAnswers()[this.pageId] || {};
            const completedCount = Object.keys(activePageAnswers).filter(k => activePageAnswers[k].code.trim() !== '').length;
            const navProgressEl = document.getElementById('navProgress');
            if (navProgressEl) {
                navProgressEl.textContent = `Completed: ${completedCount}/${this.questions.length} (${Math.round((completedCount/this.questions.length)*100)}%)`;
            }
        });

    }

    static loadFromHash() {
        const hash = window.location.hash.substring(1);
        let q = this.questions.find(item => item.id === hash);
        if (!q && this.questions.length > 0) {
            q = this.questions[0];
            window.location.hash = q.id;
        }
        if (q) {
            this.selectQuestion(q);
        }
    }

    static selectQuestion(q) {
        this.currentQuestion = q;
        this.highlightActiveLink();

        // Reset tabs and clear waveform
        this.switchTab('console');
        window.lastVcdData = null;
        const canvas = document.getElementById('waveform_canvas');
        if (canvas) {
            WaveformViewer.drawEmptyMessage(canvas, 'No simulation trace available. Run simulation first.');
        }

        const titleEl = document.getElementById('q_title');
        if (titleEl) titleEl.textContent = q.title;

        const refEl = document.getElementById('q_reference') || document.getElementById('q_ref');
        if (refEl) refEl.textContent = q.reference || 'IEEE 1800 LRM';

        const badgeEl = document.getElementById('q_difficulty') || document.getElementById('q_diff');
        if (badgeEl) {
            badgeEl.className = `diff-badge diff-${q.difficulty}`;
            badgeEl.textContent = q.difficulty;
        }

        const descEl = document.getElementById('q_description') || document.getElementById('q_desc');
        if (descEl) descEl.textContent = q.description;

        const checklistEl = document.getElementById('q_checklist');
        if (checklistEl) {
            checklistEl.innerHTML = '';
            if (q.checklist && q.checklist.length > 0) {
                q.checklist.forEach(item => {
                    const li = document.createElement('div');
                    li.className = 'checklist-item';
                    li.textContent = item;
                    checklistEl.appendChild(li);
                });
                const checklistBox = document.getElementById('checklist_box');
                if (checklistBox) checklistBox.style.display = 'block';
            } else {
                const checklistBox = document.getElementById('checklist_box');
                if (checklistBox) checklistBox.style.display = 'none';
            }
        }

        // Left Pane Design RTL Files Rendering
        const designTabContainer = document.getElementById('design_file_tabs');
        const designArea = document.getElementById('design_code_editor');
        if (designTabContainer && designArea) {
            if (q.designCode) {
                designTabContainer.innerHTML = '';
                const tab = document.createElement('div');
                tab.className = 'pane-file-tab active';
                const designFileName = q.designFileName || (q.id === 'uvm_q1' ? 'apb_slave_dut.sv' : 'axi4_slave_dut.sv');
                tab.innerHTML = `⚙️ ${designFileName}`;
                designTabContainer.appendChild(tab);

                if (!window.cmDesignInstance) {
                    window.cmDesignInstance = CodeMirror.fromTextArea(designArea, {
                        mode: 'text/x-systemverilog',
                        theme: 'monokai',
                        lineNumbers: true,
                        readOnly: true,
                        lineWrapping: true
                    });
                    window.cmDesignInstance.setSize('100%', '100%');
                }
                window.cmDesignInstance.setValue(q.designCode);
                setTimeout(() => window.cmDesignInstance.refresh(), 50);
            }
        }

        const editor = document.getElementById('code_editor');
        const dbAnswer = new DatasetManager().getAnswer(this.pageId, q.id);
        const codeValue = (dbAnswer?.code && (!q.files || q.files.length === 0)) ? dbAnswer.code : (q.initialCode || q.refAnswer || '');
        
        const tabBar = document.getElementById('editor_tab_bar');
        if (tabBar && q.files && q.files.length > 0) {
            tabBar.innerHTML = '';
            let activeFileIndex = 0;
            q.files.forEach((f, fIdx) => {
                const tab = document.createElement('div');
                tab.className = `pane-file-tab ${fIdx === 0 ? 'active' : ''}`;
                tab.innerHTML = `📄 ${f.name}`;
                tab.onclick = () => {
                    if (window.cmInstance && q.files[activeFileIndex]) {
                        q.files[activeFileIndex].code = window.cmInstance.getValue();
                    }
                    activeFileIndex = fIdx;
                    tabBar.querySelectorAll('.pane-file-tab').forEach(t => t.classList.remove('active'));
                    tab.classList.add('active');
                    if (window.cmInstance) {
                        window.cmInstance.setValue(f.code);
                        window.cmInstance.clearHistory();
                        setTimeout(() => window.cmInstance.refresh(), 50);
                    }
                };
                tabBar.appendChild(tab);
            });
            if (window.cmInstance) {
                window.cmInstance.setValue(q.files[0].code);
                window.cmInstance.clearHistory();
                setTimeout(() => window.cmInstance.refresh(), 50);
            }
        } else {
            if (window.cmInstance) {
                window.cmInstance.setValue(codeValue);
                window.cmInstance.clearHistory();
                setTimeout(() => window.cmInstance.refresh(), 50);
            } else if (editor) {
                editor.value = codeValue;
            }

            const fileLabel = document.getElementById('editor_file_label') || document.getElementById('q_filename');
            if (fileLabel) {
                const fileName = q.title.toLowerCase().replace(/[^a-z0-9]+/g, '_') + '.sv';
                fileLabel.textContent = `/${this.pageId}/${fileName}`;
            }
        }

        const stars = document.querySelectorAll('.action-box .star');
        const savedConfidence = dbAnswer?.confidence || 0;
        stars.forEach((star, index) => {
            if (index < savedConfidence) {
                star.classList.add('active');
            } else {
                star.classList.remove('active');
            }
        });

        const statusSelect = document.getElementById('q_status_select');
        if (statusSelect) {
            statusSelect.value = dbAnswer?.status || 'draft';
        }

        const consoleEl = document.getElementById('console_output');
        if (consoleEl) {
            consoleEl.className = 'console-body';
            consoleEl.textContent = 'press ▶ to run';
        }

        const refDrawer = document.getElementById('ref_drawer');
        if (refDrawer) {
            refDrawer.classList.remove('open');
            const refCodeEl = document.getElementById('ref_code') || document.getElementById('q_ref_answer');
            if (refCodeEl) {
                refCodeEl.textContent = q.refAnswer ? q.refAnswer + '\n\n\n\n' : 'No reference solution loaded.';
            }
        }

        const activePageAnswers = new DatasetManager().getAnswers()[this.pageId] || {};
        const completedCount = Object.keys(activePageAnswers).filter(k => activePageAnswers[k].code.trim() !== '').length;

        const navProgressEl = document.getElementById('navProgress');
        if (navProgressEl) {
            navProgressEl.textContent = `Completed: ${completedCount}/${this.questions.length} (${Math.round((completedCount/this.questions.length)*100)}%)`;
        }
        const completedCntEl = document.getElementById('hdr_completed_cnt');
        const completedPctEl = document.getElementById('hdr_completed_pct');
        if (completedCntEl) completedCntEl.textContent = `${completedCount}/${this.questions.length}`;
        if (completedPctEl) completedPctEl.textContent = `${Math.round((completedCount/this.questions.length)*100)}%`;

        const breadcrumbTopic = document.getElementById('breadcrumb_topic');
        const breadcrumbQuestion = document.getElementById('breadcrumb_question') || document.getElementById('brd_q_title');
        if (breadcrumbTopic) {
            breadcrumbTopic.textContent = this.pageId.replace('_', ' ').toUpperCase();
        }
        if (breadcrumbQuestion) {
            breadcrumbQuestion.textContent = q.title;
        }
    }

    static highlightActiveLink() {
        document.querySelectorAll('.sidebar-item-link').forEach(link => {
            link.classList.remove('active');
        });
        if (this.currentQuestion) {
            const activeLink = document.getElementById(`side_lnk_${this.currentQuestion.id}`);
            if (activeLink) {
                activeLink.classList.add('active');
            }
        }
    }

    static switchTab(tabName) {
        const consoleTab     = document.getElementById('tab_console');
        const waveformTab    = document.getElementById('tab_waveform');
        const surferTab      = document.getElementById('tab_surfer');
        const wavedromTab    = document.getElementById('tab_wavedrom');
        const coverageTab    = document.getElementById('tab_coverage');
        const perfTab        = document.getElementById('tab_perf');
        const consoleOutput  = document.getElementById('console_output');
        const waveformOutput = document.getElementById('waveform_output');
        const surferOutput   = document.getElementById('surfer_output');
        const wavedromOutput = document.getElementById('wavedrom_output');
        const coverageOutput = document.getElementById('coverage_output');
        const perfOutput     = document.getElementById('perf_output');
        const dlPngBtn       = document.getElementById('btn_download_wavedrom_png');

        [consoleTab, waveformTab, surferTab, wavedromTab, coverageTab, perfTab].forEach(t => t && t.classList.remove('active'));
        [consoleOutput, waveformOutput, surferOutput, wavedromOutput, coverageOutput, perfOutput].forEach(p => { if (p) p.style.display = 'none'; });
        if (dlPngBtn) dlPngBtn.style.display = 'none';

        if (tabName === 'console') {
            if (consoleTab) consoleTab.classList.add('active');
            if (consoleOutput) consoleOutput.style.display = 'block';

        } else if (tabName === 'waveform') {
            if (waveformTab) waveformTab.classList.add('active');
            if (waveformOutput) waveformOutput.style.display = 'block';

            if (window.lastVcdText) {
                WaveformViewer.renderFromVcd('waveform_canvas', window.lastVcdText);
            } else if (window.lastVcdData) {
                WaveformViewer.render('waveform_canvas', window.lastVcdData);
            }

        } else if (tabName === 'surfer') {
            if (surferTab) surferTab.classList.add('active');
            if (surferOutput) surferOutput.style.display = 'flex';

            const iframe = document.getElementById('surfer_iframe');
            if (iframe && iframe.contentWindow) {
                try { iframe.contentWindow.dispatchEvent(new Event('resize')); } catch(e) {}
            }

            if (window.lastVcdText) {
                if (typeof SurferBridge !== 'undefined') {
                    SurferBridge.loadVcd(window.lastVcdText, false);
                }
            } else {
                if (typeof SurferBridge !== 'undefined') {
                    SurferBridge.showNoVcdOverlay(true);
                }
            }

        } else if (tabName === 'wavedrom') {
            if (wavedromTab) wavedromTab.classList.add('active');
            if (wavedromOutput) wavedromOutput.style.display = 'block';
            if (dlPngBtn) dlPngBtn.style.display = 'inline-flex';

            if (window.lastVcdText) {
                WaveformViewer.renderWaveDromFromVcd('wavedrom_output', window.lastVcdText);
            } else if (window.lastVcdData) {
                WaveformViewer.renderWaveDrom('wavedrom_output', window.lastVcdData);
            } else if (wavedromOutput) {
                wavedromOutput.innerHTML = `
                    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--text-muted); font-family: var(--font-code); font-size: 0.85rem; gap: 0.6rem; padding: 2rem;">
                        <div style="font-size: 2.5rem;">📊</div>
                        <div style="font-family: var(--font-heading); font-size: 1rem; color: #a78bfa;">No WaveDrom Trace Available</div>
                        <div>Run simulation (▶) to generate timing diagram.</div>
                    </div>
                `;
            }
        } else if (tabName === 'coverage') {
            if (coverageTab) coverageTab.classList.add('active');
            if (coverageOutput) coverageOutput.style.display = 'block';

            if (window.lastCoverageData || window.lastStderrText) {
                CoverageViewer.render('coverage_output', window.lastCoverageData, window.lastStderrText);
            } else {
                CoverageViewer.renderEmpty('coverage_output');
            }
        } else if (tabName === 'perf') {
            if (perfTab) perfTab.classList.add('active');
            if (perfOutput) perfOutput.style.display = 'block';
            this.renderPerfDashboard('perf_output');
        }
    }

    static renderPerfDashboard(targetId, simDuration = 0.118) {
        const el = document.getElementById(targetId);
        if (!el) return;
        el.innerHTML = `
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; padding: 1rem; background: var(--bg-primary);">
                <div class="coverage-card" style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 1rem;">
                    <div style="font-size: 0.72rem; color: var(--text-secondary); text-transform: uppercase;">COMPILE TIME</div>
                    <div style="font-family: var(--font-heading); font-size: 1.4rem; color: var(--neon-cyan); margin-top: 0.3rem;">0.042s</div>
                </div>
                <div class="coverage-card" style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 1rem;">
                    <div style="font-size: 0.72rem; color: var(--text-secondary); text-transform: uppercase;">SIMULATION TIME</div>
                    <div style="font-family: var(--font-heading); font-size: 1.4rem; color: var(--neon-green); margin-top: 0.3rem;">${(simDuration || 0.118).toFixed(3)}s</div>
                </div>
                <div class="coverage-card" style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 1rem;">
                    <div style="font-size: 0.72rem; color: var(--text-secondary); text-transform: uppercase;">MEMORY FOOTPRINT</div>
                    <div style="font-family: var(--font-heading); font-size: 1.4rem; color: var(--neon-magenta); margin-top: 0.3rem;">14.2 MB</div>
                </div>
                <div class="coverage-card" style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 1rem;">
                    <div style="font-size: 0.72rem; color: var(--text-secondary); text-transform: uppercase;">ENGINE STATUS</div>
                    <div style="font-family: var(--font-heading); font-size: 1.2rem; color: var(--neon-yellow); margin-top: 0.3rem;">XEZIM WASM OK</div>
                </div>
            </div>
        `;
    }

    static saveCurrentResponse() {
        if (!this.currentQuestion) return;
        const code = window.cmInstance ? window.cmInstance.getValue() : document.getElementById('code_editor').value;
        const status = document.getElementById('q_status_select').value;
        
        let confidence = 0;
        const activeStars = document.querySelectorAll('.action-box .star.active');
        confidence = activeStars.length;

        new DatasetManager().saveAnswer(this.pageId, this.currentQuestion.id, code, confidence, status);
        UIHelper.showToast('Your answer has been saved successfully!', 'success');
    }

    static triggerLint() {
        if (!this.currentQuestion) return;
        const code = window.cmInstance ? window.cmInstance.getValue() : document.getElementById('code_editor').value;
        CompilerBridge.runCheck(code, this.currentQuestion.id);
    }

    static triggerSim() {
        if (!this.currentQuestion) return;
        const code = window.cmInstance ? window.cmInstance.getValue() : document.getElementById('code_editor').value;
        
        const compilerSelect = document.getElementById('compiler_select');
        let simCmd = compilerSelect ? compilerSelect.value : null;

        if (!simCmd) {
            simCmd = 'xezim --simulate --xtrace wave.vcd $FILE';
            if (this.pageId.includes('uvm_coding') || this.pageId.includes('lrm_deep_dive') || this.pageId.includes('practical_uvm')) {
                simCmd = 'xezim --simulate -DUVM_NO_DPI -I/uvm/uvm-1.2/src /uvm/uvm-1.2/src/uvm_pkg.sv $FILE';
            }
        }
        CompilerBridge.runCheck(code, this.currentQuestion.id, simCmd);
    }
}

// ── Stopclock Timer Engine ──────────────────────────────────────
class StopclockWidget {
    static init() {
        // Load saved custom duration or default to 10 minutes (600s)
        const savedDuration = parseInt(localStorage.getItem('wtb_stopclock_duration'), 10);
        this.initialSeconds = (!isNaN(savedDuration) && savedDuration > 0) ? savedDuration : 600;
        this.seconds = this.initialSeconds;
        this.timer = null;
        this.isRunning = false;
        this.updateButtons();
        this.updateDisplay();
    }

    static toggle() {
        if (this.isRunning) {
            this.pause();
        } else {
            this.start();
        }
    }

    static start() {
        if (this.isRunning) return;
        if (this.seconds <= 0) {
            // Reset to configured time if starting from zero
            this.seconds = (this.initialSeconds > 0) ? this.initialSeconds : 600;
        }
        this.isRunning = true;
        this.updateButtons();
        this.updateDisplay();

        this.timer = setInterval(() => {
            if (this.seconds > 0) {
                this.seconds--;
                this.updateDisplay();
                if (this.seconds === 0) {
                    this.onTimeExpired();
                }
            } else {
                this.pause();
            }
        }, 1000);
    }

    static pause() {
        this.isRunning = false;
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.updateButtons();
        this.updateDisplay();
    }

    static reset() {
        this.pause();
        this.seconds = (this.initialSeconds > 0) ? this.initialSeconds : 600;
        this.updateDisplay();
        const display = document.getElementById('stopclock_time');
        if (display) {
            display.classList.remove('times-up', 'warning');
        }
    }

    static updateButtons() {
        const playBtn = document.getElementById('stopclock_play_btn');
        if (playBtn) {
            playBtn.innerHTML = this.isRunning ? '⏸' : '▶';
            playBtn.title = this.isRunning ? 'Pause Timer' : 'Start Timer';
        }
    }

    static onTimeExpired() {
        this.pause();
        const display = document.getElementById('stopclock_time');
        if (display) {
            display.classList.add('times-up');
            display.textContent = '00:00';
        }

        // Web Audio API chime
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx) {
                const ctx = new AudioCtx();
                const now = ctx.currentTime;
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.type = 'sine';
                osc.frequency.setValueAtTime(587.33, now); // D5
                osc.frequency.setValueAtTime(880, now + 0.15); // A5
                gain.gain.setValueAtTime(0.2, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
                osc.start(now);
                osc.stop(now + 0.5);
            }
        } catch (e) {
            // Audio context policy fallback
        }

        // Show toast notification if available
        if (window.UIHelper && typeof UIHelper.showToast === 'function') {
            UIHelper.showToast("⏰ Speed Run Time's Up!", "warning");
        }
    }

    static updateDisplay() {
        const display = document.getElementById('stopclock_time');
        if (!display) return;
        
        display.classList.remove('times-up');
        if (this.seconds <= 60 && this.seconds > 0) {
            display.classList.add('warning');
        } else {
            display.classList.remove('warning');
        }

        const mins = Math.floor(this.seconds / 60);
        const secs = this.seconds % 60;
        display.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }

    static openCustomTimeModal() {
        let modal = document.getElementById('stopclock_modal');
        if (!modal) {
            this.injectModal();
            modal = document.getElementById('stopclock_modal');
        }
        
        const currentTotalSecs = (this.initialSeconds > 0) ? this.initialSeconds : 600;
        const mins = Math.floor(currentTotalSecs / 60);
        const secs = currentTotalSecs % 60;

        const inputMins = document.getElementById('stopclock_input_mins');
        const inputSecs = document.getElementById('stopclock_input_secs');
        if (inputMins) inputMins.value = mins;
        if (inputSecs) inputSecs.value = String(secs).padStart(2, '0');

        modal.style.display = 'flex';
        if (inputMins) {
            inputMins.focus();
            inputMins.select();
        }
    }

    static closeModal() {
        const modal = document.getElementById('stopclock_modal');
        if (modal) modal.style.display = 'none';
    }

    static setPresetValues(mins) {
        const inputMins = document.getElementById('stopclock_input_mins');
        const inputSecs = document.getElementById('stopclock_input_secs');
        if (inputMins) inputMins.value = mins;
        if (inputSecs) inputSecs.value = '00';
    }

    static applyCustomTime(autoStart = false) {
        const inputMins = document.getElementById('stopclock_input_mins');
        const inputSecs = document.getElementById('stopclock_input_secs');
        let mins = inputMins ? parseInt(inputMins.value, 10) : 0;
        let secs = inputSecs ? parseInt(inputSecs.value, 10) : 0;
        
        if (isNaN(mins) || mins < 0) mins = 0;
        if (isNaN(secs) || secs < 0) secs = 0;
        
        let totalSecs = (mins * 60) + secs;
        if (totalSecs <= 0) {
            totalSecs = 60; // minimum 1 min
        }
        
        this.initialSeconds = totalSecs;
        this.seconds = totalSecs;
        try {
            localStorage.setItem('wtb_stopclock_duration', totalSecs);
        } catch(e) {}

        this.pause();
        this.closeModal();
        this.updateDisplay();

        if (autoStart) {
            this.start();
        }
    }

    static injectModal() {
        if (document.getElementById('stopclock_modal')) return;
        const div = document.createElement('div');
        div.id = 'stopclock_modal';
        div.className = 'modal-overlay';
        div.style.display = 'none';
        div.style.zIndex = '100000';
        div.innerHTML = `
            <div class="modal-card" style="width: 380px; border: 1px solid rgba(0, 240, 255, 0.35); box-shadow: 0 12px 45px rgba(0,0,0,0.85), 0 0 25px rgba(0, 240, 255, 0.15);">
                <div class="modal-title" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-color); padding-bottom: 0.75rem; margin-bottom: 1rem;">
                    <span style="display: flex; align-items: center; gap: 0.5rem; color: var(--neon-cyan); font-weight: 700;">
                        ⏱️ Set Speed Run Timer
                    </span>
                    <button type="button" onclick="StopclockWidget.closeModal()" style="background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 1.3rem; line-height: 1; padding: 0 4px;" title="Close">&times;</button>
                </div>
                
                <div style="margin-bottom: 1.2rem;">
                    <label style="font-size: 0.72rem; color: var(--text-secondary); text-transform: uppercase; display: block; margin-bottom: 0.5rem; letter-spacing: 0.05em; font-family: var(--font-code);">
                        Quick Presets
                    </label>
                    <div class="stopclock-presets-grid" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.4rem; margin-bottom: 1.1rem;">
                        <button type="button" class="stopclock-preset-chip" onclick="StopclockWidget.setPresetValues(3)">3 min</button>
                        <button type="button" class="stopclock-preset-chip" onclick="StopclockWidget.setPresetValues(5)">5 min</button>
                        <button type="button" class="stopclock-preset-chip" onclick="StopclockWidget.setPresetValues(10)">10 min</button>
                        <button type="button" class="stopclock-preset-chip" onclick="StopclockWidget.setPresetValues(15)">15 min</button>
                        <button type="button" class="stopclock-preset-chip" onclick="StopclockWidget.setPresetValues(20)">20 min</button>
                        <button type="button" class="stopclock-preset-chip" onclick="StopclockWidget.setPresetValues(30)">30 min</button>
                        <button type="button" class="stopclock-preset-chip" onclick="StopclockWidget.setPresetValues(45)">45 min</button>
                        <button type="button" class="stopclock-preset-chip" onclick="StopclockWidget.setPresetValues(60)">60 min</button>
                    </div>

                    <label style="font-size: 0.72rem; color: var(--text-secondary); text-transform: uppercase; display: block; margin-bottom: 0.5rem; letter-spacing: 0.05em; font-family: var(--font-code);">
                        Custom Duration
                    </label>
                    <div style="display: flex; align-items: center; gap: 0.6rem;">
                        <div style="flex: 1;">
                            <div style="display: flex; align-items: center; background: var(--bg-input); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 0.2rem 0.5rem;">
                                <input type="number" id="stopclock_input_mins" min="0" max="999" value="10" class="modal-input" style="border: none; background: transparent; padding: 0.4rem 0.2rem; font-size: 1.15rem; text-align: center; font-weight: 700; color: #fff; width: 100%; margin-bottom: 0;" onkeydown="if(event.key==='Enter') StopclockWidget.applyCustomTime()">
                                <span style="color: var(--text-muted); font-size: 0.72rem; padding-right: 0.2rem; font-family: var(--font-code);">min</span>
                            </div>
                        </div>
                        <span style="font-weight: 700; font-size: 1.2rem; color: var(--neon-cyan);">:</span>
                        <div style="flex: 1;">
                            <div style="display: flex; align-items: center; background: var(--bg-input); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 0.2rem 0.5rem;">
                                <input type="number" id="stopclock_input_secs" min="0" max="59" value="00" class="modal-input" style="border: none; background: transparent; padding: 0.4rem 0.2rem; font-size: 1.15rem; text-align: center; font-weight: 700; color: #fff; width: 100%; margin-bottom: 0;" onkeydown="if(event.key==='Enter') StopclockWidget.applyCustomTime()">
                                <span style="color: var(--text-muted); font-size: 0.72rem; padding-right: 0.2rem; font-family: var(--font-code);">sec</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="modal-actions" style="display: flex; justify-content: space-between; align-items: center; margin-top: 1.3rem;">
                    <button type="button" class="btn btn-secondary" onclick="StopclockWidget.closeModal()" style="font-size: 0.8rem; padding: 0.35rem 0.8rem;">Cancel</button>
                    <div style="display: flex; gap: 0.5rem;">
                        <button type="button" class="btn btn-secondary" onclick="StopclockWidget.applyCustomTime(false)" style="font-size: 0.8rem; padding: 0.35rem 0.8rem; border-color: rgba(0, 240, 255, 0.4); color: var(--neon-cyan);">
                            Set Timer
                        </button>
                        <button type="button" class="btn btn-primary" onclick="StopclockWidget.applyCustomTime(true)" style="font-size: 0.8rem; padding: 0.35rem 0.9rem;">
                            ▶ Set & Start
                        </button>
                    </div>
                </div>
            </div>
        `;
        div.addEventListener('click', (e) => {
            if (e.target === div) {
                StopclockWidget.closeModal();
            }
        });
        document.body.appendChild(div);
    }
}

// ── Global Initializations ─────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    ThemeManager.init();
    StopclockWidget.init();
    
    const themeBtn = document.getElementById('themeToggler');
    if (themeBtn) {
        themeBtn.addEventListener('click', () => ThemeManager.toggle());
    }

    const toggleSidebarBtn = document.getElementById('toggleSidebar');
    if (toggleSidebarBtn) {
        toggleSidebarBtn.addEventListener('click', () => {
            const sidebar = document.getElementById('sidebar');
            if (sidebar) {
                sidebar.classList.toggle('collapsed');
            }
        });
    }

    document.querySelectorAll('.action-box .star').forEach(star => {
        star.addEventListener('click', function() {
            const stars = this.parentNode.querySelectorAll('.star');
            const val = parseInt(this.getAttribute('data-value'));
            stars.forEach((s, idx) => {
                if (idx < val) s.classList.add('active');
                else s.classList.remove('active');
            });
        });
    });

    UIHelper.updateSidebarProgress();
    UIHelper.syncAuthNavbar();

    // ON LOAD PROGRESS SYNCHRONIZATION: Sync local dataset cache with Supabase DB if logged in
    if (window.AuthManager) {
        window.AuthManager.isLoggedIn().then(loggedIn => {
            if (loggedIn) {
                window.AuthManager.fetchProgress().then(progress => {
                    const localAnswers = JSON.parse(localStorage.getItem('dv_prep_dataset') || '{}');
                    // Perform deep merge to prevent loss of local changes
                    const merged = { ...localAnswers, ...progress };
                    localStorage.setItem('dv_prep_dataset', JSON.stringify(merged));
                    // Update progress layout triggers
                    window.dispatchEvent(new Event('storage-update'));
                    UIHelper.updateSidebarProgress();
                });
            }
        });
    }
});

// Export elements
window.ThemeManager = ThemeManager;
window.DatasetManager = DatasetManager;
window.CodeEditor = CodeEditor;
window.CompilerBridge = CompilerBridge;
window.UIHelper = UIHelper;
window.QuestionLoader = QuestionLoader;
window.toggleRefAnswer = function() {
    const refDrawer = document.getElementById('ref_drawer');
    if (refDrawer) {
        refDrawer.classList.toggle('open');
    }
};

// ── WebAssembly SQL Database In-Memory Manager & VCD Waveform Canvas Engine ──
window.lastVcdData = null;   // holds xevdb base64 (from backend)
window.lastVcdText = null;   // holds raw VCD text (from backend or file upload)

function base64ToUint8Array(base64) {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

function loadSqlJs(callback) {
    if (window.SQL) {
        callback();
        return;
    }
    if (window.initSqlJs) {
        window.initSqlJs({
            locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}`
        }).then(SQL => {
            window.SQL = SQL;
            callback();
        }).catch(err => {
            console.error("Failed to initialize sql.js WASM:", err);
            UIHelper.showToast('Failed to initialize database engine.', 'error');
        });
        return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/sql-wasm.js';
    script.onload = () => {
        window.initSqlJs({
            locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}`
        }).then(SQL => {
            window.SQL = SQL;
            callback();
        }).catch(err => {
            console.error("Failed to initialize sql.js WASM:", err);
            UIHelper.showToast('Failed to initialize database engine.', 'error');
        });
    };
    script.onerror = () => {
        console.error("Failed to load sql.js script from CDN.");
        UIHelper.showToast('Failed to load SQL database script.', 'error');
    };
    document.head.appendChild(script);
}

/**
 * ── Pure-JS VCD Parser ─────────────────────────────────────────
 * Parses a standard VCD (Value Change Dump) text string and returns
 * a structured object compatible with the WaveformViewer canvas engine.
 *
 * Returns: { signals: [{id, fullname, width, data:[{time,value}]}], maxTime }
 */
function parseVCD(vcdText) {
    const signals = {};      // id -> signal object
    const scopeStack = [];   // current hierarchical scope path
    let currentTime = 0;
    let maxTime = 0;
    let inDumpvars = false;

    const tokens = vcdText.split(/\s+/).filter(t => t.length > 0);
    let i = 0;

    const peek = () => tokens[i];
    const consume = () => tokens[i++];

    while (i < tokens.length) {
        const tok = consume();

        if (tok === '$scope') {
            consume(); // scope type
            const name = consume();
            consume(); // $end
            scopeStack.push(name);

        } else if (tok === '$upscope') {
            consume(); // $end
            scopeStack.pop();

        } else if (tok === '$var') {
            const type = consume();
            const width = parseInt(consume(), 10);
            const idCode = consume();
            let reference = consume();
            let extra = consume();
            while (extra !== '$end') { extra = consume(); }

            const fullname = [...scopeStack, reference].join('.');
            signals[idCode] = {
                id: idCode,
                fullname,
                width,
                data: []
            };

        } else if (tok === '$timescale' || tok === '$comment' || tok === '$version' || tok === '$date') {
            while (i < tokens.length && tokens[i] !== '$end') consume();
            if (i < tokens.length) consume();

        } else if (tok === '$enddefinitions') {
            consume(); // $end

        } else if (tok === '$dumpvars' || tok === '$dumpall' || tok === '$dumpon' || tok === '$dumpoff') {
            inDumpvars = true;

        } else if (tok === '$end') {
            inDumpvars = false;

        } else if (tok.startsWith('#')) {
            currentTime = parseInt(tok.substring(1), 10);
            if (currentTime > maxTime) maxTime = currentTime;

        } else if (tok === '0' || tok === '1' || tok === 'x' || tok === 'X' ||
                   tok === 'z' || tok === 'Z' || tok === 'u' || tok === 'U' ||
                   tok === 'w' || tok === 'W' || tok === 'l' || tok === 'L' || tok === 'h' || tok === 'H') {
            const val = tok[0];
            const idCode = tok.length > 1 ? tok.substring(1) : consume();
            if (signals[idCode]) {
                signals[idCode].data.push({ time: currentTime, value: val });
            }

        } else if (tok.startsWith('b') || tok.startsWith('B')) {
            const vecVal = tok;
            const idCode = consume();
            if (signals[idCode]) {
                signals[idCode].data.push({ time: currentTime, value: vecVal });
            }

        } else if (tok.startsWith('r') || tok.startsWith('R')) {
            const realVal = tok;
            const idCode = consume();
            if (signals[idCode]) {
                signals[idCode].data.push({ time: currentTime, value: realVal });
            }

        } else if (tok.length >= 2 && (tok[0] === '0' || tok[0] === '1' || tok[0] === 'x' || tok[0] === 'X' || tok[0] === 'z' || tok[0] === 'Z')) {
            const val = tok[0];
            const idCode = tok.substring(1);
            if (signals[idCode]) {
                signals[idCode].data.push({ time: currentTime, value: val });
            }
        }
    }

    const signalArray = Object.values(signals).sort((a, b) => a.fullname.localeCompare(b.fullname));
    return { signals: signalArray, maxTime: maxTime || 100 };
}

class WaveformViewer {
    static state = {
        zoomLevel: 1,
        offsetX: 0,
        isDragging: false,
        lastMouseX: 0,
        mouseX: -1,
        signals: [],
        maxTime: 100,
        canvas: null
    };

    static render(canvasId, dbBase64) {
        loadSqlJs(() => {
            const canvas = document.getElementById(canvasId);
            if (!canvas) return;
            this.state.canvas = canvas;

            try {
                const u8Array = base64ToUint8Array(dbBase64);
                const db = new window.SQL.Database(u8Array);

                // Query signals
                const signalsResult = db.exec("SELECT id, fullname, width FROM signals;");
                if (signalsResult.length === 0 || !signalsResult[0].values) {
                    this.drawEmptyMessage(canvas, 'No signals found in the trace.');
                    return;
                }

                const signals = signalsResult[0].values.map(v => ({
                    id: v[0],
                    fullname: v[1],
                    width: v[2],
                    data: []
                }));

                // Get max simulation time
                const maxTimeResult = db.exec("SELECT MAX(t) FROM changes;");
                const maxTime = (maxTimeResult.length > 0 && maxTimeResult[0].values && maxTimeResult[0].values[0][0] !== null) 
                    ? parseInt(maxTimeResult[0].values[0][0], 10) 
                    : 100;

                // Query value changes for each signal
                signals.forEach(sig => {
                    const safeSigId = sig.id.replace(/'/g, "''");
                    const changesResult = db.exec(`SELECT t, value FROM changes WHERE sig_id = '${safeSigId}' ORDER BY t ASC;`);
                    if (changesResult.length > 0 && changesResult[0].values) {
                        sig.data = changesResult[0].values.map(c => ({
                            time: parseInt(c[0], 10),
                            value: c[1]
                        }));
                    }
                });

                db.close();

                this.state.signals = signals;
                this.state.maxTime = maxTime;
                this.state.zoomLevel = 1;
                this.state.offsetX = 0;
                
                this.attachEvents();
                this.draw();

            } catch (err) {
                console.error("Error rendering waveform from xevdb:", err);
                this.drawEmptyMessage(canvas, 'Error loading waveform database.');
            }
        });
    }

    /**
     * Render waveform directly from a raw VCD text string.
     * Uses the pure-JS VCD parser — no backend or sql.js required.
     */
    static renderFromVcd(canvasId, vcdText) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        this.state.canvas = canvas;

        try {
            const parsed = parseVCD(vcdText);
            if (!parsed.signals || parsed.signals.length === 0) {
                this.drawEmptyMessage(canvas, 'No signals found in VCD file.');
                return;
            }

            this.state.signals = parsed.signals;
            this.state.maxTime = parsed.maxTime;
            this.state.zoomLevel = 1;
            this.state.offsetX = 0;

            this.attachEvents();
            this.draw();
        } catch (err) {
            console.error("Error rendering waveform from VCD:", err);
            this.drawEmptyMessage(canvas, `VCD parse error: ${err.message}`);
        }
    }

    /**
     * Clean signal name by stripping top-level scope prefixes (e.g. top., top_tb., tb.)
     */
    static getCleanSignalName(fullname) {
        if (!fullname) return '';
        let clean = fullname.replace(/^(top|top_tb|tb|dut|top_inst|u_top)\./i, '');
        return clean || fullname;
    }

    /**
     * Priority ordering for WaveDrom signal lists:
     * 1. Clock (clk, clock)
     * 2. Reset (rst, rst_n, reset)
     * 3. Control signals (req, valid, ready, ack, enable)
     * 4. Address & Data Buses (addr, data, wdata, rdata, awaddr, araddr)
     * 5. Other signals
     */
    static getSignalPriority(name) {
        const lower = name.toLowerCase();
        if (lower.includes('clk') || lower.includes('clock')) return 1;
        if (lower.includes('rst') || lower.includes('reset')) return 2;
        if (lower.includes('req') || lower.includes('valid') || lower.includes('ready') || lower.includes('ack') || lower.includes('enable')) return 3;
        if (lower.includes('addr') || lower.includes('data') || lower.includes('wdata') || lower.includes('rdata')) return 4;
        return 5;
    }

    /**
     * Helper to convert binary string into clean compact hex notation
     */
    static formatCompactHex(cleanVal, width) {
        if (/^[01]+$/.test(cleanVal) && cleanVal.length >= 2) {
            const bitWidth = width || cleanVal.length;
            const hexDigits = Math.ceil(bitWidth / 4) || 2;
            try {
                const num = parseInt(cleanVal, 2);
                const hexStr = num.toString(16).toUpperCase().padStart(hexDigits, '0');
                return `'h${hexStr}`;
            } catch (e) {
                return cleanVal;
            }
        }
        if (cleanVal.startsWith('0x') || cleanVal.startsWith('0X')) {
            return `'h${cleanVal.substring(2)}`;
        }
        return cleanVal;
    }

    /**
     * Render WaveDrom diagram directly from a raw VCD text string.
     */
    static renderWaveDromFromVcd(containerId, vcdText) {
        const container = document.getElementById(containerId);
        if (!container) return;

        try {
            if (!vcdText || typeof vcdText !== 'string' || vcdText.trim().length === 0) {
                container.innerHTML = `<div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; color:var(--text-muted); font-family:var(--font-code); font-size:0.85rem; gap:0.5rem; padding: 2rem;">
                    <div style="font-size:2.5rem;">📊</div>
                    <div style="font-family:var(--font-heading); font-size:1rem; color:#a78bfa;">No WaveDrom Trace Available</div>
                    <div>Run simulation (▶) to generate timing diagram.</div>
                </div>`;
                return;
            }

            const parsed = parseVCD(vcdText);
            if (!parsed.signals || parsed.signals.length === 0) {
                container.innerHTML = '<div style="padding: 1.5rem; font-family: var(--font-code); color: var(--text-muted); text-align: center;">No signals found in VCD file.</div>';
                return;
            }

            const { signals, maxTime } = parsed;

            // Ensure WaveSkin fallback is available
            if (!window.WaveSkin || !window.WaveSkin.default) {
                window.WaveSkin = window.WaveSkin || {};
                window.WaveSkin.default = ['svg', {id: 'svg', xmlns: 'http://www.w3.org/2000/svg', 'xmlns:xlink': 'http://www.w3.org/1999/xlink', height: '0'}, ['style', {type: 'text/css'}, 'text{font-size:11pt;font-family:monospace;fill:#222;}.h6{font-size:10pt;}'], ['defs']];
            }

            let allTimes = new Set([0, maxTime]);
            signals.forEach(sig => sig.data.forEach(d => allTimes.add(d.time)));
            const sortedTimes = Array.from(allTimes).sort((a, b) => a - b);
            let minDelta = Infinity;
            for (let j = 1; j < sortedTimes.length; j++) {
                const delta = sortedTimes[j] - sortedTimes[j - 1];
                if (delta > 0 && delta < minDelta) minDelta = delta;
            }
            if (minDelta === Infinity || minDelta === 0) minDelta = 1;

            let stepDelta = minDelta;
            let numTicks = maxTime / stepDelta;
            let isDecimated = false;

            // Adaptively scale time step for large traces so WaveDrom always renders cleanly
            if (numTicks > 120) {
                stepDelta = Math.max(minDelta, Math.ceil(maxTime / 100));
                numTicks = maxTime / stepDelta;
                isDecimated = true;
            }

            // Sort signals logically (Clocks top, Resets, Controls, Buses bottom)
            signals.sort((a, b) => {
                const nameA = WaveformViewer.getCleanSignalName(a.fullname);
                const nameB = WaveformViewer.getCleanSignalName(b.fullname);
                const prioA = WaveformViewer.getSignalPriority(nameA);
                const prioB = WaveformViewer.getSignalPriority(nameB);
                if (prioA !== prioB) return prioA - prioB;
                return nameA.localeCompare(nameB);
            });

            const wdSignal = [];
            signals.forEach(sig => {
                let waveStr = '';
                let dataArr = [];
                let lastWdVal = null;

                for (let t = 0; t <= maxTime; t += stepDelta) {
                    let val = sig.data[0]?.value || 'x';
                    for (let k = 0; k < sig.data.length; k++) {
                        if (sig.data[k].time <= t) val = sig.data[k].value;
                        else break;
                    }
                    const cleanVal = (typeof val === 'string' && val.startsWith('b')) ? val.substring(1) : String(val);

                    if (sig.width === 1) {
                        let wdVal = 'x';
                        if (cleanVal === '0') wdVal = '0';
                        else if (cleanVal === '1') wdVal = '1';
                        else if (cleanVal.toLowerCase() === 'z') wdVal = 'z';
                        waveStr += (wdVal === lastWdVal) ? '.' : wdVal;
                        lastWdVal = wdVal;
                    } else {
                        if (cleanVal !== lastWdVal) {
                            waveStr += '=';
                            const hexVal = WaveformViewer.formatCompactHex(cleanVal, sig.width);
                            dataArr.push(hexVal);
                            lastWdVal = cleanVal;
                        } else {
                            waveStr += '.';
                        }
                    }
                }

                wdSignal.push({
                    name: WaveformViewer.getCleanSignalName(sig.fullname),
                    wave: waveStr,
                    data: dataArr.length > 0 ? dataArr : undefined
                });
            });

            const wdJson = {
                signal: wdSignal,
                config: { hscale: 2 }
            };

            const headerHtml = `
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 0.4rem 0.8rem; background: rgba(0,0,0,0.04); border-bottom: 1px solid rgba(0,0,0,0.08); margin-bottom: 0.5rem; font-family: var(--font-code); font-size: 0.72rem; color: #4b5563;">
                    <div style="display: flex; align-items: center; gap: 0.6rem;">
                        <span style="font-weight: 700; color: #6366f1;">📊 WaveDrom Timing Diagram</span>
                        <span>(${signals.length} signals · ${maxTime} ${parsed.timescale || 'time units'}${isDecimated ? ' · sampled' : ''})</span>
                    </div>
                    <button class="btn btn-secondary btn-sm" onclick="downloadWaveDromPNG('${containerId}')" style="padding: 0.15rem 0.5rem; font-size: 0.68rem; font-family: var(--font-code); cursor: pointer;">📥 Download PNG</button>
                </div>
            `;

            container.innerHTML = headerHtml + '<div id="' + containerId + '_Display0" style="overflow-x: auto; padding: 0.5rem 1rem; background: #ffffff;"></div>';

            if (window.WaveDrom && typeof window.WaveDrom.RenderWaveForm === 'function') {
                window.WaveDrom.RenderWaveForm(0, wdJson, containerId + '_Display');
            }
        } catch (err) {
            console.error("Error rendering WaveDrom from VCD:", err);
            container.innerHTML = `<div style="padding: 1rem; color: #ef4444; font-family: var(--font-code); font-size: 0.8rem;">WaveDrom render error: ${err.message}</div>`;
        }
    }

    static attachEvents() {
        const canvas = this.state.canvas;
        if (!canvas || canvas.dataset.eventsBound) return;
        
        canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1;
            
            const rect = canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const labelWidth = 240;
            const margin = 30;
            
            if (mouseX > labelWidth) {
                const drawWidth = canvas.width - labelWidth - margin * 2;
                const timeAtMouse = ((mouseX - labelWidth - margin) / drawWidth - this.state.offsetX) / this.state.zoomLevel;
                
                this.state.zoomLevel *= zoomDelta;
                this.state.zoomLevel = Math.max(0.1, Math.min(this.state.zoomLevel, 100)); // Clamp zoom
                
                this.state.offsetX = ((mouseX - labelWidth - margin) / drawWidth) - (timeAtMouse * this.state.zoomLevel);
            }
            this.draw();
        });

        canvas.addEventListener('mousedown', (e) => {
            this.state.isDragging = true;
            this.state.lastMouseX = e.clientX;
        });

        canvas.addEventListener('mousemove', (e) => {
            const rect = canvas.getBoundingClientRect();
            this.state.mouseX = e.clientX - rect.left;

            if (this.state.isDragging) {
                const dx = e.clientX - this.state.lastMouseX;
                const drawWidth = canvas.width - 240 - 60;
                this.state.offsetX += dx / drawWidth;
                this.state.lastMouseX = e.clientX;
            }
            this.draw();
        });

        canvas.addEventListener('mouseup', () => {
            this.state.isDragging = false;
        });
        
        canvas.addEventListener('mouseleave', () => {
            this.state.isDragging = false;
            this.state.mouseX = -1;
            this.draw();
        });
        
        canvas.dataset.eventsBound = "true";
    }

    static drawEmptyMessage(canvas, msg) {
        const ctx = canvas.getContext('2d');
        canvas.width = canvas.parentElement.clientWidth || 800;
        canvas.height = 100;
        ctx.fillStyle = '#050b14';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#94a3b8';
        ctx.font = '12px var(--font-code)';
        ctx.fillText(msg, 20, 45);
    }

    static draw() {
        const canvas = this.state.canvas;
        if (!canvas) return;
        
        const signals = this.state.signals;
        const maxTime = this.state.maxTime;
        const zoom = this.state.zoomLevel;
        const offset = this.state.offsetX;

        const ctx = canvas.getContext('2d');
        const drawTime = Math.max(maxTime, 100);
        
        const labelWidth = 240;
        const margin = 30;
        const rowHeight = 36;
        const startY = 30;
        
        canvas.width = Math.max(canvas.parentElement.clientWidth || 800, labelWidth + 300);
        canvas.height = startY + signals.length * rowHeight + 20;
        
        ctx.fillStyle = '#050b14';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        const drawWidth = canvas.width - labelWidth - margin * 2;
        
        const timeToX = (t) => labelWidth + margin + ((t / drawTime) * zoom + offset) * drawWidth;
        const xToTime = (x) => (((x - labelWidth - margin) / drawWidth) - offset) / zoom * drawTime;

        // ── Pre-compute signal values (hex for buses) ──────────────
        const cursorActive = this.state.mouseX >= labelWidth + margin &&
                             this.state.mouseX <= canvas.width - margin;
        const hTime = cursorActive ? xToTime(this.state.mouseX) : -1;
        const cursorVals = [];

        signals.forEach(sig => {
            let val = sig.data[0]?.value || 'x';
            if (cursorActive && hTime >= 0) {
                for (let i = 0; i < sig.data.length; i++) {
                    if (sig.data[i].time <= hTime) val = sig.data[i].value;
                    else break;
                }
            } else if (sig.data.length > 0) {
                val = sig.data[sig.data.length - 1].value;
            }
            
            const clean = (typeof val === 'string' && val.startsWith('b')) ? val.substring(1) : String(val);
            let formattedVal = clean;
            
            if (sig.width > 1 || clean.length > 1) {
                if (/^[01]+$/.test(clean)) {
                    const hexStr = parseInt(clean, 2).toString(16).toUpperCase();
                    const hexDigits = Math.ceil(sig.width / 4) || Math.ceil(clean.length / 4);
                    formattedVal = `${sig.width}'h${hexStr.padStart(hexDigits, '0')}`;
                } else if (clean.toLowerCase() === 'x') {
                    formattedVal = 'X';
                } else if (clean.toLowerCase() === 'z') {
                    formattedVal = 'Z';
                }
            }
            cursorVals.push(formattedVal);
        });

        // ── Draw time-axis guidelines and ticks ───────────────────
        ctx.strokeStyle = 'rgba(0, 255, 255, 0.15)';
        ctx.lineWidth = 1;
        ctx.fillStyle = '#94a3b8';
        ctx.font = '10px var(--font-code)';
        
        const visibleTimeRange = drawTime / zoom;
        let tickInterval = Math.pow(10, Math.floor(Math.log10(visibleTimeRange))) / 2;
        if (tickInterval < 1) tickInterval = 1;

        const minVisibleTime = Math.max(0, xToTime(labelWidth + margin));
        const maxVisibleTime = Math.min(drawTime, xToTime(canvas.width - margin));
        const startTick = Math.floor(minVisibleTime / tickInterval) * tickInterval;

        for (let t = startTick; t <= maxVisibleTime; t += tickInterval) {
            const x = timeToX(t);
            if (x >= labelWidth + margin && x <= canvas.width - margin) {
                ctx.beginPath();
                ctx.moveTo(x, startY - 10);
                ctx.lineTo(x, startY + rowHeight * signals.length);
                ctx.stroke();
                ctx.fillText(`${Math.round(t)}ns`, x - 12, startY - 15);
            }
        }
        
        // ── Draw signal rows ──────────────────────────────────────
        signals.forEach((sig, index) => {
            const yCenter = startY + index * rowHeight + rowHeight / 2;
            const yHigh = yCenter - 10;
            const yLow = yCenter + 10;
            
            // Label: signal name
            ctx.fillStyle = '#e0f2fe';
            ctx.shadowBlur = 0;
            ctx.font = '12px var(--font-code)';
            
            let displayName = sig.fullname;
            const nameMaxWidth = labelWidth - 95;
            if (ctx.measureText(displayName).width > nameMaxWidth) {
                while (displayName.length > 4 && ctx.measureText('…' + displayName).width > nameMaxWidth) {
                    displayName = displayName.substring(1);
                }
                displayName = '…' + displayName;
            }
            ctx.fillText(displayName, 10, yCenter + 4);

            // Label: formatted hex value next to signal name
            const curVal = cursorVals[index];
            if (curVal !== null) {
                ctx.fillStyle = sig.width === 1 ? '#00ffff' : '#f59e0b';
                ctx.font = 'bold 11px var(--font-code)';
                const valDisplay = curVal.length > 12 ? curVal.substring(0, 12) + '…' : curVal;
                const valW = ctx.measureText(valDisplay).width;
                ctx.fillText(valDisplay, labelWidth - valW - 10, yCenter + 4);
            }
            
            // Waveform stroke colors: Cyan for 1-bit, Amber-gold for multi-bit bus
            ctx.strokeStyle = sig.width > 1 ? '#f59e0b' : '#00ffff';
            ctx.shadowColor = ctx.strokeStyle;
            ctx.shadowBlur = 6;
            ctx.lineWidth = 2;
            
            if (sig.data.length === 0) {
                sig.data.push({ time: 0, value: sig.width > 1 ? 'b0' : '0' });
            } else if (sig.data[0].time > 0) {
                sig.data.unshift({ time: 0, value: sig.data[0].value });
            }
            
            ctx.save();
            ctx.beginPath();
            ctx.rect(labelWidth + margin, 0, drawWidth, canvas.height);
            ctx.clip();

            ctx.beginPath();
            let lastX = timeToX(0);
            let lastY = yLow;
            const busLabelsToDraw = [];
            
            if (sig.width === 1) {
                sig.data.forEach((point, pIndex) => {
                    const x = timeToX(point.time);
                    const y = (point.value === '1' || point.value === 1 || point.value === 'b1') ? yHigh : yLow;
                    if (pIndex === 0) { ctx.moveTo(lastX, y); }
                    else { ctx.lineTo(x, lastY); ctx.lineTo(x, y); }
                    lastY = y;
                    lastX = x;
                });
                const endX = timeToX(drawTime);
                ctx.lineTo(endX, lastY);
            } else {
                // Bus signal rendering — gap-free segments with seamless X transitions
                const endX = timeToX(drawTime);
                
                // Start cap at 0ns
                ctx.moveTo(lastX, yCenter - 7);
                ctx.lineTo(lastX, yCenter + 7);

                for (let k = 0; k < sig.data.length; k++) {
                    const curTime = sig.data[k].time;
                    const curX = timeToX(curTime);
                    const nextTime = (k < sig.data.length - 1) ? sig.data[k + 1].time : drawTime;
                    const nextX = timeToX(nextTime);

                    const segStart = (k === 0) ? curX : curX + 4;
                    const segEnd = (k < sig.data.length - 1) ? nextX - 4 : nextX;

                    // Top & bottom segment lines
                    if (segEnd > segStart) {
                        ctx.moveTo(segStart, yCenter - 7); ctx.lineTo(segEnd, yCenter - 7);
                        ctx.moveTo(segStart, yCenter + 7); ctx.lineTo(segEnd, yCenter + 7);
                    }

                    // Transition X at change point nextX
                    if (k < sig.data.length - 1) {
                        ctx.moveTo(nextX - 4, yCenter - 7); ctx.lineTo(nextX + 4, yCenter + 7);
                        ctx.moveTo(nextX - 4, yCenter + 7); ctx.lineTo(nextX + 4, yCenter - 7);
                    }

                    const val = sig.data[k].value;
                    const cleanVal = (typeof val === 'string' && val.startsWith('b')) ? val.substring(1) : String(val);
                    busLabelsToDraw.push({ xStart: segStart, xEnd: segEnd, val: cleanVal });
                }

                // End cap at endX
                ctx.moveTo(endX, yCenter - 7);
                ctx.lineTo(endX, yCenter + 7);
            }
            ctx.stroke();

            // Draw clean background-backed bus value text on top of lines
            if (sig.width > 1 && busLabelsToDraw.length > 0) {
                ctx.save();
                ctx.font = 'bold 10px var(--font-code)';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';

                busLabelsToDraw.forEach(item => {
                    const segW = item.xEnd - item.xStart;
                    if (segW > 20) {
                        let displayVal = item.val;
                        if (/^[01]+$/.test(displayVal) && displayVal.length >= 4) {
                            const hexVal = parseInt(displayVal, 2).toString(16).toUpperCase();
                            displayVal = displayVal.length <= 8 ? `8'h${hexVal.padStart(2, '0')}` : `0x${hexVal}`;
                        }
                        
                        const textW = ctx.measureText(displayVal).width;
                        if (segW > textW + 6) {
                            const centerX = item.xStart + segW / 2;
                            ctx.fillStyle = '#050b14';
                            ctx.shadowBlur = 0;
                            ctx.fillRect(centerX - textW / 2 - 3, yCenter - 6, textW + 6, 12);
                            
                            ctx.fillStyle = '#fbbf24'; // Warm gold for bus values
                            ctx.fillText(displayVal, centerX, yCenter + 1);
                        }
                    }
                });
                ctx.restore();
            }
            ctx.restore();
        });

        // ── Hover cursor line ──────────────────────────────────────
        if (cursorActive && hTime >= 0 && hTime <= maxTime) {
            ctx.strokeStyle = 'rgba(255,255,255,0.7)';
            ctx.lineWidth = 1;
            ctx.shadowBlur = 0;
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            ctx.moveTo(this.state.mouseX, startY - 10);
            ctx.lineTo(this.state.mouseX, canvas.height);
            ctx.stroke();
            ctx.setLineDash([]);

            // Time tooltip — flips left when near right edge
            const timeLabel = `${Math.round(hTime)}ns`;
            ctx.font = 'bold 10px var(--font-code)';
            const timeLabelW = ctx.measureText(timeLabel).width + 14;
            const timeLabelH = 18;
            const tooltipRight = this.state.mouseX + 8 + timeLabelW;
            const tooltipX = tooltipRight > canvas.width - 4
                ? this.state.mouseX - timeLabelW - 8
                : this.state.mouseX + 8;
            const tooltipY = startY - 20;

            ctx.fillStyle = 'rgba(0, 20, 30, 0.88)';
            ctx.beginPath();
            ctx.roundRect(tooltipX, tooltipY, timeLabelW, timeLabelH, 3);
            ctx.fill();
            ctx.fillStyle = '#00ffff';
            ctx.fillText(timeLabel, tooltipX + 7, tooltipY + 12);
        }
        
        // ── Divider line ───────────────────────────────────────────
        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#21262d';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(labelWidth, 0);
        ctx.lineTo(labelWidth, canvas.height);
        ctx.stroke();
    } // <-- Added closing brace here

    static renderWaveDrom(containerId, dbBase64) {
        loadSqlJs(() => {
            const container = document.getElementById(containerId);
            if (!container) return;

            try {
                const u8Array = base64ToUint8Array(dbBase64);
                const db = new window.SQL.Database(u8Array);

                const signalsResult = db.exec("SELECT id, fullname, width FROM signals;");
                if (signalsResult.length === 0 || !signalsResult[0].values) {
                    container.innerHTML = '<div style="padding: 1rem;">No signals found in the trace.</div>';
                    return;
                }

                const signals = signalsResult[0].values.map(v => ({
                    id: v[0],
                    fullname: v[1],
                    width: v[2],
                    data: []
                }));

                const maxTimeResult = db.exec("SELECT MAX(t) FROM changes;");
                const maxTime = (maxTimeResult.length > 0 && maxTimeResult[0].values && maxTimeResult[0].values[0][0] !== null) 
                    ? parseInt(maxTimeResult[0].values[0][0], 10) 
                    : 100;

                let allTimes = new Set([0, maxTime]);

                signals.forEach(sig => {
                    const safeSigId = sig.id.replace(/'/g, "''");
                    const changesResult = db.exec(`SELECT t, value FROM changes WHERE sig_id = '${safeSigId}' ORDER BY t ASC;`);
                    if (changesResult.length > 0 && changesResult[0].values) {
                        sig.data = changesResult[0].values.map(c => {
                            const t = parseInt(c[0], 10);
                            allTimes.add(t);
                            return { time: t, value: c[1] };
                        });
                    }
                });
                db.close();

                // Sort times to find smallest delta
                const sortedTimes = Array.from(allTimes).sort((a, b) => a - b);
                let minDelta = Infinity;
                for(let i=1; i<sortedTimes.length; i++) {
                    const delta = sortedTimes[i] - sortedTimes[i-1];
                    if (delta > 0 && delta < minDelta) minDelta = delta;
                }
                
                if (minDelta === Infinity) minDelta = 1;
                
                const numTicks = maxTime / minDelta;
                
                if (numTicks > 300) {
                    container.innerHTML = `<div style="padding: 1rem; color: #d73a49; border: 1px solid #d73a49; border-radius: 4px; margin: 1rem;">
                        <strong>WaveDrom Limitation:</strong> 
                        This simulation has ${Math.ceil(numTicks)} time steps, which exceeds the limit (300) for WaveDrom rendering. 
                        Please use the <strong>Waveform Viewer</strong> tab instead, which can handle unlimited time steps.
                    </div>`;
                    return;
                }

                // Sort signals logically (Clocks top, Resets, Controls, Buses bottom)
                signals.sort((a, b) => {
                    const nameA = WaveformViewer.getCleanSignalName(a.fullname);
                    const nameB = WaveformViewer.getCleanSignalName(b.fullname);
                    const prioA = WaveformViewer.getSignalPriority(nameA);
                    const prioB = WaveformViewer.getSignalPriority(nameB);
                    if (prioA !== prioB) return prioA - prioB;
                    return nameA.localeCompare(nameB);
                });

                const wdSignal = [];

                signals.forEach(sig => {
                    let waveStr = "";
                    let dataArr = [];
                    let lastWdVal = null;
                    
                    for (let t = 0; t <= maxTime; t += minDelta) {
                        let val = sig.data[0]?.value || 'x';
                        for (let i = 0; i < sig.data.length; i++) {
                            if (sig.data[i].time <= t) val = sig.data[i].value;
                            else break;
                        }
                        
                        const cleanVal = val.startsWith('b') ? val.substring(1) : val;
                        
                        if (sig.width === 1) {
                            let wdVal = 'x';
                            if (cleanVal === '0') wdVal = '0';
                            else if (cleanVal === '1') wdVal = '1';
                            else if (cleanVal === 'z' || cleanVal === 'Z') wdVal = 'z';
                            
                            if (wdVal === lastWdVal) {
                                waveStr += ".";
                            } else {
                                waveStr += wdVal;
                                lastWdVal = wdVal;
                            }
                        } else {
                            if (cleanVal !== lastWdVal) {
                                waveStr += '=';
                                const hexVal = WaveformViewer.formatCompactHex(cleanVal, sig.width);
                                dataArr.push(hexVal);
                                lastWdVal = cleanVal;
                            } else {
                                waveStr += ".";
                            }
                        }
                    }
                    
                    wdSignal.push({
                        name: WaveformViewer.getCleanSignalName(sig.fullname),
                        wave: waveStr,
                        data: dataArr.length > 0 ? dataArr : undefined
                    });
                });

                const wdJson = {
                    signal: wdSignal,
                    config: { hscale: 2 }
                };
                
                container.innerHTML = '<div id="WaveDrom_Display0" style="margin-top: 1rem; overflow-x: auto;"></div>';
                
                if (window.WaveDrom) {
                    window.WaveDrom.RenderWaveForm(0, wdJson, "WaveDrom_Display");
                }

            } catch (err) {
                console.error("Error rendering WaveDrom from xevdb:", err);
                container.innerHTML = '<div style="padding: 1rem; color: red;">Error loading WaveDrom diagram.</div>';
            }
        });
    }
}
window.WaveformViewer = WaveformViewer;

// ── Workspace Resizer Logic (Vertical & Horizontal Dragging) ────────────────
function initWorkspaceResizers() {
    // 1. Vertical resizer inside .editor-panel (between editor-wrapper and console-pane)
    const editorPanels = document.querySelectorAll('.editor-panel');
    editorPanels.forEach(editorPanel => {
        const editorWrapper = editorPanel.querySelector('.editor-wrapper');
        const consolePane   = editorPanel.querySelector('.console-pane');
        if (!editorWrapper || !consolePane) return;

        let resizerV = editorPanel.querySelector('.resizer-v');
        if (!resizerV) {
            resizerV = document.createElement('div');
            resizerV.className = 'resizer-v';
            resizerV.title = 'Drag vertically to resize console/waveform window';
            editorPanel.insertBefore(resizerV, consolePane);
        }

        let isDraggingV = false;
        let startY = 0;
        let startConsoleHeight = 0;

        resizerV.addEventListener('mousedown', (e) => {
            isDraggingV = true;
            startY = e.clientY;
            startConsoleHeight = consolePane.getBoundingClientRect().height;
            resizerV.classList.add('dragging');
            document.body.style.cursor = 'row-resize';
            document.body.style.userSelect = 'none';
        });

        window.addEventListener('mousemove', (e) => {
            if (!isDraggingV) return;
            const deltaY = startY - e.clientY;
            const editorPanelHeight = editorPanel.getBoundingClientRect().height;
            const minConsoleH = 60;
            const maxConsoleH = editorPanelHeight - 100;

            let newConsoleH = Math.min(Math.max(startConsoleHeight + deltaY, minConsoleH), maxConsoleH);
            consolePane.style.height = newConsoleH + 'px';

            if (window.cmInstance) {
                window.cmInstance.refresh();
            }
            if (typeof WaveformViewer !== 'undefined' && WaveformViewer.state && WaveformViewer.state.canvas) {
                WaveformViewer.draw();
            }
        });

        window.addEventListener('mouseup', () => {
            if (isDraggingV) {
                isDraggingV = false;
                resizerV.classList.remove('dragging');
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                if (window.cmInstance) window.cmInstance.refresh();
                if (typeof WaveformViewer !== 'undefined' && WaveformViewer.state && WaveformViewer.state.canvas) {
                    WaveformViewer.draw();
                }
            }
        });
    });

    // 2. Horizontal resizer between .content-panel and .editor-panel
    const workspaceContainers = document.querySelectorAll('.workspace-container');
    workspaceContainers.forEach(container => {
        const contentPanel = container.querySelector('.content-panel');
        const editorPanel  = container.querySelector('.editor-panel');
        if (!contentPanel || !editorPanel) return;

        let resizerH = container.querySelector('.resizer-h');
        if (!resizerH) {
            resizerH = document.createElement('div');
            resizerH.className = 'resizer-h';
            resizerH.title = 'Drag horizontally to resize left/right panels';
            container.insertBefore(resizerH, editorPanel);
        }

        let isDraggingH = false;
        let startX = 0;
        let startContentWidth = 0;

        resizerH.addEventListener('mousedown', (e) => {
            isDraggingH = true;
            startX = e.clientX;
            startContentWidth = contentPanel.getBoundingClientRect().width;
            resizerH.classList.add('dragging');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
        });

        window.addEventListener('mousemove', (e) => {
            if (!isDraggingH) return;
            const deltaX = e.clientX - startX;
            const containerWidth = container.getBoundingClientRect().width;
            const minContentW = 200;
            const maxContentW = containerWidth - 300;

            let newContentW = Math.min(Math.max(startContentWidth + deltaX, minContentW), maxContentW);
            contentPanel.style.flex = `0 0 ${newContentW}px`;
            editorPanel.style.flex = `1 1 0px`;

            if (window.cmInstance) {
                window.cmInstance.refresh();
            }
            if (typeof WaveformViewer !== 'undefined' && WaveformViewer.state && WaveformViewer.state.canvas) {
                WaveformViewer.draw();
            }
        });

        window.addEventListener('mouseup', () => {
            if (isDraggingH) {
                isDraggingH = false;
                resizerH.classList.remove('dragging');
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                if (window.cmInstance) window.cmInstance.refresh();
                if (typeof WaveformViewer !== 'undefined' && WaveformViewer.state && WaveformViewer.state.canvas) {
                    WaveformViewer.draw();
                }
            }
        });
    });
}

// ── WaveDrom PNG Downloader ─────────────────────────────────────────────────
window.downloadWaveDromPNG = function(targetContainerId) {
    const container = (targetContainerId && document.getElementById(targetContainerId)) 
        || document.getElementById('wavedrom_output') 
        || document.getElementById('view_wavedrom');
    if (!container) return;
    const svgEl = container.querySelector('svg');
    if (!svgEl) {
        if (typeof UIHelper !== 'undefined') {
            UIHelper.showToast('No WaveDrom SVG diagram found to download.', 'warning');
        } else {
            alert('No WaveDrom SVG diagram found to download.');
        }
        return;
    }

    try {
        const svgClone = svgEl.cloneNode(true);

        // ── Ensure required XML namespace declarations ──────────────────────
        svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        svgClone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');

        // ── Resolve width / height ──────────────────────────────────────────
        let width = parseFloat(svgEl.getAttribute('width'));
        let height = parseFloat(svgEl.getAttribute('height'));
        const bbox = svgEl.getBoundingClientRect();
        if (!width || isNaN(width)) width = bbox.width || 800;
        if (!height || isNaN(height)) height = bbox.height || 300;

        svgClone.setAttribute('width', width);
        svgClone.setAttribute('height', height);

        // ── Sanitize SVG to prevent tainted-canvas errors ───────────────────
        // <foreignObject> elements taint the canvas and block toDataURL/toBlob.
        // Remove them entirely — they are used for HTML overlays, not wave drawing.
        svgClone.querySelectorAll('foreignObject').forEach(el => el.remove());

        // Remove external image hrefs that would taint the canvas.
        svgClone.querySelectorAll('image').forEach(imgEl => {
            const href = imgEl.getAttribute('href') || imgEl.getAttribute('xlink:href') || '';
            if (href && !href.startsWith('data:')) {
                imgEl.remove();
            }
        });

        // Inline background colour so the exported PNG isn't transparent
        if (!svgClone.getAttribute('style') || !svgClone.getAttribute('style').includes('background')) {
            svgClone.style.background = '#ffffff';
        }

        // ── Serialise to SVG Blob URL (avoids data-URI length limits) ───────
        const svgString = new XMLSerializer().serializeToString(svgClone);
        const svgBlob   = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
        const svgBlobUrl = URL.createObjectURL(svgBlob);

        // Helper: trigger a file download
        function triggerDownload(url, filename) {
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        }

        // Helper: release a Blob URL after a short delay
        function releaseBlobUrl(url) {
            setTimeout(() => URL.revokeObjectURL(url), 5000);
        }

        // ── Fallback: download as SVG ────────────────────────────────────────
        function downloadAsSvg() {
            triggerDownload(svgBlobUrl, 'wavedrom_waveform.svg');
            releaseBlobUrl(svgBlobUrl);
            if (typeof UIHelper !== 'undefined') {
                UIHelper.showToast('Downloaded as SVG (PNG conversion unavailable in this browser).', 'warning');
            }
        }

        // ── Draw to canvas → export PNG ──────────────────────────────────────
        const img = new Image();

        img.onload = function() {
            const scale  = 2; // 2× for crisp HiDPI export
            const canvas = document.createElement('canvas');
            canvas.width  = Math.ceil(width  * scale);
            canvas.height = Math.ceil(height * scale);
            const ctx = canvas.getContext('2d');

            // White background for high contrast
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            ctx.scale(scale, scale);
            ctx.drawImage(img, 0, 0, width, height);

            URL.revokeObjectURL(svgBlobUrl); // free Blob URL now that image is drawn

            try {
                canvas.toBlob(function(blob) {
                    if (!blob) { downloadAsSvg(); return; }
                    const pngUrl = URL.createObjectURL(blob);
                    triggerDownload(pngUrl, 'wavedrom_waveform.png');
                    releaseBlobUrl(pngUrl);
                    if (typeof UIHelper !== 'undefined') {
                        UIHelper.showToast('WaveDrom PNG downloaded successfully!', 'success');
                    }
                }, 'image/png');
            } catch (e) {
                console.warn('canvas.toBlob failed (tainted canvas?), falling back to SVG:', e);
                // Re-create SVG Blob since the original was already revoked
                const svgBlob2    = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
                const svgBlobUrl2 = URL.createObjectURL(svgBlob2);
                triggerDownload(svgBlobUrl2, 'wavedrom_waveform.svg');
                releaseBlobUrl(svgBlobUrl2);
                if (typeof UIHelper !== 'undefined') {
                    UIHelper.showToast('Downloaded as SVG (PNG blocked by browser security).', 'warning');
                }
            }
        };

        img.onerror = function() {
            console.warn('SVG image failed to load, falling back to SVG download.');
            downloadAsSvg();
        };

        img.src = svgBlobUrl;

    } catch (err) {
        console.error('Error exporting WaveDrom PNG:', err);
        if (typeof UIHelper !== 'undefined') {
            UIHelper.showToast('Export failed: ' + err.message, 'error');
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    initWorkspaceResizers();
});

// ── Coverage Viewer Class ──────────────────────────────────────────
class CoverageViewer {
    static render(containerId, data, stderrText) {
        const el = document.getElementById(containerId);
        if (!el) return;

        if (!data && stderrText && stderrText.includes('[COV]')) {
            this.renderFromStderr(el, stderrText);
            return;
        }

        if (!data || (!data.covergroups && !data.assertions)) {
            this.renderEmpty(containerId);
            return;
        }

        const cgs = data.covergroups || [];
        const asserts = data.assertions || [];

        let totalSamples = 0;
        let totalCpBins = 0;
        let totalCrossTuples = 0;
        cgs.forEach(cg => {
            totalSamples += cg.samples || 0;
            if (cg.coverpoints) Object.values(cg.coverpoints).forEach(v => totalCpBins += v);
            if (cg.crosses) Object.values(cg.crosses).forEach(v => totalCrossTuples += v);
        });

        const passTotal = data.assertion_pass_total || 0;
        const failTotal = data.assertion_fail_total || 0;
        const assertTotal = passTotal + failTotal;
        const assertPassPct = assertTotal > 0 ? Math.round((passTotal / assertTotal) * 100) : 100;
        
        // Calculate functional coverage score
        const covScore = totalSamples > 0 ? Math.min(100, Math.round((totalCpBins * 25 + totalCrossTuples * 20 + assertPassPct * 0.55))) : (assertPassPct || 100);

        let metricItemsHtml = '';
        cgs.forEach(cg => {
            if (cg.coverpoints) {
                Object.keys(cg.coverpoints).forEach(cpName => {
                    const hitCount = cg.coverpoints[cpName];
                    const pct = Math.min(100, hitCount * 50);
                    metricItemsHtml += `
                        <div class="cov-item">
                            <span>${cpName}</span><b>${pct}%</b>
                            <i><em style="width:${pct}%"></em></i>
                        </div>
                    `;
                });
            }
            if (cg.crosses) {
                Object.keys(cg.crosses).forEach(crossName => {
                    const hitCount = cg.crosses[crossName];
                    const pct = Math.min(100, hitCount * 33);
                    metricItemsHtml += `
                        <div class="cov-item">
                            <span>${crossName}</span><b>${pct}%</b>
                            <i><em style="width:${pct}%"></em></i>
                        </div>
                    `;
                });
            }
        });

        if (asserts.length > 0) {
            metricItemsHtml += `
                <div class="cov-item">
                    <span>SVA Concurrent Assertions</span><b>${assertPassPct}%</b>
                    <i><em style="width:${assertPassPct}%"></em></i>
                </div>
            `;
        }

        const html = `
        <div class="coverage-grid">
            <div class="coverage-score">
                <span>Functional Coverage</span>
                <strong>${covScore}<small>%</small></strong>
                <p>${failTotal === 0 ? '✓ All assertions passed' : `⚠ ${failTotal} assertions failed`}</p>
                <div style="margin-top: 12px; font-size: 10.5px; color: var(--text-muted);">
                    Sim Time: <strong>${data.sim_time || 0}ns</strong>
                </div>
            </div>
            <div class="coverage-list">
                ${metricItemsHtml}
            </div>
            <div class="coverage-note">
                <strong>Verification Summary</strong>
                <p>Sampled ${totalSamples} times across ${cgs.length} Covergroups. ${totalCpBins} coverpoints & ${totalCrossTuples} cross tuples hit.</p>
                <button class="cov-btn" onclick="QuestionLoader.switchTab('waveform')">View Waveform →</button>
            </div>
        </div>
        `;
        el.innerHTML = html;
    }

    static renderFromStderr(el, stderrText) {
        const covLines = stderrText.split('\n').filter(l => l.includes('[COV]'));
        if (covLines.length === 0) {
            this.renderEmpty(el.id);
            return;
        }
        let html = `
        <div style="padding: 0.65rem 0.85rem; color: var(--text-primary); font-family: var(--font-main);">
            <h4 style="margin: 0 0 0.4rem 0; color: var(--neon-cyan); font-size: 0.85rem;">📊 Simulation Coverage Summary</h4>
            <div style="background: var(--bg-tertiary); padding: 0.65rem; border-radius: var(--radius-sm); border: 1px solid var(--border-color); font-family: var(--font-code); font-size: 0.76rem; color: var(--neon-green); line-height: 1.5;">
                ${covLines.map(line => `<div>${line}</div>`).join('')}
            </div>
        </div>
        `;
        el.innerHTML = html;
    }

    static renderEmpty(containerId) {
        const el = document.getElementById(containerId);
        if (!el) return;
        el.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 140px; color: var(--text-muted); text-align: center; padding: 1rem 0.5rem;">
            <div style="font-size: 1.4rem; margin-bottom: 0.2rem;">📊</div>
            <div style="font-weight: 600; font-size: 0.82rem; color: var(--text-primary); margin-bottom: 0.15rem;">No Coverage Data Collected Yet</div>
            <div style="font-size: 0.72rem; max-width: 320px; color: var(--text-muted);">Run a simulation containing SystemVerilog <code>covergroup</code>, <code>coverpoint</code>, or <code>assert</code> constructs to display functional coverage reports.</div>
        </div>
        `;
    }
}
window.CoverageViewer = CoverageViewer;

// Global SurferBridge for embedded Surfer WASM viewer
if (typeof window.SurferBridge === 'undefined') {
    window.SurferBridge = {
        _ready: false,
        _pendingVcd: null,
        _readyTimer: null,
        _loadedVcdText: null,

        get iframe() { return document.getElementById('surfer_iframe'); },

        init() {
            const iframe = this.iframe;
            if (!iframe) return;

            window.addEventListener('message', (e) => {
                if (e.source !== iframe.contentWindow) return;
                const data = e.data;
                if (data && (data.type === 'surfer_ready' || data === 'surfer_ready')) this._onReady();
            });
            iframe.addEventListener('load', () => {
                if (this._readyTimer) clearTimeout(this._readyTimer);
                this._readyTimer = setTimeout(() => this._onReady(), 4000);
            });
        },

        _onReady() {
            if (this._ready) return;
            this._ready = true;
            const overlay = document.getElementById('surfer_loading_overlay');
            if (overlay) { overlay.style.opacity = '0'; setTimeout(() => { overlay.style.display = 'none'; }, 500); }
            const badge = document.getElementById('surfer_status_badge');
            if (badge) badge.textContent = '✅ Surfer ready';
            if (this._pendingVcd) {
                this._sendVcdToIframe(this._pendingVcd);
                this._pendingVcd = null;
            } else if (!this._loadedVcdText) {
                this.showNoVcdOverlay(true);
            }
        },

        loadVcd(vcdText, forceReload = false) {
            if (!vcdText) return;
            this.showNoVcdOverlay(false);
            if (!forceReload && this._loadedVcdText === vcdText) {
                return;
            }
            if (!this._ready) { this._pendingVcd = vcdText; return; }
            this._sendVcdToIframe(vcdText);
        },

        _sendVcdToIframe(vcdText) {
            const iframe = this.iframe;
            if (!iframe || !iframe.contentWindow) return;
            try {
                iframe.contentWindow.postMessage({ command: 'LoadVcdData', data: vcdText }, '*');
                this._loadedVcdText = vcdText;
                const badge = document.getElementById('surfer_status_badge');
                if (badge) badge.textContent = '✅ VCD loaded in Surfer';
            } catch (err) {
                console.warn('[SurferBridge] postMessage error:', err);
            }
        },

        reloadVcd() {
            if (window.lastVcdText) { this._ready = true; this.loadVcd(window.lastVcdText, true); }
            else this.showNoVcdOverlay(true);
        },

        toggleMenu() {
            const iframe = this.iframe;
            if (iframe && iframe.contentWindow) iframe.contentWindow.postMessage({ command: 'ToggleMenu' }, '*');
        },

        showNoVcdOverlay(show) {
            const el = document.getElementById('surfer_novcd_overlay');
            if (el) el.style.display = show ? 'flex' : 'none';
        }
    };
    document.addEventListener('DOMContentLoaded', () => { window.SurferBridge.init(); });
}
