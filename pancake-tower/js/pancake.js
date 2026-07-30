/* ============================================================
 * pancake.js — パンケーキ本体（見た目・顔・ふわもち変形）と塔の生成
 * ============================================================ */
(function () {
  const TONES = ['#eda963', '#f2b273', '#e8a25e', '#f6bd80', '#e69d58'];
  const RAINBOW = ['#ff8fa3', '#ffc48f', '#fff59d', '#a8e6cf', '#9fc9ff', '#d0b3ff'];

  let faceGeo = null;

  // 上面のクリーム色まで焼き込んだ生地テクスチャ
  // （つぶした球のUV: キャンバス上端=上面, 中央=側面, 下端=底）
  function bakeTexture(drawSide) {
    const w = 128, h = 128;
    const c = PT.makeCanvas(w, h), g = c.getContext('2d');
    drawSide(g, w, h);
    // 上面: 明るいクリーム色（ふんわりグラデ）
    const gr = g.createLinearGradient(0, 0, 0, h * 0.48);
    gr.addColorStop(0, 'rgba(250,220,168,1)');
    gr.addColorStop(0.75, 'rgba(250,218,160,0.9)');
    gr.addColorStop(1, 'rgba(250,215,150,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h * 0.48);
    return PT.srgb(new THREE.CanvasTexture(c));
  }

  function pancakeTexture(tone) {
    return bakeTexture((g, w, h) => {
      g.fillStyle = tone;
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 26; i++) {
        g.fillStyle = `rgba(190,120,50,${PT.rand(0.04, 0.12)})`;
        g.beginPath();
        g.arc(PT.rand(0, w), PT.rand(h * 0.4, h), PT.rand(4, 14), 0, 7);
        g.fill();
      }
    });
  }

  function rainbowTexture() {
    return bakeTexture((g, w, h) => {
      const n = RAINBOW.length;
      for (let i = 0; i < n; i++) {
        g.fillStyle = RAINBOW[i];
        g.fillRect(0, (i / n) * h, w, h / n + 1);
      }
    });
  }

  function heartTexture() {
    return bakeTexture((g, w, h) => {
      g.fillStyle = '#ffb3cf';
      g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,255,255,0.25)';
      for (let i = 0; i < 10; i++) {
        g.beginPath();
        g.arc(PT.rand(0, w), PT.rand(h * 0.4, h), PT.rand(3, 8), 0, 7);
        g.fill();
      }
    });
  }

  class Pancake {
    constructor(idx, r, type) {
      this.idx = idx;
      this.r = r;
      this.h = PT.PANCAKE_H;
      this.type = type || 'normal';   // normal | rainbow | heart
      this.baseMass = 1 * (r / PT.PANCAKE_R) * (r / PT.PANCAKE_R);

      // ---- 物理状態 ----
      this.state = 'stack';           // stack | tipping | free | landed | served
      this.xz = new THREE.Vector2();  // 水平位置
      this.slideV = new THREE.Vector2(); // 水平速度（絶対）
      this.relSpeed = 0;              // 下の層との相対速度
      this.yCur = 0; this.yTarget = 0; this.yVel = 0;
      this.tiltA = 0; this.tiltTarget = 0;   // 自分のふち乗り傾き
      this.tiltDir = new THREE.Vector2(1, 0);
      this.tvX = 0; this.tvY = 0;     // 実効傾きベクトル（下からの持ち越し込み）
      this.wobble = 0;
      this.wobblePh = PT.rand(0, 6.28);

      // ---- トッピング効果 ----
      this.muBase = 0.62;
      this.syrup = 0;
      this.butter = 0;
      this.chocoBond = 0;
      this.sticky = 0;
      this.toppingMass = 0;
      this.comOff = new THREE.Vector2();
      this._comAcc = new THREE.Vector2();
      this.toppings = [];

      // ---- ふわもち変形 ----
      this.drapeCur = 0; this.drapeTarget = 0;
      this.drapeDirX = 1; this.drapeDirY = 0;
      this.jiggleAmp = 0;
      this.jigglePhase = PT.rand(0, 6.28);
      this._u = null;                 // シェーダーuniforms

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

      let map;
      if (this.type === 'rainbow') map = rainbowTexture();
      else if (this.type === 'heart') map = heartTexture();
      else map = pancakeTexture(PT.pick(TONES));
      const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.85 });

      // ふわもち頂点シェーダー（たれ下がり + ぷるん波）
      const self = this;
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uDrape = { value: new THREE.Vector2(0, 0) };
        shader.uniforms.uJiggle = { value: 0 };
        shader.uniforms.uJPhase = { value: 0 };
        shader.uniforms.uR = { value: self.r };
        shader.uniforms.uYFac = { value: self.r / (self.h * 0.72) };
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>',
            '#include <common>\nuniform vec2 uDrape;\nuniform float uJiggle;\nuniform float uJPhase;\nuniform float uR;\nuniform float uYFac;')
          .replace('#include <begin_vertex>', [
            '#include <begin_vertex>',
            '{',
            '  float rr = length(transformed.xz) / uR;',
            '  float dl = length(uDrape);',
            '  if (dl > 0.0001) {',
            '    float over = max(0.0, dot(transformed.xz / uR, uDrape / dl));',
            '    transformed.y -= dl * over * over * uYFac;',
            '  }',
            '  transformed.y += uJiggle * sin(rr * 9.0 - uJPhase) * rr * uYFac;',
            '}',
          ].join('\n'));
        self._u = shader.uniforms;
      };

      // ふっくらした本体（つぶした球・上面色はテクスチャに焼き込み済み）
      const body = new THREE.Mesh(new THREE.SphereGeometry(this.r, 26, 18), mat);
      body.scale.y = (this.h * 0.72) / this.r;
      body.castShadow = true;
      body.receiveShadow = true;
      grp.add(body);
      this.bodyMesh = body;

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

    mu() {
      let m = this.muBase;
      m *= 1 - 0.85 * PT.clamp(this.syrup, 0, 1);
      m *= 1 - 0.88 * PT.clamp(this.butter, 0, 1);
      m *= 1 + 0.8 * PT.clamp(this.sticky, 0, 1);
      return Math.max(0.05, m);
    }

    doSquash(v) { this.squashV += v; }

    // ぷるんと揺らす（衝撃・つんつん・マイクロスリップ）
    jiggle(amp) { this.jiggleAmp = Math.min(1, this.jiggleAmp + amp); }

    // ふわもち変形のuniform更新（毎フレーム・全状態共通）
    updateDeform(dt) {
      this.drapeCur += (this.drapeTarget - this.drapeCur) * Math.min(1, dt * 6);
      this.jiggleAmp *= Math.pow(0.006, dt);
      this.jigglePhase += dt * 24;
      if (!this._u) return;
      this._u.uDrape.value.set(
        this.drapeDirX * this.drapeCur * 0.45,
        this.drapeDirY * this.drapeCur * 0.45
      );
      this._u.uJiggle.value = this.jiggleAmp * 0.13;
      this._u.uJPhase.value = this.jigglePhase;
    }

    // スタック内の見た目更新
    syncStack(dt) {
      if (!this.visibleNow) return;
      // squashばね
      this.squashV += (-this.squash * 60 - this.squashV * 9) * dt;
      this.squash = PT.clamp(this.squash + this.squashV * dt, -0.5, 0.6);

      const wob = this.wobble * Math.sin(performance.now() * 0.011 + this.wobblePh) * 0.05;

      this.mesh.position.set(
        this.xz.x + this.tiltDir.x * wob,
        this.yCur,
        this.xz.y + this.tiltDir.y * wob
      );

      // 実効傾き（自分のふち乗り + 下からのしなり）で姿勢を決める
      let ta = Math.hypot(this.tvX, this.tvY);
      let dx = 1, dz = 0;
      if (ta > 1e-3) { dx = this.tvX / ta; dz = this.tvY / ta; }
      else { dx = this.tiltDir.x; dz = this.tiltDir.y; }
      ta = Math.min(ta, 0.95);
      ta += this.wobble * Math.sin(performance.now() * 0.009 + this.wobblePh) * 0.04;
      _axis.set(dz, 0, -dx);
      if (_axis.lengthSq() < 0.5) _axis.set(0, 0, -1);
      _axis.normalize();
      this.mesh.quaternion.setFromAxisAngle(_axis, ta);

      const s = this.squash;
      this.mesh.scale.set(1 + s * 0.3, 1 - s * 0.45, 1 + s * 0.3);

      // 顔をカメラへ
      const d = Math.atan2(
        PT.World.camera.position.x - this.mesh.position.x,
        PT.World.camera.position.z - this.mesh.position.z
      );
      this.faceHolder.rotation.y = d;

      this.updateDeform(dt);

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
