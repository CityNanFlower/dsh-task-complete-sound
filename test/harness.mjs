/**
 * Shared test harness for dsh-task-complete-sound.
 *
 * Evaluates the real lib/client.js in a stubbed browser environment (no
 * browser, no network, no audio) and hands back the handles the tests need:
 * the notifications the plugin fired, a way to publish pending-interaction
 * snapshots, a way to feed mux SSE frames, the captured settings-card
 * component, and a controllable clock for the 800 ms debounce.
 */
import { readFileSync } from 'node:fs';

export const SRC = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

/**
 * @param {object|null} config stored config document (the localStorage view)
 * @param {object} [env] overrides: visible, focused, permission, stateQueue
 * @returns {object} test handles
 */
export function boot(config, env = {}) {
  const notifications = [];
  const store = new Map();
  if (config) store.set('dsh.taskCompleteSound.v1', JSON.stringify(config));

  const visible = env.visible !== false;
  const focused = env.focused !== false;

  const doc = {
    visibilityState: visible ? 'visible' : 'hidden',
    hasFocus: () => focused,
    title: 'DSH',
    addEventListener() {},
    removeEventListener() {},
    getElementById: () => null,
    createElement: () => ({ id: '', textContent: '', style: {} }),
    head: { appendChild() {} },
  };

  let captured = null;
  const win = {
    __ModuleLoader__: { load: (spec) => { captured = spec; } },
    setTimeout: () => 0,
    clearTimeout() {},
    setInterval: () => 0,
    clearInterval() {},
    addEventListener() {},
    removeEventListener() {},
    focus() {},
  };

  class FakeNotification {
    constructor(title, options) {
      notifications.push({ title, body: options && options.body, tag: options && options.tag });
    }
    close() {}
    static permission = env.permission || 'granted';
    static requestPermission() { return Promise.resolve(FakeNotification.permission); }
  }

  class FakeEventSource {
    constructor(url) { this.url = url; FakeEventSource.last = this; }
    close() {}
    static last = null;
  }

  const globals = {
    window: win,
    document: doc,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, v),
      removeItem: (k) => store.delete(k),
    },
    navigator: { language: 'zh-CN' },
    Notification: FakeNotification,
    EventSource: FakeEventSource,
    AudioContext: undefined,
    webkitAudioContext: undefined,
  };
  const saved = {};
  for (const key of Object.keys(globals)) {
    saved[key] = Object.getOwnPropertyDescriptor(globalThis, key);
    // navigator is a getter-only accessor on modern Node: redefine, don't assign.
    Object.defineProperty(globalThis, key, { value: globals[key], configurable: true, writable: true });
  }

  // Controllable clock: the waiting debounce is 800 ms of wall time.
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;

  new Function(SRC)();
  if (!captured) throw new Error('client.js did not call window.__ModuleLoader__.load');

  const statusListeners = new Set();
  let snapshot = new Map();
  const sessions = {
    list: {
      getSnapshot: () => ({ phase: 'ready', ids: [], byId: {}, current: undefined }),
      subscribe: () => () => {},
    },
    binding: () => undefined,
  };
  let card = null;
  const ctx = {
    effect: (fn) => { try { return fn(); } catch (e) { return () => {}; } },
    sessions,
    slots: {
      inject(_name, factory) { try { factory(); } catch (e) { /* group absent */ } },
      register(_spec, component) { card = component; return () => {}; },
    },
    uiSession: {
      sessionStatus: {
        subscribe(fn) { statusListeners.add(fn); return () => statusListeners.delete(fn); },
        getSnapshot() { return snapshot; },
      },
    },
    uiWorkspace: { openSession() {} },
    remote: {},
  };

  // Minimal React face: plain element objects plus a state queue so a test can
  // render the expanded settings card without a DOM.
  const queue = env.stateQueue ? env.stateQueue.slice() : [];
  const reactStub = {
    createElement(type, props) {
      const children = Array.prototype.slice.call(arguments, 2);
      return { __el: true, type, props: props || {}, children };
    },
    useState(init) { return [queue.length > 0 ? queue.shift() : init, () => {}]; },
    useSyncExternalStore() { return 0; },
  };

  const mod = captured.factory((id) => {
    if (id === 'react') return reactStub;
    throw new Error('unexpected require: ' + id);
  });
  mod.apply(ctx);

  return {
    notifications,
    card,
    /** Publish one status snapshot and notify the watcher. */
    push(entries) {
      snapshot = new Map(entries.map(([id, status]) => [id, status]));
      for (const fn of statusListeners) fn();
    },
    /** Feed one mux SSE frame (completion path). */
    mux(payload) {
      if (FakeEventSource.last && FakeEventSource.last.onmessage) {
        FakeEventSource.last.onmessage({ data: JSON.stringify(payload) });
      }
    },
    advance(ms) { now += ms; },
    restore() {
      Date.now = realNow;
      for (const key of Object.keys(globals)) {
        if (saved[key]) Object.defineProperty(globalThis, key, saved[key]);
        else delete globalThis[key];
      }
    },
  };
}

/** Flatten a stubbed React element tree into its rendered text. */
export function renderText(node) {
  if (node === null || node === void 0 || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(renderText).join('');
  if (node.__el) {
    let out = renderText(node.children);
    if (node.props && node.props.children !== void 0) out += renderText(node.props.children);
    return out;
  }
  return '';
}
