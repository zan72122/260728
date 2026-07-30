/* ============================================================
 * pancake.js — パンケーキ本体（見た目・顔・状態データ）と塔の生成
 * ============================================================ */
(function () {
  const TONES = ['#eda963', '#f2b273', '#e8a25e', '#f6bd80', '#e69d58'];
  const RAINBOW = ['#ff8fa3', '#ffc48f', '#fff59d', '#a8e6cf', '#9fc9ff', '#d0b3ff'];

  let faceGeo = null;

  function rainbowTexture() {
    const c = PT.makeCanvas(16, 128), g = c.getContext('2d');
    const n = RAINBOW.length;
    for (let i = 0; i < n; i++) {
      g.fillStyle = RAINBOW[i];
      g.fillRect(0, (i / n) * 128, 16, 128 / n + 1);
    }
    return PT.srgb(new THREE.CanvasTexture(c));
  }

  class Pancake {
    constructor(idx, r, type) {
      this.idx = idx;
      this.r = r;
      this.h = PT.PANCAKE_H;
      this.type = type || 'normal';   // normal | rainbow | heart
      this.baseMass = 1 * (r / PT.PANCAKE_R) * (r / PT.PANCAKE_R);

      // ---- 物理状態 ----
      this.state = 'stack';           // stack | free | landed | served
      this.xz = new THREE.Vector2();  // 水平位置
      this.slideV = new THREE.Vector2();
      this.yCur = 0; this.yTarget = 0; this.yVel = 0;
      this.tiltA = 0; this.tiltTarget = 0;
      this.tiltDir = new THREE.Vector2(1, 0);
      this.wobble = 0;                // ぐらぐら量（見た目）
      this.wobblePh = PT.rand(0, 6.28);

      // ---- トッピング効果 ----
      this.muBase = 0.62;
      this.syrup = 0;                 // 0..1 下面のすべり
      this.butter = 0;                // 0..1（溶けたら効く）
      this.chocoBond = 0;             // 1で下と接着
      this.sticky = 0;                // クリームのねばり
      this.toppingMass = 0;
      this.comOff = new THREE.Vector2();
      this._comAcc = new THREE.Vector2();
      this.toppings = [];             // {mesh, mass, local(V2), kind, data}

      // ---- 見た目 ----
      this.appearDelay = 0;
      this.visibleNow = false;
      this.squash = 0; this.squashV = 0;
      this.faceKind = 'normal';
      this.blinkT = PT.rand(1, 4);

      this.buildMesh();
    }

    buildMesh() {
      const grp = new THREE.Group();
      this.mesh = grp;
      grp.userData.pancake = this;

      let mat;
      if (this.type === 'rainbow') {
        mat = new THREE.MeshStandardMaterial({ map: rainbowTexture(), roughness: 0.75 });
      } else if (this.type === 'heart') {
        mat = new THREE.MeshStandardMaterial({ color: 0xffb3cf, roughness: 0.75 });
      } else {
        mat = new THREE.MeshStandardMaterial({ map: PT.pancakeTexture(PT.pick(TONES)), roughness: 0.85 });
      }
      // ふっくらした本体（つぶした球）
      const body = new THREE.Mesh(new THREE.SphereGeometry(this.r, 22, 14), mat);
      body.scale.y = (this.h * 0.72) / this.r;
      body.position.y = 0;
      body.castShadow = true;
      body.receiveShadow = true;
      grp.add(body);
      this.bodyMesh = body;

      // 上面のクリーム色の丸
      const topCol = this.type === 'heart' ? 0xffd3e2 : 0xf9d9a8;
      const top = new THREE.Mesh(
        new THREE.CylinderGeometry(this.r * 0.8, this.r * 0.8, 0.045, 20),
        new THREE.MeshStandardMaterial({ color: topCol, roughness: 0.8 })
      );
      top.position.y = this.h * 0.34;
      grp.add(top);

      // 顔（側面・カメラの方をむく）
      const faces = PT.initFaceTextures();
      if (!faceGeo) {
        faceGeo = new THREE.PlaneGeometry(1.05, 0.52);
        faceGeo.userData.shared = true;
      }
      this.faceHolder = new THREE.Group();
      grp.add(this.faceHolder);
      this.faceMat = new THREE.MeshBasicMaterial({
        map: faces.normal, transparent: true, depthWrite: false,
      });
      const face = new THREE.Mesh(faceGeo, this.faceMat);
      face.position.z = this.r * 0.99;
      face.scale.setScalar(this.r / PT.PANCAKE_R);
      face.renderOrder = 2;
      this.faceHolder.add(face);

      // トッピング置き場
      this.topGroup = new THREE.Group();
      this.topGroup.position.y = this.h * 0.34;
      grp.add(this.topGroup);

      grp.visible = false;
    }

    setFace(kind) {
      if (this.faceKind === kind) return;
      this.faceKind = kind;
      this.faceMat.map = PT.faceTextures[kind];
    }

    totalMass() { return this.baseMass + this.toppingMass; }

    // トッピングを追加（local: パンケーキ中心からのXZオフセット）
    addTopping(kind, mass, local, mesh) {
      const t = { kind, mass, local: local.clone(), mesh };
      this.toppings.push(t);
      this.recomputeCom();
      return t;
    }

    removeTopping(t) {
      const i = this.toppings.indexOf(t);
      if (i >= 0) this.toppings.splice(i, 1);
      if (t.mesh && t.mesh.parent) t.mesh.parent.remove(t.mesh);
      this.recomputeCom();
    }

    recomputeCom() {
      let m = 0;
      const acc = this._comAcc.set(0, 0);
      this.toppings.forEach((t) => {
        m += t.mass;
        acc.x += t.local.x * t.mass;
        acc.y += t.local.y * t.mass;
      });
      this.toppingMass = m;
      const tm = this.totalMass();
      this.comOff.set(acc.x / tm, acc.y / tm);
    }

    // 現在の摩擦係数（下との界面）
    mu() {
      let m = this.muBase;
      m *= 1 - 0.85 * PT.clamp(this.syrup, 0, 1);
      m *= 1 - 0.88 * PT.clamp(this.butter, 0, 1);
      m *= 1 + 0.8 * PT.clamp(this.sticky, 0, 1);
      return Math.max(0.05, m);
    }

    doSquash(v) {
      this.squashV += v;
    }

    // スタック内の見た目更新
    syncStack(dt, camAz) {
      if (!this.visibleNow) return;
      // squashばね
      this.squashV += (-this.squash * 60 - this.squashV * 9) * dt;
      this.squash = PT.clamp(this.squash + this.squashV * dt, -0.5, 0.6);

      this.tiltA += (this.tiltTarget - this.tiltA) * Math.min(1, dt * 7);

      const wob = this.wobble * Math.sin(performance.now() * 0.011 + this.wobblePh) * 0.05;

      this.mesh.position.set(
        this.xz.x + this.tiltDir.x * wob,
        this.yCur,
        this.xz.y + this.tiltDir.y * wob
      );
      const dir = this.tiltDir;
      const ang = this.tiltA + this.wobble * Math.sin(performance.now() * 0.009 + this.wobblePh) * 0.04;
      _axis.set(dir.y, 0, -dir.x).normalize();
      if (_axis.lengthSq() < 0.5) _axis.set(0, 0, -1);
      this.mesh.quaternion.setFromAxisAngle(_axis, ang);

      const s = this.squash;
      this.mesh.scale.set(1 + s * 0.3, 1 - s * 0.45, 1 + s * 0.3);

      // 顔をカメラへ
      const d = Math.atan2(
        PT.World.camera.position.x - this.mesh.position.x,
        PT.World.camera.position.z - this.mesh.position.z
      );
      this.faceHolder.rotation.y = d;

      // まばたき
      this.blinkT -= dt;
      if (this.faceKind === 'normal' && this.blinkT < 0.13 && this.blinkT > 0) {
        this.faceMat.map = PT.faceTextures.blink;
      } else if (this.blinkT <= 0) {
        this.blinkT = PT.rand(1.6, 4.5);
        this.faceMat.map = PT.faceTextures[this.faceKind];
      }
    }
  }
  const _axis = new THREE.Vector3();
  PT.Pancake = Pancake;

  // ============ 塔の生成 ============
  PT.buildTower = function (round) {
    const count = Math.min(6 + round + PT.randi(0, 1), 16);
    const jitter = 0.05 + Math.min(round * 0.012, 0.1);
    const pancakes = [];
    let wx = 0, wz = 0;
    // レインボー/ハートの位置
    let rainbowAt = round >= 2 ? PT.randi(1, count - 2) : -1;
    let heartAt = round >= 4 && Math.random() < 0.6 ? PT.randi(2, count - 1) : -1;
    if (heartAt === rainbowAt) heartAt = -1;

    for (let i = 0; i < count; i++) {
      const taper = 1 - i * 0.013;
      const r = PT.PANCAKE_R * taper * PT.rand(0.93, 1.07);
      let type = 'normal';
      if (i === rainbowAt) type = 'rainbow';
      else if (i === heartAt) type = 'heart';
      const p = new PT.Pancake(i, r, type);
      // 少しずつずれて積まれている（毎回違う塔）
      wx += PT.rand(-jitter, jitter) * PT.PANCAKE_R * 2;
      wz += PT.rand(-jitter, jitter) * PT.PANCAKE_R * 2;
      wx *= 0.85; wz *= 0.85;
      p.xz.set(wx, wz);
      p.appearDelay = 0.35 + i * 0.24;
      pancakes.push(p);
    }
    return pancakes;
  };
})();
