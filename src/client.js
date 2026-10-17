import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import xtermCss from '@xterm/xterm/css/xterm.css';
import { createElement as h, useEffect, useRef } from 'react';

const NS = 'fastTerm';
const PLUGIN_ID = 'dsh-fast-term';
const STYLE_ID = 'dsh-fast-term-style';
const WS_PATH = '/api/dsh-fast-term/ws';
const CLOSE_PATH = '/api/dsh-fast-term/close';
const CSS = `
.dft-root{box-sizing:border-box;height:100%;min-height:0;flex:1;display:flex;flex-direction:column;padding:6px 8px 0;background:var(--dsw-alias-bg-layer-1);}
.dft-host{position:relative;flex:1;min-height:0;}
.dft-host .xterm{height:100%;}
.dft-host .xterm-viewport{overflow-y:auto;}
.dft-guide{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsl-guide-entry-radius);background:var(--dsw-alias-bg-layer-1);width:100%;}
.dft-guide-btn{all:unset;box-sizing:border-box;display:flex;flex-direction:column;gap:3px;width:100%;padding:14px 20px;cursor:pointer;border-radius:inherit;}
.dft-guide-btn:focus-visible{outline-offset:-2px;outline:2px solid var(--dsw-alias-border-l2);}
.dft-guide-title{color:var(--dsw-alias-label-primary);font-size:14px;line-height:1.4;}
.dft-guide-desc{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.4;}
`;

function ensureCss() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS + '\n' + xtermCss;
  document.head.appendChild(style);
}

const zh = {
  title: '终端',
  description: '专用 PTY 直连，无帧确认，输入到回显最短',
  guideNew: '新建终端',
  guideDesc: '在会话工作区运行命令',
  'shortcut.noSession': '先在会话中打开终端',
};

const en = {
  title: 'Terminal',
  description: 'Dedicated PTY link without frame acknowledgement',
  guideNew: 'New terminal',
  guideDesc: 'Run commands in the session workspace',
  'shortcut.noSession': 'Open a terminal inside a session first',
};

function Guide({ title, description, useTabInfo }) {
  ensureCss();
  const { tab } = useTabInfo();
  return h('div', { className: 'dft-guide', 'data-sidebar-right-guide-entry': 'fastterm' },
    h('button', {
      className: 'dft-guide-btn',
      type: 'button',
      'aria-label': description === undefined ? title : `${title} ${description}`,
      onClick: () => tab.actions.openTab('fastterm', { replaceTab: true }),
    },
      h('span', { className: 'dft-guide-title' }, title ?? 'Fast Terminal'),
      description === undefined ? null : h('span', { className: 'dft-guide-desc' }, description),
    ),
  );
}

function terminalIdOf(sessionId, tab) {
  const tabId = tab !== undefined && tab !== null && tab.id !== undefined ? String(tab.id) : 'default';
  return String(sessionId ?? '') + '/' + tabId;
}

function Body(props) {
  ensureCss();
  const { sessionId, useTabInfo } = props;
  const info = typeof useTabInfo === 'function' ? useTabInfo() : undefined;
  const tab = info === undefined ? undefined : info.tab;
  const terminalId = terminalIdOf(sessionId, tab);
  const hostRef = useRef(null);
  useEffect(() => {
    const el = hostRef.current;
    if (el === null) return undefined;
    const term = new Terminal({
      fontFamily: 'Consolas, "Cascadia Mono", "Courier New", monospace',
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    try { fit.fit(); } catch { /* ignore */ }
    let disposed = false;
    let socket = null;
    let retry = 0;
    let retryTimer = null;
    let reconnecting = false;
    const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    const send = (payload) => {
      if (socket !== null && socket.readyState === 1) {
        try { socket.send(JSON.stringify(payload)); } catch { /* ignore */ }
      }
    };
    const connect = () => {
      if (disposed) return;
      const ws = new WebSocket(proto + location.host + WS_PATH);
      socket = ws;
      ws.onopen = () => {
        retry = 0;
        try { fit.fit(); } catch { /* ignore */ }
        send({ type: 'attach', id: terminalId, sessionId, cols: term.cols, rows: term.rows });
        if (reconnecting) {
          reconnecting = false;
          term.write('\r\n\x1b[90m[已重新连接]\x1b[0m\r\n');
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
          send({ type: 'resize', cols: term.cols, rows: term.rows });
        } else if (msg.type === 'exit') {
          term.write('\r\n\x1b[90m[进程已退出]\x1b[0m\r\n');
        } else if (msg.type === 'error') {
          term.write('\r\n\x1b[31m[错误: ' + String(msg.message) + ']\x1b[0m\r\n');
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
      term.dispose();
    };
  }, [terminalId]);
  return h('div', { className: 'dft-root' },
    h('div', { ref: hostRef, className: 'dft-host', 'data-dsh-fast-term': 'true' }),
  );
}

function Title({ t }) {
  ensureCss();
  return h('span', null, t === undefined ? '终端' : t('title'));
}

const inject = ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs', 'shortcuts'];

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
      order: 21,
      title: () => t('guideNew'),
      description: () => t('guideDesc'),
    }],
  }), 'fast-term: type');
  ctx.effect(() => ctx.shortcuts.register({
    id: 'fastterm.new',
    label: () => t('guideNew'),
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
  ctx.effect(() => ctx.slots.inject('sidebar.right.tab.guide.entry', () => ctx.slots.register({
    name: 'sidebar.right.tab.guide.entry',
    key: PLUGIN_ID,
    locale: NS,
    inject: () => ({}),
  }, Guide)), 'fast-term: guide');
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: PLUGIN_ID,
    locale: NS,
    inject: () => ({}),
  }, Body)), 'fast-term: body');
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab.title',
    key: PLUGIN_ID,
    locale: NS,
    inject: () => ({ t }),
  }, Title)), 'fast-term: title');
}

export { apply, inject };
