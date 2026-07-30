/* hooks.js — 他のエージェント／機能が差し込むための軽量イベントバス。
 * index.htmlの最初のスクリプトとして読み込まれる（window.GameHooksを最初に用意するため）。
 */
(function () {
  'use strict';

  const hooks = {
    handlers: {},
    on(name, fn) {
      if (!hooks.handlers[name]) hooks.handlers[name] = [];
      hooks.handlers[name].push(fn);
    },
    emit(name, ...args) {
      const list = hooks.handlers[name];
      if (!list) return;
      for (const fn of list) {
        try {
          fn(...args);
        } catch (e) {
          console.error('[GameHooks] handler error for "' + name + '":', e);
        }
      }
    },
  };

  window.GameHooks = hooks;
})();
