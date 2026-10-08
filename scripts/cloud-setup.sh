#!/usr/bin/env bash
set -euo pipefail
cd /workspace/harnessrc
node -e 'if (Number(process.versions.node.split(".")[0]) < 22) throw new Error("Node.js 22 or newer is required")'
mkdir -p /workspace/.cache/npm /workspace/.tools/harnessrc
npm --cache /workspace/.cache/npm install --prefix /workspace/.tools/harnessrc --no-save --package-lock=false pnpm@10.34.6 typescript@5.9.3 playwright@1.58.2
/workspace/.tools/harnessrc/node_modules/.bin/pnpm --version
/workspace/.tools/harnessrc/node_modules/.bin/tsc --version
node -e 'const { DatabaseSync } = require("node:sqlite"); const db = new DatabaseSync(":memory:"); db.exec("CREATE TABLE readiness (id INTEGER PRIMARY KEY)"); db.close(); console.log("SQLite available")'
chromium --version
