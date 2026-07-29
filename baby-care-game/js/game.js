import * as THREE from 'three';
import { toon } from './world.js';
import { tween, delay, easeOut, easeOutBack } from './tween.js';

// 交換用のおむつ小道具
function makeDiaperProp(color = 0xffffff) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.33, 20, 16), toon(color));
  body.scale.set(1, 0.8, 1);
  body.castShadow = true;
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.285, 0.055, 10, 24), toon(color));
  band.rotation.x = Math.PI / 2;
  band.position.y = 0.13;
  g.add(body, band);
  return g;
}

const WIPES_NEEDED = 3;

export class Game {
  constructor({ scene, baby, world, particles, audio, ui, cameraTo, worldToScreen, setControlsEnabled, homeCamera, changeCamera }) {
    Object.assign(this, { scene, baby, world, particles, audio, ui, cameraTo, worldToScreen, setControlsEnabled, homeCamera, changeCamera });
    this.state = 'FREE';
    this.mood = 0.72;
    this.stars = parseInt(localStorage.getItem('babycare_stars') || '0', 10);
    this.wipes = 0;
    this.stinkTimer = 2;
    this.fussSoundTimer = 4;
    this.pokeTimer = 0;
    this.oldDiaper = null;
    this.newDiaper = null;
    this.tmpV = new THREE.Vector3();

    this.ui.setStars(this.stars);
    this.ui.setMood(this.mood);
    this.ui.diaperButton.addEventListener('click', () => this.startChange());
  }

  // ---------- 毎フレーム ----------
  update(t, dt) {
    if (this.state === 'FREE') {
      this.mood = Math.max(0.04, this.mood - dt / 95);
      this.ui.setMood(this.mood);
      const fussy = this.mood < 0.35;
      if (this.pokeTimer > 0) {
        this.pokeTimer -= dt;
        this.baby.setState('happy');
      } else {
        this.baby.setState(fussy ? 'fussy' : 'idle');
      }
      this.ui.setDiaperButton({ visible: true, attention: fussy, enabled: true });
      if (fussy) {
        this.stinkTimer -= dt;
        if (this.stinkTimer <= 0) {
          this.stinkTimer = 2.2;
          this.particles.burst('stink', this.baby.bottomWorldPos(this.tmpV).add(new THREE.Vector3(0.25, 0.15, 0)), 2);
        }
        this.fussSoundTimer -= dt;
        if (this.fussSoundTimer <= 0) {
          this.fussSoundTimer = 5 + Math.random() * 3;
          this.audio.fussy();
        }
      }
    }

    // 誘導のゆびアイコンをターゲットに追従させる
    let pointerTarget = null;
    if (this.state === 'TAKE') pointerTarget = this.baby.bottomWorldPos(this.tmpV);
    if (this.state === 'PUT' && this.newDiaper) pointerTarget = this.newDiaper.getWorldPosition(this.tmpV);
    if (pointerTarget) {
      const s = this.worldToScreen(pointerTarget);
      this.ui.showPointer(s.x, s.y);
    } else {
      this.ui.hidePointer();
    }

    // 新しいおむつをふわふわ浮かせる
    if (this.newDiaper) {
      this.newDiaper.position.y = this.newDiaper.userData.baseY + Math.sin(t * 3) * 0.05;
      this.newDiaper.rotation.y = Math.sin(t * 1.8) * 0.25;
      const pulse = 1 + Math.sin(t * 5) * 0.06;
      this.newDiaper.scale.setScalar(pulse);
    }
    // 取ってほしいおむつをぷるぷるさせる
    if (this.state === 'TAKE') {
      this.baby.diaper.scale.setScalar(1 + Math.sin(t * 7) * 0.05);
    }
  }

  // ---------- タップ処理 ----------
  onTap(hits, screenX, screenY) {
    if (this.state === 'FREE') {
      if (this.hitsBaby(hits) || this.nearScreen(this.baby.headWorldPos(this.tmpV), screenX, screenY, 110)) {
        this.pokeBaby();
      }
      return;
    }
    if (this.state === 'TAKE') {
      if (this.hitsBaby(hits) || this.nearScreen(this.baby.bottomWorldPos(this.tmpV), screenX, screenY, 130)) {
        this.takeDiaper();
      }
      return;
    }
    if (this.state === 'PUT' && this.newDiaper) {
      const hitProp = hits.some((h) => {
        let o = h.object;
        while (o) { if (o === this.newDiaper) return true; o = o.parent; }
        return false;
      });
      if (hitProp || this.nearScreen(this.newDiaper.getWorldPosition(this.tmpV), screenX, screenY, 130)
        || this.hitsBaby(hits)) {
        this.putDiaper();
      }
    }
  }

  hitsBaby(hits) {
    return hits.some((h) => {
      let o = h.object;
      while (o) { if (o === this.baby.group) return true; o = o.parent; }
      return false;
    });
  }

  nearScreen(worldPos, x, y, px) {
    const s = this.worldToScreen(worldPos);
    return Math.hypot(s.x - x, s.y - y) < px;
  }

  pokeBaby() {
    this.pokeTimer = 1.3;
    this.mood = Math.min(1, this.mood + 0.02);
    this.audio.giggle();
    this.particles.burst('heart', this.baby.headWorldPos(this.tmpV).add(new THREE.Vector3(0, 0.35, 0)), 5);
  }

  // ---------- ふきふき（スワイプ） ----------
  onWipeMove(distPx) {
    if (this.state !== 'WIPE') return;
    this.wipeAccum = (this.wipeAccum || 0) + distPx;
    if (this.wipeAccum >= 150 && this.wipes < WIPES_NEEDED) {
      this.wipeAccum = 0;
      this.wipes++;
      this.audio.squeak();
      this.particles.burst('bubble', this.baby.bottomWorldPos(this.tmpV).add(new THREE.Vector3(0, 0.25, 0.2)), 4);
      this.ui.setWipeProgress(this.wipes);
      if (this.wipes >= WIPES_NEEDED) {
        this.audio.sparkle();
        this.particles.burst('sparkle', this.baby.bottomWorldPos(this.tmpV).add(new THREE.Vector3(0, 0.3, 0)), 10);
        delay(0.5, () => {
          this.ui.setWipeProgress(-1);
          this.spawnNewDiaper();
        });
      }
    }
  }

  // ---------- おむつ交換シーケンス ----------
  startChange() {
    if (this.state !== 'FREE') return;
    this.state = 'TO_MAT';
    this.audio.ding();
    this.setControlsEnabled(false);
    this.ui.setDiaperButton({ visible: false });
    this.ui.say('おむつを かえよう！', 2.2);
    this.baby.setState('lying');

    const from = this.baby.group.position.clone();
    const fromRotX = this.baby.group.rotation.x;
    // マットの長いほうの軸にそって、足がカメラ側に来るように寝かせる
    const lieRotY = this.world.matRotationY + Math.PI / 2;
    const feetDir = new THREE.Vector3(Math.cos(this.world.matRotationY), 0, -Math.sin(this.world.matRotationY));
    const lieTo = this.world.matCenter.clone().addScaledVector(feetDir, 0.35);
    lieTo.y = 0.32;
    this.baby.group.rotation.order = 'YXZ';
    tween({
      duration: 1.25,
      onUpdate: (e, p) => {
        this.baby.group.position.lerpVectors(from, lieTo, e);
        this.baby.group.position.y += Math.sin(p * Math.PI) * 0.55; // ぴょんとジャンプ
        this.baby.group.rotation.x = fromRotX + (-1.45 - fromRotX) * e;
        this.baby.group.rotation.y = lieRotY * e;
      },
      onComplete: () => {
        this.baby.baseY = 0.32;
        this.cameraTo(this.changeCamera.pos, this.changeCamera.target, 1.0, () => {
          this.state = 'TAKE';
          this.ui.say('おむつを タップしてね');
        });
      },
    });
  }

  takeDiaper() {
    this.state = 'BUSY';
    this.ui.hidePointer();
    this.baby.diaper.visible = false;
    this.baby.diaper.scale.setScalar(1);

    const start = this.baby.bottomWorldPos(new THREE.Vector3());
    const old = makeDiaperProp(0xfff0cc);
    old.position.copy(start);
    this.scene.add(old);
    this.audio.pop();
    this.particles.burst('stink', start.clone().add(new THREE.Vector3(0, 0.3, 0)), 3);

    const end = this.world.potPos.clone().add(new THREE.Vector3(0, 0.75, 0));
    tween({
      duration: 0.9,
      ease: easeOut,
      onUpdate: (e, p) => {
        old.position.lerpVectors(start, end, e);
        old.position.y += Math.sin(p * Math.PI) * 1.1;
        old.rotation.z = p * Math.PI * 2;
        old.scale.setScalar(1 - p * 0.45);
      },
      onComplete: () => {
        this.scene.remove(old);
        // ぽっとのふたがぴょこんとはねる
        const lid = this.world.potLid;
        tween({
          duration: 0.5,
          onUpdate: (e, p) => { lid.position.y = 0.58 + Math.sin(p * Math.PI) * 0.22; },
        });
        this.audio.pop();
        this.particles.burst('sparkle', end, 4);
        this.state = 'WIPE';
        this.wipes = 0;
        this.wipeAccum = 0;
        this.ui.say('ゆびで おしりを ふきふき！');
        this.ui.setWipeProgress(0);
      },
    });
  }

  spawnNewDiaper() {
    this.newDiaper = makeDiaperProp(0xffffff);
    const mat = this.world.matCenter;
    this.newDiaper.position.set(mat.x - 0.2, 0.75, mat.z + 0.85);
    this.newDiaper.userData.baseY = 0.75;
    this.scene.add(this.newDiaper);
    this.particles.burst('sparkle', this.newDiaper.position, 6);
    this.audio.ding();
    this.state = 'PUT';
    this.ui.say('あたらしい おむつを タップ！');
  }

  putDiaper() {
    this.state = 'BUSY';
    this.ui.hidePointer();
    const prop = this.newDiaper;
    this.newDiaper = null;
    const start = prop.position.clone();
    const end = this.baby.bottomWorldPos(new THREE.Vector3());
    tween({
      duration: 0.7,
      ease: easeOut,
      onUpdate: (e) => {
        prop.position.lerpVectors(start, end, e);
        prop.scale.setScalar(1 - e * 0.15);
      },
      onComplete: () => {
        this.scene.remove(prop);
        this.baby.diaper.visible = true;
        this.audio.sparkle();
        this.particles.burst('sparkle', end, 12);
        this.celebrate();
      },
    });
  }

  celebrate() {
    this.state = 'CELEBRATE';
    this.mood = 1;
    this.ui.setMood(1);
    this.stars++;
    localStorage.setItem('babycare_stars', String(this.stars));
    this.ui.setStars(this.stars);
    this.ui.say('できたね！ すごい！', 2.6);
    this.audio.jingle();

    // ばんざいの全身が入るようにカメラを少し引く
    this.cameraTo(
      this.changeCamera.pos.clone().add(new THREE.Vector3(0.7, 0.5, 0.9)),
      this.changeCamera.target.clone().add(new THREE.Vector3(0, 0.5, 0)),
      0.7);

    // おすわりに戻してよろこぶ
    const g = this.baby.group;
    const fromRotX = g.rotation.x;
    const from = g.position.clone();
    const sitTo = this.world.matCenter.clone();
    sitTo.y = 0.13; // カメラから頭が見切れないようマット中央におすわり
    tween({
      duration: 0.6,
      ease: easeOutBack,
      onUpdate: (e) => {
        g.rotation.x = fromRotX * (1 - e);
        g.position.lerpVectors(from, sitTo, e);
      },
      onComplete: () => {
        this.baby.baseY = 0.13;
        this.baby.setState('happy');
        const p = this.baby.headWorldPos(new THREE.Vector3()).add(new THREE.Vector3(0, 0.4, 0));
        this.particles.burst('heart', p, 8);
        this.particles.burst('star', p, 6);
        delay(2.3, () => this.goHome());
      },
    });
  }

  goHome() {
    this.state = 'BACK';
    this.baby.tweenLock = true;
    this.baby.setState('idle');
    const g = this.baby.group;
    const from = g.position.clone();
    const fromRotY = g.rotation.y;
    tween({
      duration: 1.1,
      onUpdate: (e, p) => {
        g.position.lerpVectors(from, this.baby.homePos, e);
        g.position.y += Math.sin(p * Math.PI) * 0.5;
        g.rotation.y = fromRotY * (1 - e);
      },
      onComplete: () => {
        this.baby.baseY = 0;
        this.baby.tweenLock = false;
        g.position.copy(this.baby.homePos);
        this.baby.setState('idle');
        this.cameraTo(this.homeCamera.pos, this.homeCamera.target, 1.0, () => {
          this.setControlsEnabled(true);
          this.state = 'FREE';
          this.ui.setDiaperButton({ visible: true, enabled: true });
        });
      },
    });
  }
}
