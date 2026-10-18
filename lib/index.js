import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import WebSocket, { WebSocketServer } from 'ws';

export const name = 'dsh-fast-term';
export const inject = ['webServer', 'subprocess'];

const WS_PATH = '/api/dsh-fast-term/ws';
const CLOSE_PATH = '/api/dsh-fast-term/close';
const SHELLS_PATH = '/api/dsh-fast-term/shells';
const RENAME_PATH = '/api/dsh-fast-term/rename';
const LIST_PATH = '/api/dsh-fast-term/list';
const MAX_BUFFER_BYTES = 4 * 1024 * 1024;

function findExecutable(fileName) {
  const pathValue = process.env.PATH ?? '';
  for (const dir of pathValue.split(delimiter)) {
    if (dir === '') continue;
    const candidate = join(dir, fileName);
    try {
      if (existsSync(candidate)) return candidate;
    } catch {
      /* ignore unreadable PATH entries */
    }
  }
  return undefined;
}

/** Prefer PowerShell 7, then Windows PowerShell, then ComSpec. */
function resolveShell() {
  if (process.platform !== 'win32') {
    return [process.env.SHELL ?? '/bin/sh', '-l'];
  }
  const override = process.env.DSH_FAST_TERM_SHELL;
  if (override !== undefined && override.trim() !== '') return [override.trim()];
  const pwsh = findExecutable('pwsh.exe');
  if (pwsh !== undefined) return [pwsh, '-NoLogo'];
  const winPs = windowsPowerShellPath();
  if (winPs !== undefined) return [winPs, '-NoLogo'];
  return [process.env.ComSpec ?? 'cmd.exe'];
}

function windowsPowerShellPath() {
  const candidate = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  try {
    return existsSync(candidate) ? candidate : undefined;
  } catch {
    return undefined;
  }
}

const SHELL_CANDIDATES = process.platform === 'win32'
  ? ['pwsh.exe', 'powershell.exe', 'cmd.exe', 'bash.exe']
  : ['zsh', 'bash', 'fish', 'pwsh', 'powershell', 'cmd', 'sh'];

function shellBaseName(filePath) {
  const parts = String(filePath).split(/[\\/]/);
  const base = parts.length === 0 ? String(filePath) : parts[parts.length - 1];
  return base === '' ? String(filePath) : base;
}

function shellKind(filePath) {
  return shellBaseName(filePath).toLowerCase().replace(/\.exe$/, '');
}

function findPowerShell() {
  return windowsPowerShellPath();
}

/** Shells offered in the guide menu, ordered by preference. */
function discoverShells() {
  const found = [];
  const seen = new Set();
  const push = (filePath) => {
    if (typeof filePath !== 'string' || filePath === '') return;
    const kind = shellKind(filePath);
    if (seen.has(kind)) return;
    seen.add(kind);
    found.push({ path: filePath, name: shellBaseName(filePath) });
  };
  const override = process.env.DSH_FAST_TERM_SHELL;
  if (typeof override === 'string' && override.trim() !== '') push(override.trim());
  for (const candidate of SHELL_CANDIDATES) {
    const resolved = candidate === 'powershell.exe' && process.platform === 'win32'
      ? findExecutable(candidate) ?? findPowerShell()
      : findExecutable(candidate);
    push(resolved);
  }
  if (found.length === 0) push(resolveShell()[0]);
  return found;
}

/** Arguments for one shell path; the merged flags match the platform defaults. */
function shellArgv(filePath) {
  if (process.platform !== 'win32') return [filePath, '-l'];
  const kind = shellKind(filePath);
  if (kind === 'pwsh' || kind === 'powershell') return [filePath, '-NoLogo'];
  return [filePath];
}

/** The requested shell when it is one of the discovered shells, else the default. */
function chooseShell(requested) {
  const shells = discoverShells();
  if (typeof requested === 'string' && requested !== '') {
    const match = shells.find((shell) => shell.path.toLowerCase() === requested.toLowerCase());
    if (match !== undefined) return match.path;
  }
  const override = process.env.DSH_FAST_TERM_SHELL;
  if (typeof override === 'string' && override.trim() !== '') return override.trim();
  const fallback = resolveShell()[0];
  const known = shells.find((shell) => shell.path.toLowerCase() === fallback.toLowerCase());
  return known === undefined ? fallback : known.path;
}

function clampInt(value, fallback, min, max) {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.min(max, Math.max(min, n));
}

function isLoopback(req) {
  const remote = req.socket === undefined ? undefined : req.socket.remoteAddress;
  if (remote !== '127.0.0.1' && remote !== '::1' && remote !== '::ffff:127.0.0.1') return false;
  const origin = req.headers === undefined ? undefined : req.headers.origin;
  if (typeof origin === 'string' && origin !== '') {
    try {
      const source = new URL(origin);
      // The Desktop shell pages the app from dsh-app://app; its sockets still target the loopback host.
      if (source.protocol !== 'dsh-app:' && source.host !== req.headers.host) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function writeJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(text);
}

/** Reject non-loopback HTTP calls (same fence as the websocket). */
function guardHttp(req, res) {
  if (isLoopback(req)) return true;
  writeJson(res, 403, { error: 'forbidden' });
  return false;
}

function readJsonBody(req) {  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 256 * 1024) {
        resolve(undefined);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        resolve(undefined);
      }
    });
    req.on('error', () => resolve(undefined));
  });
}

/** Session working directory; falls back to the home directory. */
function resolveCwd(ctx, sessionId) {
  try {
    if (typeof sessionId !== 'string' || sessionId === '') return homedir();
    const sessions = ctx.get('sessions');
    const session = sessions === undefined || typeof sessions.get !== 'function' ? undefined : sessions.get(sessionId);
    if (session === undefined || session === null) return homedir();
    const workingDirectory = ctx.get('workingDirectory');
    if (workingDirectory !== undefined && typeof workingDirectory.get === 'function') {
      const directory = workingDirectory.get(session);
      if (typeof directory === 'string' && directory !== '') return directory;
    }
  } catch {
    /* fall through to homedir */
  }
  return homedir();
}

/** One persistent PTY plus its replay buffer, independent of client connections. */
class TermSession {
  constructor(id, handle, title, shellPath) {
    this.id = id;
    this.handle = handle;
    this.title = title;
    this.shellPath = shellPath;
    this.decoder = new StringDecoder('utf8');
    this.chunks = [];
    this.bytes = 0;
    this.clients = new Set();
    this.exited = false;
  }

  append(text) {
    if (text === '') return;
    this.chunks.push(text);
    this.bytes += Buffer.byteLength(text);
    while (this.bytes > MAX_BUFFER_BYTES && this.chunks.length > 1) {
      const dropped = this.chunks.shift();
      this.bytes -= Buffer.byteLength(dropped);
    }
  }

  snapshot() {
    return this.chunks.length === 0 ? '' : this.chunks.join('');
  }

  broadcast(payload) {
    const text = JSON.stringify(payload);
    for (const client of this.clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      try { client.send(text); } catch { /* ignore */ }
    }
  }

  write(data) {
    return Promise.resolve(this.handle.write(data));
  }

  resize(cols, rows) {
    const pty = this.handle.terminal;
    if (pty === undefined || typeof pty.resize !== 'function') return;
    try { pty.resize(cols, rows); } catch { /* ignore */ }
  }

  async terminate() {
    this.exited = true;
    try { await this.handle.terminate(); } catch { /* ignore */ }
  }
}

export function apply(ctx) {
  const sessions = new Map();
  const pending = new Map();

  const createSession = async (msg) => {
    const subprocess = ctx.get('subprocess');
    if (subprocess === undefined) throw new Error('宿主未提供 subprocess 能力');
    const rows = clampInt(msg.rows, 24, 2, 200);
    const cols = clampInt(msg.cols, 80, 2, 500);
    const shellPath = chooseShell(typeof msg.shellPath === 'string' ? msg.shellPath : undefined);
    const handle = await subprocess.spawnTerminal({
      argv: shellArgv(shellPath),
      rows,
      cols,
      cwd: resolveCwd(ctx, msg.sessionId),
      // DSH 用 terminalType 覆盖 PTY 的 TERM（spawnTerminal 内部是
      // `env: { ...env, TERM: spec.terminalType }`），不传就会得到一个字符串
      // "undefined" 的 TERM，ssh 透传到远端后 tmux 会拒绝启动。
      terminalType: 'xterm-256color',
      env: { COLORTERM: 'truecolor' },
      graceMs: 5000,
    });
    const session = new TermSession(msg.id, handle, shellBaseName(shellPath), shellPath);
    handle.output.on('data', (chunk) => {
      const text = session.decoder.write(chunk);
      session.append(text);
      session.broadcast({ type: 'data', data: text });
    });
    handle.output.on('end', () => {
      const rest = session.decoder.end();
      if (rest !== '') {
        session.append(rest);
        session.broadcast({ type: 'data', data: rest });
      }
    });
    void handle.done.then((result) => {
      session.exited = true;
      session.broadcast({ type: 'exit', code: result.exitCode, signal: result.signal });
    }, () => { /* ignore */ });
    sessions.set(msg.id, session);
    return session;
  };

  const ensureSession = async (msg) => {
    const existing = sessions.get(msg.id);
    if (existing !== undefined) return existing;
    const inFlight = pending.get(msg.id);
    if (inFlight !== undefined) return inFlight;
    const created = createSession(msg);
    pending.set(msg.id, created);
    try {
      return await created;
    } finally {
      pending.delete(msg.id);
    }
  };

  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => {
      const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });
      const handler = (req, socket, head) => {
        if (!isLoopback(req)) {
          socket.destroy();
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
      };
      const disposers = [];
      disposers.push(webCtx.webServer.registerUpgrade({ path: WS_PATH, handler }));
      disposers.push(webCtx.webServer.register({
        kind: 'exact',
        path: CLOSE_PATH,
        handler: async (req, res) => {
          if (req.method !== 'POST') {
            writeJson(res, 405, { error: 'method not allowed' });
            return;
          }
          if (!guardHttp(req, res)) return;
          const body = await readJsonBody(req);
          if (body === undefined || typeof body.id !== 'string' || body.id === '') {
            writeJson(res, 400, { error: 'invalid body' });
            return;
          }
          const session = sessions.get(body.id);
          if (session === undefined) {
            writeJson(res, 200, { ok: true, closed: false });
            return;
          }
          sessions.delete(body.id);
          for (const client of session.clients) {
            try { client.close(1000, 'terminal closed'); } catch { /* ignore */ }
          }
          await session.terminate();
          writeJson(res, 200, { ok: true, closed: true });
        },
      }));
      disposers.push(webCtx.webServer.register({
        kind: 'exact',
        path: LIST_PATH,
        handler: (req, res) => {
          if (req.method !== 'GET') {
            writeJson(res, 405, { error: 'method not allowed' });
            return;
          }
          if (!guardHttp(req, res)) return;
          const terminals = [];
          for (const session of sessions.values()) {
            terminals.push({ id: session.id, title: session.title, shell: session.shellPath, pid: session.handle.pid, exited: session.exited });
          }
          writeJson(res, 200, { terminals });
        },
      }));
      disposers.push(webCtx.webServer.register({
        kind: 'exact',
        path: SHELLS_PATH,
        handler: (req, res) => {
          if (req.method !== 'GET') {
            writeJson(res, 405, { error: 'method not allowed' });
            return;
          }
          if (!guardHttp(req, res)) return;
          writeJson(res, 200, { shells: discoverShells(), selectedShell: chooseShell(undefined) });
        },
      }));
      disposers.push(webCtx.webServer.register({
        kind: 'exact',
        path: RENAME_PATH,
        handler: async (req, res) => {
          if (req.method !== 'POST') {
            writeJson(res, 405, { error: 'method not allowed' });
            return;
          }
          if (!guardHttp(req, res)) return;
          const body = await readJsonBody(req);
          const id = body === undefined ? undefined : body.id;
          const title = body === undefined || typeof body.title !== 'string' ? '' : body.title.trim().slice(0, 120);
          if (typeof id !== 'string' || id === '' || title === '') {
            writeJson(res, 400, { error: 'invalid body' });
            return;
          }
          const session = sessions.get(id);
          if (session === undefined) {
            writeJson(res, 404, { ok: false, error: 'unknown terminal' });
            return;
          }
          session.title = title;
          session.broadcast({ type: 'title', id, title });
          writeJson(res, 200, { ok: true, title });
        },
      }));

      const attach = (ws) => {
        let bound = null;
        let disposed = false;
        const send = (payload) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          try { ws.send(JSON.stringify(payload)); } catch { /* ignore */ }
        };

        const bind = async (msg) => {
          if (disposed || bound !== null) return;
          if (typeof msg.id !== 'string' || msg.id === '') {
            send({ type: 'error', message: 'terminal id missing' });
            return;
          }
          const existed = sessions.has(msg.id);
          let session;
          try {
            session = await ensureSession(msg);
          } catch (error) {
            send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
            return;
          }
          if (disposed) return;
          bound = session;
          session.clients.add(ws);
          send({ type: 'ready', id: session.id, pid: session.handle.pid, fresh: existed === false, title: session.title, shell: session.shellPath });
          if (existed) send({ type: 'snapshot', data: session.snapshot() });
          if (session.exited) send({ type: 'exit' });
        };

        ws.on('message', (raw) => {
          let msg;
          try { msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8')); } catch { return; }
          if (msg === null || typeof msg !== 'object') return;
          if (msg.type === 'attach') {
            void bind(msg);
            return;
          }
          if (bound === null) return;
          if (msg.type === 'input' && typeof msg.data === 'string') {
            void bound.write(msg.data).catch(() => { /* ignore */ });
            return;
          }
          if (msg.type === 'resize') {
            bound.resize(clampInt(msg.cols, 80, 2, 500), clampInt(msg.rows, 24, 2, 200));
          }
        });

        const detach = () => {
          disposed = true;
          if (bound !== null) bound.clients.delete(ws);
          bound = null;
        };
        ws.on('close', detach);
        ws.on('error', detach);
      };

      wss.on('connection', attach);
      return () => {
        for (const dispose of disposers) {
          if (typeof dispose !== 'function') continue;
          try { dispose(); } catch { /* ignore */ }
        }
        for (const client of wss.clients) {
          try { client.terminate(); } catch { /* ignore */ }
        }
        wss.close();
        for (const session of sessions.values()) void session.terminate();
        sessions.clear();
      };
    }, 'dsh-fast-term: websocket');
  });
}
