// js/dough/presets.js — Agent A
// 9種の生地プリセット。SPEC.md の Agent A セクション厳守。
// props は全て 0..1 正規化 (thickness, layers を除く)。behavior は挙動係数。

export const DOUGH_PRESETS = {
  soft_yeast: {
    name: 'やわらかいはっこうきじ',
    baseColor: '#FBEFD6',
    bakedColor: '#E3A860',
    props: {
      hydration: 0.6, softness: 0.75, stickiness: 0.35, elasticity: 0.55,
      stretchiness: 0.55, shrinkage: 0.2, surfaceTension: 0.45, air: 0.3,
      ferment: 0, temperature: 0.18, bakeColor: 0, crustHardness: 0.2,
      crumbSoftness: 0.7, thickness: 1.0, layers: 1,
    },
    behavior: {
      reboundRate: 0.55, stretchLimit: 0.6, crackTendency: 0.15, flowiness: 0.2,
      crumbleTendency: 0.1, fermentPower: 0.8, springiness: 0.5,
    },
  },

  shokupan: {
    name: 'しょくぱん',
    baseColor: '#F7E8C9',
    bakedColor: '#C68A4B',
    props: {
      hydration: 0.55, softness: 0.55, stickiness: 0.3, elasticity: 0.6,
      stretchiness: 0.4, shrinkage: 0.15, surfaceTension: 0.5, air: 0.2,
      ferment: 0, temperature: 0.18, bakeColor: 0, crustHardness: 0.3,
      crumbSoftness: 0.55, thickness: 1.05, layers: 1,
    },
    behavior: {
      reboundRate: 0.45, stretchLimit: 0.45, crackTendency: 0.1, flowiness: 0.1,
      crumbleTendency: 0.05, fermentPower: 0.6, springiness: 0.4,
    },
  },

  melon_topping: {
    name: 'めろんぱんのうわがけ',
    baseColor: '#F2E4B8',
    bakedColor: '#D9A63E',
    props: {
      hydration: 0.35, softness: 0.35, stickiness: 0.2, elasticity: 0.3,
      stretchiness: 0.2, shrinkage: 0.1, surfaceTension: 0.6, air: 0.1,
      ferment: 0, temperature: 0.18, bakeColor: 0, crustHardness: 0.5,
      crumbSoftness: 0.25, thickness: 0.55, layers: 1,
    },
    behavior: {
      reboundRate: 0.2, stretchLimit: 0.25, crackTendency: 0.85, flowiness: 0.05,
      crumbleTendency: 0.3, fermentPower: 0.1, springiness: 0.2,
    },
  },

  croissant: {
    name: 'くろわっさんきじ',
    baseColor: '#F5E2B8',
    bakedColor: '#C97A3D',
    props: {
      hydration: 0.5, softness: 0.5, stickiness: 0.25, elasticity: 0.45,
      stretchiness: 0.8, shrinkage: 0.1, surfaceTension: 0.4, air: 0.25,
      ferment: 0, temperature: 0.18, bakeColor: 0, crustHardness: 0.25,
      crumbSoftness: 0.45, thickness: 1.0, layers: 1,
    },
    behavior: {
      reboundRate: 0.35, stretchLimit: 0.9, crackTendency: 0.1, flowiness: 0.15,
      crumbleTendency: 0.05, fermentPower: 0.5, springiness: 0.35,
    },
  },

  donut: {
    name: 'どーなつきじ',
    baseColor: '#F6E7C6',
    bakedColor: '#B5651D',
    props: {
      hydration: 0.55, softness: 0.6, stickiness: 0.3, elasticity: 0.5,
      stretchiness: 0.5, shrinkage: 0.15, surfaceTension: 0.45, air: 0.3,
      ferment: 0, temperature: 0.18, bakeColor: 0, crustHardness: 0.2,
      crumbSoftness: 0.6, thickness: 1.1, layers: 1,
    },
    behavior: {
      reboundRate: 0.5, stretchLimit: 0.55, crackTendency: 0.15, flowiness: 0.25,
      crumbleTendency: 0.1, fermentPower: 0.5, springiness: 0.45,
    },
  },

  bagel_pizza: {
    name: 'べーぐる・ぴざきじ',
    baseColor: '#F0DEB0',
    bakedColor: '#C2833B',
    props: {
      hydration: 0.5, softness: 0.45, stickiness: 0.4, elasticity: 0.8,
      stretchiness: 0.7, shrinkage: 0.1, surfaceTension: 0.55, air: 0.15,
      ferment: 0, temperature: 0.18, bakeColor: 0, crustHardness: 0.35,
      crumbSoftness: 0.35, thickness: 1.0, layers: 1,
    },
    behavior: {
      reboundRate: 0.85, stretchLimit: 0.8, crackTendency: 0.05, flowiness: 0.05,
      crumbleTendency: 0.03, fermentPower: 0.3, springiness: 0.8,
    },
  },

  steamed: {
    name: 'むしぱんきじ',
    baseColor: '#FFFBF2',
    bakedColor: '#F0E4C8',
    props: {
      hydration: 0.65, softness: 0.8, stickiness: 0.35, elasticity: 0.4,
      stretchiness: 0.5, shrinkage: 0.15, surfaceTension: 0.35, air: 0.35,
      ferment: 0, temperature: 0.18, bakeColor: 0, crustHardness: 0.1,
      crumbSoftness: 0.8, thickness: 1.05, layers: 1,
    },
    behavior: {
      reboundRate: 0.4, stretchLimit: 0.5, crackTendency: 0.2, flowiness: 0.2,
      crumbleTendency: 0.08, fermentPower: 0.7, springiness: 0.35,
    },
  },

  cookie: {
    name: 'くっきーきじ',
    baseColor: '#E8CBA0',
    bakedColor: '#A66B32',
    props: {
      hydration: 0.25, softness: 0.3, stickiness: 0.15, elasticity: 0.15,
      stretchiness: 0.15, shrinkage: 0.05, surfaceTension: 0.3, air: 0.1,
      ferment: 0, temperature: 0.18, bakeColor: 0, crustHardness: 0.4,
      crumbSoftness: 0.2, thickness: 0.85, layers: 1,
    },
    behavior: {
      reboundRate: 0.05, stretchLimit: 0.2, crackTendency: 0.7, flowiness: 0.05,
      crumbleTendency: 0.85, fermentPower: 0.05, springiness: 0.1,
    },
  },

  liquid: {
    name: 'とろとろきじ',
    baseColor: '#FFF9E8',
    bakedColor: '#F5DFA0',
    props: {
      hydration: 0.9, softness: 0.95, stickiness: 0.5, elasticity: 0.05,
      stretchiness: 0.3, shrinkage: 0.02, surfaceTension: 0.15, air: 0.2,
      ferment: 0, temperature: 0.18, bakeColor: 0, crustHardness: 0.05,
      crumbSoftness: 0.9, thickness: 0.5, layers: 1,
    },
    behavior: {
      reboundRate: 0.02, stretchLimit: 0.3, crackTendency: 0.02, flowiness: 0.9,
      crumbleTendency: 0.02, fermentPower: 0.05, springiness: 0.05,
    },
  },
};
