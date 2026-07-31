// SprayParticles.js — GPU water-spray particle system (A6 FX/POST).
//
// THREE.Points + a custom ShaderMaterial. All per-particle motion (ballistic
// arc under gravity + linear air drag) is computed analytically in the
// vertex shader from `uTime - aBirth`, so the CPU side never steps existing
// particles — it only ever writes new ones into a ring buffer and advances
// `uTime`. That keeps `emit()` cheap enough to call every frame from
// main.js and keeps `update()` O(1) regardless of particle count.
//
// Ring buffer + partial upload (r180 API, verified against
// node_modules/three/src/core/BufferAttribute.js and
// node_modules/three/src/renderers/webgl/WebGLAttributes.js):
//   - `BufferAttribute#addUpdateRange(start, count)` takes *component*
//     offsets (i.e. already multiplied by itemSize), not vertex/item
//     indices — WebGLAttributes.updateBuffer() does
//     `gl.bufferSubData(target, range.start * array.BYTES_PER_ELEMENT,
//     array, range.start, range.count)`, so `start`/`count` index straight
//     into the flat TypedArray.
//   - `attribute.needsUpdate = true` just bumps `.version`; the accumulated
//     `updateRanges` are consumed (and cleared) the next time the geometry
//     is actually drawn, so calling it once per emit() batch is enough.
//   - A geometry needs a finite-count `position` attribute or
//     WebGLRenderer.renderBufferDirect() sees drawRange.count === Infinity
//     and skips the draw call entirely. We reuse the same BufferAttribute
//     under both `position` (so three.js is happy) and `aStart` (the name
//     used inside the shader) — one GPU buffer, two attribute slots, zero
//     duplication.

import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const REF_ALT = new THREE.Vector3(1, 0, 0);

// Scratch vectors reused across emit() calls to avoid GC churn — this file
// owns them exclusively so this is safe (no re-entrancy).
const _dir = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _tangent = new THREE.Vector3();
const _bitangent = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _drawingBufferSize = new THREE.Vector2();

// Per-type emission profiles. `spread` is the cone half-angle (radians)
// around the (up-biased) emit direction. `speedMin/Max` multiply the
// caller-supplied `speed`; `kick` is a flat m/s add-on so particles still
// pop off the water even when `speed` is small. Bigger droplets (`sizeMax`
// closer to the shader's drag-normalisation cap) read as more "ballistic"
// because SprayParticles derives per-particle air drag from aSize.
const TYPE_PARAMS = {
  mist: {
    spread: 0.95,
    upBias: 0.12,
    speedMin: 0.22,
    speedMax: 0.55,
    sizeMin: 0.016,
    sizeMax: 0.042,
    lifeMin: 0.35,
    lifeMax: 0.8,
    kick: 0.15,
  },
  splash: {
    spread: 0.55,
    upBias: 0.3,
    speedMin: 0.55,
    speedMax: 1.05,
    sizeMin: 0.045,
    sizeMax: 0.1,
    lifeMin: 0.5,
    lifeMax: 1.05,
    kick: 0.35,
  },
  chunk: {
    spread: 0.28,
    upBias: 0.5,
    speedMin: 0.9,
    speedMax: 1.4,
    sizeMin: 0.1,
    sizeMax: 0.22,
    lifeMin: 0.7,
    lifeMax: 1.35,
    kick: 0.6,
  },
};

const VERTEX_SHADER = /* glsl */ `
uniform float uTime;
uniform vec3 uGravity;
uniform float uDragMin;
uniform float uDragMax;
uniform float uViewportHeight;
uniform float uProjScaleY;
uniform float uFadeStartDist;
uniform float uMaxDist;
uniform vec3 uSunDirection;

attribute vec3 aStart;
attribute vec3 aVel;
attribute float aBirth;
attribute float aLife;
attribute float aSize;
attribute float aSeed;

varying float vAlpha;
varying float vSeed;
varying float vCore;
varying float vBacklit;
varying vec3 vSunDirView;

void main() {
  float life = max( aLife, 0.0001 );
  float t = uTime - aBirth;
  float progress = clamp( t / life, 0.0, 1.0 );

  // Alive mask: born, not yet expired, and an actually-emitted slot
  // (never-emitted ring-buffer slots have aLife == 0).
  float alive = step( 0.0, t ) * step( t, life ) * step( 0.0005, aLife );

  // Bigger droplets carry more momentum relative to their drag (they read
  // as "chunkier" / more ballistic); fine mist is dominated by drag.
  float sizeNorm = clamp( aSize / 0.30, 0.0, 1.0 );
  float k = max( mix( uDragMax, uDragMin, sizeNorm ), 0.05 );

  // Closed-form solution for dv/dt = gravity - k*v (linear drag):
  //   v(t) = (v0 - g/k) * exp(-k*t) + g/k
  //   p(t) = p0 + (v0 - g/k) * (1 - exp(-k*t)) / k + (g/k) * t
  vec3 gOverK = uGravity / k;
  float decay = exp( -k * t );
  vec3 pos = aStart + ( aVel - gOverK ) * ( ( 1.0 - decay ) / k ) + gOverK * t;

  vec4 mvPosition = modelViewMatrix * vec4( pos, 1.0 );
  float dist = max( -mvPosition.z, 0.001 );

  // Quick pop-in at birth, gentle shrink as it dies.
  float grow = smoothstep( 0.0, 0.12, progress );
  float shrink = 1.0 - smoothstep( 0.72, 1.0, progress ) * 0.4;
  float sizeCurve = grow * shrink;
  float worldSize = aSize * sizeCurve;

  // Perspective-correct world-space point size: worldSize projected through
  // the same Y-scale the projection matrix uses, so it stays consistent
  // under the chase camera's dynamic FOV (68deg..92deg per SPEC 4.4).
  float ptSize = worldSize * ( uViewportHeight * uProjScaleY * 0.5 ) / dist;

  // Distance thinning: shrink + fade fully out before uMaxDist so far
  // particles cost near-zero fill rate instead of being tiny flecks.
  float distFade = 1.0 - smoothstep( uFadeStartDist, uMaxDist, dist );

  float fadeInOut = smoothstep( 0.0, 0.05, progress ) * ( 1.0 - smoothstep( 0.8, 1.0, progress ) );

  vAlpha = alive * distFade * fadeInOut;
  gl_PointSize = ptSize * alive * distFade;

  gl_Position = projectionMatrix * mvPosition;

  // Dead / faded-out / distance-culled particles: push past the clip
  // volume so the rasterizer discards them for free (GLSL ES 1.00 has no
  // vertex-stage discard).
  if ( vAlpha <= 0.002 || gl_PointSize < 0.6 ) {
    gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
  }

  vSeed = aSeed;
  vCore = sizeNorm;
  vSunDirView = normalize( ( viewMatrix * vec4( uSunDirection, 0.0 ) ).xyz );
  vBacklit = smoothstep( 0.965, 0.999, dot( normalize( mvPosition.xyz ), vSunDirView ) );
}
`;

const FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uWaterColor;
uniform vec3 uRimColor;
uniform vec3 uSunColor;
uniform float uOpacity;

varying float vAlpha;
varying float vSeed;
varying float vCore;
varying float vBacklit;
varying vec3 vSunDirView;

void main() {
  vec2 uv = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot( uv, uv );
  if ( r2 > 1.0 ) discard;

  // Fake a hemisphere normal facing the camera so the point sprite reads
  // as a tiny round, lit droplet instead of a flat disc.
  float nz = sqrt( max( 1.0 - r2, 0.0 ) );
  vec3 n = vec3( uv, nz );

  float corePow = mix( 1.2, 2.4, vSeed );
  float core = pow( nz, corePow );
  float fresnel = pow( 1.0 - nz, 3.0 );

  float sunDot = max( dot( n, vSunDirView ), 0.0 );
  float glint = pow( sunDot, 24.0 ) * 1.5;

  vec3 baseColor = mix( vec3( 1.0 ), uWaterColor, 0.35 + 0.5 * vCore );
  vec3 color = mix( baseColor, vec3( 1.0 ), core * 0.55 );
  color += uRimColor * fresnel * 0.55;
  color += uSunColor * glint;
  // Particles roughly between the camera and the sun glow instead of
  // reading as flat-shaded discs (a cheap stand-in for real transmission).
  color += uSunColor * vBacklit * ( 0.55 + fresnel ) * 1.5;

  float r = sqrt( r2 );
  float edge = 1.0 - smoothstep( 0.8, 1.0, r );
  float alpha = vAlpha * uOpacity * edge;
  // Backlit droplets thin out a bit so the glow reads as translucent
  // rather than a bright opaque dot (kept in NormalBlending on purpose —
  // see SprayParticles 要件 in the task spec).
  alpha = mix( alpha, alpha * 0.5, vBacklit );

  gl_FragColor = vec4( color, clamp( alpha, 0.0, 1.0 ) );
}
`;

export class SprayParticles {
  /**
   * @param {THREE.Scene} scene
   * @param {object} [opts]
   * @param {number} [opts.count] particle capacity, clamped to [4000, 8000]
   * @param {THREE.WebGLRenderer} [opts.renderer] optional — used to read the
   *   exact drawing-buffer height for point-size math; falls back to
   *   window.innerHeight * devicePixelRatio when omitted.
   * @param {number} [opts.fadeStartDistance] distance (m) where thinning begins
   * @param {number} [opts.maxDistance] distance (m) where particles fully vanish
   * @param {THREE.Vector3} [opts.gravity]
   * @param {number} [opts.dragMin] drag coefficient for the biggest droplets
   * @param {number} [opts.dragMax] drag coefficient for the finest mist
   * @param {THREE.Vector3} [opts.sunDirection] default sun direction for glints
   * @param {number|THREE.Color} [opts.waterColor]
   * @param {number|THREE.Color} [opts.rimColor]
   * @param {number|THREE.Color} [opts.sunColor]
   * @param {number} [opts.opacity]
   */
  constructor(scene, opts = {}) {
    const count = Math.round(THREE.MathUtils.clamp(opts.count ?? 6000, 4000, 8000));
    this.count = count;
    this._renderer = opts.renderer || null;
    this._cursor = 0;
    this._time = 0;

    const startArr = new Float32Array(count * 3);
    const velArr = new Float32Array(count * 3);
    const birthArr = new Float32Array(count).fill(-1e6);
    const lifeArr = new Float32Array(count);
    const sizeArr = new Float32Array(count);
    const seedArr = new Float32Array(count);

    this._startArr = startArr;
    this._velArr = velArr;
    this._birthArr = birthArr;
    this._lifeArr = lifeArr;
    this._sizeArr = sizeArr;
    this._seedArr = seedArr;

    const startAttr = new THREE.BufferAttribute(startArr, 3).setUsage(THREE.DynamicDrawUsage);
    const velAttr = new THREE.BufferAttribute(velArr, 3).setUsage(THREE.DynamicDrawUsage);
    const birthAttr = new THREE.BufferAttribute(birthArr, 1).setUsage(THREE.DynamicDrawUsage);
    const lifeAttr = new THREE.BufferAttribute(lifeArr, 1).setUsage(THREE.DynamicDrawUsage);
    const sizeAttr = new THREE.BufferAttribute(sizeArr, 1).setUsage(THREE.DynamicDrawUsage);
    const seedAttr = new THREE.BufferAttribute(seedArr, 1).setUsage(THREE.DynamicDrawUsage);

    this._startAttr = startAttr;
    this._velAttr = velAttr;
    this._birthAttr = birthAttr;
    this._lifeAttr = lifeAttr;
    this._sizeAttr = sizeAttr;
    this._seedAttr = seedAttr;

    const geometry = new THREE.BufferGeometry();
    // `position` is required by WebGLRenderer for a finite draw count and
    // by BufferGeometry for bounding-sphere math; `aStart` is the name the
    // shader actually reads. Same buffer, no duplication.
    geometry.setAttribute('position', startAttr);
    geometry.setAttribute('aStart', startAttr);
    geometry.setAttribute('aVel', velAttr);
    geometry.setAttribute('aBirth', birthAttr);
    geometry.setAttribute('aLife', lifeAttr);
    geometry.setAttribute('aSize', sizeAttr);
    geometry.setAttribute('aSeed', seedAttr);

    const sunDirection = (opts.sunDirection ? opts.sunDirection.clone() : new THREE.Vector3(0.55, 0.55, 0.35)).normalize();

    this._uniforms = {
      uTime: { value: 0 },
      uGravity: { value: opts.gravity ? opts.gravity.clone() : new THREE.Vector3(0, -9.81, 0) },
      uDragMin: { value: opts.dragMin ?? 0.35 },
      uDragMax: { value: opts.dragMax ?? 2.4 },
      uViewportHeight: { value: 1080 },
      uProjScaleY: { value: 1.0 },
      uFadeStartDist: { value: opts.fadeStartDistance ?? 45 },
      uMaxDist: { value: opts.maxDistance ?? 85 },
      uSunDirection: { value: sunDirection },
      uWaterColor: { value: new THREE.Color(opts.waterColor ?? 0xbfe6f0) },
      uRimColor: { value: new THREE.Color(opts.rimColor ?? 0xeaffff) },
      uSunColor: { value: new THREE.Color(opts.sunColor ?? 0xfff3d6) },
      uOpacity: { value: opts.opacity ?? 0.92 },
    };

    const material = new THREE.ShaderMaterial({
      name: 'SprayParticlesMaterial',
      uniforms: this._uniforms,
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
    });

    this._geometry = geometry;
    this._material = material;

    const points = new THREE.Points(geometry, material);
    points.name = 'SprayParticles';
    // Positions are computed dynamically in the vertex shader — the CPU
    // side `position` attribute only holds spawn points, so automatic
    // frustum culling against it would be wrong. The vertex shader already
    // clips dead/culled particles itself (see uFadeStartDist/uMaxDist).
    points.frustumCulled = false;

    this.object3D = points;
    scene.add(points);
  }

  /**
   * Emit `amount` particles from `position` roughly along `direction`.
   * Matches the SPEC 4.9 signature exactly; a 5th, optional `opts` argument
   * lets callers request a specific spray type. Without it, `emit()` mixes
   * fine mist / medium splash / chunky blobs automatically, weighted by
   * `speed` (faster = chunkier, more energetic spray).
   *
   * @param {THREE.Vector3} position world-space emission point
   * @param {THREE.Vector3} direction world-space direction (need not be unit length)
   * @param {number} amount particle count to spawn (clamped to buffer capacity)
   * @param {number} speed reference speed (m/s) driving ejection velocity
   * @param {{type?: 'mist'|'splash'|'chunk'|'auto'}} [opts]
   */
  emit(position, direction, amount, speed, opts) {
    amount = Math.min(Math.max(Math.round(amount) || 0, 0), this.count);
    if (amount <= 0 || !position) return;
    speed = Number.isFinite(speed) ? speed : 10;

    const options = opts || {};

    _dir.set(direction?.x ?? 0, direction?.y ?? 1, direction?.z ?? 0);
    if (_dir.lengthSq() < 1e-8) _dir.set(0, 1, 0);
    else _dir.normalize();

    let plan;
    const requestedType = options.type;
    if (requestedType === 'mist' || requestedType === 'splash' || requestedType === 'chunk') {
      plan = [[requestedType, amount]];
    } else {
      const speedT = THREE.MathUtils.clamp((speed - 8) / (30 - 8), 0, 1);
      const wMist = THREE.MathUtils.lerp(0.55, 0.22, speedT);
      const wChunk = THREE.MathUtils.lerp(0.08, 0.32, speedT);
      const nMist = Math.round(amount * wMist);
      const nChunk = Math.round(amount * wChunk);
      const nSplash = Math.max(0, amount - nMist - nChunk);
      plan = [
        ['mist', nMist],
        ['splash', nSplash],
        ['chunk', nChunk],
      ];
    }

    const startCursor = this._cursor;
    let written = 0;
    for (let p = 0; p < plan.length; p++) {
      const type = plan[p][0];
      const n = plan[p][1];
      if (n <= 0) continue;
      const params = TYPE_PARAMS[type];
      for (let k = 0; k < n; k++) {
        this._writeOne(position, speed, params);
        written++;
      }
    }

    if (written > 0) {
      this._markRange(startCursor, written);
      this._flush();
    }
  }

  /** Convenience wrapper: pure fine-mist burst. */
  emitMist(position, direction, amount, speed) {
    this.emit(position, direction, amount, speed, { type: 'mist' });
  }

  /** Convenience wrapper: pure medium-splash burst. */
  emitSplash(position, direction, amount, speed) {
    this.emit(position, direction, amount, speed, { type: 'splash' });
  }

  /** Convenience wrapper: pure large water-chunk burst. */
  emitChunk(position, direction, amount, speed) {
    this.emit(position, direction, amount, speed, { type: 'chunk' });
  }

  _writeOne(position, speed, p) {
    const i = this._cursor;
    this._cursor = (this._cursor + 1) % this.count;

    // Cone axis = emit direction blended toward world-up so sprays arc
    // rather than fly perfectly flat.
    _axis.copy(_dir).lerp(UP, p.upBias);
    if (_axis.lengthSq() < 1e-8) _axis.copy(_dir);
    _axis.normalize();

    const ref = Math.abs(_axis.y) > 0.95 ? REF_ALT : UP;
    _tangent.crossVectors(ref, _axis);
    if (_tangent.lengthSq() < 1e-8) _tangent.set(1, 0, 0);
    else _tangent.normalize();
    _bitangent.crossVectors(_axis, _tangent);

    const theta = Math.random() * Math.PI * 2;
    const phi = Math.sqrt(Math.random()) * p.spread;
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);

    _vel
      .copy(_axis)
      .multiplyScalar(cosPhi)
      .addScaledVector(_tangent, Math.cos(theta) * sinPhi)
      .addScaledVector(_bitangent, Math.sin(theta) * sinPhi);

    const speedMul = THREE.MathUtils.lerp(p.speedMin, p.speedMax, Math.random());
    const finalSpeed = Math.max(speed, 0) * speedMul + p.kick;
    _vel.multiplyScalar(finalSpeed);

    const i3 = i * 3;
    this._startArr[i3] = position.x;
    this._startArr[i3 + 1] = position.y;
    this._startArr[i3 + 2] = position.z;
    this._velArr[i3] = _vel.x;
    this._velArr[i3 + 1] = _vel.y;
    this._velArr[i3 + 2] = _vel.z;

    this._birthArr[i] = this._time;
    this._lifeArr[i] = THREE.MathUtils.lerp(p.lifeMin, p.lifeMax, Math.random());
    this._sizeArr[i] = THREE.MathUtils.lerp(p.sizeMin, p.sizeMax, Math.random());
    this._seedArr[i] = Math.random();
  }

  // Ring-buffer writes within a single emit() call are always one
  // contiguous run (possibly wrapping once), because `_cursor` only ever
  // advances by +1 (mod count) between writes.
  _markRange(start, amount) {
    const count = this.count;
    const end = start + amount;
    if (end <= count) {
      this._addRangeAllAttrs(start, amount);
    } else {
      this._addRangeAllAttrs(start, count - start);
      this._addRangeAllAttrs(0, end - count);
    }
  }

  _addRangeAllAttrs(itemStart, itemCount) {
    if (itemCount <= 0) return;
    // vec3 attributes: component offset = item offset * 3.
    this._startAttr.addUpdateRange(itemStart * 3, itemCount * 3);
    this._velAttr.addUpdateRange(itemStart * 3, itemCount * 3);
    // float attributes: component offset == item offset.
    this._birthAttr.addUpdateRange(itemStart, itemCount);
    this._lifeAttr.addUpdateRange(itemStart, itemCount);
    this._sizeAttr.addUpdateRange(itemStart, itemCount);
    this._seedAttr.addUpdateRange(itemStart, itemCount);
  }

  _flush() {
    // `position` and `aStart` share the same BufferAttribute instance, so
    // flagging it once covers both geometry slots.
    this._startAttr.needsUpdate = true;
    this._velAttr.needsUpdate = true;
    this._birthAttr.needsUpdate = true;
    this._lifeAttr.needsUpdate = true;
    this._sizeAttr.needsUpdate = true;
    this._seedAttr.needsUpdate = true;
  }

  /**
   * Advance simulation time and refresh camera-dependent uniforms.
   * @param {number} dt seconds
   * @param {THREE.Camera} camera
   * @param {{sunDirection?: THREE.Vector3}} [extra] optional overrides
   */
  update(dt, camera, extra) {
    this._time += Math.max(dt, 0);
    this._uniforms.uTime.value = this._time;

    if (camera && camera.projectionMatrix) {
      // projectionMatrix.elements[5] == the Y-scale term (1 / tan(fov/2))
      // of a standard symmetric perspective matrix — keeps point size
      // correct as ChaseCamera sweeps FOV with speed (SPEC 4.4).
      this._uniforms.uProjScaleY.value = camera.projectionMatrix.elements[5];
    }

    let viewportHeight = null;
    if (this._renderer && typeof this._renderer.getDrawingBufferSize === 'function') {
      viewportHeight = this._renderer.getDrawingBufferSize(_drawingBufferSize).height;
    }
    if (!viewportHeight) {
      const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
      const innerH = typeof window !== 'undefined' && window.innerHeight ? window.innerHeight : 1080;
      viewportHeight = innerH * dpr;
    }
    this._uniforms.uViewportHeight.value = viewportHeight;

    if (extra && extra.sunDirection) {
      this._uniforms.uSunDirection.value.copy(extra.sunDirection).normalize();
    }
  }

  dispose() {
    this._geometry.dispose();
    this._material.dispose();
  }
}
