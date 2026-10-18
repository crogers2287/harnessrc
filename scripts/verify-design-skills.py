#!/usr/bin/env python3
"""Check reviewed UI skill copies against the pinned file manifest."""
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / 'docs/design-skills.lock.json').read_text())
failures = []
for skill in manifest['skills']:
    base = root / skill['localPath']
    for relative, expected in skill['sha256'].items():
        file = base / relative
        if not file.is_file() or hashlib.sha256(file.read_bytes()).hexdigest() != expected:
            failures.append(f"{skill['name']}/{relative}")
    print(f"{skill['name']}: {len(skill['sha256'])} pinned files, {skill['license']}")
if failures:
    raise SystemExit('Changed or missing skill files: ' + ', '.join(failures))
print('All reviewed skill files match the pinned manifest.')
