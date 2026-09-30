/**
 * dsh-task-complete-sound - browser half.
 *
 * Plays a synthesized notification cue whenever an agent "task" finishes while
 * this GUI page is open, with per-event classification (v0.2.0):
 *   - turnEnd        a session's turn ends normally (mux `turn/end`, reason
 *                    `completed` / `max-tokens` / `blocked`; `aborted` /
 *                    `interrupted` / `forked` stay silent - user-driven or
 *                    synthetic closers);
 *   - error          a turn ends with reason `error`;
 *   - backgroundDone a session flips to the host's `completed` flag while not
 *                    selected (the sidebar's green "done" reminder);
 *   - approval       a session raises a pending approval interaction
 *                    (observed through uiSession.sessionStatus) - always
 *                    audible regardless of the only-when-hidden gate, and
 *                    exempt from the debounce merge.
 *
 * Optional desktop notifications (Notification API) with click-to-jump:
 * clicking one focuses the window and opens the owning session through
 * uiWorkspace.openSession when that service is available.
 *
 * Burst handling: completions arriving inside the minInterval window after a
 * sound are swallowed; two or more swallowed completions produce one merged
 * notification instead of a sound storm.
 *
 * Sounds are synthesized with the Web Audio API (no asset, no network).
 * Configuration lives in localStorage (key dsh.taskCompleteSound.v1) and is
 * editable through the Web UI plugin group's settings card (Settings -> Web
 * UI plugins -> 任务完成提示音).
 *
 * Failure policy: everything is best-effort and never throws - a sound plugin
 * must not take the web shell down (the shell fails boot when an apply
 * throws).
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-task-complete-sound',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    var react = require('react');

    /** localStorage key for the configuration document. */
    var STORAGE_KEY = 'dsh.taskCompleteSound.v1';
    /** Composition defaults; a stored document is merged over these. */
    var DEFAULTS = {
      enabled: true,
      /** Legacy single-sound choice (pre-0.2.0); migrated onto sounds.turnEnd. */
      sound: 'chime',
      /** Per-event-class sound mapping; each value is a key of SOUND_OPTIONS. */
      sounds: { turnEnd: 'chime', backgroundDone: 'ding', approval: 'bubble', error: 'error' },
      volume: 0.6,
      onlyWhenHidden: false,
      notifyDesktop: false,
      /** Skip the OS banner while the page is in the foreground (sound/flash still fire). */
      notifyOnlyHidden: true,
      skipCurrentTurnEnd: false,
      /** Flash the tab title while an event fires in a hidden tab. */
      flashTitle: true,
      /** Title substrings muting one session's completion cues. */
      mutedKeywords: [],
      quietEnabled: false,
      quietStart: '23:00',
      quietEnd: '08:00',
      minIntervalMs: 1500,
      debug: false
    };
    /** Every selectable sound kind; 'none' silences one event class. */
    var SOUND_OPTIONS = ['chime', 'ding', 'bell', 'bubble', 'shimmer', 'error', 'woodblock', 'none'];
    /** Event classes exposed in the settings card, in display order. */
    var EVENT_FIELDS = ['turnEnd', 'backgroundDone', 'approval', 'error'];

    function isSoundKind(v) {
      return v === 'chime' || v === 'ding' || v === 'bell' || v === 'woodblock' || v === 'bubble' || v === 'shimmer' || v === 'error' || v === 'none';
    }

    // ------------------------------------------------------------ config
    /** Read the stored config merged over defaults. Never throws. */
    function readConfig() {
      var merged = Object.assign({}, DEFAULTS);
      merged.sounds = Object.assign({}, DEFAULTS.sounds);
      try {
        var raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          var parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            for (var key in DEFAULTS) {
              if (key === 'sounds' || key === 'mutedKeywords') continue;
              if (parsed[key] !== void 0) merged[key] = parsed[key];
            }
            if (Array.isArray(parsed.mutedKeywords)) {
              merged.mutedKeywords = parsed.mutedKeywords.filter(function (s) {
                return typeof s === 'string' && s.trim() !== '';
              });
            }
            if (parsed.sounds && typeof parsed.sounds === 'object') {
              for (var k in DEFAULTS.sounds) {
                if (typeof parsed.sounds[k] === 'string' && isSoundKind(parsed.sounds[k])) {
                  merged.sounds[k] = parsed.sounds[k];
                }
              }
            }
          }
        }
      } catch (e) { /* storage unavailable -> defaults */ }
      return merged;
    }
    function writeConfig(cfg) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); } catch (e) {}
    }

    /** Merge a stored document (host view value) into a fresh defaults object. */
    function mergeStored(merged, doc) {
      if (!doc || typeof doc !== 'object') return merged;
      for (var key in DEFAULTS) {
        if (key === 'sounds' || key === 'mutedKeywords') continue;
        if (doc[key] !== void 0) merged[key] = doc[key];
      }
      if (Array.isArray(doc.mutedKeywords)) {
        merged.mutedKeywords = doc.mutedKeywords.filter(function (s) {
          return typeof s === 'string' && s.trim() !== '';
        });
      }
      if (doc.sounds && typeof doc.sounds === 'object') {
        for (var k in DEFAULTS.sounds) {
          if (typeof doc.sounds[k] === 'string' && isSoundKind(doc.sounds[k])) {
            merged.sounds[k] = doc.sounds[k];
          }
        }
      }
      return merged;
    }

    // ------------------------------------------------ host config sync
    /** Settings namespace candidates: profile entry id first, then package name. */
    var ENTRY_NS = ['task-complete-sound', '@local/dsh-task-complete-sound'];
    var hostSettings = null;
    var hostNs = null;

    /** Normalize a remote answer: typert envelope {ok,value} or a bare value. */
    function unwrapRemote(res) {
      if (res && typeof res === 'object' && ('ok' in res)) {
        return res.ok ? { ok: true, value: res.value } : { ok: false, value: null };
      }
      return { ok: true, value: res };
    }

    /** The config fields persisted to the host, in schema shape. */
    function patchOf(cfg) {
      return {
        enabled: cfg.enabled !== false,
        sounds: {
          turnEnd: soundFor(cfg, 'turnEnd'),
          backgroundDone: soundFor(cfg, 'backgroundDone'),
          approval: soundFor(cfg, 'approval'),
          error: soundFor(cfg, 'error'),
        },
        volume: typeof cfg.volume === 'number' ? cfg.volume : DEFAULTS.volume,
        onlyWhenHidden: cfg.onlyWhenHidden === true,
        notifyDesktop: cfg.notifyDesktop === true,
        notifyOnlyHidden: cfg.notifyOnlyHidden !== false,
        skipCurrentTurnEnd: cfg.skipCurrentTurnEnd === true,
        flashTitle: cfg.flashTitle !== false,
        quietEnabled: cfg.quietEnabled === true,
        quietStart: typeof cfg.quietStart === 'string' ? cfg.quietStart : DEFAULTS.quietStart,
        quietEnd: typeof cfg.quietEnd === 'string' ? cfg.quietEnd : DEFAULTS.quietEnd,
        minIntervalMs: typeof cfg.minIntervalMs === 'number' ? cfg.minIntervalMs : DEFAULTS.minIntervalMs,
        mutedKeywords: Array.isArray(cfg.mutedKeywords) ? cfg.mutedKeywords : [],
        debug: cfg.debug === true,
      };
    }

    /** Fire-and-forget write of the config into the host settings namespace. */
    function hostWrite(cfg) {
      try {
        if (!hostSettings || hostNs === null || typeof hostSettings.update !== 'function') return;
        var ns = hostNs;
        Promise.resolve(hostSettings.update(ns, patchOf(cfg), void 0)).then(function (res) {
          var u = unwrapRemote(res);
          if (!u.ok) log('host settings update refused for ns=', ns);
        }).catch(function (e) { log('host settings update threw:', String(e)); });
      } catch (e) { log('host settings write unavailable:', String(e)); }
    }

    /** Boot-time adopt/seed: a host user section wins; otherwise seed from this browser. */
    function hostReadSync() {
      try {
        if (!hostSettings || typeof hostSettings.describe !== 'function') return;
        Promise.resolve(hostSettings.describe()).then(function (res) {
          var u = unwrapRemote(res);
          if (!u.ok) { log('host settings describe refused'); return; }
          var views = u.value && Array.isArray(u.value.namespaces) ? u.value.namespaces : [];
          var view = null;
          for (var i = 0; i < ENTRY_NS.length && view === null; i++) {
            for (var j = 0; j < views.length; j++) {
              if (views[j] && views[j].ns === ENTRY_NS[i]) { view = views[j]; break; }
            }
          }
          if (!view) { log('host settings: no namespace registered for this plugin'); return; }
          hostNs = view.ns;
          var hasUser = !!(view.user && typeof view.user === 'object' && Object.keys(view.user).length > 0);
          if (hasUser) {
            var merged = Object.assign({}, DEFAULTS);
            merged.sounds = Object.assign({}, DEFAULTS.sounds);
            merged.mutedKeywords = [];
            mergeStored(merged, view.value);
            setCurrentConfig(merged);
            writeConfig(merged);
            info('config adopted from host settings (ns=' + view.ns + ')');
          } else {
            hostWrite(currentConfig);
            info('host settings seeded from this browser (ns=' + view.ns + ')');
          }
        }).catch(function (e) { log('host settings describe threw:', String(e)); });
      } catch (e) { log('host settings unavailable:', String(e)); }
    }

    // ------------------------------------------------------- title flash
    var titleFlash = { timer: null, base: null };
    function stopTitleFlash() {
      try {
        if (titleFlash.timer !== null) {
          window.clearInterval(titleFlash.timer);
          titleFlash.timer = null;
          if (titleFlash.base !== null) document.title = titleFlash.base;
          titleFlash.base = null;
        }
      } catch (e) {}
    }
    function startTitleFlash(marker) {
      try {
        if (!getConfig().flashTitle) return;
        if (document.visibilityState !== 'hidden') return;
        if (titleFlash.timer !== null) return; // already flashing
        titleFlash.base = document.title;
        // Set the marker synchronously: a hidden tab's timers are throttled
        // (1/min after ~5 min), so waiting for the first tick made the flash
        // look like it never fired.
        var on = true;
        try { document.title = marker + ' ' + titleFlash.base; } catch (e) {}
        titleFlash.timer = window.setInterval(function () {
          on = !on;
          try { document.title = on ? marker + ' ' + titleFlash.base : titleFlash.base; } catch (e) {}
        }, 900);
      } catch (e) {}
    }
    try {
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') stopTitleFlash();
      });
      window.addEventListener('focus', stopTitleFlash);
      window.addEventListener('beforeunload', stopTitleFlash);
    } catch (e) {}

    /** Resolve the configured sound kind for one event class. */
    function soundFor(cfg, kind) {
      var m = cfg && cfg.sounds && typeof cfg.sounds === 'object' ? cfg.sounds : null;
      var v = m ? m[kind] : void 0;
      if (typeof v === 'string' && isSoundKind(v)) return v;
      // Legacy migration: the pre-0.2.0 single choice seeds the turn-end class.
      if (kind === 'turnEnd' && cfg && typeof cfg.sound === 'string' && isSoundKind(cfg.sound)) {
        return cfg.sound;
      }
      return DEFAULTS.sounds[kind];
    }

    /**
     * Whether the configured quiet-hours window covers "now". An empty or
     * malformed window never mutes; equal start/end means the whole day.
     */
    function isQuietNow() {
      try {
        var cfg = getConfig();
        if (!cfg.quietEnabled) return false;
        var parse = function (s) {
          if (typeof s !== 'string') return NaN;
          var m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
          if (!m) return NaN;
          var hh = Number(m[1]), mm = Number(m[2]);
          if (hh > 23 || mm > 59) return NaN;
          return hh * 60 + mm;
        };
        var a = parse(cfg.quietStart), b = parse(cfg.quietEnd);
        if (isNaN(a) || isNaN(b)) return false;
        var now = new Date();
        var cur = now.getHours() * 60 + now.getMinutes();
        if (a === b) return true;
        if (a < b) return cur >= a && cur < b;
        return cur >= a || cur < b; // overnight wrap (e.g. 23:00 -> 08:00)
      } catch (e) { return false; }
    }

    /** Module-level current config: the watcher reads this live. */
    var currentConfig = readConfig();
    var configVersion = 0;
    var configListeners = [];
    function setCurrentConfig(cfg) {
      currentConfig = cfg;
      configVersion += 1;
      for (var i = 0; i < configListeners.length; i++) configListeners[i]();
    }
    function getConfig() { return currentConfig; }
    function subscribeConfig(fn) {
      configListeners.push(fn);
      return function () {
        var idx = configListeners.indexOf(fn);
        if (idx !== -1) configListeners.splice(idx, 1);
      };
    }
    function getConfigVersion() { return configVersion; }

    // ------------------------------------------------------ sound engine
    var audioCtx = null;
    var unlockCleanups = [];
    function ensureAudio() {
      if (audioCtx === null) {
        try {
          var Ctor = window.AudioContext || window.webkitAudioContext;
          if (!Ctor) return null;
          audioCtx = new Ctor();
        } catch (e) { return null; }
      }
      if (audioCtx.state === 'suspended') {
        try { audioCtx.resume().catch(function () {}); } catch (e) {}
      }
      return audioCtx;
    }
    /** Pre-unlock audio on the first user gesture (autoplay policy). */
    function armAudioUnlock() {
      if (unlockCleanups.length > 0) return;
      var events = ['pointerdown', 'keydown', 'touchstart'];
      var unlock = function () {
        ensureAudio();
        for (var i = 0; i < unlockCleanups.length; i++) unlockCleanups[i]();
        unlockCleanups = [];
      };
      for (var i = 0; i < events.length; i++) {
        document.addEventListener(events[i], unlock, { once: true, passive: true });
      }
      unlockCleanups.push(function () {
        for (var j = 0; j < events.length; j++) {
          document.removeEventListener(events[j], unlock);
        }
      });
    }

    /** One oscillator tone with a soft attack and exponential decay. */
    function tone(ctx, dest, freq, start, dur, peak) {
      var t0 = ctx.currentTime + start;
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain);
      gain.connect(dest);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    }

    /** Synthesize one notification sound. Never throws. */
    function playSound(kind, volume) {
      try {
        if (kind === 'none') return;
        var ctx = ensureAudio();
        if (ctx === null) return;
        var v = Math.max(0, Math.min(1, typeof volume === 'number' ? volume : DEFAULTS.volume));
        var master = ctx.createGain();
        master.gain.value = Math.max(v, 0.001) * 0.9;
        master.connect(ctx.destination);
        var kindKey = isSoundKind(kind) ? kind : 'chime';
        if (kindKey === 'woodblock') {
          // Woodblock: two crisp percussive knocks. Tonal (triangle wave
          // with a fast pitch settle) but sharp - replaces the ocean-wave
          // noise swell, which tested poorly.
          var kAt = [0, 0.16];
          var kHz = [980, 740];
          for (var ki = 0; ki < kAt.length; ki++) {
            var tkw = ctx.currentTime + kAt[ki];
            var wOsc = ctx.createOscillator();
            var wG = ctx.createGain();
            wOsc.type = 'triangle';
            wOsc.frequency.setValueAtTime(kHz[ki] * 1.35, tkw);
            wOsc.frequency.exponentialRampToValueAtTime(kHz[ki], tkw + 0.02);
            wG.gain.setValueAtTime(0.0001, tkw);
            wG.gain.exponentialRampToValueAtTime(0.65, tkw + 0.006);
            wG.gain.exponentialRampToValueAtTime(0.0001, tkw + 0.1);
            wOsc.connect(wG);
            wG.connect(master);
            wOsc.start(tkw);
            wOsc.stop(tkw + 0.14);
          }
        } else if (kindKey === 'bubble') {
          // Bubbles: quick rising blips, each popping a little higher.
          var bFreqs = [350, 480, 640, 840, 1080];
          for (var bi = 0; bi < bFreqs.length; bi++) {
            var tb = ctx.currentTime + bi * 0.11;
            var bOsc = ctx.createOscillator();
            var bGain = ctx.createGain();
            bOsc.type = 'sine';
            bOsc.frequency.setValueAtTime(bFreqs[bi], tb);
            bOsc.frequency.exponentialRampToValueAtTime(bFreqs[bi] * 1.5, tb + 0.06);
            bGain.gain.setValueAtTime(0.0001, tb);
            bGain.gain.exponentialRampToValueAtTime(0.7, tb + 0.012);
            bGain.gain.exponentialRampToValueAtTime(0.0001, tb + 0.1);
            bOsc.connect(bGain);
            bGain.connect(master);
            bOsc.start(tb);
            bOsc.stop(tb + 0.14);
          }
        } else if (kindKey === 'shimmer') {
          // Sea shimmer: rising C-major arpeggio (C6-E6-G6-C7), bright and
          // quick - replaces the whale glide, which tested poorly.
          tone(ctx, master, 1046.5, 0, 0.45, 0.42);
          tone(ctx, master, 1318.5, 0.09, 0.45, 0.4);
          tone(ctx, master, 1568.0, 0.18, 0.5, 0.38);
          tone(ctx, master, 2093.0, 0.27, 0.7, 0.36);
        } else if (kindKey === 'ding') {
          tone(ctx, master, 1046.5, 0, 0.6, 0.65);
        } else if (kindKey === 'bell') {
          // Lighthouse bell: bright partial plus a fifth below, long decay.
          tone(ctx, master, 1318.5, 0, 0.9, 0.45);
          tone(ctx, master, 987.77, 0.06, 0.8, 0.3);
        } else if (kindKey === 'error') {
          // Storm alert: the old descending pair lifted an octave so it cuts
          // through instead of rumbling under the mix.
          tone(ctx, master, 659.3, 0, 0.18, 0.6);
          tone(ctx, master, 440.0, 0.16, 0.35, 0.6);
        } else {
          tone(ctx, master, 880, 0, 0.3, 0.55);
          tone(ctx, master, 587.33, 0.18, 0.55, 0.5);
        }
      } catch (e) { /* audio must never break the app */ }
    }

    // ---------------------------------------------------- session watcher
    /**
     * Watch for task-completion signals and play a classified cue.
     *
     * Four independent signals, so a completion is never missed:
     *   1. mux SSE events - authoritative `turn/end` with its end reason
     *      (primary channel);
     *   2. uiSession.sessionStatus - pending approval interactions;
     *   3. list rows flipping `running`/`completed` (fallback when SSE dies);
     *   4. the current session's conversation snapshot running/turnEnds edge.
     * Diagnostics are logged to the console so a failure is easy to trace.
     * @param sessions - ctx.sessions (the ISessions service).
     * @param uiSession - ctx.uiSession (approval status source), may be null.
     * @returns a disposer.
     */
    /** Debug logging: only when the config's `debug` flag is on. */
    function log() {
      try {
        if (!getConfig().debug) return;
        var args = ['[dsh-task-complete-sound]'];
        for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
        console.log.apply(console, args);
      } catch (e) {}
    }
    /** Always-on one-liners (armed / played) so the user can confirm it works. */
    function info() {
      try {
        var args = ['[dsh-task-complete-sound]'];
        for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
        console.log.apply(console, args);
      } catch (e) {}
    }

    /** Session display titles, refreshed from list rows by every scan. */
    var titleById = new Map();
    function displayTitleOf(id) {
      var t = id !== void 0 && id !== null ? titleById.get(id) : null;
      return t || tr('notifyGenericName');
    }

    /** Whether a session's completion cues are muted by a title keyword. */
    function isSessionMuted(sessionId) {
      try {
        var cfg = getConfig();
        var kws = Array.isArray(cfg.mutedKeywords) ? cfg.mutedKeywords : [];
        if (kws.length === 0 || sessionId === void 0 || sessionId === null) return false;
        var title = titleById.get(sessionId);
        if (typeof title !== 'string' || title === '') return false;
        var t = title.toLowerCase();
        for (var i = 0; i < kws.length; i++) {
          var kw = typeof kws[i] === 'string' ? kws[i].trim().toLowerCase() : '';
          if (kw !== '' && t.indexOf(kw) !== -1) return true;
        }
        return false;
      } catch (e) { return false; }
    }

    /** Captured at apply time; opens a session on notification click. */
    var openSessionFn = null;
    /** One-shot diagnostics for the desktop-notification permission state. */
    var notifyPermissionDenied = false;
    /** How the most recent completion event was handled (for the card). */
    var lastGate = null;

    /** True when the OS banner should be withheld right now:
     * "banners only when hidden" is on AND the page is focused+visible. */
    function bannerSuppressed(cfg) {
      try {
        if (cfg.notifyOnlyHidden === false) return false;
        return document.visibilityState === 'visible' && document.hasFocus();
      } catch (e) { return false; }
    }

    // ------------------------------------------------ event source classify
    /** ctx.remote face (set in apply) used for the schedule catalog RPC. */
    var remoteFace = null;
    /** sessionId -> active automation task title (from the schedule catalog). */
    var scheduleTitles = new Map();
    /** True once one catalog call has succeeded; gates automation labeling. */
    var scheduleCatalogOk = false;
    /** sessionId -> timestamp of the latest mux turn/start. */
    var turnStartAtById = new Map();

    /** Fire-and-forget refresh of the automation (schedule) task catalog.
     * The schedule face comes from an optional plugin; touching it without
     * the matching inject THROWS, so the first probe that throws permanently
     * drops the face (automation labeling degrades to main/subagent only). */
    function refreshScheduleCatalog() {
      if (!remoteFace) return;
      var face = null;
      try {
        face = remoteFace.schedule;
      } catch (eGetter) {
        log('remote.schedule getter threw (optional service not injected) -> automation source detection disabled:', String(eGetter));
        remoteFace = null;
        return;
      }
      try {
        if (!face || typeof face.catalog !== 'function') return;
        var res = face.catalog();
        var fail = function (e) { log('schedule catalog failed:', String(e)); };
        var done = function (value) {
          try {
            var unwrapped = unwrapRemote(value);
            if (!unwrapped.ok || !Array.isArray(unwrapped.value)) return;
            scheduleTitles.clear();
            for (var i = 0; i < unwrapped.value.length; i++) {
              var entry = unwrapped.value[i];
              if (!entry || typeof entry.sessionId !== 'string') continue;
              if (entry.status !== void 0 && entry.status !== 'active') continue;
              scheduleTitles.set(entry.sessionId, typeof entry.title === 'string' ? entry.title : '');
            }
            scheduleCatalogOk = true;
            log('schedule catalog:', scheduleTitles.size, 'active task(s)');
          } catch (e2) { log('schedule catalog digest threw:', String(e2)); }
        };
        if (res && typeof res.then === 'function') { res.then(done, fail); } else { done(res); }
      } catch (e) { log('schedule catalog threw:', String(e)); }
    }

    /**
     * Fire one desktop notification. Returns the outcome as a status string
     * ('sent' | 'no-api' | 'not-granted' | 'error: ...') so the in-card test
     * can tell the user exactly which layer swallowed it; regular callers
     * ignore the return value.
     */
    function showNotification(title, body, sessionId) {
      try {
        if (typeof Notification === 'undefined') return 'no-api';
        if (Notification.permission !== 'granted') return 'not-granted';
        var n;
        try {
          // A FIXED tag makes Chromium treat every later notification as a
          // silent replacement: it only updates the Win+N entry and does NOT
          // pop a new banner (the ctor path has no renotify). Bucket the tag
          // by a 2s window instead: rapid repeats still collapse into one
          // toast, but every new event gets its own banner.
          n = new Notification(title, {
            body: body,
            tag: 'dsh-tcs-' + Math.floor(Date.now() / 2000),
            silent: true
          });
        } catch (eCtor) {
          // e.g. Windows notifications disabled for the whole browser.
          return 'error: ' + String(eCtor && eCtor.message || eCtor);
        }
        n.onclick = function () {
          try { window.focus(); } catch (e) {}
          try { if (sessionId && openSessionFn) openSessionFn(sessionId); } catch (e) {}
          try { n.close(); } catch (e) {}
        };
        return 'sent';
      } catch (e) { return 'error: ' + String(e && e.message || e); }
    }

    function fill(template, name, count) {
      var s = template;
      if (name !== null && name !== void 0) s = s.split('{name}').join(name);
      if (count !== void 0) s = s.split('{n}').join(String(count));
      return s;
    }

    /** Source tag for notification titles: 【主会话】 / 【子代理】 / 【自动化任务】. */
    function sourcePrefix(src) {
      var label = src === 'subagent' ? tr('srcSubagent') : src === 'automation' ? tr('srcAutomation') : tr('srcMain');
      return tr('sourcePrefixFmt').split('{src}').join(label);
    }

    /** Bare source label for the gate line. */
    function sourceLabel(src) {
      return src === 'subagent' ? tr('srcSubagent') : src === 'automation' ? tr('srcAutomation') : tr('srcMain');
    }

    /**
     * Fire the desktop notification for one classified event (best effort).
     * Requests permission lazily on the 'default' state; the next event
     * delivers once the user grants it.
     */
    function maybeNotify(kind, detail, hiddenGated, src) {
      try {
        var cfg = getConfig();
        if (!cfg.notifyDesktop) return;
        if (hiddenGated) return;
        if (typeof Notification === 'undefined') {
          if (!notifyPermissionDenied) {
            notifyPermissionDenied = true;
            info('desktop notification: Notification API unavailable on this origin (non-localhost http?)');
          }
          return;
        }
        if (Notification.permission === 'default') {
          info('desktop notification: requesting permission; this event is skipped, the next one delivers');
          try { Notification.requestPermission().catch(function () {}); } catch (e) {}
          return;
        }
        if (Notification.permission !== 'granted') {
          if (!notifyPermissionDenied) {
            notifyPermissionDenied = true;
            info('desktop notification: permission denied in this browser - notifications stay silent until the site permission is granted');
          }
          return;
        }
        var name = detail && detail.title ? detail.title : (detail && detail.sessionId ? displayTitleOf(detail.sessionId) : tr('notifyGenericName'));
        var title, body;
        if (kind === 'backgroundDone') {
          title = tr('notifyBgDoneTitle'); body = fill(tr('notifyBgDoneBody'), name);
        } else if (kind === 'approval') {
          title = tr('notifyApprovalTitle');
          body = fill(tr('notifyApprovalBody'), name) + (detail && detail.toolName ? ' ' + detail.toolName : '');
        } else if (kind === 'error') {
          title = tr('notifyErrorTitle'); body = fill(tr('notifyErrorBody'), name);
        } else {
          title = tr('notifyTurnEndTitle'); body = fill(tr('notifyTurnEndBody'), name);
        }
        // Source tag up front so one glance tells main / subagent / automation.
        showNotification(sourcePrefix(src || 'main') + title, body, detail ? detail.sessionId : void 0);
      } catch (e) {}
    }

    function startWatcher(sessions, uiSession, remote) {
      var prevBySession = new Map();
      var binding = null;
      var lastPlayedAt = 0;
      var approvalLastAt = 0;
      var swallowedCount = 0;
      var mergeTimer = null;
      var listUpdates = 0;
      var scans = 0;

      /** Classify a completion source: 'subagent' (authoritative row origin /
       * parentId), 'automation' (session has active schedule tasks and no
       * human prompt inside the turn window), else 'main'. */
      var sessionSource = function (sessionId) {
        if (sessionId === void 0 || sessionId === null) return 'main';
        var row = null;
        try {
          var snap = sessions.list.getSnapshot();
          row = snap && snap.byId ? snap.byId[sessionId] : null;
        } catch (e) {}
        if (row && (row.origin === 'subagent' || row.parentId != null)) return 'subagent';
        if (scheduleCatalogOk && scheduleTitles.has(sessionId)) {
          var meta = row && row.projectionValues ? row.projectionValues.sessionListMetadata : null;
          var lpa = meta && typeof meta.lastPromptAt === 'number' ? meta.lastPromptAt : null;
          var started = turnStartAtById.get(sessionId) || 0;
          if (lpa === null || lpa < started - 5000) return 'automation';
        }
        return 'main';
      };
      var currentSessionId = function () {
        try {
          var snap = sessions.list.getSnapshot();
          return snap && snap.current !== void 0 ? snap.current : null;
        } catch (e) { return null; }
      };

      var flushMerge = function () {
        mergeTimer = null;
        var n = swallowedCount;
        swallowedCount = 0;
        if (n <= 0) return;
        if (n === 1) { log('1 completion merged (merged notice suppressed)'); return; }
        info('merged', n, 'completions inside the debounce window');
        try {
          var cfg = getConfig();
          var gated = !cfg.notifyDesktop
            || isQuietNow()
            || bannerSuppressed(cfg)
            || (cfg.onlyWhenHidden && document.visibilityState === 'visible' && document.hasFocus());
          if (!gated) showNotification(tr('notifyMergedTitle'), fill(tr('notifyMergedBody'), null, n), void 0);
        } catch (e) {}
      };

      var notifyCompletion = function (kind, detail) {
        var cfg = getConfig();
        var src = sessionSource(detail ? detail.sessionId : void 0);
        if (!cfg.enabled) { lastGate = { reason: 'disabled', kind: kind, at: Date.now(), src: src }; log('completion detected, gated by enabled=false ->', kind, detail); return; }
        if (kind === 'approval') {
          // Approval always cuts through: it blocks the agent until answered.
          var nowA = Date.now();
          if (nowA - approvalLastAt < 800) { log('approval detected, gated by approval debounce'); return; }
          approvalLastAt = nowA;
          if (isQuietNow()) {
            info('approval requested during quiet hours -> notification only');
          } else {
            info('approval requested -> play sound');
            playSound(soundFor(cfg, 'approval'), cfg.volume);
          }
          maybeNotify('approval', detail, bannerSuppressed(cfg), src);
          startTitleFlash('\u26a0\ufe0f');
          return;
        }
        if ((kind === 'turnEnd' || kind === 'backgroundDone')
          && isSessionMuted(detail ? detail.sessionId : void 0)) {
          lastGate = { reason: 'muted', kind: kind, at: Date.now(), src: src };
          log('completion detected, gated by muted session ->', kind, detail);
          return;
        }
        if (isQuietNow()) {
          lastGate = { reason: 'quiet', kind: kind, at: Date.now(), src: src };
          log('completion detected, gated by quiet hours ->', kind, detail);
          return;
        }
        if (cfg.onlyWhenHidden && document.visibilityState === 'visible' && document.hasFocus()) {
          lastGate = { reason: 'onlyWhenHidden', kind: kind, at: Date.now(), src: src };
          log('completion detected, gated by onlyWhenHidden ->', kind, detail);
          return;
        }
        if (cfg.skipCurrentTurnEnd && kind === 'turnEnd'
          && detail && detail.sessionId !== void 0 && detail.sessionId === currentSessionId()) {
          lastGate = { reason: 'skipCurrent', kind: kind, at: Date.now(), src: src };
          log('completion detected, gated by skipCurrentTurnEnd ->', kind, detail);
          return;
        }
        var now = Date.now();
        var minGap = typeof cfg.minIntervalMs === 'number' ? cfg.minIntervalMs : DEFAULTS.minIntervalMs;
        if (now - lastPlayedAt < minGap) {
          swallowedCount++;
          lastGate = { reason: 'debounce', kind: kind, at: Date.now(), src: src };
          if (mergeTimer === null) {
            mergeTimer = window.setTimeout(flushMerge, Math.max(200, lastPlayedAt + minGap - now));
          }
          log('completion detected, merged into debounce window ->', kind, 'swallowed=', swallowedCount);
          return;
        }
        lastPlayedAt = now;
        info(kind, '-> play sound');
        playSound(soundFor(cfg, kind), cfg.volume);
        var bannerHeld = bannerSuppressed(cfg);
        maybeNotify(kind, detail, bannerHeld, src);
        startTitleFlash(kind === 'error' ? '\u26d4' : '\u2705');
        lastGate = { reason: bannerHeld ? 'bannerFg' : (cfg.notifyDesktop ? 'sent' : 'soundOnly'), kind: kind, at: Date.now(), src: src };
      };

      var detachBinding = function () {
        if (binding !== null) {
          try { binding.unsubscribe(); } catch (e) {}
          binding = null;
        }
      };

      var attachBinding = function (id) {
        detachBinding();
        var resolved;
        try { resolved = sessions.binding(id); } catch (e) { log('binding threw for', id, String(e)); return; }
        if (!resolved || !resolved.session) { log('binding undefined for', id); return; }
        if (typeof resolved.session.subscribe !== 'function') { log('binding.session has no subscribe for', id); return; }
        var face = resolved.session;
        var init;
        try { init = face.getSnapshot(); } catch (e) { log('session snapshot threw for', id, String(e)); return; }
        var prevRunning = init.running === true;
        var prevTurnEnds = init.turnEnds && typeof init.turnEnds.size === 'number' ? init.turnEnds.size : 0;
        var unsub;
        try {
          unsub = face.subscribe(function () {
            var snap;
            try { snap = face.getSnapshot(); } catch (e) { return; }
            var nowRunning = snap.running === true;
            var turnEnds = snap.turnEnds && typeof snap.turnEnds.size === 'number' ? snap.turnEnds.size : 0;
            log('session snapshot:', id, 'running=', nowRunning, 'turnEnds=', turnEnds, '(prev', prevRunning, prevTurnEnds + ')');
            var finished = (prevRunning && !nowRunning) || turnEnds > prevTurnEnds;
            prevRunning = nowRunning;
            prevTurnEnds = turnEnds;
            if (finished) notifyCompletion('turnEnd', { sessionId: id });
          });
        } catch (e) { log('session subscribe threw for', id, String(e)); return; }
        binding = { id: id, unsubscribe: unsub };
        log('watching current session', id, '(running=' + prevRunning + ', turnEnds=' + prevTurnEnds + ')');
      };

      var scan = function (source) {
        scans++;
        var snapshot;
        try { snapshot = sessions.list.getSnapshot(); } catch (e) { log('scan', source, 'getSnapshot threw:', String(e)); return; }
        var byId = snapshot && snapshot.byId ? snapshot.byId : {};
        var completion = false;
        var flippedDoneId = null;
        var flippedTurnEndId = null;
        var rows = [];
        for (var id in byId) {
          var row = byId[id];
          if (!row || typeof row !== 'object') continue;
          var nowRunning = row.running === true;
          var nowCompleted = row.completed === true;
          titleById.set(id, typeof row.displayTitle === 'string' && row.displayTitle ? row.displayTitle : (typeof row.title === 'string' && row.title ? row.title : id));
          rows.push(id + '=' + (nowRunning ? 'R' : '-') + (nowCompleted ? 'C' : ''));
          var p = prevBySession.get(id);
          if (p === void 0) {
            prevBySession.set(id, { running: nowRunning, completed: nowCompleted });
            continue;
          }
          if (p.running && !nowRunning) {
            completion = true;
            if (flippedTurnEndId === null) flippedTurnEndId = id;
          }
          if (!p.completed && nowCompleted) {
            completion = true;
            if (flippedDoneId === null) flippedDoneId = id;
          }
          prevBySession.set(id, { running: nowRunning, completed: nowCompleted });
        }
        var current = snapshot.current;
        if (current === void 0) {
          detachBinding();
        } else if (binding === null || binding.id !== current) {
          attachBinding(current);
        }
        listUpdates++;
        log('list', source, '#', listUpdates, 'scan', scans, 'phase=', snapshot.phase, 'current=', current, 'rows=', rows.join(',') || '(empty)', 'completion=', completion);
        if (completion) {
          // Prefer the explicit background-completed edge; the running edge is
          // normally already covered (with the end reason) by the mux channel.
          var kind = flippedDoneId !== null ? 'backgroundDone' : 'turnEnd';
          notifyCompletion(kind, { sessionId: flippedDoneId !== null ? flippedDoneId : flippedTurnEndId });
        }
      };

      var listUnsub = sessions.list.subscribe(function () { scan('event'); });
      var timer = window.setInterval(function () { scan('poll'); }, 800);

      // ---- independent signal: mux SSE stream (turn/end events) ----------
      var es = null;
      try {
        es = new EventSource('/api/events.mux');
        es.onopen = function () { log('mux SSE open'); };
        es.onerror = function () { log('mux SSE error (browser will reconnect)'); };
        es.onmessage = function (ev) {
          var env = null;
          try { env = JSON.parse(ev.data); } catch (e) { return; }
          var payload = env && typeof env === 'object' && env.payload ? env.payload : env;
          if (!payload || typeof payload !== 'object') return;
          if (payload.type === 'session/event' && payload.event) {
            var evt = payload.event;
            var et = evt.type;
            if (et === 'turn/end') {
              var reason = evt.data && evt.data.reason;
              var rk = reason && typeof reason === 'object' ? reason.kind : reason;
              log('mux turn/end for session', payload.sessionId, 'reason=', rk);
              // User-driven cancels and synthetic closers stay silent.
              if (rk === 'aborted' || rk === 'interrupted' || rk === 'forked') return;
              notifyCompletion(rk === 'error' ? 'error' : 'turnEnd', { sessionId: payload.sessionId });
            } else if (et === 'turn/start') {
              log('mux turn/start for session', payload.sessionId);
              turnStartAtById.set(payload.sessionId, Date.now());
            }
          } else if (payload.type === 'host/session-status') {
            log('mux session-status', payload.sessionId, 'running=', payload.running);
          }
        };
      } catch (e) { log('mux SSE init failed:', String(e)); }

      // ---- independent signal: pending approval interactions -------------
      var statusUnsub = null;
      if (uiSession && uiSession.sessionStatus
        && typeof uiSession.sessionStatus.subscribe === 'function'
        && typeof uiSession.sessionStatus.getSnapshot === 'function') {
        var prevApproval = new Map();
        try {
          statusUnsub = uiSession.sessionStatus.subscribe(function () {
            var snap;
            try { snap = uiSession.sessionStatus.getSnapshot(); } catch (e) { return; }
            if (!snap || typeof snap.forEach !== 'function') return;
            var found = new Map();
            try {
              snap.forEach(function (st, id) {
                var pi = st && st.pendingInteraction;
                if (pi && pi.kind === 'approval') found.set(id, pi);
              });
            } catch (e) { log('status snapshot not iterable:', String(e)); return; }
            found.forEach(function (pi, id) {
              if (!prevApproval.has(id)) {
                log('approval pending for session', id, pi.toolName || '');
                notifyCompletion('approval', { sessionId: id, toolName: pi.toolName });
              }
              prevApproval.set(id, pi.key || 'k');
            });
            prevApproval.forEach(function (k, id) {
              if (!found.has(id)) prevApproval.delete(id);
            });
          });
        } catch (e) { log('status subscribe threw:', String(e)); }
      } else {
        log('uiSession.sessionStatus not available at apply time (approval cue disabled)');
      }

      // Automation (schedule) task catalog: refreshed at arm time + every 60s.
      refreshScheduleCatalog();
      var scheduleTimer = window.setInterval(refreshScheduleCatalog, 60000);

      try { info('watcher armed'); } catch (e) {}
      return function dispose() {
        try { listUnsub(); } catch (e) {}
        try { window.clearInterval(timer); } catch (e) {}
        try { window.clearInterval(scheduleTimer); } catch (e) {}
        try { if (es) es.close(); } catch (e) {}
        try { if (statusUnsub) statusUnsub(); } catch (e) {}
        try { if (mergeTimer !== null) window.clearTimeout(mergeTimer); } catch (e) {}
        detachBinding();
      };
    }

    // -------------------------------------------------------- settings UI
    var COPY = {
      title: { zh: '任务完成提示音', en: 'Task Complete Sound' },
      description: { zh: '回合 / 后台完成 / 审批 / 错误分类提示音，支持桌面通知', en: 'Classified cues for turns, background completion, approval and errors, plus desktop notifications' },
      expand: { zh: '展开', en: 'Show' },
      collapse: { zh: '收起', en: 'Hide' },
      enabled: { zh: '启用提示音', en: 'Enabled' },
      enabledHint: { zh: '按事件分类播放：回合结束、后台会话完成、等待审批（始终可听）、错误结束。', en: 'Classified cues: turn end, background completion, approval waiting (always audible) and error endings.' },
      sound: { zh: '音效', en: 'Sound' },
      chime: { zh: '海风铃（叮咚）', en: 'Sea chime' },
      ding: { zh: '珊瑚叮（单音）', en: 'Coral ding' },
      bell: { zh: '灯塔钟', en: 'Lighthouse bell' },
      woodblock: { zh: '木鱼（双敲）', en: 'Woodblock' },
      bubble: { zh: '泡泡（上升气泡）', en: 'Bubbles' },
      shimmer: { zh: '波光（上行琶音）', en: 'Sea shimmer' },
      error: { zh: '风暴警报（降双音）', en: 'Storm alert' },
      none: { zh: '静音', en: 'Silent' },
      soundTurnEnd: { zh: '回合结束音效', en: 'Turn-end sound' },
      soundTurnEndHint: { zh: '任意会话的回合正常结束时播放；手动停止不响。', en: 'Plays when any session turn ends normally; manual stops stay silent.' },
      soundBgDone: { zh: '后台完成音效', en: 'Background-done sound' },
      soundBgDoneHint: { zh: '未打开的会话在后台跑完（侧边栏绿色完成标记）时播放。', en: 'Plays when an unopened session finishes in the background.' },
      soundApproval: { zh: '等待审批音效', en: 'Approval-wait sound' },
      soundApprovalHint: { zh: '工具请求审批时播放；不受「仅后台」与防抖合并限制。', en: 'Plays when a tool asks for approval; ignores the hidden-only gate and the merge window.' },
      soundError: { zh: '错误结束音效', en: 'Error sound' },
      soundErrorHint: { zh: '回合因错误结束时播放，便于立刻发现异常。', en: 'Plays when a turn ends with an error.' },
      volume: { zh: '音量', en: 'Volume' },
      onlyHidden: { zh: '仅标签页不在前台时播放', en: 'Only when the tab is not focused' },
      notifyFgOnly: { zh: '前台不弹横幅', en: 'Banners only when hidden' },
      notifyFgOnlyHint: { zh: '开启后，页面正在前台时完成类事件只响声音、闪标题，不发系统通知；切到后台才会弹横幅（审批同样适用；「测试通知」按钮不受影响，始终弹出）。', en: 'When on, completion events while the page is focused only play the sound and flash the title; the OS banner fires only when the tab is hidden (approvals included; the test button always toasts).' },
      onlyHiddenHint: { zh: '开启后，正在盯着页面看时不会响（审批提醒除外）。', en: 'When on, no sound while you are watching the page (approval cues excepted).' },
      skipCurrent: { zh: '当前会话回合结束不响', en: "Skip the current session's turn ends" },
      skipCurrentHint: { zh: '正在查看的会话自己跑回合时不响；后台会话照常提示。', en: 'No cue for turn ends of the session you are viewing; background sessions still cue.' },
      quiet: { zh: '免打扰时段', en: 'Quiet hours' },
      quietHint: { zh: '时段内完成类提示整体静音；审批仍会弹通知，只是不出声。', en: 'Completion cues are muted during this window; approvals still notify, without sound.' },
      quietStart: { zh: '免打扰开始', en: 'Quiet from' },
      quietEnd: { zh: '免打扰结束', en: 'Quiet until' },
      flashTitle: { zh: '后台完成时闪烁标签页标题', en: 'Flash the tab title in the background' },
      flashTitleHint: { zh: '标签页不在前台时，标题栏闪现「✅ / ⚠️ / ⛔」前缀提醒；切回即停。', en: 'While hidden, the tab title flashes a marker (done / approval / error); it stops when you switch back.' },
      muted: { zh: '静音会话（标题关键词）', en: 'Muted sessions (title keywords)' },
      mutedHint: { zh: '标题含任一关键词的会话，其回合结束 / 后台完成不响、不通知、不闪标题；审批与错误不受影响。每行或逗号分隔一个关键词，保存后生效。', en: 'Sessions whose title contains any keyword stay silent for turn ends and background completions; approvals and errors still cue. One keyword per line or comma; applies on save.' },
      mutedPlaceholder: { zh: '例如：长任务', en: 'e.g. long-running' },
      gatePrefix: { zh: '{time} 最近一次完成事件 → ', en: '{time} last completion event: ' },
      gateNone: { zh: '暂无完成事件记录；事件发生后重新展开此卡即可看到处理结果。', en: 'No completion event yet; reopen this card after one fires to see the verdict.' },
      gate_disabled: { zh: '总开关处于关闭状态，一切静默。', en: 'the master switch is off - everything stays silent.' },
      gate_muted: { zh: '被静音会话的关键词规则过滤。', en: 'filtered by the muted-session keyword rules.' },
      gate_quiet: { zh: '被免打扰时段静音（时段内不响也不弹通知；审批仍会通知）。', en: 'muted by quiet hours (no sound or toast inside the window; approvals still notify).' },
      gate_onlyWhenHidden: { zh: '「仅后台标签页」开启中：页面在前台时完成类事件不提醒。', en: 'only-when-hidden is on: completion events are not cued while the page is in the foreground.' },
      gate_skipCurrent: { zh: '「当前会话免响」开启中：你正看着的这个会话不提醒。', en: 'skip-current-session is on: the session you are viewing does not cue.' },
      gate_debounce: { zh: '处于防抖窗口内，已合并计数。', en: 'merged into the debounce window.' },
      gate_sent: { zh: '已完整提醒（声音 + 系统通知 + 标题闪烁）。', en: 'fully cued (sound + system notification + title flash).' },
      gate_soundOnly: { zh: '声音和标题闪烁已触发，但「桌面通知」开关未开，所以没有系统通知。', en: 'sound and title flash fired, but the desktop-notification toggle is off, so no system toast.' },
      gate_bannerFg: { zh: '声音和标题闪烁已触发；「前台不弹横幅」开启且页面正处在前台，本次未发系统通知（切到后台的事件会弹）。', en: 'sound and title flash fired; banners-only-when-hidden is on and the page is in the foreground, so no system toast was sent (background events still toast).' },
      srcMain: { zh: '主会话', en: 'Main' },
      srcSubagent: { zh: '子代理', en: 'Subagent' },
      srcAutomation: { zh: '自动化任务', en: 'Automation' },
      sourcePrefixFmt: { zh: '【{src}】', en: '[{src}] ' },
      gateSourceSuffix: { zh: '（来源：{src}）', en: ' (source: {src})' },
      notify: { zh: '桌面通知', en: 'Desktop notifications' },
      notifyTest: { zh: '测试通知', en: 'Test notification' },
      notifyTestTitle: { zh: '测试通知', en: 'Test notification' },
      notifyTestBody: { zh: '看到这条说明通知链路是通的；没看到就看下面的结果行。', en: 'If you can read this, the notification path works.' },
      notifyTestNoApi: { zh: '结果：此页面没有通知 API（非 localhost 的 http 访问）——用 http://localhost:3080 打开 dsh。', en: 'Result: no Notification API on this origin (non-localhost http). Open dsh via http://localhost:3080.' },
      notifyTestAsking: { zh: '结果：正在请求权限——留意地址栏 / 页面里的授权弹窗。', en: 'Result: requesting permission - watch for the prompt in the address bar.' },
      notifyTestQuietBlocked: { zh: '结果：浏览器没弹授权框就拒绝了权限（Edge「安静的通知请求」拦截）——edge://settings/content/notifications 里手动允许后重试。', en: 'Result: permission denied without a prompt (Edge quiet prompts). Allow notifications manually at edge://settings/content/notifications.' },
      notifyTestSent: { zh: '结果：通知已交给系统发送。若屏幕没弹，是 Windows 层吞了：勿扰模式（Win+N）、Windows 设置→通知→Edge 开关、或专注助手。', en: 'Result: notification handed to the OS. If no toast appeared, Windows swallowed it: Do Not Disturb (Win+N), Windows notification settings for Edge, or Focus Assist.' },
      notifyTestDenied: { zh: '结果：权限处于被拒绝状态——地址栏锁图标 → 网站权限 → 通知 改为「允许」，再点测试。', en: 'Result: permission is denied. Allow notifications for this site (padlock icon), then test again.' },
      notifyTestError: { zh: '结果：Notification 调用抛错：{err}', en: 'Result: Notification constructor threw: {err}' },
      notifyStatusUnsupported: { zh: '不支持：此页面无通知 API（非 localhost 的 http 访问）', en: 'Unsupported: no Notification API on this origin (non-localhost http?)' },
      notifyStatusDefault: { zh: '权限未请求：点「测试通知」授权', en: 'Permission not requested yet: click Test to grant' },
      notifyStatusGranted: { zh: '权限已授予', en: 'Permission granted' },
      notifyStatusDenied: { zh: '权限被拒绝：地址栏锁图标 → 网站权限 → 通知，改为「允许」', en: 'Permission denied: allow notifications for this site in browser settings' },
      notifyHint: { zh: '完成 / 审批时弹系统通知，点击可跳转对应会话；首次开启会请求通知权限。', en: 'Show a system notification on completion / approval; click it to open the session. Grants permission on first enable.' },
      interval: { zh: '最小间隔（毫秒）', en: 'Min interval (ms)' },
      intervalHint: { zh: '窗口内连发的完成被静默合并，2 项以上补一条合并通知（默认 1500）。', en: 'Bursts inside the window are merged; 2+ merged items get one summary notification (default 1500).' },
      debug: { zh: '调试日志', en: 'Debug logs' },
      debugHint: { zh: '开启后控制台输出详细监听日志（排查用）。', en: 'Print detailed watcher logs to the console (for troubleshooting).' },
      test: { zh: '试听', en: 'Test' },
      save: { zh: '保存', en: 'Save' },
      saving: { zh: '保存中…', en: 'Saving…' },
      saved: { zh: '已保存', en: 'Saved' },
      unsaved: { zh: '未保存更改', en: 'Unsaved changes' },
      note: { zh: '配置保存在本浏览器（localStorage），保存后立即生效。', en: 'Config is stored in this browser (localStorage); applies immediately.' },
      notifyGenericName: { zh: '会话', en: 'Session' },
      notifyTurnEndTitle: { zh: '回合完成', en: 'Turn finished' },
      notifyTurnEndBody: { zh: '{name} 的回合已完成。', en: '{name} finished a turn.' },
      notifyBgDoneTitle: { zh: '后台任务完成', en: 'Background task finished' },
      notifyBgDoneBody: { zh: '{name} 已在后台完成。', en: '{name} finished in the background.' },
      notifyApprovalTitle: { zh: '等待审批', en: 'Approval needed' },
      notifyApprovalBody: { zh: '{name} 正在等待工具审批：', en: '{name} is waiting for tool approval:' },
      notifyErrorTitle: { zh: '回合异常结束', en: 'Turn ended with an error' },
      notifyErrorBody: { zh: '{name} 的回合因错误结束。', en: '{name} ended a turn with an error.' },
      notifyMergedTitle: { zh: '任务完成（合并提醒）', en: 'Tasks finished (merged)' },
      notifyMergedBody: { zh: '防抖窗口内合并了 {n} 项完成提醒。', en: '{n} completions were merged inside the debounce window.' },
    };

    function tr(key) {
      var lang = 'en';
      if (typeof navigator !== 'undefined' && (navigator.language || '').toLowerCase().indexOf('zh') === 0) lang = 'zh';
      var entry = COPY[key];
      return entry ? entry[lang] : key;
    }

    var h = react.createElement;

    /**
     * Family-aligned card styles: same structure and --dsw-alias-* design tokens
     * as the dsh-web-ui settings cards (task-board / web-ui-settings), so this
     * card reads as a sibling of the other plugin cards. Comment-style text
     * (description / hint / note / chevron) uses label-secondary, matching the
     * family cards - some skins paint label-tertiary in saturated accent
     * colors, which read as links here.
     */
    var TCS_CSS = [
      '.tcs-card{list-style:none;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;transition:border-color .16s,background .16s}',
      '.tcs-card:hover{border-color:var(--dsw-alias-label-dimmed)}',
      '.tcs-cardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}',
      '.tcs-header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:transparent;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}',
      '.tcs-header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}',
      '.tcs-headText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}',
      '.tcs-name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}',
      '.tcs-description{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.5}',
      '.tcs-chevron{color:var(--dsw-alias-label-secondary);flex:none;transition:transform .16s}',
      '.tcs-chevronOpen{transform:rotate(180deg)}',
      '.tcs-body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}',
      '.tcs-field{flex-direction:column;gap:6px;padding:12px 0;display:flex}',
      '.tcs-field+.tcs-field{border-top:1px solid var(--dsw-alias-border-l2)}',
      '.tcs-label{min-width:0;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:1.5}',
      '.tcs-hint{color:var(--dsw-alias-label-secondary);margin:0;font-size:12px;line-height:1.5}',
      '.tcs-check{display:flex;align-items:center;gap:8px;cursor:pointer}',
      '.tcs-check input{accent-color:var(--dsw-alias-brand-primary)}',
      '.tcs-input,.tcs-select{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px;line-height:1.5;width:100%;box-sizing:border-box}',
      '.tcs-input:focus-visible,.tcs-select:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}',
      '.tcs-input[type=range]{padding:0;accent-color:var(--dsw-alias-brand-primary)}',
      '.tcs-footer{border-top:1px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex}',
      '.tcs-btn{appearance:none;font:inherit;cursor:pointer;border:1px solid transparent;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}',
      '.tcs-btnDiscard{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:transparent}',
      '.tcs-btnDiscard:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}',
      '.tcs-btnSave{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}',
      '.tcs-btn:disabled{opacity:.4;cursor:default}',
      '.tcs-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.tcs-badge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}',
      '.tcs-note{color:var(--dsw-alias-label-secondary);margin:10px 0 0;font-size:12px;line-height:1.5}',
      '@media (prefers-reduced-motion:reduce){.tcs-card,.tcs-header,.tcs-chevron,.tcs-chevronOpen,.tcs-btn{transition:none}}'
    ].join('');

    /** Inject the card stylesheet once per page (idempotent). */
    function injectStyles() {
      try {
        if (document.getElementById('dsh-tcs-styles') !== null) return;
        var tag = document.createElement('style');
        tag.id = 'dsh-tcs-styles';
        tag.textContent = TCS_CSS;
        document.head.appendChild(tag);
      } catch (e) {}
    }

    function SoundSettingsCard(props) {
      var useState = react.useState;
      var useSyncExternalStore = react.useSyncExternalStore;
      var t = typeof props.t === 'function' ? props.t : tr;
      var openState = useState(false);
      var draftState = useState(null);
      var savingState = useState(false);
      var flashState = useState(false);
      /** Bumped after a permission change so the status text re-renders. */
      var permTick = useState(0);
      /** Last test-notification outcome, shown inside the card. */
      var testResultState = useState(null);
      var testResult = testResultState[0];
      var setTestResult = testResultState[1];
      var open = openState[0], setOpen = openState[1];
      var draft = draftState[0], setDraft = draftState[1];
      var saving = savingState[0], setSaving = savingState[1];
      var flash = flashState[0], setFlash = flashState[1];
      // Re-render when the config changes from another surface.
      useSyncExternalStore(subscribeConfig, getConfigVersion);

      var current = readConfig();
      var effective = draft === null ? current : draft;
      var dirty = draft !== null;

      var setField = function (key, value) {
        setDraft(Object.assign({}, draft === null ? readConfig() : draft, (function (o) { o[key] = value; return o; })({})));
      };
      var setSoundField = function (kind, value) {
        var base = draft === null ? readConfig() : draft;
        var sounds = Object.assign({}, base.sounds && typeof base.sounds === 'object' ? base.sounds : DEFAULTS.sounds);
        sounds[kind] = value;
        setDraft(Object.assign({}, base, { sounds: sounds }));
      };
      var timeInput = function (key) {
        return h('input', {
          className: 'tcs-input',
          type: 'time',
          value: typeof effective[key] === 'string' ? effective[key] : DEFAULTS[key],
          onChange: function (e) { setField(key, e.target.value); },
        });
      };
      var save = function () {
        if (draft === null) return;
        setSaving(true);
        var next = Object.assign({}, readConfig(), draft);
        next.sounds = Object.assign({}, DEFAULTS.sounds, draft && draft.sounds ? draft.sounds : {});
        writeConfig(next);
        setCurrentConfig(next);
        hostWrite(next);
        setDraft(null);
        setSaving(false);
        setFlash(true);
        window.setTimeout(function () { setFlash(false); }, 1400);
      };
      // Audition: play every configured event sound in sequence (0.8s apart),
      // skipping 'none' entries, so one click reviews the whole scheme.
      var test = function () {
        var delay = 0;
        for (var i = 0; i < EVENT_FIELDS.length; i++) {
          (function (kind, d) {
            var v = soundFor(effective, kind);
            if (v === 'none') return;
            if (d === 0) playSound(v, effective.volume);
            else window.setTimeout(function () { playSound(v, effective.volume); }, d);
          })(EVENT_FIELDS[i], delay);
          delay += 800;
        }
      };

      var chevronPath = 'M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z';

      var head = h('button', {
        type: 'button',
        className: 'tcs-header',
        'aria-expanded': open,
        'aria-label': (open ? t('collapse') : t('expand')) + ': ' + t('title'),
        onClick: function () { setOpen(!open); },
      }, [
        h('span', { className: 'tcs-headText' }, [
          h('span', { className: 'tcs-name', title: t('title') }, t('title')),
          h('span', { className: 'tcs-description', title: t('description') }, t('description')),
        ]),
        dirty ? h('span', { className: 'tcs-badge', title: t('unsaved') }, t('unsaved')) : null,
        h('svg', { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', xmlns: 'http://www.w3.org/2000/svg', className: open ? 'tcs-chevron tcs-chevronOpen' : 'tcs-chevron', 'aria-hidden': true }, h('path', { d: chevronPath, fill: 'currentColor' })),
      ]);

      var checkField = function (key, labelText, hintText) {
        return h('div', { className: 'tcs-field' }, [
          h('label', { className: 'tcs-check' }, [
            h('input', { type: 'checkbox', checked: effective[key] === true, onChange: function (e) { setField(key, e.target.checked); } }),
            h('span', { className: 'tcs-label' }, labelText),
          ]),
          hintText ? h('p', { className: 'tcs-hint' }, hintText) : null,
        ]);
      };
      var inputField = function (labelText, controlNode, hintText) {
        return h('div', { className: 'tcs-field' }, [
          h('span', { className: 'tcs-label' }, labelText),
          controlNode,
          hintText ? h('p', { className: 'tcs-hint' }, hintText) : null,
        ]);
      };
      var soundSelect = function (kind) {
        return h('select', {
          className: 'tcs-select',
          value: soundFor(effective, kind),
          onChange: function (e) {
            var v = e.target.value;
            setSoundField(kind, v);
            // Audition on switch too; the row's audition button covers
            // replaying the already-chosen sound. 'none' stays silent.
            if (v !== 'none') playSound(v, effective.volume);
          },
        }, SOUND_OPTIONS.map(function (opt) {
          return h('option', { key: opt, value: opt }, t(opt));
        }));
      };
      /** One sound row: select plus an inline audition button (auto-play on
       * switch was too noisy; the button plays the row's chosen sound). */
      var soundRow = function (kind, labelText, hintText) {
        var chosen = soundFor(effective, kind);
        return h('div', { className: 'tcs-field' }, [
          h('span', { className: 'tcs-label' }, labelText),
          h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, [
            h('div', { style: { flex: '1', minWidth: '0' } }, soundSelect(kind)),
            h('button', {
              type: 'button',
              className: 'tcs-btn tcs-btnDiscard',
              title: t('test'),
              'aria-label': t('test') + ': ' + labelText,
              style: { flex: 'none', whiteSpace: 'nowrap' },
              disabled: chosen === 'none',
              onClick: function () { playSound(chosen, effective.volume); },
            }, t('test')),
          ]),
          hintText ? h('p', { className: 'tcs-hint' }, hintText) : null,
        ]);
      };
      var bumpPerm = function () { permTick[1](function (n) { return n + 1; }); };
      /** Live permission state, rendered into the card so failures are visible. */
      var notifyPermissionLabel = function () {
        if (typeof Notification === 'undefined') return t('notifyStatusUnsupported');
        var p = Notification.permission; // read at render; bumpPerm refreshes
        if (p === 'granted') return t('notifyStatusGranted');
        if (p === 'denied') return t('notifyStatusDenied');
        return t('notifyStatusDefault');
      };
      /** In-card test: grant if needed, then fire one notification right away.
       * Every outcome lands in the card as text - "nothing happened" is impossible. */
      var sendTestNotification = function () {
        if (typeof Notification === 'undefined') {
          setTestResult(t('notifyTestNoApi'));
          return;
        }
        if (Notification.permission === 'default') {
          setTestResult(t('notifyTestAsking'));
          var after = function () {
            bumpPerm();
            if (Notification.permission === 'granted') { sendTestNotification(); return; }
            // Resolved denied without a visible prompt: Edge's quiet prompts.
            setTestResult(t('notifyTestQuietBlocked'));
          };
          try { Notification.requestPermission().then(after).catch(after); } catch (e) {
            bumpPerm();
            setTestResult(t('notifyTestQuietBlocked'));
          }
          return;
        }
        bumpPerm();
        var outcome = showNotification(tr('notifyTestTitle'), tr('notifyTestBody'), void 0);
        if (outcome === 'sent') setTestResult(t('notifyTestSent'));
        else if (outcome === 'not-granted') setTestResult(t('notifyTestDenied'));
        else setTestResult(t('notifyTestError').split('{err}').join(outcome));
      };
      var notifyField = function () {
        return h('div', { className: 'tcs-field' }, [
          h('label', { className: 'tcs-check' }, [
            h('input', {
              type: 'checkbox',
              checked: effective.notifyDesktop === true,
              onChange: function (e) {
                var v = e.target.checked;
                setField('notifyDesktop', v);
                if (v && typeof Notification !== 'undefined' && Notification.permission === 'default') {
                  try { Notification.requestPermission().then(bumpPerm).catch(bumpPerm); } catch (e2) {}
                }
              },
            }),
            h('span', { className: 'tcs-label' }, t('notify')),
          ]),
          h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, [
            h('span', { className: 'tcs-hint', style: { flex: '1' } }, notifyPermissionLabel()),
            h('button', {
              type: 'button',
              className: 'tcs-btn tcs-btnDiscard',
              style: { flex: 'none', whiteSpace: 'nowrap' },
              onClick: sendTestNotification,
            }, t('notifyTest')),
          ]),
          testResult ? h('p', { className: 'tcs-hint', style: { fontWeight: 600 } }, testResult) : null,
          h('p', { className: 'tcs-hint' }, t('notifyHint')),
        ]);
      };

      var textareaField = function (labelText, placeholder, hintText, key) {
        var arr = Array.isArray(effective[key]) ? effective[key] : [];
        return h('div', { className: 'tcs-field' }, [
          h('span', { className: 'tcs-label' }, labelText),
          h('textarea', {
            className: 'tcs-input',
            rows: 3,
            placeholder: placeholder,
            value: arr.join('\n'),
            onChange: function (e) {
              var parts = e.target.value.split(/[\n,\uff0c;\uff1b]+/).map(function (s) { return s.trim(); }).filter(function (s, idx, a) { return s !== '' && a.indexOf(s) === idx; });
              setField(key, parts);
            },
          }),
          hintText ? h('p', { className: 'tcs-hint' }, hintText) : null,
        ]);
      };

      /** One-line verdict for the most recent completion event: delivered,
       * or exactly which gate muted it. Read at render; reopen to refresh. */
      var gateLine = function () {
        var g = lastGate;
        if (!g) return h('p', { className: 'tcs-hint' }, t('gateNone'));
        var when = new Date(g.at);
        var hhmm = ('0' + when.getHours()).slice(-2) + ':' + ('0' + when.getMinutes()).slice(-2);
        var text = t('gate_' + g.reason);
        if (g.src) text += t('gateSourceSuffix').split('{src}').join(t(g.src === 'subagent' ? 'srcSubagent' : g.src === 'automation' ? 'srcAutomation' : 'srcMain'));
        return h('p', { className: 'tcs-hint', style: { fontWeight: 600 } },
          t('gatePrefix').split('{time}').join(hhmm) + text);
      };

      var body = null;
      if (open) {
        body = h('div', { className: 'tcs-body' }, [
          gateLine(),
          checkField('enabled', t('enabled'), t('enabledHint')),
          soundRow('turnEnd', t('soundTurnEnd'), t('soundTurnEndHint')),
          soundRow('backgroundDone', t('soundBgDone'), t('soundBgDoneHint')),
          soundRow('approval', t('soundApproval'), t('soundApprovalHint')),
          soundRow('error', t('soundError'), t('soundErrorHint')),
          inputField(t('volume') + ' (' + Math.round((typeof effective.volume === 'number' ? effective.volume : DEFAULTS.volume) * 100) + '%)', h('input', { className: 'tcs-input', type: 'range', min: 0, max: 1, step: 0.05, value: typeof effective.volume === 'number' ? effective.volume : DEFAULTS.volume, onChange: function (e) { setField('volume', Number(e.target.value)); } }), null),
          checkField('onlyWhenHidden', t('onlyHidden'), t('onlyHiddenHint')),
          checkField('skipCurrentTurnEnd', t('skipCurrent'), t('skipCurrentHint')),
          checkField('quietEnabled', t('quiet'), t('quietHint')),
          h('div', { className: 'tcs-field' }, [
            h('div', { style: { display: 'flex', gap: '8px' } }, [
              h('span', { className: 'tcs-label', style: { flex: '1' } }, t('quietStart')),
              h('span', { className: 'tcs-label', style: { flex: '1' } }, t('quietEnd')),
            ]),
            h('div', { style: { display: 'flex', gap: '8px' } }, [
              timeInput('quietStart'),
              timeInput('quietEnd'),
            ]),
          ]),
          notifyField(),
          (effective.notifyDesktop === true)
            ? checkField('notifyOnlyHidden', t('notifyFgOnly'), t('notifyFgOnlyHint'))
            : null,
          checkField('flashTitle', t('flashTitle'), t('flashTitleHint')),
          textareaField(t('muted'), t('mutedPlaceholder'), t('mutedHint'), 'mutedKeywords'),
          inputField(t('interval'), h('input', { className: 'tcs-input', type: 'number', min: 0, max: 60000, step: 100, value: typeof effective.minIntervalMs === 'number' ? effective.minIntervalMs : DEFAULTS.minIntervalMs, onChange: function (e) { setField('minIntervalMs', Number(e.target.value)); } }), t('intervalHint')),
          checkField('debug', t('debug'), t('debugHint')),
          h('div', { className: 'tcs-footer' }, [
            h('button', { type: 'button', className: 'tcs-btn tcs-btnDiscard', onClick: test }, t('test')),
            flash ? h('span', { className: 'tcs-badge' }, t('saved')) : null,
            h('button', { type: 'button', className: 'tcs-btn tcs-btnSave', disabled: !dirty || saving, onClick: save }, saving ? t('saving') : t('save')),
          ]),
          h('p', { className: 'tcs-note' }, t('note')),
        ]);
      }

      return h('li', { className: open ? 'tcs-card tcs-cardOpen' : 'tcs-card' }, [head, body]);
    }

    // --------------------------------------------------------------- apply
    var claimed = false;
    var inject = ['sessions', 'slots', 'uiSession', 'uiWorkspace', 'remote'];

    /**
     * Mount the sound watcher and the settings card.
     * @param ctx - client root context (services: sessions, slots; optional
     *   uiWorkspace for notification click-to-jump, uiSession for approval).
     */
    function apply(ctx) {
      try {
        log('apply called; claimed=', claimed);
        // A duplicated client injection (module factory executed twice in one
        // page lifetime) would otherwise subscribe twice; first apply wins.
        if (claimed) return;
        claimed = true;
        ctx.effect(function () { return function () { claimed = false; }; }, 'task-complete-sound: claim');

        // Pre-unlock audio on the first gesture (autoplay policy).
        armAudioUnlock();

        // Optional click-to-jump target for notifications (absent -> focus only).
        try {
          if (ctx.uiWorkspace && typeof ctx.uiWorkspace.openSession === 'function') {
            openSessionFn = function (id) {
              try { ctx.uiWorkspace.openSession(id); } catch (e) { log('openSession threw for', id, String(e)); }
            };
          } else {
            log('uiWorkspace.openSession not available (notification click will only focus)');
          }
        } catch (e) { log('uiWorkspace probe threw:', String(e)); }

        // Optional approval status source.
        var uiSession = null;
        try {
          if (ctx.uiSession && ctx.uiSession.sessionStatus
            && typeof ctx.uiSession.sessionStatus.subscribe === 'function') {
            uiSession = ctx.uiSession;
          }
        } catch (e) { log('uiSession probe threw:', String(e)); }

        // Optional host settings face for cross-browser config sync.
        try {
          if (ctx.remote && ctx.remote.settings && typeof ctx.remote.settings.describe === 'function') {
            hostSettings = ctx.remote.settings;
          } else {
            log('ctx.remote.settings not available (config stays per-browser)');
          }
        } catch (e) { log('remote probe threw:', String(e)); }

        // Watch session list for completion edges + mux SSE turn/end + approvals.
        var disposeWatcher = null;
        if (ctx.sessions && ctx.sessions.list && typeof ctx.sessions.list.subscribe === 'function') {
          remoteFace = ctx.remote || null;
          // The schedule face belongs to an optional plugin; property access
          // on an uninjected service THROWS, so this probe must not run raw.
          try {
            var schedProbe = remoteFace ? remoteFace.schedule : null;
            if (schedProbe && typeof schedProbe.catalog === 'function') {
              log('remote.schedule face present (automation source detection enabled)');
            } else {
              log('remote.schedule face absent (automation source detection unavailable)');
            }
          } catch (eSched) {
            log('remote.schedule probe threw (treated as absent):', String(eSched));
          }
          disposeWatcher = startWatcher(ctx.sessions, uiSession, ctx.remote);
          log('watcher created:', disposeWatcher ? 'ok' : 'unexpected');
          ctx.effect(function () { return function () { if (disposeWatcher) disposeWatcher(); }; }, 'task-complete-sound: watcher');
        } else {
          log('sessions.list not available at apply time');
        }

        // One-liner: which optional services actually resolved (inject list).
        info('services: uiSession=', !!uiSession, 'uiWorkspace=', openSessionFn ? 'ok' : 'missing',
          'remote.settings=', hostSettings ? 'ok' : 'missing',
          'notifications=', typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);

        // Adopt or seed the host settings namespace (best effort, async).
        hostReadSync();

        // Family-aligned card stylesheet (idempotent).
        injectStyles();

        // Settings card into the Web UI plugin group (present when the
        // dsh-web-ui-settings group is installed; otherwise inert).
        if (ctx.slots && typeof ctx.slots.inject === 'function') {
          ctx.slots.inject('web-ui.plugin.item', function () {
            return ctx.slots.register({
              name: 'web-ui.plugin.item',
              id: 'task-complete-sound',
              order: 116,
              inject: function () { return {}; },
            }, SoundSettingsCard);
          });
          log('settings card registered');
        }
        log('apply done');
      } catch (error) {
        console.error('[dsh-task-complete-sound] apply failed:', error);
      }
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
