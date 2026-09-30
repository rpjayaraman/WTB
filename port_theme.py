import os
import re

# 1. Update common.css
with open("training/css/digital_book.css", "r") as f:
    digital_css = f.read()

# Extract themes 
themes_match = re.search(r'(\[data-theme="github"\].*?\[data-theme="batman"\] \{.*?})', digital_css, re.DOTALL)
if themes_match:
    themes_css = themes_match.group(1)
else:
    print("Could not find themes in digital_book.css")
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

# 2. Extract HTML from uvm_course.html
with open("training/uvm_course.html", "r") as f:
    uvm_html = f.read()

dropdown_match = re.search(r'(<div class="theme-dropdown-container" id="theme_dropdown_container">.*?</div>\s*</div>\s*</div>)', uvm_html, re.DOTALL)
if dropdown_match:
    dropdown_html = dropdown_match.group(1)
    # Fix the toggle call to ThemeManager
    dropdown_html = dropdown_html.replace('App.toggleThemeMenu(event)', 'ThemeManager.toggleThemeMenu(event)')
    dropdown_html = dropdown_html.replace('App.setTheme(', 'ThemeManager.setTheme(')
else:
    print("Could not find dropdown in uvm_course.html")
    dropdown_html = ""

# 3. Apply to all HTML files
for file in os.listdir('.'):
    if file.endswith('.html'):
        with open(file, 'r') as f:
            content = f.read()
        
        # We need to replace the current theme-dropdown-container block.
        # It looks like: <div class="theme-dropdown-container" id="theme_dropdown_container"> ... </div>\s*</div>\s*</div> (wait, index.html might have different closing tags)
        
        # It's safer to use regex that stops at the closing of header-actions.
        # Actually, let's just find the theme-dropdown-container and replace until its closing div.
        content = re.sub(r'<div class="theme-dropdown-container" id="theme_dropdown_container">.*?</button>\s*</div>\s*</div>', dropdown_html.replace('</div>\s*</div>\s*</div>', '</div>'), content, flags=re.DOTALL)
        
        # Change the css link for cache busting
        content = content.replace('href="common.css?v=2"', 'href="common.css?v=3"')
        content = content.replace('href="common.css"', 'href="common.css?v=3"')
        
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

