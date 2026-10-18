#!/usr/bin/env bash
set -euo pipefail
npm run check
mkdir -p artifacts
tar --exclude=node_modules --exclude=.git --exclude=.data --exclude=artifacts --exclude=test-results --exclude=playwright-report --exclude='*.pyc' --exclude=__pycache__ -czf artifacts/relay-0.1.0.tar.gz .
printf 'Installation package: artifacts/relay-0.1.0.tar.gz\n'
