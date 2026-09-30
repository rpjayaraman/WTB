import os
import re

for file in os.listdir('.'):
    if file.endswith('.html'):
        with open(file, 'r') as f:
            content = f.read()
            
        # Remove header links
        content = re.sub(r'<nav class="header-links">.*?</nav>', '', content, flags=re.DOTALL)
        
        # In index.html, we already removed sub-header. But just to be sure we don't break SV coding modules,
        # we will ONLY remove the sub-header in index.html, custom_playground.html, dataset_manager.html, training.html.
        if file in ['index.html', 'training.html', 'dataset_manager.html', 'custom_playground.html']:
            # For index.html we already manually removed it
            content = re.sub(r'<div class="sub-header".*?>\s*(?:<button.*?>.*?</button>\s*)?(?:<div class="breadcrumbs">.*?</div>\s*)?</div>', '', content, flags=re.DOTALL)
            
        with open(file, 'w') as f:
            f.write(content)
