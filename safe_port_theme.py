import os
import glob
import re

# 1. Update common.css
with open("training/css/digital_book.css", "r") as f:
    digital_css = f.read()

themes_match = re.search(r'(\[data-theme="github"\].*?\[data-theme="batman"\] \{.*?})', digital_css, re.DOTALL)
if themes_match:
    themes_css = themes_match.group(1)
else:
    themes_css = ""

extra_css = """
/* Extracted from digital_book.css */
.theme-desc { font-size: 0.68rem; color: var(--text-muted); }
.theme-swatches { display: flex; align-items: center; gap: 3px; }
.swatch { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
.theme-option.active { background: rgba(56, 189, 248, 0.1); border-color: rgba(56, 189, 248, 0.3); }
.theme-option { justify-content: space-between; flex-direction: row; align-items: center; }
"""
with open("common.css", "a") as f:
    f.write("\n\n" + themes_css + "\n\n" + extra_css)

# 2. Extract HTML from uvm_course.html safely
with open("training/uvm_course.html", "r") as f:
    uvm_html = f.read()

start_idx = uvm_html.find('<div class="theme-dropdown-container" id="theme_dropdown_container">')
if start_idx != -1:
    div_count = 0
    end_idx = -1
    for i in range(start_idx, len(uvm_html)):
        if uvm_html[i:i+4] == '<div':
            div_count += 1
        elif uvm_html[i:i+6] == '</div>':
            div_count -= 1
            if div_count == 0:
                end_idx = i + 6
                break
    dropdown_html = uvm_html[start_idx:end_idx]
    dropdown_html = dropdown_html.replace('App.toggleThemeMenu(event)', 'ThemeManager.toggleThemeMenu(event)')
    dropdown_html = dropdown_html.replace('App.setTheme(', 'ThemeManager.setTheme(')
else:
    dropdown_html = ""

# 3. Apply to all HTML files safely
for file in glob.glob('*.html'):
    with open(file, 'r') as f:
        content = f.read()
    
    start_idx = content.find('<div class="theme-dropdown-container" id="theme_dropdown_container">')
    if start_idx != -1:
        div_count = 0
        end_idx = -1
        for i in range(start_idx, len(content)):
            if content[i:i+4] == '<div':
                div_count += 1
            elif content[i:i+6] == '</div>':
                div_count -= 1
                if div_count == 0:
                    end_idx = i + 6
                    break
        if end_idx != -1:
            content = content[:start_idx] + dropdown_html + content[end_idx:]
            content = content.replace('href="common.css?v=2"', 'href="common.css?v=4"')
            content = content.replace('href="common.css?v=3"', 'href="common.css?v=4"')
            with open(file, 'w') as f:
                f.write(content)

# 4. Update common.js ThemeManager
with open("common.js", "r") as f:
    js_content = f.read()

new_theme_manager = """class ThemeManager {
    static THEME_META = {
        github: { icon: "🌌", name: "GitHub Dark" },
        nord: { icon: "❄️", name: "Nord Frost" },
        onedark: { icon: "🪐", name: "One Dark Pro" },
        dracula: { icon: "🧛", name: "Dracula Pro" },
        light: { icon: "☀️", name: "Paper Light" },
        batman: { icon: "🦇", name: "Batman Dark Knight" }
    };

    static init() {
        const theme = localStorage.getItem('dv_prep_theme') || 'github';
        this.setTheme(theme, true);
        
        document.addEventListener('click', (e) => {
            const container = document.getElementById("theme_dropdown_container");
            if (container && !container.contains(e.target)) {
                container.classList.remove("open");
            }
        });
    }

    static toggleThemeMenu(event) {
        event.stopPropagation();
        document.getElementById('theme_dropdown_container').classList.toggle('open');
    }

    static setTheme(themeName, isInit=false) {
        if (!this.THEME_META[themeName]) themeName = "github";
        document.documentElement.setAttribute("data-theme", themeName);
        localStorage.setItem('dv_prep_theme', themeName);

        const meta = this.THEME_META[themeName];
        const iconEl = document.getElementById("theme_active_icon");
        const labelEl = document.getElementById("theme_active_label");
        if (iconEl) iconEl.textContent = meta.icon;
        if (labelEl) labelEl.textContent = meta.name;

        document.querySelectorAll(".theme-option").forEach(opt => {
            opt.classList.remove("active");
        });
        const activeOpt = document.getElementById(`theme_opt_${themeName}`);
        if (activeOpt) activeOpt.classList.add("active");

        const container = document.getElementById("theme_dropdown_container");
        if (container && !isInit) container.classList.remove("open");
    }
}"""
js_content = re.sub(r'class ThemeManager \{.*?updateThemeTogglerIcon\(\) \{.*?\}\s*\}', new_theme_manager, js_content, flags=re.DOTALL)
with open("common.js", "w") as f:
    f.write(js_content)


# 5. Restore WASM Interceptor logic
intercept_js = """
(function() {
    const originalFetch = window.fetch;
    window.fetch = async function(resource, init) {
        if (typeof resource === 'string' && resource.includes("/api/simulate")) {
            if (typeof Worker !== 'undefined') {
                if (!window.wasmWorker) {
                    window.wasmWorker = new Worker('../wasm_worker.js?v=' + Date.now());
                    window.wasmReqs = new Map();
                    window.wasmReqId = 0;
                    window.wasmWorker.onmessage = (e) => {
                        const { id, success, result, error } = e.data;
                        if (window.wasmReqs.has(id)) {
                            const { resolve, reject } = window.wasmReqs.get(id);
                            window.wasmReqs.delete(id);
                            if (success) resolve(result);
                            else reject(new Error(error));
                        }
                    };
                }
                
                try {
                    const payload = JSON.parse(init.body);
                    let engine = payload.engine || 'verilator';
                    let plusargsStr = (payload.plusargs || []).join(' ');
                    
                    let simCmd = engine === 'verilator' 
                       ? `verilator --binary -j 0 --timescale 1ns/1ns -Wall -Wno-fatal --timing -sv $FILE ${plusargsStr}` 
                       : `xezim --simulate --xtrace wave.vcd -DUVM_NO_DPI -I/Users/mac/xezim-workspace/uvm-1.2/src /Users/mac/xezim-workspace/uvm-1.2/src/uvm_pkg.sv $FILE ${plusargsStr}`;
                       
                    const id = ++window.wasmReqId;
                    const wasmPromise = new Promise((resolve, reject) => {
                        window.wasmReqs.set(id, { resolve, reject });
                    });
                    
                    window.wasmWorker.postMessage({
                        id,
                        type: 'SIMULATE',
                        files: payload.files,
                        command: simCmd,
                        simulator: engine === 'verilator' ? 'verilator' : 'xezim_wasm'
                    });
                    
                    const res = await wasmPromise;
                    return new Response(JSON.stringify(res), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' }
                    });
                } catch (err) {}
            }
        }
        return originalFetch.apply(this, arguments);
    };
})();
"""
os.makedirs("training/js", exist_ok=True)
with open("training/js/wasm_intercept.js", "w") as f:
    f.write(intercept_js.strip())

for html_file in glob.glob("training/*.html"):
    with open(html_file, "r") as f:
        content = f.read()
    if "wasm_intercept.js" not in content:
        content = content.replace("</head>", '    <script src="js/wasm_intercept.js"></script>\n</head>')
        with open(html_file, "w") as f:
            f.write(content)

