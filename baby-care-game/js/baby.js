import * as THREE from 'three';
import { toon } from './world.js';

const SKIN = 0xffdcc4;
const SKIN_DARK = 0xf5c8ac;
const HAIR = 0xb57a4a;

function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// まんが調のまるい3D赤ちゃん（プリミティブの組み合わせで作る）
export class Baby {
  constructor() {
    this.group = new THREE.Group();
    this.state = 'idle'; // idle | fussy | lying | happy
    this.blinkTimer = 2.5;
    this.blinkT = 0;
    this.homePos = new THREE.Vector3(0, 0, 0.35);
    this.build();
    this.group.position.copy(this.homePos);
  }

  build() {
    const skin = toon(SKIN);
    const g = this.group;

    // おしり（おむつの下の肌）とおむつ
    this.bareBottom = mesh(new THREE.SphereGeometry(0.29, 20, 16), toon(SKIN_DARK), 0, 0.32, 0);
    this.bareBottom.scale.set(1.0, 0.82, 1.0);
    g.add(this.bareBottom);

    this.diaper = new THREE.Group();
    const dia = mesh(new THREE.SphereGeometry(0.33, 20, 16), toon(0xffffff), 0, 0, 0);
    dia.scale.set(1.0, 0.8, 1.0);
    this.diaper.add(dia);
    const band = mesh(new THREE.TorusGeometry(0.285, 0.055, 10, 24), toon(0xffffff), 0, 0.13, 0);
    band.rotation.x = Math.PI / 2;
    this.diaper.add(band);
    const ribbon = mesh(new THREE.SphereGeometry(0.05, 10, 8), toon(0xffaecf), 0, 0.16, 0.28);
    this.diaper.add(ribbon);
    this.diaper.position.y = 0.32;
    g.add(this.diaper);

    // おなか
    this.torso = mesh(new THREE.CapsuleGeometry(0.28, 0.26, 8, 18), skin, 0, 0.64, 0);
    g.add(this.torso);
    g.add(mesh(new THREE.SphereGeometry(0.026, 8, 8), toon(SKIN_DARK), 0, 0.62, 0.275)); // おへそ

    // うで（かたの位置にピボットを置いて回す）
    this.arms = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.29, 0.76, 0.02);
      const arm = mesh(new THREE.CapsuleGeometry(0.085, 0.2, 6, 14), skin, 0, -0.14, 0);
      const hand = mesh(new THREE.SphereGeometry(0.095, 14, 12), skin, 0, -0.3, 0);
      pivot.add(arm, hand);
      pivot.rotation.z = side * 0.5;
      g.add(pivot);
      this.arms.push(pivot);
    }

    // あし（すわりポーズで前へ）
    this.legs = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.17, 0.33, 0.08);
      const leg = mesh(new THREE.CapsuleGeometry(0.1, 0.2, 6, 14), skin, 0, -0.15, 0);
      const foot = mesh(new THREE.SphereGeometry(0.105, 14, 12), skin, 0, -0.31, 0.02);
      foot.scale.set(0.95, 0.85, 1.15);
      pivot.add(leg, foot);
      pivot.rotation.x = -1.35;
      pivot.rotation.z = side * 0.25;
      g.add(pivot);
      this.legs.push(pivot);
    }

    // あたま（まる顔・おおきな目）
    const head = new THREE.Group();
    head.position.set(0, 1.26, 0);
    this.head = head;
    g.add(head);

    const skull = mesh(new THREE.SphereGeometry(0.34, 28, 22), skin, 0, 0, 0);
    skull.scale.set(1, 0.96, 0.97);
    head.add(skull);

    // みみ
    for (const side of [-1, 1]) {
      const ear = mesh(new THREE.SphereGeometry(0.07, 12, 10), skin, side * 0.325, -0.02, 0.01);
      ear.scale.set(0.6, 1, 0.8);
      head.add(ear);
    }

    // かみのけ（ちょこんとしたくるん）
    const curl = mesh(new THREE.TorusGeometry(0.075, 0.024, 8, 20, 4.4), toon(HAIR), 0.01, 0.33, 0.03);
    curl.rotation.set(0.25, 0.35, 1.2);
    head.add(curl);

    // おおきな目（ひらいた目）
    this.eyesOpen = [];
    for (const side of [-1, 1]) {
      const eye = new THREE.Group();
      eye.position.set(side * 0.135, 0.015, 0.27);
      const white = mesh(new THREE.SphereGeometry(0.088, 16, 14), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      white.scale.set(1, 1.15, 0.55);
      const iris = mesh(new THREE.SphereGeometry(0.055, 14, 12), new THREE.MeshBasicMaterial({ color: 0x4a3428 }), 0, 0, 0.038);
      iris.scale.set(1, 1.15, 0.5);
      const light1 = mesh(new THREE.SphereGeometry(0.02, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }), 0.02, 0.035, 0.068);
      const light2 = mesh(new THREE.SphereGeometry(0.011, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }), -0.018, -0.02, 0.068);
      eye.add(white, iris, light1, light2);
      head.add(eye);
      this.eyesOpen.push(eye);
    }

    // にっこり目（とじた笑い目）
    this.eyesHappy = [];
    for (const side of [-1, 1]) {
      const arc = mesh(
        new THREE.TorusGeometry(0.055, 0.016, 8, 16, Math.PI),
        new THREE.MeshBasicMaterial({ color: 0x4a3428 }),
        side * 0.135, 0.0, 0.3);
      arc.visible = false;
      head.add(arc);
      this.eyesHappy.push(arc);
    }

    // なみだ（ぐずったとき）
    this.tears = [];
    for (const side of [-1, 1]) {
      const tear = mesh(new THREE.SphereGeometry(0.03, 10, 8), new THREE.MeshBasicMaterial({ color: 0x7ec8ff }), side * 0.15, -0.09, 0.29);
      tear.scale.set(0.8, 1.3, 0.8);
      tear.visible = false;
      head.add(tear);
      this.tears.push(tear);
    }

    // ほっぺ・はな
    for (const side of [-1, 1]) {
      const cheek = mesh(new THREE.SphereGeometry(0.062, 12, 10), toon(0xffaEB9), side * 0.2, -0.08, 0.24);
      cheek.scale.set(1, 0.7, 0.5);
      head.add(cheek);
    }
    head.add(mesh(new THREE.SphereGeometry(0.028, 10, 8), toon(SKIN_DARK), 0, -0.035, 0.33));

    // くち（にっこり／へのじ／ぱっくり）
    const mouthMat = new THREE.MeshBasicMaterial({ color: 0x8a4a52 });
    this.mouthSmile = mesh(new THREE.TorusGeometry(0.05, 0.014, 8, 16, Math.PI), mouthMat, 0, -0.135, 0.3);
    this.mouthSmile.rotation.z = Math.PI;
    head.add(this.mouthSmile);
    this.mouthFrown = mesh(new THREE.TorusGeometry(0.042, 0.013, 8, 16, Math.PI), mouthMat, 0, -0.165, 0.3);
    this.mouthFrown.visible = false;
    head.add(this.mouthFrown);
    this.mouthOpen = mesh(new THREE.SphereGeometry(0.05, 12, 10), new THREE.MeshBasicMaterial({ color: 0xc2586e }), 0, -0.15, 0.29);
    this.mouthOpen.scale.set(1, 0.8, 0.4);
    this.mouthOpen.visible = false;
    head.add(this.mouthOpen);
  }

  setFace(name) {
    const openEyes = name === 'smile' || name === 'frown';
    for (const e of this.eyesOpen) e.visible = openEyes;
    for (const e of this.eyesHappy) e.visible = !openEyes;
    for (const t of this.tears) t.visible = name === 'frown';
    this.mouthSmile.visible = name === 'smile' || name === 'happysmile';
    this.mouthFrown.visible = name === 'frown';
    this.mouthOpen.visible = name === 'joy';
  }

  setState(state) {
    if (this.state === state) return;
    this.state = state;
    if (state === 'idle') this.setFace('smile');
    if (state === 'fussy') this.setFace('frown');
    if (state === 'happy') this.setFace('joy');
    if (state === 'lying') this.setFace('smile');
  }

  // おむつ・おしりのワールド座標（パーティクル用）
  bottomWorldPos(target = new THREE.Vector3()) {
    return this.diaper.getWorldPosition(target);
  }

  headWorldPos(target = new THREE.Vector3()) {
    return this.head.getWorldPosition(target);
  }

  update(t, dt) {
    // まばたき
    if (this.blinkT > 0) {
      this.blinkT -= dt;
      const closed = this.blinkT > 0.04;
      for (const e of this.eyesOpen) e.scale.y = closed ? 0.08 : 1;
    } else {
      this.blinkTimer -= dt;
      if (this.blinkTimer <= 0) {
        this.blinkTimer = 2.2 + Math.random() * 2.5;
        this.blinkT = 0.14;
      }
      for (const e of this.eyesOpen) e.scale.y = 1;
    }

    const s = this.state;
    if (s === 'idle' || s === 'fussy') {
      const speed = s === 'fussy' ? 5.2 : 2.1;
      const amp = s === 'fussy' ? 1.6 : 1;
      // よろこびバウンドのあとに、すっと元の高さへ戻す（移動トゥイーン中はさわらない）
      if (!this.tweenLock) {
        this.group.position.y += (this.baseY - this.group.position.y) * Math.min(1, dt * 8);
      }
      this.group.rotation.x = 0;
      this.group.rotation.z = Math.sin(t * speed * 0.7) * 0.03 * amp;
      this.head.rotation.z = Math.sin(t * speed * 0.8) * 0.07 * amp;
      this.head.rotation.x = s === 'fussy' ? 0.08 : Math.sin(t * 1.3) * 0.03;
      this.torso.scale.setScalar(1 + Math.sin(t * 3.2) * 0.015);
      for (let i = 0; i < 2; i++) {
        const side = i === 0 ? -1 : 1;
        this.arms[i].rotation.x = Math.sin(t * speed + i * 2) * 0.25 * amp - 0.15;
        this.arms[i].rotation.z = side * (0.5 + (s === 'fussy' ? Math.sin(t * 6 + i) * 0.35 : 0));
        this.legs[i].rotation.x = -1.35 + Math.sin(t * speed * 0.9 + i * 2.4) * 0.12 * amp;
      }
      if (s === 'fussy') {
        for (const tear of this.tears) tear.position.y = -0.09 - (t * 0.6 % 0.5) * 0.12;
      }
    } else if (s === 'lying') {
      // あおむけで足をばたばた
      this.head.rotation.set(0, 0, Math.sin(t * 1.8) * 0.06);
      this.group.rotation.z = 0;
      for (let i = 0; i < 2; i++) {
        this.arms[i].rotation.x = -0.6 + Math.sin(t * 3 + i * 2.6) * 0.3;
        this.arms[i].rotation.z = (i === 0 ? -1 : 1) * 0.9;
        this.legs[i].rotation.x = -2.1 + Math.sin(t * 4.2 + i * Math.PI) * 0.35;
      }
    } else if (s === 'happy') {
      const bounce = Math.abs(Math.sin(t * 6));
      this.group.rotation.x = 0;
      this.group.rotation.z = 0;
      this.group.position.y = this.baseY + bounce * 0.09;
      this.head.rotation.z = Math.sin(t * 6) * 0.1;
      for (let i = 0; i < 2; i++) {
        const side = i === 0 ? -1 : 1;
        this.arms[i].rotation.z = side * (2.4 + Math.sin(t * 8 + i) * 0.25);
        this.arms[i].rotation.x = 0;
        this.legs[i].rotation.x = -1.35 + bounce * 0.25;
      }
    }
  }

  get baseY() { return this._baseY || 0; }
  set baseY(v) { this._baseY = v; }
}
