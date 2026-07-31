// LensDroplets.js — procedural water droplets stuck to the camera "lens"
// (A6 FX/POST). Implemented as a single ShaderPass so PostFX.js can splice
// it straight into the EffectComposer chain via `.pass`.
//
// Everything is generated in the fragment shader from a fixed-size loop
// (16 iterations — inside the "10〜20" droplet count the task spec asks
// for) driven by a seeded hash function; there is no per-droplet CPU
// state. That keeps update() to a handful of uniform writes and keeps the
// shader itself simple enough to compile reliably on mobile GPUs (no
// dynamic loop bounds, no texture fetches inside the loop, no `continue`/
// `break`).

import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;

const FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uResolution;
uniform float uTime;
uniform float uSpeed;
uniform float uSplashRate;
uniform float uSeed;
uniform float uIntensity;

varying vec2 vUv;

const int NUM_DROPS = 16;

vec2 hash2( float n ) {
  return fract( sin( vec2( n, n + 1.7 ) ) * vec2( 43758.5453123, 22578.1459123 ) );
}

void main() {
  vec2 uv = vUv;
  float aspect = uResolution.x / max( uResolution.y, 1.0 );

  float speedT = clamp( uSpeed / 30.0, 0.0, 1.0 );
  float splash = clamp( uSplashRate, 0.0, 1.0 );

  vec2 uvOffset = vec2( 0.0 );
  float highlight = 0.0;

  for ( int i = 0; i < NUM_DROPS; i++ ) {
    float fi = float( i );

    vec2 rndA = hash2( fi * 12.9898 + uSeed * 3.7 + 1.0 );
    vec2 rndB = hash2( fi * 78.233 + uSeed * 9.13 + 7.0 );

    // Higher splashRate both wakes up more of the 16 slots and shortens
    // each slot's cycle, so more droplets appear more often.
    float activation = step( rndB.y, clamp( splash * 1.3 + 0.15, 0.0, 1.0 ) );

    float cycleDur = mix( 4.0, 9.0, rndA.x );
    float cycle = cycleDur / ( 1.0 + splash * 2.5 );
    float phase = fract( ( uTime + rndA.y * cycle * 13.0 ) / cycle );

    vec2 basePos = vec2( mix( 0.08, 0.92, rndB.x ), mix( 0.08, 0.55, rndB.y ) );

    // Gravity: accelerating downward slide. Speed: wind drags it further
    // down and slightly sideways.
    float fall = phase * phase;
    float fallDist = mix( 0.15, 0.75, rndB.x ) * ( 0.35 + 0.65 * speedT );
    float driftX = ( rndA.x - 0.5 ) * 0.05 * speedT * phase;

    vec2 center = basePos + vec2( driftX, fall * fallDist );

    float appear = smoothstep( 0.0, 0.06, phase );
    float vanish = 1.0 - smoothstep( 0.82, 1.0, phase );
    float dropAlpha = appear * vanish * activation;

    float radius = mix( 0.006, 0.017, rndA.y ) * ( 1.0 + speedT * 0.3 );
    // Faster slide -> droplet streaks/elongates a little.
    float stretch = 1.0 + speedT * 1.6 * smoothstep( 0.05, 1.0, phase );

    vec2 d = uv - center;
    d.x *= aspect;
    d.y /= stretch;
    float dist = length( d ) / max( radius, 0.0001 );

    float mask = ( 1.0 - smoothstep( 0.7, 1.0, dist ) ) * dropAlpha;

    vec2 dn = d / max( radius, 0.0001 );
    float nz = sqrt( max( 1.0 - dot( dn, dn ), 0.0 ) );
    vec2 refractDir = dn * ( 1.0 - nz );
    vec2 offset = vec2( refractDir.x / max( aspect, 0.0001 ), refractDir.y * stretch ) * 0.03 * uIntensity;

    uvOffset += offset * mask;
    highlight += pow( nz, 8.0 ) * mask * 0.6;
  }

  vec2 sampleUv = clamp( uv + uvOffset, 0.0, 1.0 );
  vec4 color = texture2D( tDiffuse, sampleUv );
  color.rgb += vec3( highlight );

  gl_FragColor = color;
}
`;

export class LensDroplets {
  /**
   * @param {object} [opts]
   * @param {number} [opts.intensity] master strength multiplier (default 1)
   * @param {number} [opts.seed] fixed seed for the procedural droplet layout
   */
  constructor(opts = {}) {
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const initW = ((typeof window !== 'undefined' && window.innerWidth) || 1920) * dpr;
    const initH = ((typeof window !== 'undefined' && window.innerHeight) || 1080) * dpr;

    this._time = 0;

    const pass = new ShaderPass({
      name: 'LensDropletsShader',
      uniforms: {
        tDiffuse: { value: null },
        uResolution: { value: new THREE.Vector2(Math.max(initW, 1), Math.max(initH, 1)) },
        uTime: { value: 0 },
        uSpeed: { value: 0 },
        uSplashRate: { value: 0 },
        uSeed: { value: opts.seed ?? Math.random() * 1000.0 },
        uIntensity: { value: opts.intensity ?? 1.0 },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
    });

    // IMPORTANT: ShaderPass's constructor (for a plain shader-definition
    // object, as opposed to a pre-built ShaderMaterial) runs the uniforms
    // object we hand it through UniformsUtils.clone() before storing it as
    // `pass.uniforms` / `pass.material.uniforms` — the object literal
    // above is *not* the one actually bound to the GPU program. `update()`
    // must mutate `pass.uniforms` (this reference) from here on, or the
    // shader would silently stay frozen at its initial values forever.
    this._uniforms = pass.uniforms;

    // ShaderPass (unlike e.g. FXAAPass) doesn't override setSize, so
    // EffectComposer#setSize would otherwise never refresh uResolution.
    // Override it on this instance so the pass stays correct whenever
    // PostFX.setSize()/composer.setSize() runs.
    const uniforms = this._uniforms;
    pass.setSize = function setSize(width, height) {
      uniforms.uResolution.value.set(Math.max(width, 1), Math.max(height, 1));
    };

    this.pass = pass;
  }

  /**
   * @param {number} dt seconds
   * @param {{speed?: number, splashRate?: number}} [params]
   */
  update(dt, params = {}) {
    this._time += Math.max(dt, 0);
    this._uniforms.uTime.value = this._time;
    this._uniforms.uSpeed.value = Math.max(params.speed ?? 0, 0);
    this._uniforms.uSplashRate.value = THREE.MathUtils.clamp(params.splashRate ?? 0, 0, 1);
  }

  dispose() {
    this.pass.dispose();
  }
}
