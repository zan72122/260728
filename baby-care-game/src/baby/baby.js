import * as THREE from 'three';
import { PALETTE, toon, toonUnique } from '../scene/palette.js';
import { STATIONS } from '../scene/props.js';
import { outlineAll } from '../util/outline.js';
import { clamp, damp, lerp, tween, easeInOutQuad, easeOutBack } from '../util/tween.js';

// 現実寄りの4頭身。あたま R=0.17 を基準に、全部の寸法を決めている。
const HEAD_R = 0.17;

// 部屋のなかで しっかり主役に見える大きさに、モデル全体を拡大する
export const BABY_SCALE = 1.4;

// ポーズごとの 関節の角度と、床からの持ち上げ量
const POSES = {
  sit: {
    lift: 0.16,
    tilt: 0,
    shift: 0,
    hip: { x: -1.35, z: 0.22 },
    knee: { x: 0.55 },
    shoulder: { x: 0.1, z: 0.55 },
    elbow: { x: -0.5 },
  },
  lie: {
    lift: 0.17,
    tilt: -Math.PI / 2,
    shift: 0.32,          // あたまが台からはみ出さないように 足もと側へ
    
    hip: { x: -0.55, z: 0.34 },
    knee: { x: 0.9 },
    shoulder: { x: -0.15, z: 0.7 },
    elbow: { x: -0.75 },
  },
  held: {
    lift: 0.2,
    tilt: -0.35,
    shift: 0,
    hip: { x: -1.0, z: 0.3 },
    knee: { x: 0.7 },
    shoulder: { x: 0.0, z: 0.7 },
    elbow: { x: -0.4 },
  },
};

const EXPRESSIONS = {
  neutral: { brow: 0.0, browY: 0, eye: 1, mouth: 'smile', mouthScale: 0.85 },
  happy:   { brow: 0.12, browY: 0.01, eye: 0.85, mouth: 'smile', mouthScale: 1.15 },
  laugh:   { brow: 0.16, browY: 0.012, eye: 0.15, mouth: 'open', mouthScale: 1.0 },
  fussy:   { brow: -0.42, browY: -0.012, eye: 0.7, mouth: 'pout', mouthScale: 1.0 },
  sleepy:  { brow: -0.05, browY: -0.004, eye: 0.12, mouth: 'smile', mouthScale: 0.6 },
  sleeping:{ brow: 0.0, browY: 0, eye: 0.06, mouth: 'smile', mouthScale: 0.5 },
};

export class Baby {
  constructor() {
    this.group = new THREE.Group();         // 部屋のなかでの位置と向き
    this.group.scale.setScalar(BABY_SCALE);
    this.bob = new THREE.Group();           // 呼吸やジャンプの上下
    this.pose = new THREE.Group();          // すわる／ねる の姿勢
    this.group.add(this.bob);
    this.bob.add(this.pose);

    this.touchTargets = [];
    this._build();

    this.station = 'rug';
    this.poseName = 'sit';
    this._applyPose(POSES.sit, true);
    const st = STATIONS.rug;
    this.group.position.copy(st.spot);
    this.group.position.y += POSES.sit.lift * BABY_SCALE;
    this.group.rotation.y = st.face;

    this.expression = 'neutral';
    this._expr = { ...EXPRESSIONS.neutral };
    this._blinkTimer = 2 + Math.random() * 2;
    this._blink = 0;
    this._kick = 0;
    this._lookEnabled = true;
    this._headYaw = 0;
    this._headPitch = 0;
    this._tmp = new THREE.Vector3();
    this._moving = false;
  }

  // ------------------------------------------------------------- モデル

  _build() {
    const skin = toon(PALETTE.skin);

    // どうたい（おなかは まるく）
    this.torso = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 16), skin);
    this.torso.scale.set(0.205, 0.245, 0.175);
    this.torso.position.y = 0.19;
    this.pose.add(this.torso);
    this._shade(this.torso);

    const chest = new THREE.Mesh(new THREE.SphereGeometry(0.155, 16, 14), skin);
    chest.position.y = 0.33;
    chest.scale.set(1.1, 0.85, 0.95);
    this.pose.add(chest);
    this._shade(chest);

    // おむつ（交換で ずらすので、ひとつのグループにまとめる）
    this.diaperGroup = new THREE.Group();
    this.pose.add(this.diaperGroup);

    this.diaper = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 14), toonUnique(PALETTE.cream));
    this.diaper.scale.set(0.2, 0.16, 0.185);
    this.diaper.position.y = 0.03;
    this.diaperGroup.add(this.diaper);
    this._shade(this.diaper);

    const band = new THREE.Mesh(new THREE.TorusGeometry(0.185, 0.022, 8, 20), toonUnique(PALETTE.sky));
    band.rotation.x = Math.PI / 2;
    band.position.y = 0.12;
    band.scale.set(1, 0.92, 1);
    this.diaperGroup.add(band);
    this.diaperBand = band;

    // よごれ（おむつ交換のときだけ 見せる）
    this.diaperSpots = [];
    for (const [x, y, z] of [[-0.055, 0.0, 0.165], [0.06, -0.03, 0.16], [0.0, 0.045, 0.17]]) {
      const spot = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), toonUnique(PALETTE.dirt));
      spot.position.set(x, y, z);
      spot.scale.set(1.2, 0.9, 0.5);
      spot.visible = false;
      spot.userData.noOutline = true;
      this.diaperGroup.add(spot);
      this.diaperSpots.push(spot);
    }

    // くび と あたま
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.08, 12), skin);
    neck.position.y = 0.42;
    this.pose.add(neck);

    this.headPivot = new THREE.Group();
    this.headPivot.position.y = 0.45;
    this.pose.add(this.headPivot);

    this.head = new THREE.Mesh(new THREE.SphereGeometry(HEAD_R, 24, 20), skin);
    this.head.position.y = 0.15;
    this.head.scale.set(1, 0.97, 0.98);
    this.headPivot.add(this.head);
    this._shade(this.head);
    this.touchTargets.push(this.head, this.torso);

    this._buildFace();
    this._buildLimbs(skin);

    // 輪郭線は主役の赤ちゃんだけに付ける
    outlineAll(this.pose, 1.035);
  }

  _buildFace() {
    const head = this.head;
    const eyeMat = toon(PALETTE.eye);

    this.eyes = [];
    this.brows = [];
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.032, 14, 12), eyeMat);
      eye.position.set(side * 0.062, 0.012, 0.152);
      eye.scale.set(0.95, 1.15, 0.5);
      eye.userData.noOutline = true;
      head.add(eye);
      this.eyes.push(eye);

      const glint = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 8), toon(0xffffff));
      glint.position.set(side * 0.01, 0.012, 0.028);
      glint.userData.noOutline = true;
      eye.add(glint);

      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.009, 0.01), toon(0xb08a68));
      brow.position.set(side * 0.065, 0.075, 0.148);
      brow.userData.noOutline = true;
      head.add(brow);
      this.brows.push(brow);

      const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.038, 12, 10), toonUnique(PALETTE.blush, { opacity: 0.6 }));
      cheek.position.set(side * 0.105, -0.035, 0.115);
      cheek.scale.set(1, 0.72, 0.35);
      cheek.userData.noOutline = true;
      head.add(cheek);

      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), toon(PALETTE.skin));
      ear.position.set(side * 0.163, -0.01, 0);
      ear.scale.set(0.45, 1, 0.75);
      ear.userData.noOutline = true;
      head.add(ear);
    }

    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), toon(PALETTE.blush));
    nose.position.set(0, -0.025, 0.165);
    nose.scale.set(1.2, 0.8, 0.8);
    nose.userData.noOutline = true;
    head.add(nose);

    // くち：にっこり と ぱっくり と への字 を切り替える
    this.mouthSmile = new THREE.Mesh(new THREE.TorusGeometry(0.034, 0.008, 8, 16, Math.PI), toon(PALETTE.mouth));
    this.mouthSmile.rotation.z = Math.PI;
    this.mouthSmile.position.set(0, -0.062, 0.155);
    this.mouthSmile.userData.noOutline = true;
    head.add(this.mouthSmile);

    this.mouthOpen = new THREE.Mesh(new THREE.SphereGeometry(0.036, 14, 12), toon(PALETTE.mouth));
    this.mouthOpen.scale.set(1, 0.9, 0.5);
    this.mouthOpen.position.set(0, -0.07, 0.15);
    this.mouthOpen.visible = false;
    this.mouthOpen.userData.noOutline = true;
    head.add(this.mouthOpen);

    this.mouthPout = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.008, 8, 16, Math.PI), toon(PALETTE.mouth));
    this.mouthPout.position.set(0, -0.078, 0.155);
    this.mouthPout.visible = false;
    this.mouthPout.userData.noOutline = true;
    head.add(this.mouthPout);

    // かみのけ（うぶ毛と ぴょこん）
    const hairMat = toon(PALETTE.hair);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const tuft = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), hairMat);
      tuft.position.set(Math.cos(a) * 0.075, 0.145 - Math.abs(Math.sin(a)) * 0.015, Math.sin(a) * 0.06 - 0.03);
      tuft.scale.set(1.3, 0.6, 1.3);
      tuft.userData.noOutline = true;
      head.add(tuft);
    }
    // ぴょこん と はねた毛
    this.curl = new THREE.Group();
    [[0, 0.185, -0.01, 0.036], [0.012, 0.215, -0.02, 0.028], [0.03, 0.238, -0.035, 0.02]].forEach(([x, y, z, r]) => {
      const bead = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), hairMat);
      bead.position.set(x, y, z);
      bead.userData.noOutline = true;
      this.curl.add(bead);
    });
    head.add(this.curl);
  }

  _buildLimbs(skin) {
    const mkLimb = (opts) => {
      const pivot = new THREE.Group();
      pivot.position.copy(opts.at);
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(opts.r1, opts.l1, 4, 12), skin);
      upper.position.y = -opts.l1 / 2;
      pivot.add(upper);
      this._shade(upper);

      const joint = new THREE.Group();
      joint.position.y = -opts.l1;
      pivot.add(joint);

      const lower = new THREE.Mesh(new THREE.CapsuleGeometry(opts.r2, opts.l2, 4, 12), skin);
      lower.position.y = -opts.l2 / 2;
      joint.add(lower);
      this._shade(lower);

      const end = new THREE.Mesh(new THREE.SphereGeometry(opts.r3, 14, 12), skin);
      end.position.y = -opts.l2 - opts.r3 * 0.35;
      end.scale.copy(opts.endScale);
      joint.add(end);
      this._shade(end);

      // ポーズの角度は base に持ち、毎フレームの ゆらぎを足して rotation にする
      return {
        pivot, joint, upper, lower, end,
        basePivot: new THREE.Vector3(),
        baseJoint: new THREE.Vector3(),
      };
    };

    this.arms = [-1, 1].map((side) => {
      const limb = mkLimb({
        at: new THREE.Vector3(side * 0.17, 0.36, 0),
        r1: 0.055, l1: 0.14, r2: 0.05, l2: 0.12, r3: 0.062,
        endScale: new THREE.Vector3(1, 0.9, 0.85),
      });
      limb.side = side;
      this.pose.add(limb.pivot);
      return limb;
    });

    this.legs = [-1, 1].map((side) => {
      const limb = mkLimb({
        at: new THREE.Vector3(side * 0.095, 0.02, 0),
        r1: 0.078, l1: 0.17, r2: 0.062, l2: 0.15, r3: 0.075,
        endScale: new THREE.Vector3(0.9, 0.75, 1.5),
      });
      limb.side = side;
      this.pose.add(limb.pivot);
      return limb;
    });
  }

  _shade(mesh) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  }

  // -------------------------------------------------------------- ポーズ

  _applyPose(p, instant) {
    const set = (base, rot, sign = 1) => {
      const target = new THREE.Vector3(rot.x ?? 0, (rot.y ?? 0) * sign, (rot.z ?? 0) * sign);
      if (instant) {
        base.copy(target);
      } else {
        const from = base.clone();
        tween({
          duration: 0.55,
          ease: easeInOutQuad,
          onUpdate: (t) => base.lerpVectors(from, target, t),
        });
      }
    };

    this.arms.forEach((a) => { set(a.basePivot, p.shoulder, a.side); set(a.baseJoint, p.elbow); });
    this.legs.forEach((l) => { set(l.basePivot, p.hip, l.side); set(l.baseJoint, p.knee); });

    const shift = p.shift ?? 0;
    if (instant) {
      this.pose.rotation.x = p.tilt;
      this.bob.position.z = shift;
    } else {
      const fromTilt = this.pose.rotation.x;
      const fromShift = this.bob.position.z;
      tween({
        duration: 0.55,
        onUpdate: (t) => {
          this.pose.rotation.x = lerp(fromTilt, p.tilt, t);
          this.bob.position.z = lerp(fromShift, shift, t);
        },
      });
    }
  }

  setPose(name, instant = false) {
    if (this.poseName === name && !instant) return;
    this.poseName = name;
    this._applyPose(POSES[name], instant);
  }

  /** お世話の場所へ「だっこして運ぶ」ように移動する。 */
  moveTo(stationKey, onDone) {
    const st = STATIONS[stationKey];
    const pose = POSES[st.pose];
    const from = this.group.position.clone();
    const to = st.spot.clone();
    to.y += pose.lift * BABY_SCALE;
    const fromRot = this.group.rotation.y;
    let toRot = st.face;
    while (toRot - fromRot > Math.PI) toRot -= Math.PI * 2;
    while (toRot - fromRot < -Math.PI) toRot += Math.PI * 2;

    this.station = stationKey;
    this._moving = true;
    this.setPose('held');
    const lift = 0.55 + from.distanceTo(to) * 0.06;

    tween({
      duration: 1.1,
      ease: easeInOutQuad,
      onUpdate: (t) => {
        this.group.position.lerpVectors(from, to, t);
        this.group.position.y += Math.sin(t * Math.PI) * lift;
        this.group.rotation.y = lerp(fromRot, toRot, t);
      },
      onComplete: () => {
        this._moving = false;
        this.setPose(st.pose);
        onDone?.();
      },
    });
  }

  // ------------------------------------------------------------ ひょうじょう

  setExpression(name) {
    if (!EXPRESSIONS[name]) return;
    this.expression = name;
    const e = EXPRESSIONS[name];
    this.mouthSmile.visible = e.mouth === 'smile';
    this.mouthOpen.visible = e.mouth === 'open';
    this.mouthPout.visible = e.mouth === 'pout';
  }

  /** よろこんで ぴょんと はねる。 */
  hop(height = 0.14) {
    const base = this.group.position.y;
    tween({
      duration: 0.55,
      ease: easeInOutQuad,
      onUpdate: (t) => { this.group.position.y = base + Math.sin(t * Math.PI) * height; },
      onComplete: () => { this.group.position.y = base; },
    });
    this._kick = 1;
  }

  giggle() {
    this.setExpression('laugh');
    this.hop();
    clearTimeout(this._exprTimer);
    this._exprTimer = setTimeout(() => this.setExpression('happy'), 1400);
  }

  /** おむつ・服などをふわっと出す小さな演出。 */
  popScale(object) {
    object.visible = true;
    tween({ duration: 0.5, ease: easeOutBack, onUpdate: (t) => object.scale.setScalar(t) });
  }

  setLookEnabled(on) { this._lookEnabled = on; }

  /** おむつを よごれた見た目にする／きれいにもどす。 */
  setDiaperDirty(dirty) {
    this.diaper.material.color.setHex(dirty ? 0xf0e4b8 : PALETTE.cream);
    this.diaperSpots.forEach((s) => { s.visible = dirty; });
  }

  /** ずらしたおむつを もとの位置にもどす。 */
  resetDiaper() {
    this.diaperGroup.position.set(0, 0, 0);
    this.diaperGroup.rotation.set(0, 0, 0);
    this.diaperGroup.scale.setScalar(1);
    this.diaperGroup.visible = true;
    this.diaper.material.opacity = 1;
    this.diaper.material.transparent = false;
  }

  getHeadWorldPosition(target = new THREE.Vector3()) {
    return this.head.getWorldPosition(target);
  }

  // -------------------------------------------------------------- まいフレーム

  update(dt, time, camera) {
    // いき（おなかが ふくらむ）
    const breath = 1 + Math.sin(time * 1.9) * 0.028;
    this.torso.scale.set(0.205 * breath, 0.245 * (2 - breath), 0.175 * breath);

    // まばたき
    this._blinkTimer -= dt;
    if (this._blinkTimer <= 0) {
      this._blinkTimer = 2.2 + Math.random() * 3;
      this._blink = 1;
    }
    this._blink = Math.max(0, this._blink - dt * 7);
    const blinkFactor = 1 - Math.sin(this._blink * Math.PI) * 0.95;

    // ひょうじょうの あてこみ
    const e = EXPRESSIONS[this.expression];
    this._expr.eye = damp(this._expr.eye, e.eye, 12, dt);
    this._expr.brow = damp(this._expr.brow, e.brow, 10, dt);
    this._expr.browY = damp(this._expr.browY, e.browY, 10, dt);
    this._expr.mouthScale = damp(this._expr.mouthScale, e.mouthScale, 10, dt);

    this.eyes.forEach((eye) => eye.scale.set(0.95, 1.15 * this._expr.eye * blinkFactor, 0.5));
    this.brows.forEach((brow, i) => {
      const side = i === 0 ? -1 : 1;
      brow.rotation.z = this._expr.brow * side;
      brow.position.y = 0.075 + this._expr.browY;
    });
    const ms = this._expr.mouthScale;
    this.mouthSmile.scale.setScalar(ms);
    this.mouthPout.scale.setScalar(ms);
    this.mouthOpen.scale.set(ms, 0.9 * ms * (1 + Math.sin(time * 8) * 0.08), 0.5);

    // カメラのほうを見る（首はすこしだけ動かす）
    if (this._lookEnabled && camera && !this._moving) {
      this.head.getWorldPosition(this._tmp);
      const dir = camera.position.clone().sub(this._tmp);
      const yaw = Math.atan2(dir.x, dir.z) - this.group.rotation.y;
      const flat = Math.hypot(dir.x, dir.z);
      let pitch = Math.atan2(dir.y, flat);
      const wrapped = Math.atan2(Math.sin(yaw), Math.cos(yaw));
      if (this.poseName === 'lie') pitch -= Math.PI / 2;   // 寝ているときは真上が正面
      this._headYaw = damp(this._headYaw, clamp(wrapped, -0.6, 0.6), 3, dt);
      this._headPitch = damp(this._headPitch, clamp(-pitch * 0.4, -0.35, 0.35), 3, dt);
    } else {
      this._headYaw = damp(this._headYaw, 0, 3, dt);
      this._headPitch = damp(this._headPitch, 0, 3, dt);
    }
    this.headPivot.rotation.y = this._headYaw;
    this.headPivot.rotation.x = this._headPitch + Math.sin(time * 1.3) * 0.02;

    // てあし の ゆらゆら（うれしいと ばたばた）
    this._kick = Math.max(0, this._kick - dt * 0.8);
    const energy = 0.35 + this._kick * 2.2;
    // ポーズの角度（base）に ゆらぎを足す
    this.arms.forEach((arm, i) => {
      const phase = time * (2.1 + i * 0.4) + i * 1.7;
      arm.pivot.rotation.set(
        arm.basePivot.x + Math.sin(phase) * 0.14 * energy,
        arm.basePivot.y,
        arm.basePivot.z + Math.sin(phase * 0.8) * 0.1 * energy * arm.side
      );
      arm.joint.rotation.x = arm.baseJoint.x + Math.sin(phase * 1.3) * 0.12 * energy;
    });
    this.legs.forEach((leg, i) => {
      const phase = time * (1.8 + i * 0.5) + i * 2.3;
      leg.pivot.rotation.set(
        leg.basePivot.x + Math.sin(phase) * 0.12 * energy,
        leg.basePivot.y,
        leg.basePivot.z
      );
      leg.joint.rotation.x = leg.baseJoint.x + Math.sin(phase * 1.2) * 0.14 * energy;
    });

    // からだ全体の ゆれ
    this.bob.position.y = Math.sin(time * 1.9) * 0.006;
    this.bob.rotation.z = Math.sin(time * 0.9) * 0.012;
  }
}
