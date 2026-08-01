// PostFX.js — post-processing pipeline (A6 FX/POST). This is the module
// that sells "speed": a restrained bloom, a speed-linked radial blur +
// chromatic aberration + vignette/grain/exposure combo (one shader, see
// below), the lens-droplet overlay, AA, and finally tone mapping / color
// space conversion.
//
// Addon existence was verified with `ls node_modules/three/examples/jsm/postprocessing/`
// before writing any import (RenderPass, UnrealBloomPass, ShaderPass,
// SMAAPass, OutputPass all present in this r180 install).
//
// Tone-mapping / OutputPass correctness (verified by reading
// node_modules/three/src/renderers/webgl/WebGLPrograms.js and
// node_modules/three/examples/jsm/postprocessing/OutputPass.js):
//   - WebGLPrograms only sets a material's effective tone mapping to
//     `renderer.toneMapping` when the *current render target is null*
//     (i.e. rendering straight to the screen). While EffectComposer's
//     passes render into its internal (non-null) render targets, tone
//     mapping is implicitly NoToneMapping — the whole chain stays in
//     linear HDR. Same story for output color space: WebGLRenderer only
//     applies `renderer.outputColorSpace` when the current render target
//     is null; offscreen targets always resolve through LinearSRGBColorSpace
//     regardless of what the target texture's own colorSpace says.
//   - OutputPass reads `renderer.toneMapping` / `renderer.outputColorSpace`
//     fresh every render() call and applies both exactly once, right when
//     it finally draws to the screen (it's last in the chain below). So
//     tone mapping happens exactly once, not twice, as long as OutputPass
//     stays last — which is also why every custom pass below (radial
//     blur/chromatic aberration/vignette, LensDroplets) operates on
//     un-tonemapped linear HDR values, same as UnrealBloomPass.
//   - EffectComposer's default (no explicit renderTarget passed to its
//     constructor) already allocates its internal buffers with
//     `type: HalfFloatType` — confirmed in
//     node_modules/three/examples/jsm/postprocessing/EffectComposer.js —
//     so this file doesn't need to construct its own render target to get
//     an HDR-safe composer buffer.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { LensDroplets } from '../fx/LensDroplets.js';

// ---------------------------------------------------------------------
// Combined radial-blur + chromatic-aberration + vignette/grain/exposure
// pass. Merged into a single ShaderPass on purpose (SPEC 4.9 / task spec
// "パフォーマンス" section): every extra full-screen pass is a full
// render-target bind + draw call, which costs far more than a few extra
// texture taps inside one shader.
// ---------------------------------------------------------------------

const SPEEDFX_VERTEX = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;

const SPEEDFX_FRAGMENT = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uResolution;
uniform float uBlurStrength;
uniform float uChromaAmount;
uniform float uVignetteStrength;
uniform float uExposure;
uniform float uContrast;
uniform float uGrainAmount;
uniform float uGrainSeed;

varying vec2 vUv;

float hash12( vec2 p ) {
  return fract( sin( dot( p, vec2( 12.9898, 78.233 ) ) ) * 43758.5453123 );
}

void main() {
  vec2 uv = vUv;

  float aspect = uResolution.x / max( uResolution.y, 1.0 );
  vec2 aspectUv = uv - 0.5;
  aspectUv.x *= aspect;
  float radius = length( aspectUv );

  vec2 toCenter = vec2( 0.5 ) - uv;

  // Radial ("zoom") blur: sample inward toward screen center. Kept off
  // entirely near the center per SPEC 4.9's explicit falloff.
  float blurMask = smoothstep( 0.15, 0.9, radius );
  float blurAmt = uBlurStrength * blurMask;

  const int SAMPLES = 10;
  vec3 blurCol = vec3( 0.0 );
  for ( int i = 0; i < SAMPLES; i++ ) {
    float t = ( float( i ) + 0.5 ) / float( SAMPLES );
    vec2 sampleUv = clamp( uv + toCenter * ( t * blurAmt ), 0.0, 1.0 );
    blurCol += texture2D( tDiffuse, sampleUv ).rgb;
  }
  blurCol /= float( SAMPLES );

  // Chromatic aberration: split R/B along the same radial axis, anchored
  // at the blur's midpoint sample so the fringing rides the streak.
  float chromaMask = smoothstep( 0.1, 0.95, radius );
  vec2 chromaDir = toCenter * ( uChromaAmount * chromaMask );
  vec2 midUv = clamp( uv + toCenter * ( blurAmt * 0.5 ), 0.0, 1.0 );
  float rC = texture2D( tDiffuse, clamp( midUv + chromaDir, 0.0, 1.0 ) ).r;
  float bC = texture2D( tDiffuse, clamp( midUv - chromaDir, 0.0, 1.0 ) ).b;

  vec3 col = vec3( rC, blurCol.g, bC );

  // Vignette.
  float vig = 1.0 - smoothstep( 0.35, 1.05, radius ) * uVignetteStrength;
  col *= vig;

  // Exposure (tunnel darkening + eye-adaptation recovery, driven from JS)
  // and a light contrast lift.
  col *= uExposure;
  col = ( col - 0.5 ) * uContrast + 0.5;

  // Film grain, applied in linear HDR so the tonemapper (OutputPass, run
  // after this) naturally compresses it in bright areas.
  float grain = hash12( uv * uResolution + uGrainSeed ) - 0.5;
  col += grain * uGrainAmount;

  col = max( col, 0.0 );

  gl_FragColor = vec4( col, 1.0 );
}
`;

function approach(current, target, dt, rate) {
  const k = 1 - Math.exp(-rate * Math.max(dt, 0));
  return current + (target - current) * k;
}

/**
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene} scene
 * @param {THREE.PerspectiveCamera} camera
 * @returns {{composer: EffectComposer, setSize(w:number,h:number):void, update(dt:number, params:object):void, render(dt:number):void, dispose():void}}
 */
export function createPostFX(renderer, scene, camera) {
  // Defensive only: Engine.js (A1) already sets ACESFilmicToneMapping.
  // This just keeps OutputPass correct if PostFX is ever wired up before
  // that, without overriding a deliberate choice made elsewhere.
  if (renderer.toneMapping === THREE.NoToneMapping) {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
  }

  // No explicit renderTarget passed here — EffectComposer's default path
  // already allocates a HalfFloatType buffer (see file header comment).
  const composer = new EffectComposer(renderer);

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  const initSize = renderer.getSize(new THREE.Vector2());
  const initPixelRatio = renderer.getPixelRatio();

  // Bloom: deliberately restrained — only the brightest highlights (sun,
  // water sparkle) should bloom at all. V4 washout fix: this pass runs on
  // the *pre-tonemap linear HDR* buffer (see the file header), where with
  // toneMappingExposure=0.22 ordinary mid-tones already sit well above the
  // old 0.85 threshold — so the whole frame bloomed and the entire ride
  // read as a white haze (confirmed in live screenshots at speed). The
  // threshold must be expressed in HDR units: 4.0 keeps it to genuine
  // highlights (sun disc, specular glints) and restores contrast.
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(Math.max(1, initSize.x * initPixelRatio), Math.max(1, initSize.y * initPixelRatio)),
    0.32,
    0.45,
    4.0
  );
  composer.addPass(bloomPass);

  const speedPass = new ShaderPass({
    name: 'SpeedFXShader',
    uniforms: {
      tDiffuse: { value: null },
      uResolution: { value: new THREE.Vector2(Math.max(1, initSize.x * initPixelRatio), Math.max(1, initSize.y * initPixelRatio)) },
      uBlurStrength: { value: 0 },
      uChromaAmount: { value: 0 },
      uVignetteStrength: { value: 0.28 },
      uExposure: { value: 1.0 },
      uContrast: { value: 1.0 },
      uGrainAmount: { value: 0.018 },
      uGrainSeed: { value: 0 },
    },
    vertexShader: SPEEDFX_VERTEX,
    fragmentShader: SPEEDFX_FRAGMENT,
  });
  composer.addPass(speedPass);
  // IMPORTANT: ShaderPass clones whatever uniforms object it's handed
  // (UniformsUtils.clone, see LensDroplets.js for the full explanation) —
  // `speedPass.uniforms` is the live object actually bound to the GPU
  // program, so update()/setSize() below mutate this reference, not the
  // object literal above.
  const speedUniforms = speedPass.uniforms;

  const lensDroplets = new LensDroplets();
  composer.addPass(lensDroplets.pass);

  // SMAAPass operates in linear-srgb, so it must run before OutputPass
  // (documented directly in SMAAPass.js) — matches SPEC 4.9's ordering.
  const smaaPass = new SMAAPass();
  composer.addPass(smaaPass);

  // Tone mapping + color space conversion. Always last.
  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  const state = {
    vignette: 0.28,
    exposure: 1.0,
    wasTunnel: false,
    exitFlash: 0,
    grainTime: 0,
  };

  function setSize(w, h) {
    const pr = renderer.getPixelRatio();
    // Keep the composer's pixel-ratio bookkeeping in sync before resizing
    // so every pass (bloom, SMAA, LensDroplets via its own setSize
    // override) gets the correct device-pixel dimensions.
    composer.setPixelRatio(pr);
    composer.setSize(w, h);

    const pxW = Math.max(1, Math.round(w * pr));
    const pxH = Math.max(1, Math.round(h * pr));
    speedUniforms.uResolution.value.set(pxW, pxH);
  }

  /**
   * @param {number} dt seconds
   * @param {{speed?:number, gForce?:number, airborne?:boolean, tunnel?:boolean, splashRate?:number}} [params]
   */
  function update(dt, params = {}) {
    const speed = Math.max(params.speed ?? 0, 0);
    const gForce = params.gForce ?? 1;
    const airborne = !!params.airborne;
    const tunnel = !!params.tunnel;
    const splashRate = THREE.MathUtils.clamp(params.splashRate ?? 0, 0, 1);

    // Radial blur: 0 at low speed, ramping with the measured speed band
    // (no-input ~12-20 m/s, full-tuck ~22-27 m/s), with a small extra kick
    // under high G / airborne (SPEC 4.9). V4 washout fix: the old peak of
    // 0.6 sampled more than half-way to screen centre, smearing the bright
    // chute over the entire frame at speed — together with the bloom
    // threshold bug this erased all detail. Capped so the streaking stays
    // a periphery effect and the course remains readable at full tuck.
    const speedT = THREE.MathUtils.clamp((speed - 6) / (27 - 6), 0, 1);
    let blur = speedT * 0.28;
    blur += THREE.MathUtils.clamp((gForce - 1.3) / 1.7, 0, 1) * 0.08;
    if (airborne) blur += 0.05;
    speedUniforms.uBlurStrength.value = THREE.MathUtils.clamp(blur, 0, 0.4);

    // Chromatic aberration: speed-linked, capped around 2px equivalent.
    const chromaPx = THREE.MathUtils.lerp(0.0, 2.0, speedT) + (airborne ? 0.3 : 0.0);
    const resW = speedUniforms.uResolution.value.x || 1;
    speedUniforms.uChromaAmount.value = chromaPx / resW;

    // Tunnel: strong vignette + dropped exposure, both time-smoothed so
    // entering/exiting reads as an eye-adaptation cue rather than a snap.
    // V4: the real darkness now comes from the scene itself (main.js dims
    // scene.environmentIntensity/hemi inside the tunnel), so the post
    // exposure drop is softer than before — it's the eye-adaptation layer,
    // not the only source of dark.
    state.vignette = approach(state.vignette, tunnel ? 0.72 : 0.26, dt, tunnel ? 2.4 : 1.4);
    state.exposure = approach(state.exposure, tunnel ? 0.62 : 1.0, dt, tunnel ? 2.2 : 1.3);

    if (tunnel) {
      state.wasTunnel = true;
    } else if (state.wasTunnel) {
      // Brief brightness flash right on exit — "eyes still wide open"
      // from the dark tunnel, settling back down over ~0.6s.
      state.exitFlash = 1.0;
      state.wasTunnel = false;
    }
    state.exitFlash = Math.max(0, state.exitFlash - dt / 0.6);

    speedUniforms.uVignetteStrength.value = state.vignette;
    speedUniforms.uExposure.value = state.exposure + state.exitFlash * 0.4;
    speedUniforms.uContrast.value = THREE.MathUtils.lerp(1.0, 1.08, speedT) + (tunnel ? 0.04 : 0.0);
    speedUniforms.uGrainAmount.value = 0.016 + speedT * 0.01;

    state.grainTime += Math.max(dt, 0);
    speedUniforms.uGrainSeed.value = state.grainTime * 24.0;

    lensDroplets.update(dt, { speed, splashRate });
  }

  function render(dt) {
    composer.render(dt);
  }

  function dispose() {
    composer.dispose();
    renderPass.dispose?.();
    bloomPass.dispose();
    speedPass.dispose();
    lensDroplets.dispose();
    smaaPass.dispose();
    outputPass.dispose();
  }

  // Sync every pass (resolution uniforms, internal render targets) once
  // up front so the very first frame is already correctly sized.
  setSize(initSize.x, initSize.y);

  // TEMP DIAGNOSTIC HOOK (V3 camera/postfx pass) — read-only introspection
  // for the Playwright screenshot harness in scratchpad/. No gameplay
  // effect. Remove before final handoff.
  if (typeof window !== 'undefined') {
    window.__av3PostFX = { speedUniforms, state, lensDroplets };
  }

  return { composer, setSize, update, render, dispose };
}
