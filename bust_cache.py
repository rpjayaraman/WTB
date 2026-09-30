import os

for file in os.listdir('.'):
    if file.endswith('.html'):
        with open(file, 'r') as f:
            content = f.read()
        
        content = content.replace('href="common.css"', 'href="common.css?v=2"')
        
        with open(file, 'w') as f:
            f.write(content)
