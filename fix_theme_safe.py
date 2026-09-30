import os
for file in os.listdir('.'):
    if file.endswith('.html'):
        with open(file, 'r') as f:
            content = f.read()
        content = content.replace('<svg class="theme-icon" id="theme_active_icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>', '<span id="theme_active_icon" style="font-size: 1.2rem;">🌓</span>')
        content = content.replace('<svg class="theme-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>', '<span style="font-size: 1.2rem;">🌓</span>')
        with open(file, 'w') as f:
            f.write(content)
