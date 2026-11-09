// Prism Pop 3D: the blocks, the board and the line-clear shatter, drawn with three.js.
// The game works in screen pixels (x right, y down). Here a pixel is X = x, Y = -y on the Z = 0 plane, and a
// camera looking straight down -Z maps that plane exactly onto the screen, so the 2D canvas on top (score,
// ghost, highlights, special icons, text) lines up with every 3D block.
import * as THREE from './three.module.min.js';

const H = window.PP3D;
const TAU = Math.PI * 2;
const FOV = 26;

const glCanvas = document.getElementById('gl');
let renderer = null;
try { renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, powerPreference: 'high-performance' }); } catch (e) { renderer = null; }
if (!renderer || !H) dispatchEvent(new Event('world3dfail'));

if (renderer && H){
const lowEnd = (navigator.hardwareConcurrency || 4) <= 4 && matchMedia('(pointer: coarse)').matches;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;          // candy colours stay saturated

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(FOV, 1, 10, 50000);
const col = c => new THREE.Color(c);

// light: a soft key from the upper left in front, a fill from the right, and a colourful studio environment for reflections
scene.add(new THREE.HemisphereLight(0xdcd6ff, 0x2a1860, .35));
const key = new THREE.DirectionalLight(0xffffff, 1.7); scene.add(key, key.target);
const fill = new THREE.DirectionalLight(0xa48cff, .6); scene.add(fill, fill.target);
{
  const es = new THREE.Scene(), g = new THREE.SphereGeometry(100, 32, 16), cols = [];
  const top = col(0xffffff), mid = col(0x6a58d8), bot = col(0x120c3a), pink = col(0xff6ad5), cyan = col(0x6fd6ff);
  for (let i = 0; i < g.attributes.position.count; i++){
    const x = g.attributes.position.getX(i) / 100, y = g.attributes.position.getY(i) / 100;
    const z = g.attributes.position.getZ(i) / 100;
    let c = y > 0 ? mid.clone().lerp(top, Math.pow(y, 2)) : mid.clone().lerp(bot, -y);
    if (y > .2 && y < .6) c.lerp(x > 0 ? pink : cyan, .35 * Math.abs(x));
    if (z > .45 && y > -.1) c.lerp(top, Math.min(1, (z - .45) * 2.2) * (y > .25 ? 1 : .55));     // a big softbox in front: the faces reflect it as gloss
    cols.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  es.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(es, .03).texture; pm.dispose();
  scene.environmentIntensity = .55;
}

// ---------- the block: a rounded, bevelled tile of unit size, centred, its face toward the camera ----------
function roundedSquare(s, r){ const h = s / 2, sh = new THREE.Shape(); sh.moveTo(-h + r, -h); sh.lineTo(h - r, -h); sh.quadraticCurveTo(h, -h, h, -h + r); sh.lineTo(h, h - r); sh.quadraticCurveTo(h, h, h - r, h); sh.lineTo(-h + r, h); sh.quadraticCurveTo(-h, h, -h, h - r); sh.lineTo(-h, -h + r); sh.quadraticCurveTo(-h, -h, -h + r, -h); return sh; }
const BLOCK = .88, DEPTH = .3;
function blockGeo(bevelSeg, curve){
  const g = new THREE.ExtrudeGeometry(roundedSquare(BLOCK - .16, .14), { depth: DEPTH, bevelEnabled: true, bevelThickness: .1, bevelSize: .08, bevelSegments: bevelSeg, curveSegments: curve });
  g.translate(0, 0, -DEPTH / 2 - .02); g.computeVertexNormals(); return g;
}
const GEO = { smooth: blockGeo(5, 6), facet: blockGeo(1, 1) };
// candy stripes, tinted by the instance colour
const stripeTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 128, 128); g.strokeStyle = 'rgba(255,255,255,1)'; g.fillStyle = '#d8d8d8'; for (let k = -2; k < 5; k++){ g.beginPath(); g.moveTo(k * 40, 128); g.lineTo(k * 40 + 18, 128); g.lineTo(k * 40 + 18 + 128, 0); g.lineTo(k * 40 + 128, 0); g.closePath(); g.fill(); } const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1.4, 1.4); return t; })();
const SKIN = {
  glossy: { geo: GEO.smooth, mat: new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: .3, metalness: 0, clearcoat: 1, clearcoatRoughness: .06 }), emiss: .5, gloss: true },
  neon:   { geo: GEO.smooth, mat: new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: .35, metalness: .1, clearcoat: .6 }), emiss: .9, rim: true },
  candy:  { geo: GEO.smooth, mat: new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: stripeTex, roughness: .3, clearcoat: 1, clearcoatRoughness: .15 }), emiss: .42, gloss: true },
  gem:    { geo: GEO.facet,  mat: new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: .05, metalness: .25, clearcoat: 1, iridescence: .6, flatShading: true }), emiss: .22 },
};
const CAP = 220;
for (const k in SKIN){
  const S = SKIN[k];
  // per-instance glow: emissive = instance colour * strength. Neon has a dark body and glows only on its bevelled rim.
  const glow = S.rim ? 'totalEmissiveRadiance += vInstC * (uEm * pow(1.0 - clamp(normal.z, 0.0, 1.0), 1.4) * 3.0 + 0.08);' : 'totalEmissiveRadiance += vInstC * uEm;';
  S.mat.onBeforeCompile = sh => {
    sh.uniforms.uEm = { value: S.emiss };
    sh.vertexShader = 'varying vec3 vInstC;\n' + sh.vertexShader.replace('#include <color_vertex>', '#include <color_vertex>\n#ifdef USE_INSTANCING_COLOR\n vInstC = instanceColor;\n#else\n vInstC = vec3(1.0);\n#endif');
    sh.fragmentShader = 'uniform float uEm;\nvarying vec3 vInstC;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + glow);
    if (S.rim) sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= 0.18;');
  };
  S.mat.customProgramCacheKey = () => 'pp-' + k;      // each skin has its own shader edits: never share a compiled program
  S.mesh = new THREE.InstancedMesh(S.geo, S.mat, CAP); S.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); S.mesh.frustumCulled = false; S.mesh.setColorAt(0, col(0xffffff)); S.mesh.count = 0;
  scene.add(S.mesh);
}

// the glossy streak along the top of each block's face, like the 2D blocks
const glossTex = (() => { const c = document.createElement('canvas'); c.width = 128; c.height = 32; const g = c.getContext('2d'); const r = 14; g.fillStyle = '#fff'; g.beginPath(); g.moveTo(r, 2); g.lineTo(128 - r, 2); g.quadraticCurveTo(126, 2, 126, 16); g.quadraticCurveTo(126, 30, 128 - r, 30); g.lineTo(r, 30); g.quadraticCurveTo(2, 30, 2, 16); g.quadraticCurveTo(2, 2, r, 2); g.fill(); const t = new THREE.CanvasTexture(c); return t; })();
const glossMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: glossTex, transparent: true, opacity: .5, depthWrite: false, toneMapped: false }), 220);
glossMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); glossMesh.frustumCulled = false; glossMesh.renderOrder = 2; scene.add(glossMesh);
let ng = 0;
// the board: its frame and empty cells, painted by the game's own 2D code into a texture
const boardTex = { canvas: document.createElement('canvas'), tex: null, key: '' };
const boardMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false }));
boardMesh.renderOrder = -1; scene.add(boardMesh);
// a soft shadow under the piece you're holding
const shadowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const r = g.createRadialGradient(32, 32, 4, 32, 32, 32); r.addColorStop(0, 'rgba(0,0,0,.55)'); r.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
const SHADOW_CAP = 12, shadowMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, toneMapped: false }), SHADOW_CAP);
shadowMesh.frustumCulled = false; shadowMesh.renderOrder = 0; scene.add(shadowMesh);

// ---------- shards: every cleared block bursts into tumbling glassy pieces that fly at you ----------
const SHARD_MAX = lowEnd ? 260 : 560;
const shardGeo = new THREE.TetrahedronGeometry(1, 0);
const shardMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: .15, clearcoat: 1, flatShading: true });
shardMat.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_INSTANCING_COLOR\n totalEmissiveRadiance += vColor * .35;\n#endif'); };
const shardMesh = new THREE.InstancedMesh(shardGeo, shardMat, SHARD_MAX); shardMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); shardMesh.frustumCulled = false; shardMesh.setColorAt(0, col(0xffffff)); shardMesh.count = 0; scene.add(shardMesh);
const shards = [], seenFx = new WeakSet();
function shatter(x, y, s, color, flush){
  const n = flush ? 10 : 7, c = col(color);
  for (let k = 0; k < n; k++){
    if (shards.length >= SHARD_MAX) shards.shift();
    const a = Math.random() * TAU, sp = (140 + Math.random() * 380) * (s / 44);
    shards.push({ x: x + (Math.random() - .5) * s * .5, y: y + (Math.random() - .5) * s * .5, z: Math.random() * s * .3,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 200 * (s / 44), vz: (300 + Math.random() * 900) * (s / 44),
      rx: Math.random() * TAU, ry: Math.random() * TAU, vr: (Math.random() - .5) * 18, size: s * (.14 + Math.random() * .16), life: .9 + Math.random() * .35, max: 1.25,
      c: Math.random() < .25 ? c.clone().lerp(col(0xffffff), .6) : c });
  }
}

// ---------- per frame ----------
const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S3 = new THREE.Vector3(), E = new THREE.Euler(), TMP = new THREE.Color();
let lastBg = null, bgTex = null;
function put(S, i, x, y, z, s, color, dim = 1, sx = 1, sy = 1, rot = 0, tilt = 0){
  E.set(tilt, 0, rot); Q.setFromEuler(E);
  M4.compose(V.set(x, -y, z), Q, S3.set(s * sx, s * sy, s));
  S.mesh.setMatrixAt(i, M4);
  if (S.gloss && ng < 220 && dim === 1){ const gy = y - s * sy * .27; M4.compose(V.set(x, -gy, z + s * .31), Q, S3.set(s * sx * .6, s * sy * .13, 1)); glossMesh.setMatrixAt(ng++, M4); } TMP.set(color); if (S.dark) TMP.multiplyScalar(S.dark); if (dim !== 1) TMP.multiplyScalar(dim); S.mesh.setColorAt(i, TMP);
}
function render(dt, sx = 0, sy = 0){
  const VW = innerWidth, VH = innerHeight, dpr = H.dpr, G = H.G, L = H.L;
  if (!VW || !VH) return;
  governor();
  const pr = Math.min(dpr, Qs.maxRes), pw = Math.round(VW * pr), ph = Math.round(VH * pr);
  if (glCanvas.width !== pw || glCanvas.height !== ph){ renderer.setPixelRatio(pr); renderer.setSize(VW, VH, false); }
  const bg = H.backdrop();
  if (bg && bg !== lastBg){ lastBg = bg; if (bgTex) bgTex.dispose(); bgTex = new THREE.CanvasTexture(bg); bgTex.colorSpace = THREE.SRGBColorSpace; scene.background = bgTex; }

  const D = (VH / 2) / Math.tan(FOV * Math.PI / 360);
  camera.aspect = VW / VH; camera.position.set(VW / 2 - sx, -VH / 2 + sy, D); camera.lookAt(VW / 2 - sx, -VH / 2 + sy, 0); camera.near = D * .2; camera.far = D * 3; camera.updateProjectionMatrix();
  key.position.set(VW * .5 - D * .55, -VH * .5 + D * .7, D * .55);     // low and to the upper left, so the bevels catch the light key.target.position.set(VW / 2, -VH / 2, 0);
  fill.position.set(VW * 1.1, -VH * .9, D * .4); fill.target.position.set(VW / 2, -VH / 2, 0);

  const S = SKIN[H.skin()] || SKIN.glossy; ng = 0;
  for (const k in SKIN) SKIN[k].mesh.visible = SKIN[k] === S;
  let n = 0, ns = 0;
  boardMesh.visible = !!G;
  if (G){
    const cs = L.cs, bx = L.bx, by = L.by;
    // the board texture, repainted when the layout changes
    const fr = Math.max(10, cs * .3), m = 40, bw = L.size + (fr + m) * 2, kk = `${bw}|${dpr}|${L.bx}|${L.by}`;
    if (boardTex.key !== kk){ boardTex.key = kk; const c = boardTex.canvas; c.width = Math.ceil(bw * dpr); c.height = c.width; H.paintBoard(c.getContext('2d'), fr + m); if (boardTex.tex) boardTex.tex.dispose(); boardTex.tex = new THREE.CanvasTexture(c); boardTex.tex.colorSpace = THREE.SRGBColorSpace; boardMesh.material.map = boardTex.tex; boardMesh.material.needsUpdate = true; }
    boardMesh.position.set(bx + L.size / 2, -(by + L.size / 2), -cs * .3); boardMesh.scale.set(bw * (1 + cs * .3 / (D)), bw * (1 + cs * .3 / D), 1);
    // placed tiles (squash on landing, like the 2D game)
    for (let r = 0; r < H.N; r++) for (let c = 0; c < H.N; c++){
      const t = G.grid[r][c]; if (!t || n >= CAP) continue;
      const land = t.land || 0;
      if (land > 0){ const u = 1 - land / .22, sq = Math.sin(u * Math.PI) * (1 - u) * .9; put(S, n++, bx + (c + .5) * cs, by + (r + .5) * cs + cs * sq * .13, cs * .02, cs, H.COLORS[t.color], 1, 1 + sq * .22, 1 - sq * .26); }
      else put(S, n++, bx + (c + .5) * cs, by + (r + .5) * cs, 0, cs, H.COLORS[t.color]);
    }
    // blocks still waiting for their turn in a line clear
    for (const f of G.fx){
      if (f.type !== 'tile') continue;
      if (f.delay > 0){ if (n < CAP) put(S, n++, bx + (f.c + .5) * cs, by + (f.r + .5) * cs, 0, cs, H.COLORS[f.color]); }
      else if (!seenFx.has(f)){ seenFx.add(f); shatter(bx + (f.c + .5) * cs, by + (f.r + .5) * cs, cs, H.COLORS[f.color], G.fx.some(q => q.type === 'flushLine')); }
    }
    // the tray, dimmed when a piece has nowhere to go
    const drag = H.drag();
    for (let i = 0; i < 3; i++){
      const p = G.tray[i]; if (!p || (drag && drag.i === i)) continue;
      const sb = H.slotBox(i), s = Math.min(cs * .62, (sb.w - 16) / Math.max(p.w, 3), (sb.h - 10) / Math.max(p.h, 3));
      const ox = sb.x + (sb.w - p.w * s) / 2, oy = sb.y + (sb.h - p.h * s) / 2, dim = H.fits(p) ? 1 : .32;
      for (const [y, x] of p.cells) if (n < CAP) put(S, n++, ox + (x + .5) * s, oy + (y + .5) * s, 0, s, H.COLORS[p.color], dim);
    }
    // the piece in your hand floats above the board, leaning with your motion, with its shadow below
    if (drag && G.tray[drag.i]){
      const p = G.tray[drag.i], left = drag.x - p.w * cs / 2, top = drag.y + drag.offY - p.h * cs / 2;
      const vx = drag.x - (drag.px ?? drag.x), vy = drag.y - (drag.py ?? drag.y); drag.px = drag.x; drag.py = drag.y;
      drag.lean = (drag.lean || 0) * .8 + clampN(vx * .01, -.35, .35) * .2; drag.pitch = (drag.pitch || 0) * .8 + clampN(vy * .01, -.35, .35) * .2;
      const lift = cs * .9, kz = (D - lift) / D, ccx = VW / 2 - sx, ccy = VH / 2 - sy;     // closer to the camera: pull in so it stays exactly under the finger
      for (const [y, x] of p.cells){
        const cx = left + (x + .5) * cs, cy = top + (y + .5) * cs;
        if (n < CAP) put(S, n++, ccx + (cx - ccx) * kz, ccy + (cy - ccy) * kz, lift, cs * kz, H.COLORS[p.color], 1, 1, 1, -drag.lean * .4, drag.pitch * .5);
        if (ns < SHADOW_CAP){ M4.compose(V.set(cx + cs * .18, -(cy + cs * .22), -cs * .1), Q.identity(), S3.set(cs * 1.25, cs * 1.25, 1)); shadowMesh.setMatrixAt(ns++, M4); }
      }
    }
  }
  S.mesh.count = n; S.mesh.instanceMatrix.needsUpdate = true; if (S.mesh.instanceColor) S.mesh.instanceColor.needsUpdate = true;
  shadowMesh.count = ns; shadowMesh.instanceMatrix.needsUpdate = true;
  glossMesh.count = ng; glossMesh.instanceMatrix.needsUpdate = true;

  // shards: gravity, spin, fade out by shrinking
  let k = 0;
  for (let i = shards.length - 1; i >= 0; i--){
    const p = shards[i]; p.life -= dt; if (p.life <= 0){ shards.splice(i, 1); continue; }
    p.vy += 1500 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.vz *= Math.pow(.4, dt); p.rx += p.vr * dt; p.ry += p.vr * .7 * dt;
    const sc = p.size * Math.min(1, p.life / .35);
    E.set(p.rx, p.ry, 0); Q.setFromEuler(E); M4.compose(V.set(p.x, -p.y, p.z), Q, S3.set(sc, sc, sc));
    shardMesh.setMatrixAt(k, M4); shardMesh.setColorAt(k, p.c); k++;
  }
  shardMesh.count = k; shardMesh.instanceMatrix.needsUpdate = true; if (shardMesh.instanceColor) shardMesh.instanceColor.needsUpdate = true;

  renderer.render(scene, camera);
}
const clampN = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- quality: step down automatically when frames run slow ----------
const Qs = { level: 0, maxRes: 2, ema: 16.7, last: 0, slowFor: 0 };
function setQuality(l){ Qs.level = l; Qs.maxRes = [2, 1.5, 1.25, 1][l]; }
if (/[?&]lowgfx(&|=|$)/.test(location.search)) setQuality(3); else if (lowEnd) setQuality(1);
function governor(){
  const now = performance.now(), dt = now - Qs.last; Qs.last = now;
  if (dt <= 0 || dt > 200 || document.hidden) return;
  Qs.ema += (dt - Qs.ema) * .05;
  Qs.slowFor = Qs.ema > 22 ? Qs.slowFor + dt : 0;
  if (Qs.slowFor > 2000 && Qs.level < 3){ setQuality(Qs.level + 1); Qs.slowFor = 0; Qs.ema = 16.7; }
}

glCanvas.addEventListener('webglcontextlost', e => { e.preventDefault(); window.World3D = null; glCanvas.style.display = 'none'; dispatchEvent(new Event('world3dfail')); });
window.World3D = { ok: true, render, scene, camera, Q: Qs, setQuality, shards };
dispatchEvent(new Event('world3d'));
}
