# BUG-042: what `vercel deploy` uploads (tools/deploy.sh). The CLI never reads .gitignore, and its own skip list holds only
# .env.local and .env.*.local, so any other .env file goes up with the code unless .vercelignore says no. It sits here
# because agent/.env (the agent's secrets) is one of them, and this folder is the one CI runs for a card that adds secrets.
# The rules are applied with the `ignore` package the repo already has (the CLI's ignore library; same gitignore rules).
import json
import os
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# What the CLI skips before it reads .vercelignore: `ignores` in @vercel/cli-support of vercel@66.6.0, read from its source.
# A new CLI version may change the list, so the test below fails when tools/deploy.sh pins another version: read the
# new source, update this list and this number together.
CLI_VERSION = '66.6.0'
CLI_DEFAULTS = [
    '.hg', '.git', '.gitmodules', '.svn', 'CVS', '.cache', '.next', '.now', '.vercel', '.npmignore', '.dockerignore',
    '.gitignore', '.*.swp', '.DS_Store', '.wafpicke-*', '.lock-wscript', '.env.local', '.env.*.local', '.venv',
    '.yarn/cache', '.pnp*', 'npm-debug.log', 'config.gypi', 'node_modules', '__pycache__', 'venv',
]

# Always checked, so the guard holds in CI where no server/.env exists: every kind of .env file, and a few that must go up.
FIXTURE = [
    '.env', 'server/.env', 'client/.env', 'agent/.env', 'tools/test-report/.env',
    '.env.production', 'server/.env.staging', 'client/.env.development', '.env.test',
    '.env.local', 'server/.env.production.local', 'node_modules/pkg/.env', 'node_modules/pkg/.env.example',
    '.venv/lib/.env.example', '.env.example', 'server/.env.example', 'client/.env.example', 'agent/.env.example',
    'package.json', 'server/src/app.js', 'client/src/main.tsx', 'agent/app.py', 'agent/.venv/lib/site.py',
]


def is_env_file(path):
    """.env, server/.env, .env.production… but not .env.example (the same rule as TC-NF-05)"""
    name = path.rsplit('/', 1)[-1]
    return re.fullmatch(r'\.env(\..+)?', name) is not None and name != '.env.example'


def checkout_files():
    """Every file on disk in this checkout, as a deploy from here would see it (a dev machine has the real server/.env)."""
    found = []
    for folder, dirs, files in os.walk(ROOT):
        dirs[:] = [d for d in dirs if d not in ('.git', 'node_modules', '.venv', 'venv', '__pycache__')]
        found += [Path(folder, name).relative_to(ROOT).as_posix() for name in files]
    return found


def uploaded(paths):
    """The paths that go up with the CLI's defaults alone, and with .vercelignore added (the CLI appends it)."""
    ignore_file = re.sub(r'(\n|^)\./', r'\1', (ROOT / '.vercelignore').read_text())  # the CLI's clearRelative()
    rules = {'defaults': '\n'.join(CLI_DEFAULTS), 'deploy': '\n'.join(CLI_DEFAULTS) + '\n' + ignore_file}
    script = ("import ignore from 'ignore'; import { readFileSync } from 'node:fs';"
              "const { rules, paths } = JSON.parse(readFileSync(0, 'utf8'));"
              "console.log(JSON.stringify(Object.fromEntries(Object.entries(rules)"
              ".map(([name, text]) => [name, ignore().add(text).filter(paths)]))));")
    done = subprocess.run(['node', '--input-type=module', '-e', script], cwd=ROOT, text=True, capture_output=True,
                          input=json.dumps({'rules': rules, 'paths': paths}), timeout=60)
    assert done.returncode == 0, done.stderr
    return {name: set(found) for name, found in json.loads(done.stdout).items()}


def test_no_env_file_goes_to_vercel_and_nothing_skipped_before_does():
    """TC-NF-19 vercel deploy uploads no .env file but .env.example, in any folder, and never a path its own defaults skip (BUG-042)"""
    paths = sorted(set(FIXTURE + checkout_files()))
    up = uploaded(paths)
    assert [p for p in paths if is_env_file(p) and p in up['deploy']] == []
    assert {'.env.example', 'server/.env.example'} <= up['deploy']  # the template is not a secret: it keeps going up
    assert up['deploy'] <= up['defaults']  # .vercelignore only takes files away; the `!` line lets nothing back in


def test_the_cli_the_defaults_were_read_from_is_the_one_deploy_uses():
    """TC-NF-19 tools/deploy.sh pins the Vercel CLI the skip list above was read from, so a new CLI makes someone re-read it"""
    pinned = re.search(r'^VERCEL_CLI="vercel@([^"]+)"', (ROOT / 'tools' / 'deploy.sh').read_text(), re.M)
    assert pinned and pinned.group(1) == CLI_VERSION
