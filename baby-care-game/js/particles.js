import * as THREE from 'three';

// 絵文字をキャンバスに描いてスプライト用テクスチャにする
function emojiTexture(emoji, size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.font = `${size * 0.8}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, size / 2, size / 2 + size * 0.04);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const TYPES = {
  heart: { emoji: '💗', gravity: 0.9, spread: 0.9, life: 1.3, size: 0.28 },
  star: { emoji: '⭐', gravity: 0.5, spread: 1.2, life: 1.5, size: 0.3 },
  sparkle: { emoji: '✨', gravity: 0.2, spread: 0.7, life: 0.9, size: 0.24 },
  bubble: { emoji: '🫧', gravity: -0.6, spread: 0.5, life: 1.1, size: 0.2 },
  stink: { emoji: '💨', gravity: -0.4, spread: 0.3, life: 1.6, size: 0.22 },
  note: { emoji: '🎵', gravity: -0.5, spread: 0.5, life: 1.6, size: 0.24 },
};

export class Particles {
  constructor(scene) {
    this.scene = scene;
    this.textures = {};
    this.active = [];
    for (const [name, def] of Object.entries(TYPES)) {
      this.textures[name] = emojiTexture(def.emoji);
    }
  }

  burst(type, position, count = 8) {
    const def = TYPES[type];
    for (let i = 0; i < count; i++) {
      const mat = new THREE.SpriteMaterial({
        map: this.textures[type],
        transparent: true,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(mat);
      const s = def.size * (0.7 + Math.random() * 0.6);
      sprite.scale.set(s, s, 1);
      sprite.position.copy(position);
      sprite.position.x += (Math.random() - 0.5) * 0.25;
      sprite.position.y += (Math.random() - 0.5) * 0.15;
      sprite.position.z += (Math.random() - 0.5) * 0.25;
      this.scene.add(sprite);
      this.active.push({
        sprite,
        vel: new THREE.Vector3(
          (Math.random() - 0.5) * def.spread,
          Math.random() * def.spread * 0.9 + 0.35,
          (Math.random() - 0.5) * def.spread
        ),
        gravity: def.gravity,
        life: def.life * (0.8 + Math.random() * 0.4),
        age: 0,
      });
    }
  }

  update(dt) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.age += dt;
      if (p.age >= p.life) {
        this.scene.remove(p.sprite);
        p.sprite.material.dispose();
        this.active.splice(i, 1);
        continue;
      }
      p.vel.y -= p.gravity * dt;
      p.sprite.position.addScaledVector(p.vel, dt);
      p.sprite.material.opacity = 1 - (p.age / p.life) ** 2;
    }
  }
}
