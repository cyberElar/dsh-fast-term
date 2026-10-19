import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

/**
 * Windows freezes a process' environment block when it starts, so a long-lived
 * host keeps the PATH it was launched with. A terminal opened hours later would
 * then miss every PATH edit made since (a freshly installed CLI, an updated
 * toolchain). Read the value back from the registry instead of trusting the
 * inherited one.
 */

const MACHINE_ENV_KEY = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment';
const USER_ENV_KEY = 'HKCU\\Environment';
const CACHE_TTL_MS = 5000;

let cachedPath;
let cachedAt = 0;

function expandWindowsVars(value) {
  return value.replace(/%([^%]+)%/g, (whole, varName) => process.env[varName] ?? whole);
}

/** The 'Path' value of one registry store, with %VAR% expanded; undefined when absent. */
function readRegistryPath(storeKey) {
  let raw;
  try {
    raw = execFileSync('reg.exe', ['query', storeKey, '/v', 'Path'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
      windowsHide: true,
    });
  } catch {
    return undefined;
  }
  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*Path\s+(REG_EXPAND_SZ|REG_SZ)\s*(.*)$/i.exec(line);
    if (match === null) continue;
    const value = match[2].trim();
    if (value === '') return undefined;
    return match[1].toUpperCase() === 'REG_EXPAND_SZ' ? expandWindowsVars(value) : value;
  }
  return undefined;
}

function entryKey(entry) {
  return entry.trim().replace(/^"(.*)"$/, '$1').replace(/[\\/]+$/, '').toLowerCase();
}

function buildPath() {
  const machine = readRegistryPath(MACHINE_ENV_KEY);
  const user = readRegistryPath(USER_ENV_KEY);
  if (machine === undefined && user === undefined) return undefined;
  const entries = [];
  const seen = new Set();
  const add = (entry) => {
    const trimmed = entry.trim().replace(/^"(.*)"$/, '$1');
    if (trimmed === '') return;
    const key = entryKey(trimmed);
    if (seen.has(key)) return;
    seen.add(key);
    entries.push(trimmed);
  };
  for (const value of [machine, user]) {
    if (value === undefined) continue;
    for (const entry of value.split(';')) add(entry);
  }
  // Directories the host added at runtime (plugin shims, wrappers) are not in
  // the registry. Keep the ones that still exist; stale leftovers stay dropped.
  const inherited = process.env.Path ?? process.env.PATH ?? '';
  for (const entry of inherited.split(';')) {
    const trimmed = entry.trim();
    if (trimmed === '' || seen.has(entryKey(trimmed))) continue;
    if (!existsSync(trimmed)) continue;
    add(trimmed);
  }
  return entries.length === 0 ? undefined : entries.join(';');
}

/** Fresh PATH for a newly spawned terminal, or undefined when unknown. */
export function windowsTerminalPath() {
  if (process.platform !== 'win32') return undefined;
  const now = Date.now();
  if (cachedPath !== undefined && now - cachedAt < CACHE_TTL_MS) return cachedPath;
  let value;
  try {
    value = buildPath();
  } catch {
    value = undefined;
  }
  cachedPath = value;
  cachedAt = now;
  return value;
}