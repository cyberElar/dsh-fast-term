import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import xtermCss from '@xterm/xterm/css/xterm.css';
import {
  Fragment,
  createElement as h,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  Button,
  IconChevronDownOutlineRegular,
  Menu,
  PluginArtworkTerminal,
  ShortcutKeys,
} from '@deepseek-ai/dsh-client-ui-primitives';

const NS = 'fastTerm';
const PLUGIN_ID = 'dsh-fast-term';
const STYLE_ID = 'dsh-fast-term-style';
const WS_PATH = '/api/dsh-fast-term/ws';
const CLOSE_PATH = '/api/dsh-fast-term/close';
const RENAME_PATH = '/api/dsh-fast-term/rename';
const LIST_PATH = '/api/dsh-fast-term/list';
const SHELLS_PATH = '/api/dsh-fast-term/shells';
const CONFIG_PATH = '/api/dsh-fast-term/config';
const SHELL_KEY = 'dsh-fast-term:shell';

/**
 * Backend origin for sockets. The Desktop shell serves the app from
 * `dsh-app://app` and injects the real host origin as `__DSH_TRANSPORT__.streamBaseUrl`;
 * a plain web session falls back to the document base (same origin).
 */
function transportBase() {
  const injected = typeof window === 'undefined' ? undefined : window.__DSH_TRANSPORT__;
  const raw = injected !== undefined && injected !== null && typeof injected.streamBaseUrl === 'string' && injected.streamBaseUrl !== ''
    ? injected.streamBaseUrl
    : (typeof document === 'undefined' ? location.href : document.baseURI);
  try {
    return new URL(raw, location.href);
  } catch {
    return new URL(location.href);
  }
}

function absoluteUrl(path) {
  const base = transportBase();
  const href = base.href.endsWith('/') ? base.href : base.href + '/';
  return new URL(path.replace(/^\/+/u, ''), href).href;
}

function websocketUrl(path) {
  const url = new URL(absoluteUrl(path));
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
}

const CSS = `
.dft-root{box-sizing:border-box;height:100%;min-height:0;color:var(--dsw-alias-label-primary);flex-direction:column;flex:1;padding-top:8px;font-size:13px;display:flex}
.dft-screen{min-width:0;min-height:0;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);flex:1;padding:8px;overflow:hidden;position:relative}
.dft-host{position:relative;width:100%;height:100%;}
.dft-screen .xterm{height:100%;}
.dft-screen .xterm-viewport{background:var(--dsw-alias-bg-base);}
.dft-lock{position:absolute;top:2px;right:6px;z-index:4;display:inline-flex;align-items:center;gap:4px;height:18px;padding:0 7px;border-radius:9px;border:.5px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-tertiary);font:11px/1 ui-sans-serif,system-ui,sans-serif;cursor:pointer;opacity:.55;transition:opacity .12s ease}
.dft-lock:hover,.dft-lock:focus-visible{opacity:1;outline:none}
.dft-lock[data-locked='false']{color:var(--dsw-alias-label-primary);opacity:.85}
.dft-lock[data-denied='true']{border-color:var(--dsw-alias-label-warning,#c98a00);color:var(--dsw-alias-label-warning,#c98a00);opacity:1}
.dft-lock-dot{width:5px;height:5px;border-radius:50%;background:currentColor;flex:none}
.dft-entry{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsl-guide-entry-radius);background:var(--dsw-alias-bg-layer-1);align-items:center;gap:14px;width:100%;min-height:56px;padding:14px 20px;display:flex;position:relative;overflow:hidden}
.dft-main{border-radius:0;width:100%;height:100%;position:absolute;inset:0}
.dft-main:focus-visible{outline-offset:-2px}
.dft-icon{width:26px;height:26px;color:var(--dsw-alias-label-secondary);pointer-events:none;flex:none;justify-content:center;align-items:center;display:flex;position:relative}
.dft-text{pointer-events:none;flex-direction:column;flex:1;gap:3px;min-width:0;display:flex;position:relative}
.dft-titleRow{align-items:center;gap:4px;min-width:0;display:flex}
.dft-title{color:var(--dsw-alias-label-primary);white-space:nowrap;text-overflow:ellipsis;font-size:14px;line-height:1.4;overflow:hidden}
.dft-description{color:var(--dsw-alias-label-tertiary);white-space:nowrap;text-overflow:ellipsis;font-size:11px;line-height:1.4;overflow:hidden}
.dft-trigger{border-radius:4px;flex:none;width:20px;height:20px;padding:0}
.dft-trigger svg{width:14px;height:14px;color:var(--dsw-alias-label-tertiary)}
.dft-menu{pointer-events:auto;flex:none;display:flex}
.dft-shortcut{pointer-events:none;position:relative}
.dft-tab-title{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}
.dft-tab-name{width:120px;min-width:48px;max-width:100%;color:inherit;font:inherit;background:var(--dsw-alias-bg-l1);border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);outline:none;padding:0 4px}
.dft-ctx{position:absolute;z-index:6;min-width:150px;padding:4px;border:.5px solid var(--dsw-alias-border-l3);border-radius:6px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 8px 28px rgba(0,0,0,.18);font:12px/1.2 ui-sans-serif,system-ui,sans-serif;color:var(--dsw-alias-label-primary)}
.dft-ctx-item{appearance:none;display:flex;align-items:center;justify-content:space-between;gap:24px;width:100%;padding:5px 8px;border:0;border-radius:4px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:default}
.dft-ctx-item:hover:not(:disabled),.dft-ctx-item:focus-visible{background:var(--dsw-alias-bg-l1);outline:none}
.dft-ctx-item:disabled{color:var(--dsw-alias-label-tertiary);opacity:.6}
.dft-ctx-key{color:var(--dsw-alias-label-tertiary);font-size:11px;white-space:nowrap}
.dft-flash{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);z-index:6;max-width:calc(100% - 32px);padding:4px 10px;border-radius:10px;border:.5px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:11px/1.3 ui-sans-serif,system-ui,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;box-shadow:0 4px 16px rgba(0,0,0,.12)}
.dft-flash[data-error='true']{color:var(--dsw-alias-label-warning,#c98a00);border-color:var(--dsw-alias-label-warning,#c98a00)}
`;

function ensureCss() {
  if (typeof document === 'undefined') return;
  const content = CSS + '\n' + xtermCss;
  const existing = document.getElementById(STYLE_ID);
  if (existing !== null) {
    // A hot-reloaded client reuses the style tag created by the previous
    // instance of this module, so refresh its text instead of bailing out.
    if (existing.textContent !== content) existing.textContent = content;
    return;
  }
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = content;
  document.head.appendChild(style);
}

const zh = {
  title: '终端',
  new: '新建终端',
  description: '在会话工作区运行命令',
  shell: '选择 Shell',
  shellLoading: '正在读取 Shell…',
  shellEmpty: '没有可用的 Shell',
  shellFailed: 'Shell 读取失败：{message}',
  rename: '终端名称',
  retry: '重试',
  failed: '终端错误：{message}',
  closed: '终端已关闭。',
  exited: '进程已退出（{code}）',
  reconnected: '已重新连接',
  'shortcut.noSession': '请先选择会话',
  'lock.readonly': '只读',
  'lock.readonlyHint': '外部输入已锁定：只有这个终端界面可以输入。点击允许外部程序或 Agent 输入。',
  'lock.unlocked': '可输入',
  'lock.unlockedHint': '外部输入已允许。点击恢复只读。',
  'lock.whitelist': '白名单 {count} 条',
  'lock.denied': '已拒绝外部输入',
  'lock.failed': '切换失败：{message}',
  'copy.menu': '复制',
  'copy.paste': '粘贴',
  'copy.selectAll': '全选',
  'copy.copied': '已复制 {count} 个字符',
  'copy.nothing': '没有选中内容',
  'copy.failed': '复制失败：剪贴板不可用，请检查剪贴板权限后重试',
  'copy.pasteFailed': '无法读取剪贴板，请按 Ctrl+Shift+V 粘贴',
  'shortcut.terminalInput': '终端优先（{keys}）',
};

const en = {
  title: 'Terminal',
  new: 'New terminal',
  description: 'Run commands in the Session workspace',
  shell: 'Choose shell',
  shellLoading: 'Loading shells…',
  shellEmpty: 'No shells available',
  shellFailed: 'Shell discovery failed: {message}',
  rename: 'Terminal name',
  retry: 'Retry',
  failed: 'Terminal error: {message}',
  closed: 'Terminal closed.',
  exited: 'Process exited ({code})',
  reconnected: 'Reconnected',
  'shortcut.noSession': 'Select a session first',
  'lock.readonly': 'Read-only',
  'lock.readonlyHint': 'External input is locked: only this terminal view can type. Click to allow programs or an agent to type.',
  'lock.unlocked': 'Input on',
  'lock.unlockedHint': 'External input is allowed. Click to go back to read-only.',
  'lock.whitelist': '{count} allowed command(s)',
  'lock.denied': 'External input rejected',
  'lock.failed': 'Could not switch: {message}',
  'copy.menu': 'Copy',
  'copy.paste': 'Paste',
  'copy.selectAll': 'Select all',
  'copy.copied': 'Copied {count} characters',
  'copy.nothing': 'Nothing selected',
  'copy.failed': 'Copy failed — the clipboard is unavailable; check the clipboard permission and try again',
  'copy.pasteFailed': 'Cannot read the clipboard — press Ctrl+Shift+V',
  'shortcut.terminalInput': 'Terminal input priority ({keys})',
};

const titles = new Map();
const titleListeners = new Set();

function setStoredTitle(id, title) {
  if (typeof title !== 'string' || title === '') return;
  if (titles.get(id) === title) return;
  titles.set(id, title);
  for (const listener of titleListeners) listener();
}

function subscribeTitles(listener) {
  titleListeners.add(listener);
  return () => { titleListeners.delete(listener); };
}

function useStoredTitle(id, fallback) {
  return useSyncExternalStore(
    subscribeTitles,
    () => titles.get(id) ?? fallback,
    () => fallback,
  );
}

function rememberedShell() {
  try { return localStorage.getItem(SHELL_KEY) ?? undefined; } catch { return undefined; }
}

function rememberShell(path) {
  if (typeof path !== 'string' || path === '') return;
  try { localStorage.setItem(SHELL_KEY, path); } catch { /* ignore */ }
}

function terminalIdOf(sessionId, tab) {
  const tabId = tab !== undefined && tab !== null && tab.id !== undefined ? String(tab.id) : 'default';
  return String(sessionId ?? '') + '/' + tabId;
}

function TerminalIcon() {
  return h('svg', {
    width: '16',
    height: '16',
    viewBox: '0 0 16 16',
    fill: 'none',
    'aria-hidden': 'true',
  },
  h('path', { d: 'M3 4L7 8L3 12', stroke: 'currentColor' }),
  h('path', { d: 'M9 12H13', stroke: 'currentColor' }));
}

function Guide({ title, description, kind, useTabInfo, loadShells, selectShell, t, useShortcuts }) {
  ensureCss();
  const shortcut = typeof useShortcuts === 'function'
    ? useShortcuts((entries) => entries.find((entry) => entry.id === 'fastterm.new'))
    : undefined;
  const { tab } = useTabInfo();
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ phase: 'loading' });
  useEffect(() => {
    if (!open) return undefined;
    const lifetime = new AbortController();
    loadShells(lifetime.signal).then((choices) => {
      if (!lifetime.signal.aborted) setState({ phase: 'ready', choices });
    }, (error) => {
      if (!lifetime.signal.aborted) {
        setState({ phase: 'failed', message: error instanceof Error ? error.message : String(error) });
      }
    });
    return () => { lifetime.abort(); };
  }, [open, attempt, loadShells]);
  const items = state.phase === 'ready'
    ? state.choices.shells.map((shell) => ({ id: shell.path, label: shell.name }))
    : state.phase === 'loading'
      ? [{ id: 'loading', label: t('shellLoading'), disabled: true }]
      : [{ id: 'error', label: t('shellFailed', { message: state.message }), disabled: true },
        { id: 'retry', label: t('retry') }];
  const openTerminal = (shellPath) => {
    tab.actions.openTab('fastterm', {
      replaceTab: true,
      ...(shellPath === undefined ? {} : { params: { shellPath } }),
    });
  };
  return h('div', { className: 'dft-entry', 'data-sidebar-right-guide-entry': kind ?? 'fastterm' },
    h(Button, {
      variant: 'ghost',
      className: 'dft-main',
      'aria-label': description === undefined ? title : `${title} ${description}`,
      'aria-keyshortcuts': shortcut === undefined ? undefined : shortcut.aria,
      onClick: () => openTerminal(rememberedShell()),
    }),
    h('span', { className: 'dft-icon', 'aria-hidden': 'true' },
      h(PluginArtworkTerminal, { size: description === undefined ? 22 : 26 })),
    h('span', { className: 'dft-text' },
      h('span', { className: 'dft-titleRow' },
        h('span', { className: 'dft-title', 'aria-hidden': 'true' }, title),
        h(Menu, {
          open,
          portal: true,
          autoFocus: true,
          align: 'end',
          className: 'dft-menu',
          items: items.length === 0 ? [{ id: 'empty', label: t('shellEmpty'), disabled: true }] : items,
          selectedId: state.phase === 'ready' ? state.choices.selectedShell : undefined,
          onClose: () => { setOpen(false); },
          onSelect: (path) => {
            if (path === 'retry') {
              setState({ phase: 'loading' });
              setAttempt((value) => value + 1);
              return;
            }
            selectShell(path);
            setOpen(false);
            openTerminal(path);
          },
          anchor: h(Button, {
            variant: 'ghost',
            className: 'dft-trigger',
            'aria-label': t('shell'),
            'aria-haspopup': 'menu',
            'aria-expanded': open,
            onClick: () => {
              if (!open) setState({ phase: 'loading' });
              setOpen((value) => !value);
            },
          }, h(IconChevronDownOutlineRegular, {})),
        })),
      description === undefined ? null : h('span', { className: 'dft-description', 'aria-hidden': 'true' }, description)),
    shortcut !== undefined && shortcut.keys.length > 0
      ? h(ShortcutKeys, { keys: shortcut.keys, className: 'dft-shortcut' })
      : null);
}

function terminalFontFamily(appTheme) {
  const value = appTheme === undefined || appTheme === null || appTheme.fontFamilies === undefined
    ? undefined
    : appTheme.fontFamilies.terminal;
  if (Array.isArray(value) && value.length > 0) {
    return value.map((name) => (/\s/.test(name) ? '"' + String(name) + '"' : String(name))).join(', ');
  }
  if (typeof value === 'string' && value !== '') return value;
  return 'Consolas, "Cascadia Mono", "Courier New", monospace';
}

function terminalFontSize(appTheme) {
  const value = appTheme === undefined || appTheme === null || appTheme.fontSizes === undefined
    ? undefined
    : appTheme.fontSizes.terminal;
  return typeof value === 'number' && value > 0 ? value : 13;
}

function isMacPlatform() {
  if (typeof navigator === 'undefined') return false;
  const platform = navigator.userAgentData !== undefined && typeof navigator.userAgentData.platform === 'string'
    ? navigator.userAgentData.platform
    : (typeof navigator.platform === 'string' ? navigator.platform : '');
  return /mac/i.test(platform);
}

/** Copy synchronously through a throwaway textarea when the async clipboard is unavailable. */
function legacyCopy(text) {
  if (typeof document === 'undefined' || document.body === null) return false;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.setAttribute('aria-hidden', 'true');
  area.style.position = 'fixed';
  area.style.top = '0';
  area.style.left = '-9999px';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }
  area.remove();
  return copied;
}

async function copyText(text) {
  if (typeof text !== 'string' || text === '') return false;
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined
      && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // The clipboard permission can be denied (or absent outside a secure
    // context); fall back to the copy command while the gesture is still live.
  }
  return legacyCopy(text);
}

async function readClipboardText() {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined
      && typeof navigator.clipboard.readText === 'function') {
      const text = await navigator.clipboard.readText();
      return typeof text === 'string' ? text : '';
    }
  } catch {
    return null;
  }
  return null;
}

const PASSTHROUGH_PREFIX = 'fastterm.passthrough.';

/**
 * Desktop shortcuts are resolved by the Electron main process before the page
 * sees the key, and desktop bindings deliberately override focused regions.
 * While our terminal owns the keyboard we park a fixed shortcut on every
 * single-Ctrl binding that DSH would otherwise capture; the shortcut service
 * then marks those rows conflicted, the main process drops the keys from its
 * intercept set, and xterm receives them (Ctrl+B becomes the tmux prefix).
 * The fixed entries are conflict markers only: they never run, are never
 * persisted, and disappear again as soon as the terminal loses focus.
 */
const passthrough = {
  service: undefined,
  holders: 0,
  disposers: [],
  signature: '',
  busy: false,
  pending: false,
  unsubscribe: null,
  label: undefined,
};

function passthroughIdentity(binding) {
  const codes = binding.secondCode === undefined ? [binding.code] : [binding.code, binding.secondCode].sort();
  return [...binding.modifiers, ...codes].join('+');
}

function passthroughCandidates(service) {
  const candidates = new Map();
  const rows = service.catalog.getSnapshot();
  if (!Array.isArray(rows)) return candidates;
  for (const row of rows) {
    if (row === null || row === undefined) continue;
    if (typeof row.id !== 'string' || row.id.startsWith('fastterm.')) continue;
    const binding = row.binding;
    if (binding === null || binding === undefined) continue;
    if (typeof binding.code !== 'string' || !Array.isArray(binding.modifiers)) continue;
    if (row.issue !== null && row.issue !== undefined) continue;
    // Only claim rows that are enabled, or that are already disabled purely by
    // markers we parked ourselves (so a second refresh recognises its own work).
    const conflicts = Array.isArray(row.conflicts) ? row.conflicts : [];
    if (conflicts.some((id) => typeof id !== 'string' || !id.startsWith(PASSTHROUGH_PREFIX))) continue;
    if (binding.secondCode !== undefined) continue;
    if (binding.modifiers.length !== 1 || binding.modifiers[0] !== 'control') continue;
    const id = PASSTHROUGH_PREFIX + passthroughIdentity(binding).replace(/\+/gu, '-').toLowerCase();
    candidates.set(id, binding);
  }
  return candidates;
}

function releasePassthrough() {
  passthrough.signature = '';
  const disposers = passthrough.disposers;
  passthrough.disposers = [];
  for (const dispose of disposers) {
    try { dispose(); } catch { /* keep releasing the rest */ }
  }
}

function refreshPassthrough() {
  const service = passthrough.service;
  if (service === undefined) return;
  const active = passthrough.holders > 0
    && service.runtime === 'desktop'
    && (service.platform === 'windows' || service.platform === 'macos');
  if (!active) {
    releasePassthrough();
    return;
  }
  if (passthrough.busy) {
    passthrough.pending = true;
    return;
  }
  const wanted = passthroughCandidates(service);
  const signature = [...wanted.keys()].sort().join('|');
  if (signature === passthrough.signature) return;
  passthrough.busy = true;
  try {
    releasePassthrough();
    passthrough.signature = signature;
    for (const [id, binding] of wanted) {
      try {
        const described = service.describeBinding(binding);
        const keys = Array.isArray(described.keys) ? described.keys : [];
        const text = keys.filter((key) => key !== '+').join('+');
        const dispose = service.registerFixed({
          id,
          label: () => (typeof passthrough.label === 'function' ? passthrough.label(text) : text),
          keys,
          bindings: [binding],
        });
        passthrough.disposers.push(dispose);
      } catch {
        // Rejecting one marker must never take down the shortcuts catalog.
      }
    }
  } finally {
    passthrough.busy = false;
    if (passthrough.pending) {
      passthrough.pending = false;
      refreshPassthrough();
    }
  }
}

function beginTerminalPassthrough(label) {
  const service = passthrough.service;
  if (service === undefined) return () => {};
  if (passthrough.holders === 0) {
    const offCatalog = service.catalog.subscribe(() => { refreshPassthrough(); });
    const offConfig = service.config.subscribe(() => { refreshPassthrough(); });
    passthrough.unsubscribe = () => { offCatalog(); offConfig(); };
  }
  passthrough.holders += 1;
  passthrough.label = label;
  refreshPassthrough();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    passthrough.holders = Math.max(0, passthrough.holders - 1);
    if (passthrough.holders > 0) {
      refreshPassthrough();
      return;
    }
    if (passthrough.unsubscribe !== null) {
      passthrough.unsubscribe();
      passthrough.unsubscribe = null;
    }
    releasePassthrough();
  };
}

function setShortcutService(service) {
  if (passthrough.service === service) return;
  if (passthrough.unsubscribe !== null) {
    passthrough.unsubscribe();
    passthrough.unsubscribe = null;
  }
  releasePassthrough();
  passthrough.service = service;
}

function Body(props) {
  ensureCss();
  const { sessionId, useTabInfo, readShellPath, useTheme, t } = props;
  const info = typeof useTabInfo === 'function' ? useTabInfo() : undefined;
  const tab = info === undefined ? undefined : info.tab;
  const terminalId = terminalIdOf(sessionId, tab);
  const appTheme = typeof useTheme === 'function' ? useTheme((value) => value) : undefined;
  const fontFamily = terminalFontFamily(appTheme);
  const fontSize = terminalFontSize(appTheme);
  const hostRef = useRef(null);
  const screenRef = useRef(null);
  const termRef = useRef(null);
  const fitRef = useRef(null);
  const [lock, setLock] = useState({ allowExternalInput: false, allowedCommands: [] });
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(null);
  const [flash, setFlash] = useState(null);
  const flashDenied = useRef(() => {});
  const deniedTimer = useRef(null);
  const menuRef = useRef(null);
  const flashTimer = useRef(null);
  const liveRef = useRef(true);
  const [termFocused, setTermFocused] = useState(false);
  const say = (key, vars) => (t === undefined ? key : t(key, vars));
  const showFlash = (text, error) => {
    if (!liveRef.current) return;
    setFlash({ text, error: error === true });
    if (flashTimer.current !== null) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => { setFlash(null); }, 1800);
  };
  const copySelection = () => {
    const term = termRef.current;
    if (term === null) return;
    const selection = term.getSelection();
    if (selection === '') {
      showFlash(say('copy.nothing'));
      return;
    }
    void copyText(selection).then((copied) => {
      if (copied) {
        showFlash(say('copy.copied', { count: selection.length }));
      } else {
        showFlash(say('copy.failed'), true);
      }
    });
  };
  const pasteSelection = () => {
    const term = termRef.current;
    if (term === null) return;
    void readClipboardText().then((text) => {
      if (text === null || text === '') {
        showFlash(say('copy.pasteFailed'), true);
        return;
      }
      term.paste(text);
    });
  };
  const closeMenu = () => {
    setMenu(null);
    termRef.current?.focus();
  };
  const openMenu = (event) => {
    const target = event.target;
    if (target instanceof Element && target.closest('.dft-lock') !== null) return;
    const term = termRef.current;
    const screen = screenRef.current;
    if (term === null || screen === null) return;
    event.preventDefault();
    const frame = screen.getBoundingClientRect();
    const x = Math.max(4, Math.min(event.clientX - frame.left, frame.width - 176));
    const y = Math.max(4, Math.min(event.clientY - frame.top, frame.height - 104));
    setMenu({ x, y, hasSelection: term.hasSelection() });
  };
  flashDenied.current = () => {
    setDenied(true);
    if (deniedTimer.current !== null) clearTimeout(deniedTimer.current);
    deniedTimer.current = setTimeout(() => { setDenied(false); }, 1600);
  };
  useEffect(() => {
    liveRef.current = true;
    return () => {
      liveRef.current = false;
      if (deniedTimer.current !== null) clearTimeout(deniedTimer.current);
      if (flashTimer.current !== null) clearTimeout(flashTimer.current);
    };
  }, []);
  useEffect(() => {
    if (menu === null) return undefined;
    const dismiss = (event) => {
      const el = menuRef.current;
      if (el !== null && event.target instanceof Node && el.contains(event.target)) return;
      setMenu(null);
    };
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setMenu(null);
      termRef.current?.focus();
    };
    const onBlur = () => { setMenu(null); };
    window.addEventListener('pointerdown', dismiss, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('pointerdown', dismiss, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [menu]);
  useEffect(() => {
    let live = true;
    void fetch(CONFIG_PATH, { headers: { accept: 'application/json' } })
      .then((response) => (response.ok ? response.json() : undefined))
      .then((body) => {
        if (live && body !== undefined && body.config !== undefined) setLock(body.config);
      })
      .catch(() => { /* keep defaults */ });
    return () => { live = false; };
  }, []);
  const toggleLock = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch(CONFIG_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ allowExternalInput: !(lock !== undefined && lock.allowExternalInput === true) }),
      });
      const body = await response.json();
      if (!response.ok || body === null || body.ok !== true) throw new Error('HTTP ' + String(response.status));
      if (body.config !== undefined) setLock(body.config);
    } catch (error) {
      const text = t === undefined
        ? 'Could not switch: ' + String(error instanceof Error ? error.message : error)
        : t('lock.failed', { message: String(error instanceof Error ? error.message : error) });
      termRef.current?.write('\r\n\x1b[90m[' + String(text) + ']\x1b[0m\r\n');
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    const el = hostRef.current;
    if (el === null) return undefined;
    const shellPath = typeof readShellPath === 'function' ? readShellPath(tab === undefined ? undefined : tab.id) : undefined;
    const term = new Terminal({
      fontFamily,
      fontSize,
      minimumContrastRatio: 4.5,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    termRef.current = term;
    fitRef.current = fit;
    const textarea = term.textarea;
    const onTermFocus = () => { setTermFocused(true); };
    const onTermBlur = () => { setTermFocused(false); };
    if (textarea !== null && textarea !== undefined) {
      textarea.addEventListener('focus', onTermFocus);
      textarea.addEventListener('blur', onTermBlur);
    }
    try { fit.fit(); } catch { /* ignore */ }
    const mac = isMacPlatform();
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown' || mac) return true;
      const key = event.key;
      if (event.altKey || event.metaKey) return true;
      const lower = typeof key === 'string' ? key.toLowerCase() : '';
      if (event.ctrlKey) {
        if (lower === 'c') {
          // Ctrl+C copies when something is selected; without a selection it
          // still reaches the PTY as SIGINT. Ctrl+Shift+C copies too, matching
          // the usual terminal convention.
          if (term.hasSelection()) {
            event.preventDefault();
            event.stopPropagation();
            copySelection();
            return false;
          }
          return true;
        }
        if (key === 'Insert' && !event.shiftKey) {
          if (term.hasSelection()) {
            event.preventDefault();
            event.stopPropagation();
            copySelection();
          }
          return false;
        }
        if (lower === 'v') {
          // Ctrl+Shift+V keeps the browser's native paste path.
          if (event.shiftKey) return true;
          event.preventDefault();
          event.stopPropagation();
          pasteSelection();
          return false;
        }
        return true;
      }
      if (event.shiftKey && key === 'Insert') {
        event.preventDefault();
        event.stopPropagation();
        pasteSelection();
        return false;
      }
      return true;
    });
    let disposed = false;
    let socket = null;
    let retry = 0;
    let retryTimer = null;
    let reconnecting = false;
    const send = (payload) => {
      if (socket !== null && socket.readyState === 1) {
        try { socket.send(JSON.stringify(payload)); } catch { /* ignore */ }
      }
    };
    const connect = () => {
      if (disposed) return;
      const ws = new WebSocket(websocketUrl(WS_PATH));
      socket = ws;
      ws.onopen = () => {
        retry = 0;
        try { fit.fit(); } catch { /* ignore */ }
        send({
          type: 'attach',
          id: terminalId,
          sessionId,
          writer: 'ui',
          cols: term.cols,
          rows: term.rows,
          ...(shellPath === undefined ? {} : { shellPath }),
        });
        if (reconnecting) {
          reconnecting = false;
          term.write('\r\n\x1b[90m[' + String(t === undefined ? 'reconnected' : t('reconnected')) + ']\x1b[0m\r\n');
        }
      };
      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return;
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.type === 'snapshot') {
          term.reset();
          if (typeof msg.data === 'string' && msg.data !== '') term.write(msg.data);
        } else if (msg.type === 'data') {
          term.write(msg.data);
        } else if (msg.type === 'ready') {
          if (typeof msg.title === 'string' && msg.title !== '') setStoredTitle(terminalId, msg.title);
          send({ type: 'resize', cols: term.cols, rows: term.rows });
        } else if (msg.type === 'title') {
          setStoredTitle(terminalId, msg.title);
        } else if (msg.type === 'config') {
          if (msg.config !== undefined) setLock(msg.config);
        } else if (msg.type === 'denied') {
          flashDenied.current();
        } else if (msg.type === 'exit') {
          const text = msg.code === undefined || msg.code === null
            ? (t === undefined ? 'closed' : t('closed'))
            : (t === undefined ? 'exited' : t('exited', { code: msg.code }));
          term.write('\r\n\x1b[90m[' + String(text) + ']\x1b[0m\r\n');
        } else if (msg.type === 'error') {
          const text = t === undefined ? String(msg.message) : t('failed', { message: String(msg.message) });
          term.write('\r\n\x1b[31m[' + String(text) + ']\x1b[0m\r\n');
        }
      };
      ws.onclose = () => {
        if (disposed) return;
        if (socket === ws) socket = null;
        reconnecting = true;
        const delay = Math.min(2000, 250 * Math.pow(2, retry));
        retry += 1;
        retryTimer = setTimeout(connect, delay);
      };
    };
    connect();
    const dataSub = term.onData((data) => {
      // xterm 会自动用 Device Attributes 应答回填 conhost 的查询；Windows 的
      // PowerShell 会把这条应答当成用户输入回显。这里直接过滤掉它。
      const cleaned = String(data).replace(/\x1b\[[?>][0-9;]*c/g, '');
      if (cleaned === '') return;
      send({ type: 'input', data: cleaned });
    });
    const sendSize = () => {
      try { fit.fit(); } catch { /* ignore */ }
      send({ type: 'resize', cols: term.cols, rows: term.rows });
    };
    const ro = new ResizeObserver(sendSize);
    ro.observe(el);
    const onWin = () => sendSize();
    window.addEventListener('resize', onWin);
    return () => {
      disposed = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
      window.removeEventListener('resize', onWin);
      ro.disconnect();
      dataSub.dispose();
      if (socket !== null) {
        try { socket.close(); } catch { /* ignore */ }
      }
      if (textarea !== null && textarea !== undefined) {
        textarea.removeEventListener('focus', onTermFocus);
        textarea.removeEventListener('blur', onTermBlur);
      }
      termRef.current = null;
      fitRef.current = null;
      setTermFocused(false);
      term.dispose();
    };
  }, [terminalId]);
  useEffect(() => {
    if (termFocused !== true) return undefined;
    return beginTerminalPassthrough((keys) => say('shortcut.terminalInput', { keys }));
  }, [termFocused]);
  useEffect(() => {
    const term = termRef.current;
    const el = screenRef.current;
    if (term === null || el === null) return;
    const style = getComputedStyle(el);
    term.options.theme = {
      background: style.backgroundColor,
      foreground: style.color,
      cursor: style.color,
      cursorAccent: style.backgroundColor,
      selectionBackground: style.color,
      selectionForeground: style.backgroundColor,
      selectionInactiveBackground: style.color,
    };
    if (term.options.fontFamily !== fontFamily || term.options.fontSize !== fontSize) {
      term.options.fontFamily = fontFamily;
      term.options.fontSize = fontSize;
      const fit = fitRef.current;
      if (fit !== null) {
        try { fit.fit(); } catch { /* ignore */ }
      }
    }
  }, [appTheme, fontFamily, fontSize]);
  const locked = !(lock !== undefined && lock.allowExternalInput === true);
  const listCount = lock !== undefined && Array.isArray(lock.allowedCommands) ? lock.allowedCommands.length : 0;
  const lockLabel = denied ? say('lock.denied') : locked ? say('lock.readonly') : say('lock.unlocked');
  const lockHint = locked ? say('lock.readonlyHint') : say('lock.unlockedHint');
  const menuItems = menu === null ? [] : [
    { id: 'copy', label: say('copy.menu'), hint: 'Ctrl+C', disabled: menu.hasSelection !== true, run: copySelection },
    { id: 'paste', label: say('copy.paste'), hint: 'Ctrl+V', run: pasteSelection },
    {
      id: 'all',
      label: say('copy.selectAll'),
      run: () => {
        termRef.current?.selectAll();
        termRef.current?.focus();
      },
    },
  ];
  return h('div', { className: 'dft-root' },
    h('div', { ref: screenRef, className: 'dft-screen', onContextMenu: openMenu },
      h('div', { ref: hostRef, className: 'dft-host', 'data-dsh-fast-term': 'true' }),
      h('button', {
        type: 'button',
        className: 'dft-lock',
        'data-locked': locked ? 'true' : 'false',
        'data-denied': denied ? 'true' : 'false',
        title: listCount > 0 ? lockHint + ' · ' + say('lock.whitelist', { count: listCount }) : lockHint,
        'aria-label': lockHint,
        disabled: busy,
        onClick: () => { void toggleLock(); },
      },
      h('span', { className: 'dft-lock-dot', 'aria-hidden': 'true' }),
      lockLabel,
      listCount > 0 ? ' · ' + String(listCount) : null),
      menu === null ? null : h('div', {
        ref: menuRef,
        className: 'dft-ctx',
        role: 'menu',
        style: { left: menu.x + 'px', top: menu.y + 'px' },
        onContextMenu: (event) => { event.preventDefault(); },
      }, menuItems.map((item) => h('button', {
        key: item.id,
        type: 'button',
        role: 'menuitem',
        className: 'dft-ctx-item',
        disabled: item.disabled === true,
        onClick: () => {
          closeMenu();
          item.run();
        },
      },
      h('span', null, item.label),
      item.hint === undefined ? null : h('span', { className: 'dft-ctx-key' }, item.hint)))),
      flash === null ? null : h('div', {
        className: 'dft-flash',
        'data-error': flash.error === true ? 'true' : undefined,
        role: 'status',
      }, flash.text),
    ),
  );
}

function Title({ useTabInfo, t, terminalIdOf: idOf }) {
  ensureCss();
  const { tab } = useTabInfo();
  const terminalId = typeof idOf === 'function' ? idOf(tab) : terminalIdOf(undefined, tab);
  const fallback = t === undefined ? 'Terminal' : t('title');
  const title = useStoredTitle(terminalId, fallback);
  const [editing, setEditing] = useState(false);
  const input = useRef(null);
  const label = useRef(null);
  const cancelled = useRef(false);
  useEffect(() => {
    // A body only learns its title once it attaches; read the host table so
    // parked or inactive tabs still show their shell or renamed title.
    const prefix = terminalId.slice(0, terminalId.lastIndexOf('/') + 1);
    let live = true;
    void fetch(LIST_PATH, { headers: { accept: 'application/json' } })
      .then((response) => (response.ok ? response.json() : undefined))
      .then((body) => {
        if (!live || body === undefined || !Array.isArray(body.terminals)) return;
        for (const entry of body.terminals) {
          if (typeof entry.id !== 'string' || !entry.id.startsWith(prefix)) continue;
          if (typeof entry.title === 'string') setStoredTitle(entry.id, entry.title);
        }
      })
      .catch(() => { /* title stays local */ });
    return () => { live = false; };
  }, [terminalId]);
  useLayoutEffect(() => {
    if (editing) return undefined;
    const chip = label.current === null ? undefined : label.current.closest('[data-dockkit-tab], [data-dockkit-float-grip]');
    const rename = (event) => {
      event.stopPropagation();
      cancelled.current = false;
      setEditing(true);
    };
    if (chip !== undefined && chip !== null) chip.addEventListener('dblclick', rename);
    return () => {
      if (chip !== undefined && chip !== null) chip.removeEventListener('dblclick', rename);
    };
  }, [editing]);
  useLayoutEffect(() => {
    if (!editing) return;
    input.current?.focus();
    input.current?.select();
  }, [editing]);
  const commit = (value) => {
    const next = value.trim();
    if (next === '' || next === title) return;
    setStoredTitle(terminalId, next);
    void fetch(RENAME_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: terminalId, title: next }),
    }).then((response) => response.json().then((body) => {
      if (!response.ok || body === null || body.ok !== true) throw new Error('rename rejected');
      if (typeof body.title === 'string') setStoredTitle(terminalId, body.title);
    })).catch(() => { setStoredTitle(terminalId, title); });
  };
  return h(Fragment, null,
    h(TerminalIcon, {}),
    editing
      ? h('input', {
        ref: input,
        className: 'dft-tab-name',
        defaultValue: title,
        maxLength: 120,
        'aria-label': t === undefined ? 'Terminal name' : t('rename'),
        onPointerDown: (event) => { event.stopPropagation(); },
        onClick: (event) => { event.stopPropagation(); },
        onDoubleClick: (event) => { event.stopPropagation(); },
        onBlur: (event) => {
          setEditing(false);
          if (!cancelled.current) commit(event.currentTarget.value);
        },
        onKeyDown: (event) => {
          event.stopPropagation();
          if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
          if (event.key === 'Escape') {
            cancelled.current = true;
            event.currentTarget.blur();
          } else if (event.key === 'Enter') event.currentTarget.blur();
        },
      })
      : h('span', { ref: label, className: 'dft-tab-title' }, title));
}

const inject = ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs', 'shortcuts', 'theme'];

function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'fast-term: copy');
  const t = ctx.locale.bind(NS);
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: PLUGIN_ID,
    kind: 'fastterm',
    multiple: true,
    keepMounted: true,
    priority: 'builtin',
    title: () => t('title'),
    guide: [{
      id: 'new',
      order: 20,
      title: () => t('new'),
      description: () => t('description'),
      icon: PluginArtworkTerminal,
    }],
  }), 'fast-term: type');
  ctx.effect(() => ctx.shortcuts.register({
    id: 'fastterm.new',
    label: () => t('new'),
    aliases: ['new terminal', 'shell'],
    defaults: {
      'desktop:macos': { code: 'Backquote', modifiers: ['control'] },
      'desktop:windows': { code: 'Backquote', modifiers: ['control'] },
      'desktop:linux': { code: 'Backquote', modifiers: ['control'] },
      'web:macos': { code: 'Backquote', modifiers: ['control'] },
      'web:windows': { code: 'Backquote', modifiers: ['control'] },
    },
    regions: ['page', 'editable', 'terminal'],
    modals: [],
    resolve: ({ target: element }) => {
      const target = ctx.sidebarRight.commandTarget(element);
      if (target === undefined) return { status: 'blocked', reason: t('shortcut.noSession') };
      return {
        status: 'handled',
        run: () => { ctx.sidebarRight.openTabFromTarget('fastterm', target); },
      };
    },
  }), 'fast-term: shortcut');
  ctx.effect(() => {
    setShortcutService(ctx.shortcuts);
    return () => { setShortcutService(undefined); };
  }, 'fast-term: shortcut passthrough');
  ctx.effect(() => {
    if (typeof ctx.sidebarRight.registerCloseHandler !== 'function') return;
    return ctx.sidebarRight.registerCloseHandler('fastterm', (sessionId, tab) => {
      const id = terminalIdOf(sessionId, tab);
      void fetch(CLOSE_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      }).catch(() => { /* ignore */ });
    });
  }, 'fast-term: close');
  const readShellPath = (sessionId, tabId) => {
    try {
      const occurrence = ctx.sidebarRight.tabDomain.occurrence(sessionId, { id: tabId });
      const params = occurrence.navigation.getSnapshot().params;
      return params === undefined || typeof params.shellPath !== 'string' ? undefined : params.shellPath;
    } catch {
      return undefined;
    }
  };
  ctx.effect(() => ctx.slots.inject('sidebar.right.tab.guide.entry', () => ctx.slots.register({
    name: 'sidebar.right.tab.guide.entry',
    key: PLUGIN_ID,
    locale: NS,
    inject: (sessionId) => ({
      hooks: { shortcuts: ctx.shortcuts.catalog },
      loadShells: async (signal) => {
        const response = await fetch(SHELLS_PATH, { signal, headers: { accept: 'application/json' } });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const body = await response.json();
        return body;
      },
      selectShell: (path) => { rememberShell(path); },
      sessionId,
    }),
  }, Guide)), 'fast-term: guide');
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: PLUGIN_ID,
    locale: NS,
    inject: (sessionId) => ({
      hooks: {
        theme: {
          getSnapshot: () => ctx.theme.getTheme(),
          subscribe: (listener) => ctx.on('theme/change', listener),
        },
      },
      readShellPath: (tabId) => readShellPath(sessionId, tabId),
    }),
  }, Body)), 'fast-term: body');
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab.title',
    key: PLUGIN_ID,
    locale: NS,
    inject: (sessionId) => ({
      t,
      terminalIdOf: (tab) => terminalIdOf(sessionId, tab),
    }),
  }, Title)), 'fast-term: title');
}

export { apply, inject };
