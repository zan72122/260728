/* =========================================================
 * baby.js — 超デフォルメ（約2頭身）のトゥーン調 3D 赤ちゃん
 * すべてプリミティブから組み立て、コードでアニメーションする
 * ========================================================= */
(function () {
  'use strict';

  const SKIN = 0xffdcc2;
  const SKIN_DARK = 0xf5c3a5;
  const ONESIE = 0xfff3d6;
  const DIAPER = 0xffffff;
  const DIAPER_DIRTY = 0xe8d3a0;
  const EYE = 0x4a3324;
  const CHEEK = 0xffa9c1;
  const MOUTH_IN = 0xc9584f;

  class Baby {
    constructor(toonMat) {
      this.toonMat = toonMat;
      this.group = new THREE.Group();
      this.anim = 'idle';
      this.animT = 0;
      this._blinkT = 0;
      this._nextBlink = 2 + Math.random() * 3;
      this._buildBody();
      this._buildFace();
      this._buildAccessories();
      this.setFace('neutral');
    }

    /* ---------- 体 ---------- */

    _buildBody() {
      const g = this.group;
      const skinMat = this.toonMat(SKIN);

      // あし
      this.legs = [];
      [-1, 1].forEach((s) => {
        const leg = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), skinMat);
        leg.scale.set(0.15, 0.2, 0.15);
        leg.position.set(s * 0.16, 0.16, 0.05);
        leg.castShadow = true;
        g.add(leg);
        this.legs.push(leg);
      });

      // おむつ
      this.diaperMat = this.toonMat(DIAPER);
      this.diaper = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 12), this.diaperMat);
      this.diaper.scale.set(0.31, 0.25, 0.29);
      this.diaper.position.y = 0.38;
      this.diaper.castShadow = true;
      g.add(this.diaper);

      // からだ（ロンパース）
      this.body = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 14), this.toonMat(ONESIE));
      this.body.scale.set(0.33, 0.32, 0.3);
      this.body.position.y = 0.6;
      this.body.castShadow = true;
      g.add(this.body);

      // えり
      const collar = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.045, 8, 20), this.toonMat(0xaee4d3));
      collar.rotation.x = Math.PI / 2;
      collar.position.y = 0.86;
      g.add(collar);

      // うで（肩にピボット）
      this.arms = [];
      [-1, 1].forEach((s) => {
        const pivot = new THREE.Group();
        pivot.position.set(s * 0.28, 0.72, 0);
        const arm = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), skinMat);
        arm.scale.set(0.11, 0.19, 0.11);
        arm.position.set(s * 0.03, -0.13, 0.02);
        arm.castShadow = true;
        pivot.add(arm);
        pivot.userData.side = s;
        g.add(pivot);
        this.arms.push(pivot);
      });

      // あたま
      this.head = new THREE.Group();
      this.head.position.y = 1.2;
      g.add(this.head);

      this.headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.45, 24, 20), skinMat);
      this.headMesh.scale.set(1, 0.94, 0.96);
      this.headMesh.castShadow = true;
      this.head.add(this.headMesh);

      // みみ
      [-1, 1].forEach((s) => {
        const ear = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), skinMat);
        ear.position.set(s * 0.43, -0.02, 0.02);
        this.head.add(ear);
      });

      // かみの毛（くるん）
      const curl = new THREE.Mesh(
        new THREE.TorusGeometry(0.07, 0.024, 8, 16, Math.PI * 1.4),
        this.toonMat(0xe8a95f)
      );
      curl.position.set(0.02, 0.42, 0.04);
      curl.rotation.set(-0.4, 0.3, 0.5);
      this.head.add(curl);
    }

    /* ---------- 顔 ---------- */

    _buildFace() {
      const h = this.head;
      const eyeMat = new THREE.MeshBasicMaterial({ color: EYE });
      const hlMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

      // ひらいた目（大きな黒目 + ハイライト）
      this.eyesOpen = new THREE.Group();
      [-1, 1].forEach((s) => {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.095, 14, 12), eyeMat);
        eye.scale.set(1, 1.3, 0.5);
        eye.position.set(s * 0.18, 0.03, 0.375);
        this.eyesOpen.add(eye);
        const hl = new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 8), hlMat);
        hl.position.set(s * 0.18 + 0.032, 0.085, 0.44);
        this.eyesOpen.add(hl);
        const hl2 = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 8), hlMat);
        hl2.position.set(s * 0.18 - 0.025, -0.01, 0.45);
        this.eyesOpen.add(hl2);
      });
      h.add(this.eyesOpen);

      // とじた目（「∩」のアーチ）
      this.eyesClosed = new THREE.Group();
      [-1, 1].forEach((s) => {
        const arc = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.017, 8, 14, Math.PI), eyeMat);
        arc.position.set(s * 0.18, 0.0, 0.4);
        this.eyesClosed.add(arc);
      });
      h.add(this.eyesClosed);

      // ぎゅっと閉じた目（泣き顔「><」用に少し傾ける）
      this.eyesCry = new THREE.Group();
      [-1, 1].forEach((s) => {
        const arc = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.018, 8, 14, Math.PI), eyeMat);
        arc.position.set(s * 0.18, 0.0, 0.4);
        arc.rotation.z = Math.PI + s * 0.35; // 「><」ぎみに下向きアーチ
        this.eyesCry.add(arc);
      });
      h.add(this.eyesCry);

      // ほっぺ
      [-1, 1].forEach((s) => {
        const blush = new THREE.Mesh(
          new THREE.CircleGeometry(0.075, 16),
          new THREE.MeshBasicMaterial({ color: CHEEK })
        );
        blush.position.set(s * 0.3, -0.12, 0.315);
        blush.rotation.y = s * 0.55;
        h.add(blush);
      });

      // はな
      const nose = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 8), this.toonMat(SKIN_DARK));
      nose.position.set(0, -0.05, 0.44);
      h.add(nose);

      // くち（にっこり／への字／ぱっくり）
      const mouthMat = new THREE.MeshBasicMaterial({ color: MOUTH_IN });
      this.mouthSmile = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.018, 8, 14, Math.PI), mouthMat);
      this.mouthSmile.position.set(0, -0.14, 0.41);
      this.mouthSmile.rotation.z = Math.PI; // 下向きアーチ = にっこり
      h.add(this.mouthSmile);

      this.mouthFrown = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.016, 8, 14, Math.PI), mouthMat);
      this.mouthFrown.position.set(0, -0.19, 0.41);
      h.add(this.mouthFrown);

      this.mouthOpen = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), mouthMat);
      this.mouthOpen.scale.set(0.9, 1.15, 0.35);
      this.mouthOpen.position.set(0, -0.17, 0.4);
      h.add(this.mouthOpen);
    }

    /* ---------- 小道具 ---------- */

    _buildAccessories() {
      // ミルクびん
      this.bottle = new THREE.Group();
      const glass = new THREE.Mesh(
        new THREE.CylinderGeometry(0.09, 0.09, 0.24, 14),
        new THREE.MeshToonMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 })
      );
      glass.position.y = 0.12;
      this.bottle.add(glass);
      this.milk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.075, 0.075, 0.2, 12),
        new THREE.MeshBasicMaterial({ color: 0xfffdf2 })
      );
      this.milk.position.y = 0.11;
      this.bottle.add(this.milk);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.075, 0.05, 12), this.toonMat(0xffb264));
      cap.position.y = 0.265;
      this.bottle.add(cap);
      const nipple = new THREE.Mesh(new THREE.SphereGeometry(0.038, 10, 8), this.toonMat(0xffb264));
      nipple.scale.set(1, 1.4, 1);
      nipple.position.y = 0.31;
      this.bottle.add(nipple);
      this.bottle.visible = false;
      this.group.add(this.bottle);

      // ガラガラ（右手に持つ）
      this.rattle = new THREE.Group();
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.16, 8), this.toonMat(0xffffff));
      this.rattle.add(handle);
      const rBall = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), this.toonMat(0xff8fbf));
      rBall.position.y = 0.13;
      this.rattle.add(rBall);
      const rStripe = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.018, 6, 16), this.toonMat(0xffe08a));
      rStripe.position.y = 0.13;
      rStripe.rotation.x = Math.PI / 2;
      this.rattle.add(rStripe);
      this.rattle.position.set(0, -0.3, 0.06);
      this.rattle.visible = false;
      this.arms[1].add(this.rattle);

      // あひるちゃん（おふろ用）
      this.duck = new THREE.Group();
      const duckBody = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), this.toonMat(0xffdb5c));
      duckBody.scale.set(1.25, 0.85, 1);
      this.duck.add(duckBody);
      const duckHead = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 10), this.toonMat(0xffdb5c));
      duckHead.position.set(0.1, 0.12, 0);
      this.duck.add(duckHead);
      const beak = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.06, 8), this.toonMat(0xff9040));
      beak.rotation.z = -Math.PI / 2;
      beak.position.set(0.18, 0.11, 0);
      this.duck.add(beak);
      const dEye = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 6), new THREE.MeshBasicMaterial({ color: 0x333333 }));
      dEye.position.set(0.13, 0.15, 0.05);
      this.duck.add(dEye);
      this.duck.visible = false;
      this.group.add(this.duck);

      // スポンジ
      this.sponge = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 0.12), this.toonMat(0xfff08a));
      this.sponge.visible = false;
      this.group.add(this.sponge);
    }

    /* ---------- 表情 ---------- */

    setFace(face) {
      this.face = face;
      const show = (m, v) => { m.visible = v; };
      show(this.eyesOpen, false);
      show(this.eyesClosed, false);
      show(this.eyesCry, false);
      show(this.mouthSmile, false);
      show(this.mouthFrown, false);
      show(this.mouthOpen, false);
      switch (face) {
        case 'happy':
          show(this.eyesClosed, true); // にこにこ「∩∩」
          show(this.mouthOpen, true);
          this.mouthOpen.scale.set(1.1, 1.0, 0.35);
          break;
        case 'sad':
          show(this.eyesOpen, true);
          show(this.mouthFrown, true);
          break;
        case 'cry':
          show(this.eyesCry, true);
          show(this.mouthOpen, true);
          this.mouthOpen.scale.set(0.95, 1.35, 0.35);
          break;
        case 'sleep':
          show(this.eyesClosed, true);
          show(this.mouthSmile, true);
          break;
        case 'drink':
          show(this.eyesClosed, true);
          show(this.mouthOpen, true);
          this.mouthOpen.scale.set(0.7, 0.8, 0.35);
          break;
        default: // neutral
          show(this.eyesOpen, true);
          show(this.mouthSmile, true);
      }
    }

    setAnim(name) {
      if (this.anim === name) return;
      this.anim = name;
      this.animT = 0;
      // 小道具の表示をリセット
      this.bottle.visible = (name === 'drink');
      this.rattle.visible = (name === 'play');
      this.duck.visible = (name === 'bath');
      this.sponge.visible = (name === 'bath');
      // 表情
      const faces = {
        idle: 'neutral', happy: 'happy', cry: 'cry', sleep: 'sleep',
        drink: 'drink', play: 'happy', bath: 'happy', diaper: 'happy', tickle: 'happy',
      };
      this.setFace(faces[name] || 'neutral');
    }

    setDiaperDirty(dirty) {
      this.diaperMat.color.setHex(dirty ? DIAPER_DIRTY : DIAPER);
    }

    setMilkLevel(level01) {
      const l = Math.max(0.02, level01);
      this.milk.scale.y = l;
      this.milk.position.y = 0.01 + 0.1 * l;
    }

    /* ---------- ワールド座標ヘルパー ---------- */

    getHeadTopWorld(out) {
      out = out || new THREE.Vector3();
      out.set(0, 0.5, 0).applyMatrix4(this.head.matrixWorld);
      return out;
    }

    getEyeWorld(side, out) {
      out = out || new THREE.Vector3();
      out.set(side * 0.2, -0.02, 0.42).applyMatrix4(this.head.matrixWorld);
      return out;
    }

    /* ---------- 毎フレーム更新 ---------- */

    update(dt) {
      this.animT += dt;
      const t = this.animT;
      const g = this.group;

      // デフォルト姿勢に戻してから各アニメで上書き
      g.scale.set(1, 1, 1);
      g.rotation.set(0, g.rotation.y, 0);
      this.head.rotation.set(0, 0, 0);
      this.head.position.x = 0;
      this.head.position.y = 1.2;
      g.position.y = 0;
      this.legs.forEach((leg) => { leg.position.y = 0.16; });

      switch (this.anim) {
        case 'idle': {
          const bob = Math.sin(t * 2.2) * 0.02;
          g.scale.y = 1 + bob;
          this.head.rotation.z = Math.sin(t * 0.9) * 0.06;
          this.head.rotation.y = Math.sin(t * 0.5) * 0.15;
          this.arms.forEach((a) => {
            a.rotation.z = a.userData.side * (0.35 + Math.sin(t * 2.2) * 0.08);
          });
          // まばたき
          this._blinkT += dt;
          if (this._blinkT > this._nextBlink) {
            this._blinkT = 0;
            this._nextBlink = 1.8 + Math.random() * 3.2;
          }
          const blinking = this._blinkT < 0.13 && this.face === 'neutral';
          this.eyesOpen.visible = this.face === 'neutral' && !blinking;
          this.eyesClosed.visible = this.face === 'sleep' || this.face === 'happy' || blinking;
          break;
        }
        case 'happy': {
          const jump = Math.abs(Math.sin(t * 5.5)) * 0.16;
          g.position.y = jump;
          g.scale.y = 1 + Math.sin(t * 11) * 0.05;
          this.arms.forEach((a) => {
            a.rotation.z = a.userData.side * (2.4 + Math.sin(t * 10) * 0.3);
          });
          this.head.rotation.z = Math.sin(t * 5.5) * 0.1;
          break;
        }
        case 'cry': {
          g.rotation.z = Math.sin(t * 7) * 0.05;
          this.head.rotation.z = Math.sin(t * 7 + 1) * 0.09;
          g.scale.y = 1 + Math.sin(t * 14) * 0.02;
          this.arms.forEach((a) => {
            a.rotation.z = a.userData.side * (1.2 + Math.sin(t * 12 + a.userData.side) * 0.5);
          });
          break;
        }
        case 'sleep': {
          const breathe = Math.sin(t * 1.4) * 0.03;
          g.scale.y = 1 + breathe;
          g.scale.x = 1 - breathe * 0.5;
          this.head.rotation.z = 0.14;
          this.head.position.y = 1.17;
          this.arms.forEach((a) => { a.rotation.z = a.userData.side * 0.25; });
          break;
        }
        case 'drink': {
          this.head.rotation.x = -0.18;
          const gulpPulse = 1 + Math.max(0, Math.sin(t * 6)) * 0.04;
          g.scale.set(gulpPulse, 1, gulpPulse);
          this.arms.forEach((a) => { a.rotation.z = a.userData.side * 1.5; });
          // びんを口もとへ（ななめ下から乳首が口に向くように）
          this.bottle.position.set(-0.15, 0.88, 0.66);
          this.bottle.rotation.x = -0.93 + Math.sin(t * 6) * 0.03;
          this.bottle.rotation.z = -0.5;
          break;
        }
        case 'play': {
          const hop = Math.abs(Math.sin(t * 4)) * 0.1;
          g.position.y = hop;
          this.arms[1].rotation.z = 2.0 + Math.sin(t * 14) * 0.5; // ガラガラふりふり
          this.arms[0].rotation.z = -0.6 + Math.sin(t * 4) * 0.2;
          this.head.rotation.z = Math.sin(t * 4) * 0.12;
          break;
        }
        case 'bath': {
          g.scale.y = 1 + Math.sin(t * 3) * 0.03;
          this.head.rotation.y = Math.sin(t * 1.6) * 0.25;
          this.arms.forEach((a) => {
            a.rotation.z = a.userData.side * (0.8 + Math.sin(t * 6 + a.userData.side * 2) * 0.4);
          });
          // あひるがまわりをぷかぷか
          const da = t * 1.4;
          this.duck.position.set(Math.cos(da) * 0.65, 0.12 + Math.sin(t * 3) * 0.04, Math.sin(da) * 0.65 + 0.15);
          this.duck.rotation.y = -da + Math.PI / 2;
          // スポンジがくるくる
          const sa = -t * 2.2;
          this.sponge.position.set(Math.cos(sa) * 0.45, 0.75 + Math.sin(t * 4) * 0.25, Math.sin(sa) * 0.45);
          this.sponge.rotation.set(t * 3, t * 2, 0);
          break;
        }
        case 'diaper': {
          g.scale.y = 1 + Math.sin(t * 9) * 0.03;
          this.legs.forEach((leg, i) => {
            leg.position.y = 0.16 + Math.max(0, Math.sin(t * 8 + i * Math.PI)) * 0.08;
          });
          this.arms.forEach((a) => { a.rotation.z = a.userData.side * 1.8; });
          break;
        }
        case 'tickle': {
          g.rotation.z = Math.sin(t * 18) * 0.08;
          g.scale.y = 1 + Math.sin(t * 18) * 0.05;
          this.arms.forEach((a) => {
            a.rotation.z = a.userData.side * (1.5 + Math.sin(t * 16) * 0.6);
          });
          break;
        }
      }
    }
  }

  window.Baby = Baby;
})();
