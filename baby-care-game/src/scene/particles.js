import * as THREE from 'three';
import { PALETTE, toonUnique } from './palette.js';
import { makeStarGeometry, makeHeartGeometry } from '../util/shapes.js';

const POOL = 90;

/**
 * きらきら・あわ・ハートなどの飛びちる演出。
 * メッシュを使い回して、GCとドローコールを増やさない。
 */
export class Particles {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);

    const geos = {
      sparkle: makeStarGeometry(0.09, 0.04, 0.03),
      bubble: new THREE.SphereGeometry(0.07, 10, 8),
      heart: makeHeartGeometry(0.16),
      puff: new THREE.SphereGeometry(0.1, 10, 8),
    };
    this.geos = geos;

    this.items = [];
    for (let i = 0; i < POOL; i++) {
      const mat = toonUnique(0xffffff, { transparent: true });
      const mesh = new THREE.Mesh(geos.sparkle, mat);
      mesh.visible = false;
      mesh.raycast = () => {};
      this.group.add(mesh);
      this.items.push({ mesh, life: 0, maxLife: 1, vel: new THREE.Vector3(), spin: 0, gravity: -1.2 });
    }
    this._cursor = 0;
  }

  _take() {
    for (let i = 0; i < POOL; i++) {
      const item = this.items[(this._cursor + i) % POOL];
      if (item.life <= 0) {
        this._cursor = (this._cursor + i + 1) % POOL;
        return item;
      }
    }
    return this.items[this._cursor];
  }

  /**
   * @param {'sparkle'|'bubble'|'heart'|'puff'} kind
   */
  burst(kind, position, count = 10, opts = {}) {
    const spread = opts.spread ?? 0.35;
    const speed = opts.speed ?? 1.4;
    const gravity = opts.gravity ?? (kind === 'bubble' ? 0.5 : -1.4);
    const color = opts.color ?? (
      kind === 'sparkle' ? PALETTE.star :
      kind === 'bubble' ? 0xffffff :
      kind === 'heart' ? PALETTE.pink : 0xfffaf0
    );
    const scale = opts.scale ?? 1;

    for (let i = 0; i < count; i++) {
      const item = this._take();
      const { mesh } = item;
      mesh.geometry = this.geos[kind];
      mesh.material.color.setHex(color);
      mesh.material.opacity = 1;
      mesh.visible = true;
      mesh.position.copy(position).add(new THREE.Vector3(
        (Math.random() - 0.5) * spread,
        (Math.random() - 0.5) * spread,
        (Math.random() - 0.5) * spread
      ));
      mesh.scale.setScalar(scale * (0.7 + Math.random() * 0.6));
      mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);

      const a = Math.random() * Math.PI * 2;
      const up = 0.5 + Math.random();
      item.vel.set(Math.cos(a) * speed * 0.5, up * speed, Math.sin(a) * speed * 0.5);
      item.gravity = gravity;
      item.spin = (Math.random() - 0.5) * 6;
      item.maxLife = opts.life ?? (0.8 + Math.random() * 0.6);
      item.life = item.maxLife;
    }
  }

  update(dt) {
    for (const item of this.items) {
      if (item.life <= 0) continue;
      item.life -= dt;
      if (item.life <= 0) {
        item.mesh.visible = false;
        continue;
      }
      item.vel.y += item.gravity * dt;
      item.mesh.position.addScaledVector(item.vel, dt);
      item.mesh.rotation.z += item.spin * dt;
      item.mesh.material.opacity = Math.min(1, item.life / (item.maxLife * 0.5));
    }
  }
}
