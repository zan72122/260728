import * as THREE from 'three';
import {
  makeGlowTexture,
  makeDashedRingTexture,
  makeStarTexture,
  makeHeartTexture,
} from './materials.js';

/**
 * 演出プール：危険の影・着地マーカー・光の軌跡・キラキラ。
 * すべて worldGroup に追加され、UIとは独立している。
 */
export class Effects {
  constructor(parent) {
    this.parent = parent;
    this.time = 0;

    this.texDanger = makeGlowTexture('rgba(255,130,40,0.9)', 'rgba(255,130,40,0)');
    this.texGhostRing = makeDashedRingTexture('rgba(96,150,240,0.95)');
    this.texTrail = makeGlowTexture('rgba(255,220,130,0.9)', 'rgba(255,220,130,0)');
    this.texStar = makeStarTexture('#ffe08a');
    this.texStarPink = makeStarTexture('#ffb0c8');
    this.texHeart = makeHeartTexture('#ff8fab');
    this.texSafeGlow = makeGlowTexture('rgba(150,230,170,0.75)', 'rgba(150,230,170,0)');

    this.dangerMarkers = []; // {mesh, born}
    this.ghostMarkers = [];
    this.trailSprites = []; // {sprite, life, maxLife}
    this.particles = []; // {sprite, vel, life, maxLife, gravity}
    this.safeGlow = null;
  }

  /**
   * 危険の影（オレンジのやわらかい円）を床に置く。
   * opts.sx / sz で楕円（家具の転倒帯など）にできる。
   */
  addDangerMarker(x, z, radius = 0.34, opts = {}) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(radius * 2, radius * 2),
      new THREE.MeshBasicMaterial({
        map: this.texDanger,
        transparent: true,
        depthWrite: false,
        opacity: 0,
      }),
    );
    m.rotation.x = -Math.PI / 2;
    if (opts.rotZ) m.rotation.z = opts.rotZ;
    m.position.set(x, 0.02 + this.dangerMarkers.length * 0.0015, z);
    this.parent.add(m);
    this.dangerMarkers.push({
      mesh: m,
      born: this.time,
      baseSx: opts.sx ?? 1,
      baseSz: opts.sz ?? 1,
    });
    return m;
  }

  /** Aの着地点を示す破線リング（ゴースト） */
  addGhostMarker(x, z, radius = 0.3) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(radius * 2, radius * 2),
      new THREE.MeshBasicMaterial({
        map: this.texGhostRing,
        transparent: true,
        depthWrite: false,
        opacity: 0.85,
      }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.025 + this.ghostMarkers.length * 0.0015, z);
    this.parent.add(m);
    this.ghostMarkers.push({ mesh: m, born: this.time });
    return m;
  }

  clearDangerMarkers() {
    for (const d of this.dangerMarkers) {
      this.parent.remove(d.mesh);
      d.mesh.geometry.dispose();
      d.mesh.material.dispose();
    }
    this.dangerMarkers = [];
  }

  clearGhostMarkers() {
    for (const d of this.ghostMarkers) {
      this.parent.remove(d.mesh);
      d.mesh.geometry.dispose();
      d.mesh.material.dispose();
    }
    this.ghostMarkers = [];
  }

  /** 落下物の後ろに光の粒を残す */
  emitTrail(pos, scale = 0.16) {
    const sp = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.texTrail,
        transparent: true,
        depthWrite: false,
        opacity: 0.85,
      }),
    );
    sp.position.copy(pos);
    sp.scale.setScalar(scale);
    this.parent.add(sp);
    this.trailSprites.push({ sprite: sp, life: 0, maxLife: 0.55 });
  }

  /** 星やハートのバースト */
  burst(pos, { count = 10, kind = 'star', speed = 1.4, up = 1.8, size = 0.14 } = {}) {
    const tex =
      kind === 'heart' ? this.texHeart : kind === 'pink' ? this.texStarPink : this.texStar;
    for (let i = 0; i < count; i++) {
      const sp = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }),
      );
      sp.position.copy(pos);
      sp.scale.setScalar(size * (0.7 + Math.random() * 0.6));
      const a = Math.random() * Math.PI * 2;
      const v = new THREE.Vector3(
        Math.cos(a) * speed * (0.3 + Math.random() * 0.7),
        up * (0.5 + Math.random() * 0.7),
        Math.sin(a) * speed * (0.3 + Math.random() * 0.7),
      );
      this.parent.add(sp);
      this.particles.push({ sprite: sp, vel: v, life: 0, maxLife: 0.9 + Math.random() * 0.4, gravity: 4.5 });
    }
  }

  /** 安全のときのやさしい光（くまの足元） */
  showSafeGlow(x, z) {
    this.hideSafeGlow();
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(1.3, 1.3),
      new THREE.MeshBasicMaterial({
        map: this.texSafeGlow,
        transparent: true,
        depthWrite: false,
        opacity: 0,
      }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.018, z);
    this.parent.add(m);
    this.safeGlow = { mesh: m, born: this.time };
  }

  hideSafeGlow() {
    if (this.safeGlow) {
      this.parent.remove(this.safeGlow.mesh);
      this.safeGlow.mesh.geometry.dispose();
      this.safeGlow.mesh.material.dispose();
      this.safeGlow = null;
    }
  }

  clearAll() {
    this.clearDangerMarkers();
    this.clearGhostMarkers();
    this.hideSafeGlow();
    for (const t of this.trailSprites) {
      this.parent.remove(t.sprite);
      t.sprite.material.dispose();
    }
    this.trailSprites = [];
    for (const p of this.particles) {
      this.parent.remove(p.sprite);
      p.sprite.material.dispose();
    }
    this.particles = [];
  }

  update(dt) {
    this.time += dt;

    for (const d of this.dangerMarkers) {
      const age = this.time - d.born;
      const pulse = 0.72 + Math.sin(this.time * 5) * 0.18;
      d.mesh.material.opacity = Math.min(1, age * 3) * pulse;
      const s = 1 + Math.sin(this.time * 5) * 0.06;
      d.mesh.scale.set(s * (d.baseSx ?? 1), s * (d.baseSz ?? 1), 1);
    }
    for (const d of this.ghostMarkers) {
      d.mesh.rotation.z += dt * 0.5;
    }
    if (this.safeGlow) {
      const age = this.time - this.safeGlow.born;
      this.safeGlow.mesh.material.opacity = Math.min(0.9, age * 2) * (0.8 + Math.sin(this.time * 3) * 0.2);
    }

    for (let i = this.trailSprites.length - 1; i >= 0; i--) {
      const t = this.trailSprites[i];
      t.life += dt;
      const k = t.life / t.maxLife;
      if (k >= 1) {
        this.parent.remove(t.sprite);
        t.sprite.material.dispose();
        this.trailSprites.splice(i, 1);
      } else {
        t.sprite.material.opacity = 0.85 * (1 - k);
        t.sprite.scale.setScalar(t.sprite.scale.x * (1 - dt * 1.2));
      }
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      const k = p.life / p.maxLife;
      if (k >= 1) {
        this.parent.remove(p.sprite);
        p.sprite.material.dispose();
        this.particles.splice(i, 1);
      } else {
        p.vel.y -= p.gravity * dt;
        p.sprite.position.addScaledVector(p.vel, dt);
        p.sprite.material.opacity = 1 - k * k;
        p.sprite.material.rotation += dt * 2;
      }
    }
  }
}
