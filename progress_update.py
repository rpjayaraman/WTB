import os
import re

CIRCLE_HTML = '''<div class="nav-progress-ring" title="Overall Progress" style="display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; position: relative; margin-right: 12px;">
                    <svg width="36" height="36" viewBox="0 0 36 36" style="transform: rotate(-90deg);">
                        <circle cx="18" cy="18" r="14" fill="none" stroke="var(--border-color)" stroke-width="4"></circle>
                        <circle id="navProgressCircle" cx="18" cy="18" r="14" fill="none" stroke="#10b981" stroke-width="4" stroke-dasharray="88" stroke-dashoffset="88" stroke-linecap="round" style="transition: stroke-dashoffset 0.5s ease;"></circle>
                    </svg>
                    <div id="navProgressText" style="position: absolute; font-size: 0.65rem; font-weight: 700; color: var(--text-primary);">0%</div>
                </div>'''

INDEX_JS_REPLACE = '''                // Update navbar progress ring
                const overallPercent = grandTotal > 0 ? Math.round((totalCompleted / grandTotal) * 100) : 0;
                const progressCircle = document.getElementById('navProgressCircle');
                const progressText = document.getElementById('navProgressText');
                if (progressCircle && progressText) {
                    const circumference = 88; // 2 * Math.PI * 14
                    const offset = circumference - (overallPercent / 100) * circumference;
                    progressCircle.style.strokeDashoffset = offset;
                    progressText.textContent = `${overallPercent}%`;
                }'''

DATASET_JS_REPLACE = '''            const progressCircle = document.getElementById('navProgressCircle');
            const progressText = document.getElementById('navProgressText');
            if (progressCircle && progressText) {
                const circumference = 88;
                const offset = circumference - (completionPercent / 100) * circumference;
                progressCircle.style.strokeDashoffset = offset;
                progressText.textContent = `${completionPercent}%`;
            }'''

for file in os.listdir('.'):
    if file.endswith('.html'):
        with open(file, 'r') as f:
            content = f.read()
            
        # Replace HTML element
        content = re.sub(r'<div class="nav-progress" id="navProgress">Completed: 0%</div>', CIRCLE_HTML, content)
        
        # Replace JS logic in index.html
        if file == 'index.html':
            pattern = r'const navProgress = document\.getElementById\(\'navProgress\'\);\s+if \(navProgress\) \{\s+navProgress\.textContent = [^;]+;\s+\}'
            content = re.sub(pattern, INDEX_JS_REPLACE, content)
            
        # Replace JS logic in dataset_manager.html
        if file == 'dataset_manager.html':
            pattern = r'const navProgress = document\.getElementById\(\'navProgress\'\);\s+if \(navProgress\) \{\s+navProgress\.textContent = [^;]+;\s+\}'
            content = re.sub(pattern, DATASET_JS_REPLACE, content)
            
        with open(file, 'w') as f:
            f.write(content)
