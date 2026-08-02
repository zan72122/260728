import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { loadAssets, type LoadedAssets } from './assets';
import { Garage3D, COL_X, LEVER_X, MECH_HOME_X, PLATE_POS } from './garage3d';
import { Car3D, LIFT_H, FLANK_Z, partToLocal, localToPart, bellyPlaneY, CAR_LEN } from './car3d';
import { Mechanic3D } from './mechanic3d';
import { Test3D, courseGround, COURSE_LEN } from './test3d';
import { Puck, makeChoicePucks, buildMaskItem, drawPlayIcon } from './ui3d';
import { CARS, crackLocalPts, densify } from '../car';
import { CRACK_N, type Game } from '../game';
import { layoutGarage, layoutChoice } from '../layout';
import { clamp, easeInOutCubic, easeOutCubic, lerp } from '../gfx';

interface CamPose {
  pos: THREE.Vector3;
  target: THREE.Vector3;
  up: THREE.Vector3;
  fov: number;
}

function pose(px: number, py: number, pz: number, tx: number, ty: number, tz: number, fov: number, up?: THREE.Vector3): CamPose {
  return {
    pos: new THREE.Vector3(px, py, pz),
    target: new THREE.Vector3(tx, ty, tz),
    up: up ?? new THREE.Vector3(0, 1, 0),
    fov,
  };
}

function mixPose(a: CamPose, b: CamPose, t: number): CamPose {
  return {
    pos: a.pos.clone().lerp(b.pos, t),
    target: a.target.clone().lerp(b.target, t),
    up: a.up.clone().lerp(b.up, t).normalize(),
    fov: lerp(a.fov, b.fov, t),
  };
}

interface Mood {
  bg: THREE.Color;
  hemi: number;
  key: number;
  window: number;
}

export class Scene3D {
  W = 800;
  H = 600;
  renderer!: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(38, 1, 0.1, 120);
  assets!: LoadedAssets;

  garage!: Garage3D;
  car!: Car3D;
  mech!: Mechanic3D;
  test = new Test3D();

  private hemi!: THREE.HemisphereLight;
  private key!: THREE.DirectionalLight;
  private windowSpot!: THREE.SpotLight;
  private arcLight!: THREE.PointLight;
  private emberLight!: THREE.PointLight;
  private headlight!: THREE.SpotLight;

  private cur: CamPose = pose(0, 1.9, 8.8, 0.2, 1.35, 0, 34);
  private bg = new THREE.Color(0xe8d9c0);
  private lastPhase = '';
  private lastWheelSpin = 0;
  private lastCarIdx = -1;
  private testX = 0;
  private carRoot = new THREE.Group();

  private startPuck!: Puck;
  private choicePucks: Puck[] = [];
  private choiceGroup = new THREE.Group();
  private maskItem = buildMaskItem();

  private doodleMesh!: THREE.InstancedMesh;
  private lastDoodleLen = 0;
  private lastDoodleWH = '';

  private ray = new THREE.Raycaster();

  async init(canvas: HTMLCanvasElement): Promise<void> {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      // debug-only: lets tests read pixels back from the canvas
      preserveDrawingBuffer: new URLSearchParams(window.location.search).has('pdb'),
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // soft studio reflections so metals and clearcoat paint read as materials
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.45;

    this.assets = await loadAssets(CARS);
    this.garage = new Garage3D(this.assets);
    this.car = new Car3D(this.assets);
    this.mech = new Mechanic3D();
    this.scene.add(this.garage.root);
    this.carRoot.add(this.car.root);
    this.scene.add(this.carRoot);
    this.scene.add(this.mech.root);
    this.scene.add(this.test.root);
    this.test.root.visible = false;
    this.scene.add(this.choiceGroup);
    this.scene.add(this.maskItem);
    this.maskItem.visible = false;

    // lights
    this.hemi = new THREE.HemisphereLight(0xfff2df, 0x8a8f9a, 0.55);
    this.scene.add(this.hemi);
    this.key = new THREE.DirectionalLight(0xfff1d8, 2.6);
    this.key.position.set(4, 8, 5);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.camera.left = -7;
    this.key.shadow.camera.right = 7;
    this.key.shadow.camera.top = 7;
    this.key.shadow.camera.bottom = -4;
    this.key.shadow.camera.far = 30;
    this.key.shadow.bias = -0.0003;
    this.key.shadow.normalBias = 0.035;
    this.scene.add(this.key);
    this.windowSpot = new THREE.SpotLight(0xffedc8, 1.6, 18, 0.6, 0.9, 1.5);
    this.windowSpot.position.set(-3.4, 3.2, -3.0);
    this.windowSpot.target.position.set(-1.6, 0, 1.2);
    this.scene.add(this.windowSpot);
    this.scene.add(this.windowSpot.target);
    this.arcLight = new THREE.PointLight(0x9fd0ff, 0, 7, 1.8);
    this.scene.add(this.arcLight);
    this.emberLight = new THREE.PointLight(0xff8a40, 0, 4, 2);
    this.scene.add(this.emberLight);
    this.headlight = new THREE.SpotLight(0xfff4c9, 0, 20, 0.5, 0.6, 1.2);
    this.carRoot.add(this.headlight);
    const hlTarget = new THREE.Object3D();
    hlTarget.position.set(6, 0.2, 0);
    this.carRoot.add(hlTarget);
    this.headlight.position.set(1.7, 0.7, 0);
    this.headlight.target = hlTarget;

    // ui
    this.startPuck = new Puck({ id: 'start', color: 0xe5604a, icon: (ctx, s) => drawPlayIcon(ctx, s) });
    this.scene.add(this.startPuck.group);
    this.startPuck.group.visible = false;

    // doodle beads
    this.doodleMesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.024, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xc9ccd4, roughness: 0.3, metalness: 0.9 }),
      2400,
    );
    this.doodleMesh.count = 0;
    this.scene.add(this.doodleMesh);

    this.scene.background = this.bg;
    this.scene.fog = new THREE.Fog(this.bg.getHex(), 18, 46);

    // everything casts and receives shadows (the toy look needs grounding)
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
  }

  resize(w: number, h: number, dpr: number): void {
    this.W = w;
    this.H = h;
    this.renderer.setPixelRatio(Math.min(dpr, 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------ projections

  project(v: THREE.Vector3): { x: number; y: number } {
    const p = v.clone().project(this.camera);
    return { x: (p.x + 1) / 2 * this.W, y: (1 - p.y) / 2 * this.H };
  }

  private ndc(x: number, y: number): THREE.Vector2 {
    return new THREE.Vector2((x / this.W) * 2 - 1, 1 - (y / this.H) * 2);
  }

  rayOnPlane(x: number, y: number, plane: THREE.Plane): THREE.Vector3 | null {
    this.ray.setFromCamera(this.ndc(x, y), this.camera);
    const out = new THREE.Vector3();
    return this.ray.ray.intersectPlane(plane, out) ? out : null;
  }

  unprojectAtDistance(x: number, y: number, dist: number): THREE.Vector3 {
    this.ray.setFromCamera(this.ndc(x, y), this.camera);
    return this.ray.ray.origin.clone().add(this.ray.ray.direction.clone().multiplyScalar(dist));
  }

  // --- adapter API used by src/layout.ts ---

  garageInfo(): {
    leverX: number; leverY: number; mechX: number; mechY: number;
    carX: number; groundY: number; carW: number; liftMax: number;
    plateX: number; plateY: number; plateR: number;
  } {
    const lever = this.project(new THREE.Vector3(LEVER_X, 1.35 + (0 - 0.5) * 0.5 + 0.25, 1.0));
    const leverKnob = this.garage ? this.project(this.garage.leverKnob.position) : lever;
    const home = this.mechHome();
    const mechP = this.project(new THREE.Vector3(home.x, 0.5, home.z));
    const g0 = this.project(new THREE.Vector3(0, 0, 0.9));
    const rear = this.project(new THREE.Vector3(-CAR_LEN / 2, 0.5, 0.8));
    const front = this.project(new THREE.Vector3(CAR_LEN / 2, 0.5, 0.8));
    const liftTop = this.project(new THREE.Vector3(0, LIFT_H, 0.9));
    const pp = this.platePos();
    const plate = this.project(pp.clone().add(new THREE.Vector3(0, 0.1, 0.2)));
    const plateEdge = this.project(pp.clone().add(new THREE.Vector3(0.9, 0.1, 0.2)));
    const carW = Math.hypot(front.x - rear.x, front.y - rear.y);
    return {
      leverX: leverKnob.x, leverY: leverKnob.y,
      mechX: mechP.x, mechY: mechP.y,
      carX: g0.x, groundY: g0.y,
      carW,
      liftMax: Math.abs(g0.y - liftTop.y),
      plateX: plate.x, plateY: plate.y,
      plateR: Math.abs(plateEdge.x - plate.x),
    };
  }

  underToScreenPart(ux: number, uy: number): { x: number; y: number } {
    this.carRoot.updateMatrixWorld();
    const w = this.carRoot.localToWorld(partToLocal(ux, uy, 0.1));
    return this.project(w);
  }

  screenToUnderPart(x: number, y: number): { x: number; y: number } {
    const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), bellyPlaneY(this.carRoot.position.y));
    const hit = this.rayOnPlane(x, y, plane);
    if (!hit) return { x: 500, y: 210 };
    this.carRoot.updateMatrixWorld();
    const local = this.carRoot.worldToLocal(hit.clone());
    return localToPart(local);
  }

  underInfo(): { grabR: number; floorY: number } {
    const gi = this.garageInfo();
    const f = this.project(new THREE.Vector3(0, 0.08, 1.1));
    return {
      grabR: clamp(gi.carW * 0.14, 44, 95),
      floorY: f.y,
    };
  }

  weldFrame(): { carX: number; carGroundY: number; bigW: number } {
    const o = this.project(new THREE.Vector3(this.carRoot.position.x, this.carRoot.position.y, FLANK_Z));
    const u = this.project(new THREE.Vector3(this.carRoot.position.x + 1, this.carRoot.position.y, FLANK_Z));
    const ppu = u.x - o.x;
    return { carX: o.x, carGroundY: o.y, bigW: ppu * CAR_LEN };
  }

  arcWorld(g: Game): THREE.Vector3 | null {
    if (g.phase === 'freeweld') {
      return this.rayOnPlane(g.arcX, g.arcY, this.platePlane());
    }
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, -1), FLANK_Z + 0.02);
    return this.rayOnPlane(g.arcX, g.arcY, plane);
  }

  private platePlane(): THREE.Plane {
    const n = new THREE.Vector3(0, Math.sin(0.12), Math.cos(0.12));
    const p = this.platePos().add(new THREE.Vector3(0, 0.1, 0.13));
    return new THREE.Plane().setFromNormalAndCoplanarPoint(n.negate(), p);
  }

  // ------------------------------------------------------------ cameras

  private portrait(): boolean {
    return this.H > this.W;
  }

  private garagePose(): CamPose {
    return this.portrait()
      ? pose(0.9, 2.6, 13.5, 0.9, 1.6, 0, 47)
      : pose(0.35, 1.95, 8.9, 0.25, 1.4, 0, 34);
  }

  private underPose(g: Game): CamPose {
    const bellyY = bellyPlaneY(this.carRoot.position.y);
    const p = this.portrait();
    const ppu = p
      ? Math.min((this.W * 0.85) / 1.35, (this.H * 0.60) / 3.15)
      : Math.min((this.W * 0.78) / 3.15, (this.H * 0.55) / 1.35);
    const fov = 62;
    const D = this.H / (2 * Math.tan((fov * Math.PI) / 360) * ppu);
    const tilt = 0.24;
    const center = new THREE.Vector3(0, bellyY, -0.05);
    const cp = center.clone().add(new THREE.Vector3(0, -Math.cos(tilt) * D, Math.sin(tilt) * D));
    void g;
    return {
      pos: cp, target: center,
      up: p ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, -1),
      fov,
    };
  }

  private weldPose(g: Game): CamPose {
    const c = g.cracks[Math.min(g.weldIdx, Math.max(0, g.cracks.length - 1))];
    const kind = c ? c.kind : 'door';
    const local = densify(crackLocalPts(kind), CRACK_N);
    const cu = local.reduce((s, q) => s + q[0], 0) / local.length;
    const cv = local.reduce((s, q) => s + q[1], 0) / local.length;
    const cx = this.carRoot.position.x + cu * CAR_LEN;
    const cy = this.carRoot.position.y + cv * CAR_LEN;
    const p = this.portrait();
    const bigW = p ? Math.min(this.W * 2.6, this.H * 1.4) : Math.min(this.W * 1.35, this.H * 2.2);
    const ppu = bigW / CAR_LEN;
    const fov = 36;
    const D = this.H / (2 * Math.tan((fov * Math.PI) / 360) * ppu);
    const cyOff = (this.H / 2 - this.H * 0.42) / ppu;
    return pose(cx, cy - cyOff, FLANK_Z + D, cx, cy - cyOff, FLANK_Z, fov);
  }

  private freeweldPose(): CamPose {
    const p = this.platePos().add(new THREE.Vector3(0, 0.1, 0.13));
    const ppu = (Math.min(this.W, this.H) * 0.78) / 2.0;
    const fov = 40;
    const D = this.H / (2 * Math.tan((fov * Math.PI) / 360) * ppu);
    const n = new THREE.Vector3(0, Math.sin(0.12), Math.cos(0.12));
    const cp = p.clone().add(n.multiplyScalar(D));
    return { pos: cp, target: p, up: new THREE.Vector3(0, 1, 0), fov };
  }

  private testPose(): CamPose {
    const x = this.testX;
    return this.portrait()
      ? pose(x, 2.4, 13.5, x + 0.4, 1.3, 0, 50)
      : pose(x - 0.4, 1.7, 8.6, x + 0.5, 1.1, 0, 38);
  }

  // ------------------------------------------------------------ update

  update(g: Game, dt: number): void {
    const time = g.time;
    const phaseChanged = g.phase !== this.lastPhase;

    if (g.carIdx !== this.lastCarIdx || phaseChanged) {
      this.car.setSpec(g.spec);
      if (g.carIdx !== this.lastCarIdx) {
        this.rebuildChoicePucks(g.carIdx);
        this.lastCarIdx = g.carIdx;
      }
    }

    // ---- car placement
    const inTest = g.phase === 'test';
    if (phaseChanged && inTest) {
      this.test.build(g.test.course);
      this.testX = 0;
    }
    this.garage.root.visible = !inTest;
    this.test.root.visible = inTest;

    if (inTest) {
      const k = clamp(g.test.t / g.test.dur, 0, 1);
      const speed = k < 0.12 ? k / 0.12 : k > 0.9 ? Math.max(0, (1 - k) / 0.1) : 1;
      this.testX += dt * speed * (COURSE_LEN / (g.test.dur * 0.82));
      const wb = 1.1;
      const hF = courseGround(g.test.course, this.testX + wb);
      const hR = courseGround(g.test.course, this.testX - wb);
      this.carRoot.position.set(this.testX, (hF + hR) / 2 + Math.sin(time * 9) * 0.012, 0);
      this.carRoot.rotation.z = Math.atan2(hF - hR, wb * 2) * 0.8;
      this.headlight.intensity = g.test.course === 1 ? 26 : 0;
    } else {
      let carX = 0;
      if (g.phase === 'arrive') carX = lerp(-9, 0, easeOutCubic(g.arriveT));
      if (g.phase === 'lower' && g.arriveT > 1) carX = (g.arriveT - 1) * 9;
      const hasFault = g.faultsRemaining() > 0;
      const idle = hasFault && g.liftT < 0.5 && (g.phase === 'arrive' || g.phase === 'garage')
        ? Math.sin(time * 25) * 0.012 : 0;
      const bounce = Math.sin(time * 16) * g.settleBounce * 0.004;
      this.carRoot.position.set(carX, g.liftT * LIFT_H + bounce + idle, 0);
      this.carRoot.rotation.z = 0;
      this.headlight.intensity = 0;
    }
    this.car.spinWheels(g.wheelSpin - this.lastWheelSpin);
    this.lastWheelSpin = g.wheelSpin;
    this.car.update(g, time);

    // ---- mechanic
    this.updateMech(g, dt, time);

    // ---- garage fixtures
    this.garage.update(g, time);
    // hide the floor when the camera dives under the car (it would block the view)
    const underCam = g.phase === 'under'
      || ((g.phase === 'slideIn' || g.phase === 'slideOut') && g.creeperProg > 0.55);
    this.garage.floorGroup.visible = !underCam;

    // ---- weld lights
    const aw = (g.arcOn && (g.phase === 'weld' || g.phase === 'freeweld')) ? this.arcWorld(g) : null;
    if (aw) {
      this.arcLight.position.copy(aw).add(new THREE.Vector3(0, 0, g.phase === 'freeweld' ? 0.3 : 0.25));
      this.arcLight.intensity = 22 + Math.random() * 14;
    } else {
      this.arcLight.intensity *= Math.exp(-dt * 18);
    }
    const crackState = g.cracks[0];
    if (g.phase === 'weld' && crackState && !crackState.done) {
      const local = densify(crackLocalPts(crackState.kind), CRACK_N);
      const cu = local.reduce((s, q) => s + q[0], 0) / local.length;
      const cv = local.reduce((s, q) => s + q[1], 0) / local.length;
      this.emberLight.position.set(
        this.carRoot.position.x + cu * CAR_LEN,
        this.carRoot.position.y + cv * CAR_LEN,
        FLANK_Z + 0.25,
      );
      this.emberLight.intensity = 1.6 + Math.sin(time * 3.2) * 1.2;
    } else {
      this.emberLight.intensity = 0;
    }
    this.mech.aimTorch((g.phase === 'weld' || g.phase === 'freeweld') && g.arcOn ? aw : null);

    // ---- ui pucks
    this.garage.plate.position.copy(this.platePos());
    this.garage.plate.scale.setScalar(this.portrait() ? 0.7 : 1);
    this.updateUI(g, time);
    this.updateDoodle(g);

    // ---- camera
    let des: CamPose;
    switch (g.phase) {
      case 'slideIn': case 'slideOut': {
        const s = easeInOutCubic(clamp((g.creeperProg - 0.12) / 0.75, 0, 1));
        des = mixPose(this.garagePose(), this.underPose(g), s);
        this.cur = des;
        break;
      }
      case 'under':
        des = this.underPose(g);
        this.cur = mixPose(this.cur, des, 1 - Math.exp(-dt * 5));
        break;
      case 'weld': case 'weldDone':
        des = this.weldPose(g);
        this.cur = mixPose(this.cur, des, 1 - Math.exp(-dt * 3.2));
        break;
      case 'freeweld':
        des = this.freeweldPose();
        this.cur = mixPose(this.cur, des, 1 - Math.exp(-dt * 3.5));
        break;
      case 'test':
        des = this.testPose();
        this.cur = phaseChanged ? des : mixPose(this.cur, des, 1 - Math.exp(-dt * 8));
        break;
      default:
        des = this.garagePose();
        this.cur = phaseChanged && this.lastPhase === 'test'
          ? des
          : mixPose(this.cur, des, 1 - Math.exp(-dt * 3.5));
    }
    this.camera.position.copy(this.cur.pos);
    this.camera.up.copy(this.cur.up);
    this.camera.lookAt(this.cur.target);
    if (Math.abs(this.camera.fov - this.cur.fov) > 0.01) {
      this.camera.fov = this.cur.fov;
      this.camera.updateProjectionMatrix();
    }
    // shake
    if (g.shake > 0) {
      const a = g.shakeAmp * g.shake * 0.004;
      this.camera.position.x += (Math.random() - 0.5) * a;
      this.camera.position.y += (Math.random() - 0.5) * a;
    }

    // ---- mood
    this.updateMood(g, dt);
    this.lastPhase = g.phase;
  }

  private updateMech(g: Game, dt: number, time: number): void {
    const m = this.mech;
    const prog = g.creeperProg;
    const underish = g.phase === 'under' || g.phase === 'slideIn' || g.phase === 'slideOut';

    if (g.phase === 'test') {
      m.root.visible = false;
      return;
    }
    m.root.visible = true;

    if (underish || ((g.phase === 'garage') && g.liftT >= 1 && (g.freePlay || g.faultsRemaining() > 0))) {
      // lying on the creeper, sliding under the car; the waiting spot is at the
      // right in landscape and near the camera in portrait, and the ride ends
      // off the camera axis so the near-field body doesn't block the view
      const e = easeInOutCubic(prog);
      const home = this.mechHome();
      const end = this.portrait() ? { x: -1.55, z: -0.4 } : { x: 1.1, z: 0.45 };
      m.root.position.set(lerp(home.x, end.x, e), 0, lerp(home.z, end.z, e));
      m.setPose('lie', Math.PI / 2);
      m.spinCasters((g.phase === 'slideIn' || g.phase === 'slideOut') ? dt * 20 * g.slideSpeed : 0);
      const under = prog > 0.5;
      // lamp aims at the first unfixed fault
      const first = g.faults.find((f) => !f.fixed);
      if (under) {
        const aim = first
          ? this.carRoot.localToWorld(partToLocal(this.gPos(first.kind).x, this.gPos(first.kind).y, 0))
          : this.carRoot.localToWorld(partToLocal(700, 210, 0));
        m.setLamp(1, m.root.worldToLocal(aim));
      } else {
        m.setLamp(0, new THREE.Vector3(0, 2, 0));
      }
      m.reach(g.pointer.down && g.phase === 'under' ? 1 : 0.25);
      m.look(under ? 0 : -0.6, under ? 0.4 : -0.2, g.blink);
    } else if (g.phase === 'weld' || g.phase === 'weldDone' || g.phase === 'freeweld' || g.phase === 'shield') {
      let cx: number;
      let cz: number;
      if (g.phase === 'freeweld') {
        const pp = this.platePos();
        cx = pp.x + 1.9;
        cz = pp.z + 0.4;
      } else if (g.phase === 'shield') {
        cx = MECH_HOME_X - 0.6;
        cz = 1.15;
      } else {
        // stand inside the weld camera frame, at its lower-left
        const wp = this.weldPose(g);
        const bigW = (this.portrait() ? Math.min(this.W * 2.6, this.H * 1.4) : Math.min(this.W * 1.35, this.H * 2.2));
        const ppu = bigW / CAR_LEN;
        cx = wp.target.x - (this.W * 0.36) / ppu;
        cz = FLANK_Z + 0.55;
      }
      m.root.position.set(cx, 0, cz);
      m.setPose('weld', g.phase === 'freeweld' ? -0.5 : 0.35);
      m.setLamp(0, new THREE.Vector3(0, 2, 0));
      m.setMask(g.phase === 'shield' ? g.maskT : g.phase === 'weldDone' ? g.maskT : 1);
      m.look(0.3, 0.3, g.blink);
    } else {
      // standing around the garage
      const title = g.phase === 'title';
      const home = this.mechHome();
      const homeX = title ? (this.portrait() ? -0.5 : -1.6) : home.x - 0.25;
      const homeZ = title ? (this.portrait() ? 2.3 : 1.7) : home.z;
      m.root.position.set(homeX, 0, homeZ);
      m.setPose('stand', title ? 0.2 : -0.5);
      m.setLamp(0, new THREE.Vector3(0, 2, 0));
      m.setMask(0);
      m.look(title ? 0 : -0.5, title ? -0.1 : 0.1, g.blink);
    }
    const hintPulse = g.hintT > 1.4 ? (Math.sin(time * 5) + 1) / 2 : 0;
    m.setAntenna(hintPulse);
    m.update(dt, time);
  }

  private mechHome(): { x: number; z: number } {
    return this.portrait() ? { x: 2.3, z: 2.7 } : { x: MECH_HOME_X, z: 1.15 };
  }

  private platePos(): THREE.Vector3 {
    return this.portrait() ? new THREE.Vector3(-0.8, 1.0, 2.3) : PLATE_POS.clone();
  }

  private gPos(kind: string): { x: number; y: number } {
    // grab positions for lamp aiming (PART coords)
    switch (kind) {
      case 'bolt': return { x: 640, y: 268 };
      case 'clip': return { x: 505, y: 330 };
      case 'hose': return { x: 720, y: 320 };
      default: return { x: 300, y: 330 };
    }
  }

  private rebuildChoicePucks(carIdx: number): void {
    this.choiceGroup.clear();
    this.choicePucks = makeChoicePucks(carIdx);
    for (const p of this.choicePucks) this.choiceGroup.add(p.group);
  }

  private placePuck(obj: THREE.Object3D, sx: number, sy: number, rPx: number): void {
    const D = 6;
    const world = this.unprojectAtDistance(sx, sy, D);
    obj.position.copy(world);
    const ppu = this.H / (2 * Math.tan((this.camera.fov * Math.PI) / 360) * D);
    obj.scale.setScalar(rPx / ppu);
    obj.lookAt(this.camera.position);
  }

  private updateUI(g: Game, time: number): void {
    // start puck (title)
    if (g.phase === 'title') {
      this.startPuck.group.visible = true;
      const br = Math.min(this.W, this.H) * 0.11;
      const pulse = 1 + Math.sin(time * 3) * 0.05;
      this.placePuck(this.startPuck.group, this.W / 2, this.H * 0.78, br * pulse);
    } else {
      this.startPuck.group.visible = false;
    }
    // choice pucks
    if (g.phase === 'choice') {
      this.choiceGroup.visible = true;
      const cl = layoutChoice(this.W, this.H);
      cl.btns.forEach((b, i) => {
        const p = this.choicePucks[i];
        if (!p) return;
        const wob = 1 + Math.sin(time * 2.6 + i * 2.1) * 0.035;
        this.placePuck(p.group, b.x, b.y, b.r * wob);
        p.group.rotateZ(Math.sin(time * 2.2 + i * 1.8) * 0.06);
      });
    } else {
      this.choiceGroup.visible = false;
    }
    // floating mask pickup
    const l = layoutGarage(this.W, this.H);
    const mp = g.maskScreenPos(l);
    if (mp && g.phase === 'garage') {
      this.maskItem.visible = true;
      const bob = Math.sin(time * 2.2) * 6;
      this.placePuck(this.maskItem, mp.x, mp.y + bob, Math.max(40, l.carW * 0.13));
      this.maskItem.rotation.z = Math.sin(time * 1.8) * 0.08;
    } else {
      this.maskItem.visible = false;
    }
  }

  private updateDoodle(g: Game): void {
    const wh = `${this.W}x${this.H}`;
    const inFree = g.phase === 'freeweld';
    this.doodleMesh.visible = inFree || g.doodle.length === 0 ? inFree : this.doodleMesh.visible;
    if (!inFree) {
      if (g.doodle.length === 0) {
        this.doodleMesh.count = 0;
        this.lastDoodleLen = 0;
      }
      return;
    }
    const rebuildAll = wh !== this.lastDoodleWH || g.doodle.length < this.lastDoodleLen;
    const from = rebuildAll ? 0 : this.lastDoodleLen;
    if (from < g.doodle.length || rebuildAll) {
      const m4 = new THREE.Matrix4();
      const plane = this.platePlane();
      for (let i = from; i < g.doodle.length && i < 2400; i++) {
        const d = g.doodle[i];
        const w = this.rayOnPlane(d.x * this.W, d.y * this.H, plane);
        if (w) {
          m4.makeTranslation(w.x, w.y, w.z);
          this.doodleMesh.setMatrixAt(i, m4);
        }
      }
      this.doodleMesh.count = Math.min(g.doodle.length, 2400);
      this.doodleMesh.instanceMatrix.needsUpdate = true;
      this.lastDoodleLen = g.doodle.length;
      this.lastDoodleWH = wh;
    }
  }

  private updateMood(g: Game, dt: number): void {
    let target: Mood;
    if (g.phase === 'test') {
      target = g.test.course === 0
        ? { bg: new THREE.Color(0x87d0f2), hemi: 1.0, key: 2.6, window: 0 }
        : { bg: new THREE.Color(0x4a3f76), hemi: 0.5, key: 0.9, window: 0 };
    } else if (g.phase === 'weld' || g.phase === 'weldDone' || g.phase === 'shield' || g.phase === 'freeweld') {
      const dim = g.maskT;
      target = {
        bg: new THREE.Color(0x1a2130).lerp(new THREE.Color(0xe8d9c0), 1 - dim),
        hemi: lerp(0.55, 0.3, dim),
        key: lerp(2.6, 0.55, dim),
        window: lerp(1.6, 0.15, dim),
      };
      if (dim > 0.5) this.hemi.color.set(0xcfe0ff);
      else this.hemi.color.set(0xfff2df);
    } else if (g.phase === 'under' || ((g.phase === 'slideIn' || g.phase === 'slideOut') && g.creeperProg > 0.4)) {
      target = { bg: new THREE.Color(0x252831), hemi: 0.7, key: 1.2, window: 0.4 };
    } else {
      target = { bg: new THREE.Color(0xe8d9c0), hemi: 0.55, key: 2.6, window: 1.6 };
    }
    const k = 1 - Math.exp(-dt * 4);
    this.bg.lerp(target.bg, k);
    this.hemi.intensity = lerp(this.hemi.intensity, target.hemi, k);
    this.key.intensity = lerp(this.key.intensity, target.key, k);
    this.windowSpot.intensity = lerp(this.windowSpot.intensity, target.window, k);
    if (this.scene.fog instanceof THREE.Fog) this.scene.fog.color.copy(this.bg);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}

export let view: Scene3D;

export async function initView(canvas: HTMLCanvasElement): Promise<Scene3D> {
  view = new Scene3D();
  await view.init(canvas);
  return view;
}
