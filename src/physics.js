// src/physics.js — G (physics)
// Owns all toy-body simulation: held spring-follow, ballistic flight with
// aim-assist, ImpactSpec construction at water entry, underwater buoyancy/
// drag, resurfacing/floating, soft-toy squash, and the live-body cap.
// See docs/CONTRACTS.md "src/physics.js — G" and "ImpactSpec" for the exact
// contract this file must honor.
import * as THREE from 'three';
import { createToyMesh, deformToy } from './toys.js';
import { hashInts, mulberry32 } from './rng.js';
import { G, POOL } from './constants.js';

// ---------------------------------------------------------------------------
// Tunables (not specified numerically by the contract — chosen for toddler-
// friendly game feel; the contract only fixes the formula *shapes*).
// ---------------------------------------------------------------------------
const MAX_BODIES = 6;
const MAX_DT = 0.1;              // hard ceiling on a single update() call
const SUBSTEP_LIMIT = 1 / 40;    // substep whenever dt exceeds this
const AIM_ASSIST_MARGIN = 0.97;  // land slightly inside the 0.82*WATER_RADIUS ring
const BUOY_DAMPING = 0.4;        // softens the raw (1/density - 1)*G formula
const BUOY_ACCEL_CAP = G * 1.4;  // keeps very light/heavy toys from feeling absurd
const WATER_ENTRY_SPIN_KEEP = 0.12; // fraction of spin kept on water entry
const SECONDARY_ENERGY_MUL = 0.45;  // reduced energy for hop re-entry impacts
const HELD_SPRING_K = 210;
const HELD_SPRING_C = 24;
const SQUASH_SPRING_K = 130;
const SQUASH_SPRING_C = 13;
const FADE_RATE = 2.2; // scale units / second while culling the oldest body

// ---------------------------------------------------------------------------
// Mega ("そらのだい" sky-platform) tunables — docs/CONTRACTS-MEGA.md "M4 —
// giant toys + physics". Every mega-related code path below is gated on
// `def.mega` (or an explicit body flag set only for mega bodies), so none of
// this can change a single number for the 8 normal toys — the non-mega
// branch of every touched function is the exact original code.
// ---------------------------------------------------------------------------
const MEGA_TERMINAL_VY = 18;         // m/s, downward fall-speed cap (air drag)
const MEGA_AIM_ASSIST_RADIUS = 0.55; // * WATER_RADIUS — giants need center room
const MEGA_EXPIRE_SECONDS = 8;       // giants fade+remove ~8s after settling

// giantjelly split-on-impact ("jelly rain") — fragments are clones of the
// NORMAL 'jelly' ToyDef (mirrors TOY_ORDER's local-pinning approach: this
// module only depends on createToyMesh/deformToy from toys.js, plus this
// locally-pinned copy of the normal jelly def's fields, contract docs/
// CONTRACTS.md "The 8 toys" + toys.js's own tuning).
const JELLY_FRAGMENT_DEF_BASE = {
  id: 'jelly', name: 'ゼリーボール', emoji: '🍮', shape: 'sphere',
  density: 1.05, softness: 1, bounciness: 0.9, color: 0xff8fc7,
};
const JELLY_FRAGMENT_COUNT = 6;
const JELLY_FRAGMENT_MIN_R = 0.35;
const JELLY_FRAGMENT_MAX_R = 0.5;
const JELLY_FRAGMENT_MIN_SPEED = 4;
const JELLY_FRAGMENT_MAX_SPEED = 7;

// giantbeach deep-submerge + spring-back-resurface tunables.
const MEGA_BEACH_MAX_DEPTH = 2.2;    // m below y=0 it's allowed to punch down to
const MEGA_BUOY_SOFT_DEPTH = 0.5;    // m — below this, normal-strength buoyancy
const MEGA_BUOY_SPRING_K = 40;       // extra accel per meter beyond soft depth
const MEGA_BUOY_ACCEL_CAP = G * 3;   // mega floaters get a stronger spring cap
const MEGA_HOP_MIN_VY = 1.0;
const MEGA_HOP_MAX_VY = 5.0;
const MEGA_HOP_DEPTH_GAIN = 1.8;     // vy-per-meter-of-submersion scale

// Fixed toy order for the deterministic `seed` formula's `toyIndex` term.
// This mirrors the contract's own "The 8 toys" listing (ids fixed by
// contract) rather than importing TOYS from toys.js, so this module only
// depends on the two functions the contract grants it (createToyMesh,
// deformToy) plus this locally-pinned ordering.
const TOY_ORDER = ['pingpong', 'heavyball', 'beachball', 'disc', 'cup', 'sponge', 'ring', 'jelly'];

const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export class Physics {
  // `scene` is the PRIMARY way for Physics to attach spawned toy meshes to
  // the world. If a caller only passes `getWaterHeight` (no scene), spawnToy
  // cannot add the mesh itself — it still creates + returns the body with a
  // valid `body.mesh`, and the caller is expected to add that mesh to its
  // own scene right after spawnToy() returns. removeBody() defensively
  // checks `mesh.parent` before removing, so both modes stay safe.
  constructor({ scene, getWaterHeight, getSloshOffset } = {}) {
    this.scene = scene || null;
    this.getWaterHeight = getWaterHeight || null;
    // Optional, mega-only: additive slosh offset for floating giants, wired
    // by M3/M5 the same way getWaterHeight is (guarded — absent in all
    // existing non-mega instantiations, so this is a pure no-op until wired).
    this.getSloshOffset = getSloshOffset || null;

    this.onImpact = null;
    this.onResurface = null;
    this.onState = null;

    this.bodies = [];

    this._time = 0;

    // Preallocated scratch objects — reused every frame, never per-body
    // allocated, to satisfy the "no per-frame allocations in update" rule.
    this._tmpVec3 = new THREE.Vector3();
    this._tmpVec3b = new THREE.Vector3();
    this._tmpPrevPos = new THREE.Vector3();
    this._tmpAxis = new THREE.Vector3();
    this._tmpQa = new THREE.Quaternion();
    this._tmpQb = new THREE.Quaternion();
    this._tmpQc = new THREE.Quaternion();
    this._tmpVec2 = new THREE.Vector2();
    this._tmpFragPos = new THREE.Vector3(); // giantjelly fragment spawn scratch
    this._removalScratch = [];
  }

  // -- state bookkeeping ------------------------------------------------
  _setState(body, state) {
    body.state = state;
    if (this.onState) this.onState(body, state);
  }

  // -- public API ---------------------------------------------------------

  spawnToy(def, position) {
    const mesh = createToyMesh(def);
    mesh.position.copy(position);
    if (this.scene) this.scene.add(mesh);
    // else: fallback mode, see constructor comment — caller must scene.add(mesh).

    const body = {
      mesh,
      def,
      pos: mesh.position,       // live reference — no per-frame copy needed
      vel: new THREE.Vector3(),
      quat: mesh.quaternion,    // live reference
      angVel: new THREE.Vector3(),
      state: 'held',
      // internal bookkeeping (not part of the public contract, but harmless
      // extra fields on the body object):
      _squash: 0,
      _squashVel: 0,
      _fading: false,
      _fadeScale: 1,
      _hasHopped: false,
      _pendingSecondary: false,
      _phase: Math.random() * Math.PI * 2,
      _createdAt: this._time,
      _followPos: null,
      _holdTarget: null,
      _drift: null,
      _floatBase: null,
      _floatYaw: 0,
      // Mega-only bookkeeping (harmless no-ops for the 8 normal toys):
      _pendingRemoval: false,  // giantjelly: removed the instant it splits
      _settledAt: null,        // mega: this._time when it reached sunk/floating
      _maxSubmergeDepth: 0,    // mega: deepest -pos.y reached while inwater
    };
    this.bodies.push(body);
    if (this.onState) this.onState(body, 'held');
    return body;
  }

  grab(body) {
    body._fading = false;
    if (body._fadeScale !== 1) {
      body._fadeScale = 1;
      body.mesh.scale.set(1, 1, 1);
    }
    body.vel.set(0, 0, 0);
    body.angVel.set(0, 0, 0);
    if (!body._followPos) body._followPos = new THREE.Vector3();
    body._followPos.copy(body.pos);
    if (!body._holdTarget) body._holdTarget = new THREE.Vector3();
    body._holdTarget.copy(body.pos);
    this._setState(body, 'held');
  }

  dragTo(body, position) {
    if (!body._holdTarget) body._holdTarget = new THREE.Vector3();
    body._holdTarget.copy(position);
  }

  release(body, velocity) {
    body.vel.copy(velocity);
    this._applyAimAssist(body);
    this._applyReleaseSpin(body);
    body._hasHopped = false;
    body._pendingSecondary = false;
    this._setState(body, 'flying');
  }

  removeBody(body) {
    const idx = this.bodies.indexOf(body);
    if (idx >= 0) this.bodies.splice(idx, 1);
    if (body.mesh && body.mesh.parent) {
      body.mesh.parent.remove(body.mesh);
    }
  }

  update(dt) {
    if (!(dt > 0)) return;
    dt = Math.min(dt, MAX_DT);
    const steps = dt > SUBSTEP_LIMIT ? Math.ceil(dt / SUBSTEP_LIMIT) : 1;
    const sub = dt / steps;
    for (let i = 0; i < steps; i++) this._step(sub);
    this._maybeCullOldest();
  }

  // -- aim assist -----------------------------------------------------------

  // Ballistic time-to-water (y=0) for a given start height and vertical
  // velocity, ignoring drag (air phase only, matches the ballistic flight
  // model used for `flying`).
  _timeToGround(y0, vy) {
    const disc = vy * vy + 2 * G * y0;
    if (disc < 0) return -1;
    return (vy + Math.sqrt(disc)) / G;
  }

  // Same idea, but for mega bodies: the plain ballistic formula above
  // ignores the terminal-velocity air drag applied in _stepFlying, which
  // makes the actual fall take noticeably LONGER (capped descent speed)
  // than a drag-free estimate — using the drag-free time would under-count
  // flight time and let the (unchanged) horizontal velocity carry a mega
  // body's landing point past the aim-assist ring. Numerically integrates
  // the exact same vertical ODE _stepFlying uses (horizontal motion is
  // undamped/decoupled from this, so only the vertical component matters
  // for timing) to get an accurate crossing time.
  _timeToGroundMega(y0, vy0) {
    const k = G / (MEGA_TERMINAL_VY * MEGA_TERMINAL_VY);
    const dt = 0.02;
    let y = y0, vy = vy0, t = 0;
    for (let i = 0; i < 4000; i++) { // 80s safety ceiling
      if (vy < 0) {
        vy += (-G + k * vy * vy) * dt;
      } else {
        vy -= G * dt;
      }
      const prevY = y;
      y += vy * dt;
      t += dt;
      if (prevY > 0 && y <= 0 && vy < 0) {
        const denom = prevY - y;
        const frac = denom > 1e-6 ? clamp(prevY / denom, 0, 1) : 0;
        return t - dt * (1 - frac);
      }
    }
    return -1;
  }

  _applyAimAssist(body) {
    const pos = body.pos, vel = body.vel;
    const hSpeed = Math.hypot(vel.x, vel.z);
    // A tap-then-release with (near) no horizontal movement is a pure drop —
    // leave it completely alone (it already lands in water from the tip).
    if (hSpeed < 0.02) return;
    const t = body.def.mega ? this._timeToGroundMega(pos.y, vel.y)
                             : this._timeToGround(pos.y, vel.y);
    if (!(t > 0) || !isFinite(t)) return;
    const landX = pos.x + vel.x * t;
    const landZ = pos.z + vel.z * t;
    const dist = Math.hypot(landX, landZ);
    // Mega/sky drops get a tighter ring — giants need center room — applied
    // purely off def.mega, regardless of which platform released them.
    // Non-mega bodies take the exact original 0.82 ring untouched.
    const baseR = body.def.mega ? MEGA_AIM_ASSIST_RADIUS * POOL.WATER_RADIUS
                                 : 0.82 * POOL.WATER_RADIUS;
    const maxR = baseR * AIM_ASSIST_MARGIN;
    if (dist > maxR && dist > 1e-5) {
      // Retarget (not just rescale) the horizontal velocity so the SAME
      // ballistic time-of-flight lands exactly on the assist ring, on the
      // same bearing as the original landing point. A pure velocity-rescale
      // (old approach) only shrinks the vel*t term and leaves `pos` as an
      // untouched additive offset — if `pos` itself is already far from
      // center (a fast/violent drag can carry the held toy well past the
      // platform tip before release), scaling velocity toward zero just
      // converges the landing toward `pos`, which can still be outside the
      // pool. Solving vel from `pos + vel*t = target` guarantees the actual
      // landing point regardless of how far `pos` has drifted.
      const nx = landX / dist;
      const nz = landZ / dist;
      const targetX = nx * maxR;
      const targetZ = nz * maxR;
      vel.x = (targetX - pos.x) / t;
      vel.z = (targetZ - pos.z) / t;
    }
    // Note: given PLATFORMS geometry (tips already inside WATER_RADIUS), a
    // throw can't realistically fall short of the pool, so only the
    // "too far" branch is exercised in practice; the guard above still
    // protects against future constant changes.
  }

  // Angular velocity from the release's horizontal speed: light/flat toys
  // (disc, ring, sponge) tumble a lot; a heavyball barely rotates.
  _applyReleaseSpin(body) {
    const def = body.def;
    const vel = body.vel;
    const hSpeed = Math.max(Math.hypot(vel.x, vel.z), 0.4);
    let tumble;
    switch (def.id) {
      case 'heavyball': tumble = 0.15; break;
      case 'disc':
      case 'ring':
      case 'sponge': tumble = 1.5; break;
      case 'beachball': tumble = 0.55; break;
      case 'cup': tumble = 0.85; break;
      case 'jelly': tumble = 0.7; break;
      case 'pingpong': tumble = 1.0; break;
      default: tumble = 0.8;
    }
    const mag = Math.min(hSpeed, 9) * tumble * 1.1;
    let ax = -vel.z, az = vel.x; // horizontal axis perpendicular to travel dir
    const len = Math.hypot(ax, az) || 1;
    ax /= len; az /= len;
    body.angVel.set(ax * mag, (Math.random() - 0.5) * 0.7 * tumble, az * mag);
  }

  // -- per-substep dispatch ---------------------------------------------------

  _step(dt) {
    this._time += dt;
    const removal = this._removalScratch;
    removal.length = 0;

    // Cache the pre-step body count: giantjelly fragment spawning (below)
    // appends new 'flying' bodies to this.bodies mid-loop. Capping the loop
    // bound here means a freshly-spawned fragment gets its first integration
    // step next update() call, not this one — existing code never appended
    // bodies mid-_step, so this is a no-op for every other path.
    const n = this.bodies.length;
    for (let i = 0; i < n; i++) {
      const body = this.bodies[i];
      switch (body.state) {
        case 'held': this._stepHeld(body, dt); break;
        case 'flying': this._stepFlying(body, dt); break;
        case 'inwater': this._stepInWater(body, dt); break;
        case 'floating': this._stepFloating(body, dt); break;
        case 'sunk': /* resting, nothing to integrate */ break;
      }

      this._stepSoftDeform(body, dt);

      if (body._pendingRemoval) {
        // giantjelly: emitted its mega impact and split into fragments this
        // same substep — remove it now (reuses the existing post-loop
        // removal pass so the bodies[] iteration above stays untouched).
        removal.push(body);
        continue;
      }

      // Mega-only auto-expiry: giants fade+remove ~8s after they settle
      // (sunk on the floor, or floating), reusing the exact same fade-then-
      // remove mechanism as _maybeCullOldest below. Zero effect on any body
      // whose def.mega is falsy.
      if (body.def.mega && !body._fading && body._settledAt !== null &&
          (body.state === 'sunk' || body.state === 'floating') &&
          this._time - body._settledAt > MEGA_EXPIRE_SECONDS) {
        body._fading = true;
      }

      if (body._fading) {
        body._fadeScale = Math.max(0, body._fadeScale - dt * FADE_RATE);
        if (body.def.softness > 0) {
          body.mesh.scale.multiplyScalar(body._fadeScale);
        } else {
          body.mesh.scale.setScalar(body._fadeScale);
        }
        if (body._fadeScale <= 0.001) removal.push(body);
      }
    }

    for (let i = 0; i < removal.length; i++) this.removeBody(removal[i]);
  }

  // -- held: spring-follow + idle bob ------------------------------------------

  _stepHeld(body, dt) {
    const pos = body.pos;
    if (!body._followPos) body._followPos = pos.clone();
    if (!body._holdTarget) body._holdTarget = pos.clone();

    // Critically-damped-ish spring toward the pointer target, tracked via
    // body.vel so a release feels continuous rather than teleport-y.
    this._tmpVec3.subVectors(body._holdTarget, body._followPos);
    this._tmpVec3b.copy(this._tmpVec3)
      .multiplyScalar(HELD_SPRING_K)
      .addScaledVector(body.vel, -HELD_SPRING_C);
    body.vel.addScaledVector(this._tmpVec3b, dt);
    body._followPos.addScaledVector(body.vel, dt);

    const bobAmp = 0.02 + body.def.radius * 0.01;
    const bob = Math.sin(this._time * 2.4 + body._phase) * bobAmp;
    pos.set(body._followPos.x, body._followPos.y + bob, body._followPos.z);
  }

  // -- flying: ballistic + tumbling, detects y=0 downward crossing ------------

  _stepFlying(body, dt) {
    const pos = body.pos, vel = body.vel, def = body.def;
    this._tmpPrevPos.copy(pos);
    const prevY = pos.y;

    if (def.mega && vel.y < 0) {
      // Terminal velocity: quadratic air drag smoothly approaching
      // MEGA_TERMINAL_VY as the fall speed grows, instead of gravity
      // integrating unbounded. Derived from dv/dt = -g + k*v^2 with k chosen
      // so the accel is exactly zero at v == -MEGA_TERMINAL_VY (the classic
      // terminal-velocity ODE) — asymptotic, never a hard clamp/snap.
      const k = G / (MEGA_TERMINAL_VY * MEGA_TERMINAL_VY);
      vel.y += (-G + k * vel.y * vel.y) * dt;
    } else {
      vel.y -= G * dt;
    }
    pos.addScaledVector(vel, dt);
    this._applyAngularIntegration(body, dt);

    if (prevY > 0 && pos.y <= 0 && vel.y < 0) {
      const denom = prevY - pos.y;
      const t = denom > 1e-6 ? clamp(prevY / denom, 0, 1) : 0;
      const crossPoint = this._tmpVec3.copy(this._tmpPrevPos).lerp(pos, t);
      this._handleWaterEntry(body, crossPoint, vel);
    }
  }

  _applyAngularIntegration(body, dt) {
    const angVel = body.angVel;
    const angle = angVel.length() * dt;
    if (angle > 1e-6) {
      this._tmpAxis.copy(angVel).normalize();
      this._tmpQa.setFromAxisAngle(this._tmpAxis, angle);
      body.quat.premultiply(this._tmpQa); // world-space rotation
    }
  }

  // -- ImpactSpec construction (the heart of the game) -------------------------

  _computeFlatness(body) {
    const def = body.def;
    switch (def.shape) {
      case 'sphere':
        return 0.1; // rotationally symmetric — orientation never matters
      case 'disc': {
        // LatheGeometry revolves the disc profile around local Y, so local
        // +Y is the disc's flat-face normal. Face-on (normal vertical) = 1,
        // edge-on (normal horizontal) = 0.05, matching the contract anchors.
        this._tmpAxis.set(0, 1, 0).applyQuaternion(body.quat);
        const align = Math.abs(this._tmpAxis.y);
        return 0.05 + align * 0.95;
      }
      case 'torus': {
        // toys.js rotates the torus so its hole axis is local +Y at rest —
        // same reasoning as disc, but a torus never goes fully flat (tube
        // volume), so the range is narrower.
        this._tmpAxis.set(0, 1, 0).applyQuaternion(body.quat);
        const align = Math.abs(this._tmpAxis.y);
        return 0.15 + align * 0.5;
      }
      case 'cup': {
        // Cup opening faces local +Y (contract). Rim-down or opening-up both
        // present a roughly circular flat-ish profile; sideways is the least
        // flat. align=1 (either up or down) → 0.4, matching the contract's
        // "cup rim-down ≈ 0.4" example exactly.
        this._tmpAxis.set(0, 1, 0).applyQuaternion(body.quat);
        const align = Math.abs(this._tmpAxis.y);
        return 0.15 + align * 0.25;
      }
      case 'box': {
        // Whichever local face-normal (X/Y/Z) is most vertical is the
        // striking face; a corner-first impact is far less flat than a
        // face-first one.
        this._tmpAxis.set(1, 0, 0).applyQuaternion(body.quat);
        let m = Math.abs(this._tmpAxis.y);
        this._tmpAxis.set(0, 1, 0).applyQuaternion(body.quat);
        m = Math.max(m, Math.abs(this._tmpAxis.y));
        this._tmpAxis.set(0, 0, 1).applyQuaternion(body.quat);
        m = Math.max(m, Math.abs(this._tmpAxis.y));
        return 0.4 + m * 0.4; // ~0.6 for a "generic" tumbling orientation
      }
      default:
        return 0.3;
    }
  }

  _computeCupTrap(body) {
    const def = body.def;
    if (def.shape === 'cup') {
      // Local +Y is the opening direction. d=-1 → opening straight down
      // (dome-trapping orientation) → cupTrap≈1. d=+1 → opening straight up
      // → cupTrap≈0.1. Sideways interpolates between.
      this._tmpAxis.set(0, 1, 0).applyQuaternion(body.quat);
      const d = this._tmpAxis.y;
      const t = (1 - d) / 2; // d=-1 -> 1, d=1 -> 0
      return 0.1 + 0.9 * t;
    }
    if (def.shape === 'torus') return 0.3; // ring — representative constant per contract
    return 0;
  }

  _handleWaterEntry(body, point, vel) {
    const def = body.def;
    const spin = body.angVel.length(); // BEFORE the post-entry spin kill below
    const flatness = this._computeFlatness(body);
    const cupTrap = this._computeCupTrap(body);
    const speed = vel.length();
    const hSpeed = Math.hypot(vel.x, vel.z);
    const oblique = speed > 1e-5 ? hSpeed / speed : 0;

    this._tmpVec2.set(0, 0);
    if (hSpeed > 1e-5) this._tmpVec2.set(vel.x / hSpeed, vel.z / hSpeed);

    const mass = def.density * def.radius * def.radius * def.radius * 33;
    let energy = Math.pow(clamp01((mass * speed * speed) / 260), 0.6);

    const isSecondary = !!body._pendingSecondary;
    if (isSecondary) {
      energy *= SECONDARY_ENERGY_MUL;
      body._pendingSecondary = false;
    }

    const toyIndex = TOY_ORDER.indexOf(def.id);
    const seed = hashInts(
      toyIndex,
      Math.round(speed * 3),
      Math.round(oblique * 6),
      Math.round(flatness * 6)
    );

    const spec = {
      point: new THREE.Vector3(point.x, 0, point.z),
      velocity: new THREE.Vector3(vel.x, vel.y, vel.z),
      speed,
      energy,
      size: def.radius,
      def,
      flatness,
      oblique,
      dir: new THREE.Vector2(this._tmpVec2.x, this._tmpVec2.y),
      cupTrap,
      spin,
      seed,
      isSecondary,
    };

    // Mega spec extension (docs/CONTRACTS-MEGA.md "Shared definitions"):
    // adds nothing for non-mega defs, so every field/shape above stays
    // bit-identical to today for the 8 normal toys. Secondary re-entries of
    // a mega body (giantbeach's resurface hop) are explicitly excluded —
    // contract: "its re-entry is a normal-path secondary impact", i.e. main
    // must route it through the NORMAL splash pipeline, not megasplash.
    if (def.mega && !isSecondary) {
      spec.mega = true;
      spec.megaScale = def.radius / 0.35;
    }

    if (def.softness > 0) {
      body._squash = clamp01(energy * (0.6 + def.softness * 0.6));
      body._squashVel = -body._squash * 6;
    }

    // Entering water kills most spin quickly.
    body.angVel.multiplyScalar(WATER_ENTRY_SPIN_KEEP);

    this._setState(body, 'inwater');
    if (this.onImpact) this.onImpact(spec);

    // giantjelly: splits into 6 normal-jelly fragments on impact ("jelly
    // rain") — emit the mega spec first (above), THEN remove this giant body
    // and spawn the fragments so re-entries are ordinary secondary impacts
    // through the existing pipeline.
    if (def.mega && def.id === 'giantjelly') {
      this._spawnJellyFragments(spec, spec.point);
      body._pendingRemoval = true;
    }
  }

  // -- giantjelly split: 6 seeded fragments launched outward+up ---------------

  _spawnJellyFragments(spec, origin) {
    const rand = mulberry32(spec.seed);
    for (let i = 0; i < JELLY_FRAGMENT_COUNT; i++) {
      const r = JELLY_FRAGMENT_MIN_R + rand() * (JELLY_FRAGMENT_MAX_R - JELLY_FRAGMENT_MIN_R);
      const fragDef = Object.assign({}, JELLY_FRAGMENT_DEF_BASE, { radius: r });

      // Evenly spaced ring around the impact point (a shallow launch cone),
      // with seeded jitter so the 6 fragments don't look perfectly regular.
      const slice = (Math.PI * 2) / JELLY_FRAGMENT_COUNT;
      const angle = i * slice + (rand() - 0.5) * slice * 0.6;
      const speed = JELLY_FRAGMENT_MIN_SPEED + rand() * (JELLY_FRAGMENT_MAX_SPEED - JELLY_FRAGMENT_MIN_SPEED);
      const elevation = 0.5 + rand() * 0.35; // ~29-49deg above horizontal
      const horizSpeed = Math.cos(elevation) * speed;
      const vy = Math.sin(elevation) * speed;
      const vx = Math.cos(angle) * horizSpeed;
      const vz = Math.sin(angle) * horizSpeed;

      this._tmpFragPos.set(origin.x, Math.max(origin.y, 0.05), origin.z);
      const frag = this.spawnToy(fragDef, this._tmpFragPos);
      frag.vel.set(vx, vy, vz);
      frag._pendingSecondary = true; // re-entry fires isSecondary through the
                                      // existing _handleWaterEntry pipeline
      this._setState(frag, 'flying');
    }
  }

  // -- inwater: buoyancy + drag, floor settle, upward-crossing resurface -------

  _stepInWater(body, dt) {
    const pos = body.pos, vel = body.vel, def = body.def;
    const prevY = pos.y;

    // Only a genuine floater (density < 1) gets the mega deep-submerge +
    // spring-back treatment — contract: "giantbeach: allowed to submerge
    // deeper...". giantheavy is mega but a SINKER (density 2.6); it must
    // fall through to the exact original clamp/behavior below, unmodified.
    const isMegaFloater = def.mega && def.density < 1;

    let buoyAccel = (1 / def.density - 1) * G * BUOY_DAMPING;
    if (isMegaFloater) {
      // Allowed to punch down deeper than the normal cap before the
      // buoyancy spring fights back hard — a true progressive spring (extra
      // restoring accel proportional to depth beyond MEGA_BUOY_SOFT_DEPTH),
      // capped higher so the resurface reads as a strong "spring back"
      // rather than a gentle bob-up.
      const depth = Math.max(0, -pos.y);
      const over = Math.max(0, depth - MEGA_BUOY_SOFT_DEPTH);
      buoyAccel += over * MEGA_BUOY_SPRING_K;
      buoyAccel = clamp(buoyAccel, -MEGA_BUOY_ACCEL_CAP, MEGA_BUOY_ACCEL_CAP);
    } else {
      buoyAccel = clamp(buoyAccel, -BUOY_ACCEL_CAP, BUOY_ACCEL_CAP);
    }
    vel.y += buoyAccel * dt;

    // Quadratic drag, applied as a stable implicit (division-based) update so
    // no clamping is needed even for large dt. Cup/ring shapes scoop extra
    // water and slow down faster.
    let dragK = 0.85;
    if (def.shape === 'cup' || def.shape === 'torus') dragK *= 1.9;
    const speed = vel.length();
    if (speed > 1e-5) {
      vel.multiplyScalar(1 / (1 + dragK * speed * dt));
    }

    pos.addScaledVector(vel, dt);
    body.angVel.multiplyScalar(Math.max(0, 1 - 6 * dt));

    if (isMegaFloater) {
      // Soft depth clamp (contract: "down to ~2.2m") + track the deepest
      // submersion reached, used to scale the resurface hop below. This
      // floater never touches the true pool floor (POOL.DEPTH is always
      // deeper than MEGA_BEACH_MAX_DEPTH), so it skips the radius-based
      // floor-rest check entirely below — it only ever springs back up.
      if (pos.y < -MEGA_BEACH_MAX_DEPTH) {
        pos.y = -MEGA_BEACH_MAX_DEPTH;
        if (vel.y < 0) vel.y = 0;
      }
      const depthNow = Math.max(0, -pos.y);
      if (depthNow > body._maxSubmergeDepth) body._maxSubmergeDepth = depthNow;

      if (prevY < 0 && pos.y >= 0 && vel.y > 0) {
        this._handleResurface(body);
      }
      return;
    }

    const floorY = -POOL.DEPTH + def.radius;
    if (pos.y <= floorY) {
      pos.y = floorY;
      vel.y = Math.max(0, -vel.y * 0.12); // soft thud settle
      vel.x *= 0.6;
      vel.z *= 0.6;
      if (vel.length() < 0.06) {
        vel.set(0, 0, 0);
        if (def.mega) body._settledAt = this._time;
        this._setState(body, 'sunk');
      }
      return;
    }

    if (prevY < 0 && pos.y >= 0 && vel.y > 0) {
      this._handleResurface(body);
    }
  }

  _handleResurface(body) {
    const def = body.def;
    // Beachball-class: large, very low density toys may pop up once instead
    // of settling straight into 'floating'.
    const eligibleHop = !body._hasHopped && def.density < 0.12 && def.radius >= 0.4;
    if (eligibleHop) {
      body._hasHopped = true;
      body._pendingSecondary = true;
      if (def.mega) {
        // Contract: "on upward y=0 crossing: onResurface AND a special big
        // hop" — unlike the normal-toy hop (which only calls onResurface
        // once it settles into floating), mega fires onResurface right here
        // too, then a hop scaled by how deep it had punched down.
        if (this.onResurface) this.onResurface(body.pos.clone(), def);
        const depth = body._maxSubmergeDepth || 0;
        const hopVy = clamp(MEGA_HOP_MIN_VY + depth * MEGA_HOP_DEPTH_GAIN, MEGA_HOP_MIN_VY, MEGA_HOP_MAX_VY);
        body.vel.y = hopVy;
        body.vel.x *= 0.4;
        body.vel.z *= 0.4;
      } else {
        body.vel.y = Math.max(body.vel.y * 0.8, 1.0);
        body.vel.x *= 0.4;
        body.vel.z *= 0.4;
      }
      this._setState(body, 'flying');
      return;
    }
    if (this.onResurface) this.onResurface(body.pos.clone(), def);
    this._beginFloating(body);
  }

  // -- floating: bob on the water surface, gentle rock + drift ----------------

  _beginFloating(body) {
    this._setState(body, 'floating');
    if (body.def.mega) body._settledAt = this._time;
    if (!body._floatBase) body._floatBase = new THREE.Quaternion();
    body._floatBase.copy(body.quat);
    body._floatYaw = 0;
    if (!body._drift) body._drift = { vx: 0, vz: 0 };
    const ang = Math.random() * Math.PI * 2;
    const s = 0.05 + Math.random() * 0.12;
    body._drift.vx = Math.cos(ang) * s;
    body._drift.vz = Math.sin(ang) * s;
    body.vel.set(0, 0, 0);
  }

  _stepFloating(body, dt) {
    const pos = body.pos, def = body.def;

    pos.x += body._drift.vx * dt;
    pos.z += body._drift.vz * dt;

    const distC = Math.hypot(pos.x, pos.z);
    const limit = POOL.WATER_RADIUS * 0.9 - def.radius;
    if (distC > limit && distC > 1e-5) {
      const nx = pos.x / distC, nz = pos.z / distC;
      pos.x = nx * limit;
      pos.z = nz * limit;
      body._drift.vx *= -0.6;
      body._drift.vz *= -0.6;
    }

    let wh = this.getWaterHeight ? this.getWaterHeight(pos.x, pos.z) : 0;
    // Floating giants additionally bob with the pool's sloshing (mega-only,
    // guarded — a pure no-op until M3/M5 wire getSloshOffset).
    if (def.mega && this.getSloshOffset) {
      wh += this.getSloshOffset(pos.x, pos.z);
    }
    pos.y += (wh - pos.y) * Math.min(1, 5 * dt);

    // Gentle rock + slow spin, recomputed fresh from absolute time each
    // frame (not incrementally multiplied) so nothing ever drifts/compounds.
    body._floatYaw += dt * 0.35;
    this._tmpQa.setFromAxisAngle(AXIS_Y, body._floatYaw);
    this._tmpQb.setFromAxisAngle(AXIS_X, Math.sin(this._time * 0.9 + body._phase) * 0.12);
    this._tmpQc.setFromAxisAngle(AXIS_Z, Math.cos(this._time * 0.7 + body._phase * 1.3) * 0.1);
    body.quat.copy(body._floatBase).multiply(this._tmpQa).multiply(this._tmpQb).multiply(this._tmpQc);
  }

  // -- soft toys: squash on impact + spring jiggle decay -----------------------

  _stepSoftDeform(body, dt) {
    const def = body.def;
    if (def.softness <= 0) return; // rigid toys: scale left untouched (stays default)

    const accel = -SQUASH_SPRING_K * body._squash - SQUASH_SPRING_C * body._squashVel;
    body._squashVel += accel * dt;
    body._squash += body._squashVel * dt;
    if (Math.abs(body._squash) < 0.002 && Math.abs(body._squashVel) < 0.01) {
      body._squash = 0;
      body._squashVel = 0;
    }
    deformToy(body.mesh, clamp01(body._squash), 1);
  }

  // -- cap ~6 live bodies: oldest resting/floating fades out -------------------

  _maybeCullOldest() {
    if (this.bodies.length <= MAX_BODIES) return;
    for (let i = 0; i < this.bodies.length; i++) {
      const b = this.bodies[i];
      if (b._fading) continue;
      if (b.state === 'floating' || b.state === 'sunk') {
        b._fading = true;
        break; // bodies[] is in spawn order, so the first match is the oldest
      }
    }
  }
}
