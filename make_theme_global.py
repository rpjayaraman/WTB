import os
import re

css_file = 'common.css'
with open(css_file, 'a') as f:
    f.write('''
/* --- Global Theme Dropdown --- */
.theme-dropdown-container { position: relative; margin-left: auto; }
.theme-dropdown-trigger { display: flex; align-items: center; gap: 8px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); padding: 6px 12px; border-radius: 6px; color: var(--text-primary); cursor: pointer; font-size: 0.85rem; }
.theme-dropdown-menu { position: absolute; top: 110%; right: 0; background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 8px; width: 220px; z-index: 1000; display: none; box-shadow: 0 10px 30px rgba(0,0,0,0.5); padding: 6px; }
.theme-dropdown-container.open .theme-dropdown-menu { display: block; }
.theme-option { width: 100%; display: flex; flex-direction: column; padding: 10px; border: 1px solid transparent; border-radius: 6px; background: transparent; cursor: pointer; text-align: left; }
.theme-option:hover { background: rgba(255,255,255,0.05); }
.theme-option-left { display: flex; align-items: center; gap: 10px; }
.theme-icon { width: 24px; height: 24px; fill: none; stroke: currentColor; }
.theme-info { display: flex; flex-direction: column; }
.theme-name { color: var(--text-primary); font-weight: 600; font-size: 0.9rem; }
''')

THEME_DROPDOWN = '''
                <div class="theme-dropdown-container" id="theme_dropdown_container">
                    <button class="theme-dropdown-trigger" id="theme_dropdown_btn" onclick="document.getElementById('theme_dropdown_container').classList.toggle('open')" aria-haspopup="true" aria-expanded="false" title="Switch UI Theme">
                        <svg class="theme-icon" id="theme_active_icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
                        <span id="theme_active_label">Dark Mode</span>
                        <span class="dropdown-caret">▾</span>
                    </button>
                    <div class="theme-dropdown-menu" id="theme_dropdown_menu" role="menu">
                        <button class="theme-option" onclick="ThemeManager.toggle(); document.getElementById('theme_dropdown_container').classList.remove('open')">
                            <div class="theme-option-left">
                                <svg class="theme-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>
                                <div class="theme-info"><span class="theme-name">Toggle Light / Dark Theme</span></div>
                            </div>
                        </button>
                    </div>
                </div>
'''

for file in os.listdir('.'):
    if file.endswith('.html'):
        with open(file, 'r') as f:
            content = f.read()
            
        # Replace the themeToggler button with our new dropdown
        content = re.sub(r'<button[^>]*id="themeToggler"[^>]*>.*?</button>', THEME_DROPDOWN.strip(), content, flags=re.DOTALL)
            
        with open(file, 'w') as f:
            f.write(content)
