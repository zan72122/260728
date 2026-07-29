/*
 * gl-renderer.js
 * WebGL のフラグメントシェーダーで、2 枚の周期模様シートを重ねて描く。
 * 細かい縞同士の掛け算から、大きなモアレ (うなり) 模様が自然に現れる。
 * 模様の式は sheets.js の patternValue() と必ず一致させること。
 */
(function () {
  'use strict';
  const ML = (window.MoireLab = window.MoireLab || {});

  const VERT_SRC = `
attribute vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

  const FRAG_SRC = `
precision highp float;

uniform vec2  u_res;        // 描画バッファのピクセルサイズ
uniform float u_time;
uniform vec4  u_sheetA;     // 上のシート: offset.xy, rot, scale
uniform vec4  u_sheetB;     // 下のシート
uniform int   u_patA;
uniform int   u_patB;
uniform vec3  u_colA;       // パレット: 暗
uniform vec3  u_colB;       //           中
uniform vec3  u_colC;       //           明
uniform float u_rainbow;    // 1.0 なら虹モード
uniform vec3  u_light;      // x, y, on(0/1)
uniform float u_mist;       // 霧吹き 0..1

const float TAU = 6.28318530718;
const float FREQ = 42.0;
const float ENV_GAIN = 2.2;   // sheets.js ENV_GAIN と同じ値

// sheets.js patternValue() と同一式 (縞をくっきりさせてモアレを強く出す)
float patternValue(int type, vec2 p) {
  float v;
  if (type == 0) {
    v = 0.5 + 0.5 * sin(TAU * FREQ * p.x);
  } else if (type == 1) {
    float a = 0.5 + 0.5 * sin(TAU * FREQ * p.x);
    float b = 0.5 + 0.5 * sin(TAU * FREQ * p.y);
    v = max(a, b) * 0.85 + 0.15 * a * b;
  } else if (type == 2) {
    float d = sin(TAU * FREQ * 0.75 * p.x) * sin(TAU * FREQ * 0.75 * p.y);
    v = 0.5 + 0.5 * d;
  } else if (type == 3) {
    v = 0.5 + 0.5 * sin(TAU * FREQ * 0.9 * length(p));
  } else {
    float ang = atan(p.y, p.x);
    float r = length(p);
    v = 0.5 + 0.5 * sin(12.0 * ang + TAU * FREQ * 0.35 * r);
  }
  return smoothstep(0.18, 0.82, v);
}

vec2 toSheet(vec2 w, vec4 sh) {
  float c = cos(-sh.z);
  float s = sin(-sh.z);
  vec2 q = w - sh.xy;
  return vec2(c * q.x - s * q.y, s * q.x + c * q.y) / sh.w;
}

// 2 枚重ねの透過光
float moire(vec2 w) {
  return patternValue(u_patA, toSheet(w, u_sheetA))
       * patternValue(u_patB, toSheet(w, u_sheetB));
}

// 細かい縞をならした「大きなうなり模様」(sheets.js envelopeAt() と同じ 7 点平均)
float envelope(vec2 w, float m0) {
  float l = 1.0 / FREQ;
  vec2 o1 = vec2(0.5 * l, 0.0);
  vec2 o2 = vec2(0.0, 0.5 * l);
  vec2 o3 = vec2(0.35 * l, 0.35 * l);
  float sum = m0
    + moire(w + o1) + moire(w - o1)
    + moire(w + o2) + moire(w - o2)
    + moire(w + o3) + moire(w - o3);
  return clamp(sum / 7.0 * ENV_GAIN, 0.0, 1.0);
}

vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

void main() {
  float minDim = min(u_res.x, u_res.y);
  // JS 側と同じワールド座標: 中心原点・短辺 = 1.0・y は下向き
  vec2 w = vec2(gl_FragCoord.x - 0.5 * u_res.x,
                0.5 * u_res.y - gl_FragCoord.y) / minDim;

  float m = moire(w);            // 細かい重なり (レースの質感)
  float env = envelope(w, m);    // 大きなうなり模様 (モアレの主役)

  // 大きな模様で色を塗り、細かい縞は明るさの質感として重ねる
  vec3 col;
  float texFine = 0.78 + 0.44 * m;
  if (u_rainbow > 0.5) {
    float hue = fract(env * 0.62 + 0.05 * w.x - 0.03 * w.y + u_time * 0.012);
    col = hsv2rgb(vec3(hue, 0.55, 0.30 + 0.70 * env)) * texFine;
  } else {
    float t2 = clamp(env * 2.0, 0.0, 1.0);
    float t3 = clamp(env * 2.0 - 1.0, 0.0, 1.0);
    col = mix(mix(u_colA, u_colB, t2), u_colC, t3) * texFine;
  }

  // 大きな模様がゆらゆら息をするような、ごく弱いきらめき
  col *= 1.0 + 0.05 * sin(u_time * 0.6 + env * 7.0);

  // 光を当てる: タッチについてくる暖かい光だまり
  if (u_light.z > 0.5) {
    float d = distance(w, u_light.xy);
    float glow = exp(-d * d * 9.0) * (0.30 + 0.70 * env);
    col += vec3(1.0, 0.86, 0.55) * glow * 0.85;
  }

  // 霧吹き: 画面がしっとり白くかすみ、コントラストが少しやわらぐ
  col = mix(col, vec3(0.94, 0.97, 1.0), u_mist * 0.28);

  // ふちを軽く落として、窓ごしの眺めのように
  float vig = smoothstep(1.25, 0.35, length(w * vec2(0.85, 1.0)));
  col *= 0.82 + 0.18 * vig;

  gl_FragColor = vec4(sqrt(clamp(col, 0.0, 1.0)), 1.0);
}
`;

  function compile(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error('シェーダーのコンパイルに失敗: ' + gl.getShaderInfoLog(sh));
    }
    return sh;
  }

  function createRenderer(canvas) {
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false })
      || canvas.getContext('experimental-webgl');
    if (!gl) throw new Error('WebGL が利用できません');

    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT_SRC));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG_SRC));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('シェーダーのリンクに失敗: ' + gl.getProgramInfoLog(prog));
    }
    gl.useProgram(prog);

    // 画面全体を覆う 1 枚の大きな三角形
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const U = {};
    ['u_res', 'u_time', 'u_sheetA', 'u_sheetB', 'u_patA', 'u_patB',
      'u_colA', 'u_colB', 'u_colC', 'u_rainbow', 'u_light', 'u_mist',
    ].forEach((name) => { U[name] = gl.getUniformLocation(prog, name); });

    function resize(width, height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    }

    function render(state, time) {
      const pal = ML.PALETTES[state.palette];
      gl.uniform2f(U.u_res, canvas.width, canvas.height);
      gl.uniform1f(U.u_time, time);
      gl.uniform4f(U.u_sheetA, state.top.x, state.top.y, state.top.rot, state.top.scale);
      gl.uniform4f(U.u_sheetB, state.bottom.x, state.bottom.y, state.bottom.rot, state.bottom.scale);
      gl.uniform1i(U.u_patA, state.top.pattern);
      gl.uniform1i(U.u_patB, state.bottom.pattern);
      gl.uniform3fv(U.u_colA, pal.a);
      gl.uniform3fv(U.u_colB, pal.b);
      gl.uniform3fv(U.u_colC, pal.c);
      gl.uniform1f(U.u_rainbow, pal.rainbow ? 1.0 : 0.0);
      gl.uniform1f(U.u_mist, state.mist);
      gl.uniform3f(U.u_light, state.light.x, state.light.y, state.light.on ? 1.0 : 0.0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    return { resize, render };
  }

  ML.createRenderer = createRenderer;
})();
