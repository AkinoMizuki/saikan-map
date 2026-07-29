from pathlib import Path

path = Path('index.html')
source = path.read_text(encoding='utf-8')

replacements = [
    ('ver 0.3.1', 'ver 0.3.2'),
    ('app-v3.js?v=0.3.1', 'app-v3.js?v=0.3.2'),
    ('share-v31.js?v=0.3.1', 'share-v31.js?v=0.3.2'),
]

for needle, replacement in replacements:
    if needle not in source:
        raise SystemExit(f'index patch target not found: {needle}')
    source = source.replace(needle, replacement, 1)

path.write_text(source, encoding='utf-8')
