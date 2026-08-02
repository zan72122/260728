'use strict';
/* boot */
window.addEventListener('load', () => {
  App.init();
  App.setScene(new Home());
});

/* small debug hooks for automated testing (harmless in production) */
window.__dbg = {
  app: App,
  dishes: DISHES,
  state() {
    const s = App.scene;
    if (!s) return { scene: 'none' };
    if (s instanceof Home) return { scene: 'home' };
    return { scene: 'dish', dish: s.def.id, step: s.stepI, steps: s.steps.length, done: !!(s.step.done && s.step.done()) };
  },
  open(i) { App.setScene(new DishScene(DISHES[i])); },
  next() { if (App.scene && App.scene.next) App.scene.next(); },
  food() { return App.scene && App.scene.food; }
};
