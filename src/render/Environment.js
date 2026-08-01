/**
 * Environment.js (A5 ENVIRONMENT)
 * -------------------------------------------------------------------------
 * 南国リゾートのウォーターパーク一式。地形・着水プール・椰子・建物群・
 * 遠景（山/海/雲）・背景用の装飾スライダーを構築する。
 *
 * `createEnvironment(scene, track, envMap)` -> { group, update(dt, riderPos) }
 */
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { createPoolWaterMaterial } from './WaterMaterial.js';
import { TRACK_DESIGN } from '../track/TrackDesign.js';
import {
	fbm,
	cloneTextureSet,
	concreteTextures,
	sandTextures,
	grassTextures,
	tileTextures,
	woodTextures,
	metalTextures,
	rockTextures,
	barkTexture,
	fiberglassTextures,
	foliageTexture,
	cloudTexture,
	seaWaveTextures,
} from './TextureLab.js';

// ===========================================================================
// 汎用ジオメトリ・ヘルパ
// ===========================================================================

function box(cx, cy, cz, w, h, d) {
	const g = new THREE.BoxGeometry(w, h, d);
	g.translate(cx, cy, cz);
	return g;
}

/** 2 点間を結ぶ円柱ジオメトリ（レール・パイプ・支柱の骨組み用）。 */
function cylinderBetween(pA, pB, radiusA, radiusB, radialSegments = 20) {
	const dir = new THREE.Vector3().subVectors(pB, pA);
	const rawLen = dir.length();
	const len = Math.max(rawLen, 0.001);
	const geo = new THREE.CylinderGeometry(radiusA, radiusB, len, radialSegments, 1, false);
	geo.translate(0, len / 2, 0);
	if (rawLen > 1e-5) {
		const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
		geo.applyQuaternion(quat);
	}
	geo.translate(pA.x, pA.y, pA.z);
	return geo;
}

/** BufferGeometryUtils.mergeGeometries の安全なラッパ。空/単体/失敗時も落ちない。 */
function mergeSafe(geoms) {
	const list = geoms.filter(Boolean);
	if (list.length === 0) {
		const g = new THREE.BufferGeometry();
		g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
		g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0], 3));
		g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0], 2));
		return g;
	}
	if (list.length === 1) return list[0];
	const merged = BufferGeometryUtils.mergeGeometries(list, false);
	return merged || list[0];
}

/**
 * TubeGeometry を先細り（テーパー）させる。TubeGeometry は
 * `path.getPointAt(i/tubularSegments)` でリング中心を作り、uv.y にも
 * 同じ値を書き込むため、uv.y をパラメータ t として使えば厳密に一致する。
 */
function taperTube(geometry, curve, baseRadius, radiusFn) {
	const pos = geometry.attributes.position;
	const uv = geometry.attributes.uv;
	const center = new THREE.Vector3();
	const p = new THREE.Vector3();
	for (let i = 0; i < pos.count; i++) {
		const t = THREE.MathUtils.clamp(uv.getY(i), 0, 1);
		curve.getPointAt(t, center);
		p.set(pos.getX(i), pos.getY(i), pos.getZ(i)).sub(center);
		p.multiplyScalar(radiusFn(t) / baseRadius);
		p.add(center);
		pos.setXYZ(i, p.x, p.y, p.z);
	}
	pos.needsUpdate = true;
}

// ===========================================================================
// 風揺れシェーダシステム（onBeforeCompile / InstancedMesh 対応）
// 頂点シェーダで曲げるため、毎フレームの行列更新が不要（軽量）。
// ===========================================================================

const WIND_UNIFORMS_GLSL = `
	uniform float uWindTime;
	uniform float uWindStrength;
	uniform float uWindSpeed;
	uniform float uBendLength;
`;

const WIND_BEND_GLSL = `
	{
		#ifdef USE_INSTANCING
			float windSeed = fract(sin(float(gl_InstanceID) * 12.9898) * 43758.5453);
		#else
			float windSeed = 0.0;
		#endif
		float windPhase = windSeed * 6.2831853;
		float heightFactor = clamp(transformed.y / max(uBendLength, 0.001), 0.0, 1.0);
		float bendAmt = pow(heightFactor, 1.6);
		float sway = sin(uWindTime * uWindSpeed + windPhase) * uWindStrength * bendAmt;
		float sway2 = cos(uWindTime * uWindSpeed * 0.6 + windPhase * 1.3) * uWindStrength * 0.6 * bendAmt;
		transformed.x += sway;
		transformed.z += sway2;
	}
`;

function createWindSwaySystem() {
	let clock = 0;
	const uniformsList = [];
	function apply(material, opts = {}) {
		const { bendLength = 2, strength = 0.3, speed = 1.2 } = opts;
		material.onBeforeCompile = (shader) => {
			shader.uniforms.uWindTime = { value: clock };
			shader.uniforms.uWindStrength = { value: strength };
			shader.uniforms.uWindSpeed = { value: speed };
			shader.uniforms.uBendLength = { value: bendLength };
			uniformsList.push(shader.uniforms);
			shader.vertexShader = shader.vertexShader
				.replace('#include <common>', `#include <common>\n${WIND_UNIFORMS_GLSL}`)
				.replace('#include <begin_vertex>', `#include <begin_vertex>\n${WIND_BEND_GLSL}`);
		};
		material.customProgramCacheKey = () => `windsway_${bendLength}_${strength}_${speed}`;
		return material;
	}
	function update(dt) {
		clock += dt;
		for (let i = 0; i < uniformsList.length; i++) uniformsList[i].uWindTime.value = clock;
	}
	return { apply, update };
}

// ===========================================================================
// 地形サンプラ：track / pool から高さ・平坦化・敷地中心を求める共有ロジック
// ===========================================================================

function createTerrainSampler(track) {
	const trackPts = [];
	const step = 6;
	const len = track.length;
	for (let s = 0; s <= len; s += step) {
		const p = track.frameAt(s).position;
		trackPts.push(p.x, p.z);
	}
	const endP = track.frameAt(len).position;
	trackPts.push(endP.x, endP.z);
	const startXZ = [trackPts[0], trackPts[1]];

	const poolC = new THREE.Vector3(TRACK_DESIGN.poolCenter[0], TRACK_DESIGN.poolCenter[1], TRACK_DESIGN.poolCenter[2]);
	const poolR = TRACK_DESIGN.poolRadius;

	let sx = poolC.x, sz = poolC.z, n = 1;
	for (let j = 0; j < trackPts.length; j += 2) { sx += trackPts[j]; sz += trackPts[j + 1]; n++; }
	const siteCenter = { x: sx / n, z: sz / n };

	function distToTrack(x, z) {
		let minD2 = Infinity;
		for (let j = 0; j < trackPts.length; j += 2) {
			const dx = x - trackPts[j], dz = z - trackPts[j + 1];
			const d2 = dx * dx + dz * dz;
			if (d2 < minD2) minD2 = d2;
		}
		return Math.sqrt(minD2);
	}
	function distToPoolEdge(x, z) {
		return Math.hypot(x - poolC.x, z - poolC.z) - poolR;
	}
	function flattenFactor(x, z) {
		const ft = THREE.MathUtils.smoothstep(distToTrack(x, z), 12, 42);
		const fp = THREE.MathUtils.smoothstep(distToPoolEdge(x, z), -2, 34);
		return Math.min(ft, fp);
	}
	function flatHeight(x, z) {
		return (fbm(x * 0.02 + 900, z * 0.02 + 900, 2) - 0.5) * 0.5;
	}
	function hillHeight(x, z) {
		const hillN = fbm(x * 0.012, z * 0.012, 5) * 2 - 1;
		const duneN = fbm(x * 0.05 + 340, z * 0.05 + 340, 3) * 2 - 1;
		return hillN * 7.5 + duneN * 1.4 + Math.max(0, hillN) * 3.0;
	}
	function heightAt(x, z) {
		return THREE.MathUtils.lerp(flatHeight(x, z), hillHeight(x, z), flattenFactor(x, z));
	}

	return { heightAt, flattenFactor, distToTrack, distToPoolEdge, poolC, poolR, startXZ, siteCenter };
}

// ===========================================================================
// 地形 + 地面パッチ（コンクリートデッキ・砂浜）
// ===========================================================================

function buildTerrain(sampler, envMap) {
	const SIZE = 400, SEGS = 256;
	const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEGS, SEGS);
	geo.rotateX(-Math.PI / 2);
	const pos = geo.attributes.position;
	const colors = new Float32Array(pos.count * 3);
	const { x: cx, z: cz } = sampler.siteCenter;

	for (let i = 0; i < pos.count; i++) {
		const wx = pos.getX(i) + cx;
		const wz = pos.getZ(i) + cz;
		const h = sampler.heightAt(wx, wz);
		pos.setX(i, wx);
		pos.setZ(i, wz);
		pos.setY(i, h);

		const dry = THREE.MathUtils.clamp(fbm(wx * 0.03 + 200, wz * 0.03 + 200, 3) * 1.4 - 0.2, 0, 1);
		const patchTint = THREE.MathUtils.lerp(1.0, 1.22, dry);
		const micro = 0.9 + fbm(wx * 0.2, wz * 0.2, 2) * 0.2;
		const tint = THREE.MathUtils.lerp(0.86, 1.06, fbm(wx * 0.05 + 40, wz * 0.05 + 40, 3));
		const val = patchTint * micro * tint;
		colors[i * 3] = val; colors[i * 3 + 1] = val; colors[i * 3 + 2] = val;
	}

	geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
	geo.computeVertexNormals();
	geo.computeBoundingSphere();

	const grass = cloneTextureSet(grassTextures(), 55, 55);
	const mat = new THREE.MeshStandardMaterial({
		map: grass.map,
		normalMap: grass.normalMap,
		roughnessMap: grass.roughnessMap,
		vertexColors: true,
		roughness: 1,
		metalness: 0,
		envMap: envMap || null,
		envMapIntensity: 0.45,
	});

	const mesh = new THREE.Mesh(geo, mat);
	mesh.name = 'Terrain';
	mesh.receiveShadow = true;
	mesh.castShadow = false;
	mesh.frustumCulled = false;
	return mesh;
}

function buildGroundPatches(sampler, envMap) {
	const group = new THREE.Group(); group.name = 'GroundPatches';

	function stamp(geo, lift) {
		const p = geo.attributes.position;
		for (let i = 0; i < p.count; i++) {
			p.setY(i, sampler.heightAt(p.getX(i), p.getZ(i)) + lift);
		}
		geo.computeVertexNormals();
		return geo;
	}

	const concreteGeos = [];
	{
		const R = sampler.poolR;
		const g = new THREE.RingGeometry(R + 0.35, R + 7.5, 48, 2);
		g.rotateX(-Math.PI / 2);
		g.translate(sampler.poolC.x, 0, sampler.poolC.z);
		concreteGeos.push(stamp(g, 0.03));
	}
	{
		const [tx, tz] = sampler.startXZ;
		const g = new THREE.CircleGeometry(11, 32);
		g.rotateX(-Math.PI / 2);
		g.translate(tx, 0, tz);
		concreteGeos.push(stamp(g, 0.03));
	}

	const sandGeos = [];
	const beachAngles = [0.35, 1.35, -1.05];
	beachAngles.forEach((ang, idx) => {
		const R = sampler.poolR;
		const dist = R + 13 + idx * 3;
		const cx = sampler.poolC.x + Math.cos(ang) * dist;
		const cz = sampler.poolC.z + Math.sin(ang) * dist;
		const g = new THREE.CircleGeometry(9 + idx * 2, 28);
		g.rotateX(-Math.PI / 2);
		g.translate(cx, 0, cz);
		sandGeos.push(stamp(g, 0.02));
	});

	const concreteT = cloneTextureSet(concreteTextures(), 14, 14);
	const concreteMat = new THREE.MeshStandardMaterial({
		map: concreteT.map, normalMap: concreteT.normalMap, roughnessMap: concreteT.roughnessMap,
		envMap: envMap || null, envMapIntensity: 0.5, metalness: 0,
	});
	const concreteMesh = new THREE.Mesh(mergeSafe(concreteGeos), concreteMat);
	concreteMesh.name = 'ConcreteDeck';
	concreteMesh.receiveShadow = true;
	group.add(concreteMesh);

	const sandT = cloneTextureSet(sandTextures(), 8, 8);
	const sandMat = new THREE.MeshStandardMaterial({
		map: sandT.map, normalMap: sandT.normalMap, roughnessMap: sandT.roughnessMap,
		envMap: envMap || null, envMapIntensity: 0.4, metalness: 0,
	});
	const sandMesh = new THREE.Mesh(mergeSafe(sandGeos), sandMat);
	sandMesh.name = 'SandPatches';
	sandMesh.receiveShadow = true;
	group.add(sandMesh);

	return group;
}

// ===========================================================================
// 着水プール
// ===========================================================================

function buildPool(sampler, envMap) {
	const group = new THREE.Group(); group.name = 'Pool';
	const center = sampler.poolC;
	const R = sampler.poolR;
	const baseY = sampler.heightAt(center.x, center.z);
	const depth = Math.max(2.2, R * 0.26);
	const waterY = baseY + 0.05;

	const tile = cloneTextureSet(tileTextures(), Math.max(6, R * 0.7), Math.max(3, depth * 1.1));
	const wallGeo = new THREE.CylinderGeometry(R * 0.99, R * 0.93, depth, 48, 2, true);
	wallGeo.translate(center.x, baseY - depth / 2 + 0.05, center.z);
	const wallMat = new THREE.MeshStandardMaterial({
		map: tile.map, normalMap: tile.normalMap, roughnessMap: tile.roughnessMap,
		side: THREE.BackSide, envMap: envMap || null, envMapIntensity: 0.9, metalness: 0.02, roughness: 0.5,
	});
	const wall = new THREE.Mesh(wallGeo, wallMat);
	wall.receiveShadow = true;
	wall.name = 'PoolWall';
	group.add(wall);

	const floorTile = cloneTextureSet(tileTextures(), Math.max(4, R * 0.9), Math.max(4, R * 0.9));
	const floorGeo = new THREE.CircleGeometry(R * 0.94, 48);
	floorGeo.rotateX(-Math.PI / 2);
	floorGeo.translate(center.x, baseY - depth + 0.05, center.z);
	const floorMat = new THREE.MeshStandardMaterial({
		map: floorTile.map, normalMap: floorTile.normalMap, roughnessMap: floorTile.roughnessMap,
		envMap: envMap || null, envMapIntensity: 0.7, metalness: 0.02, roughness: 0.5,
	});
	const floor = new THREE.Mesh(floorGeo, floorMat);
	floor.receiveShadow = true;
	floor.name = 'PoolFloor';
	group.add(floor);

	// coping (縁石) + 階段
	const concreteT = cloneTextureSet(concreteTextures(), 10, 3);
	const copingGeo = new THREE.TorusGeometry(R + 0.15, 0.22, 18, 48);
	copingGeo.rotateX(Math.PI / 2);
	copingGeo.translate(center.x, baseY + 0.12, center.z);

	const stepGeos = [copingGeo];
	const stepAngle = 0.5;
	const dirX = Math.cos(stepAngle), dirZ = Math.sin(stepAngle);
	const stepCount = 4, stepDepth = 0.85;
	for (let i = 0; i < stepCount; i++) {
		const stepRise = depth / stepCount;
		const rr = Math.max(1.5, R * 0.9 - i * stepDepth);
		const sxp = center.x + dirX * rr;
		const szp = center.z + dirZ * rr;
		const syp = baseY - stepRise * i - stepRise / 2 + 0.05;
		const g = new THREE.BoxGeometry(1.8, Math.max(0.12, stepRise), stepDepth);
		g.rotateY(-stepAngle);
		g.translate(sxp, syp, szp);
		stepGeos.push(g);
	}
	const copingMat = new THREE.MeshStandardMaterial({
		map: concreteT.map, normalMap: concreteT.normalMap, roughnessMap: concreteT.roughnessMap,
		envMap: envMap || null, envMapIntensity: 0.5,
	});
	const coping = new THREE.Mesh(mergeSafe(stepGeos), copingMat);
	coping.castShadow = true;
	coping.receiveShadow = true;
	coping.name = 'PoolCoping';
	group.add(coping);

	// 手すり
	const metal = cloneTextureSet(metalTextures('#d8dde0'), 2, 2);
	const railMat = new THREE.MeshStandardMaterial({
		map: metal.map, normalMap: metal.normalMap, roughnessMap: metal.roughnessMap,
		envMap: envMap || null, envMapIntensity: 1.0, metalness: 0.85, roughness: 0.35,
	});
	const railGeos = [];
	for (const side of [-1, 1]) {
		const ang = stepAngle + side * 0.16;
		const rx = center.x + Math.cos(ang) * (R * 0.93 + 0.35);
		const rz = center.z + Math.sin(ang) * (R * 0.93 + 0.35);
		const a = new THREE.Vector3(rx, baseY + 0.95, rz);
		const b = new THREE.Vector3(center.x + Math.cos(ang) * (R * 0.85), baseY + 0.3, center.z + Math.sin(ang) * (R * 0.85));
		const c = new THREE.Vector3(center.x + Math.cos(ang) * (R * 0.7), baseY - depth * 0.35, center.z + Math.sin(ang) * (R * 0.7));
		railGeos.push(cylinderBetween(a, b, 0.045, 0.045, 24));
		railGeos.push(cylinderBetween(b, c, 0.045, 0.045, 24));
	}
	const rail = new THREE.Mesh(mergeSafe(railGeos), railMat);
	rail.castShadow = true;
	rail.name = 'PoolHandrail';
	group.add(rail);

	// 水面（A4 提供のプール水マテリアル）
	const waterGeo = new THREE.CircleGeometry(R * 0.97, 48);
	waterGeo.rotateX(-Math.PI / 2);
	waterGeo.translate(center.x, waterY, center.z);
	const waterMat = createPoolWaterMaterial({ envMap: envMap || null, center, radius: R });
	const water = new THREE.Mesh(waterGeo, waterMat);
	water.name = 'PoolWater';
	water.receiveShadow = false;
	water.castShadow = false;
	group.add(water);

	return group;
}

// ===========================================================================
// 椰子の木（InstancedMesh + 風揺れシェーダ）
// ===========================================================================

function buildPalms(sampler, envMap, wind) {
	const group = new THREE.Group(); group.name = 'Palms';
	const NUM_TREES = 44;
	const FRONDS_PER_TREE = 7;

	const trunkHeight = 7.0;
	const lean = 0.85;
	const curve = new THREE.CatmullRomCurve3([
		new THREE.Vector3(0, 0, 0),
		new THREE.Vector3(lean * 0.12, trunkHeight * 0.32, lean * 0.04),
		new THREE.Vector3(lean * 0.5, trunkHeight * 0.68, lean * 0.22),
		new THREE.Vector3(lean, trunkHeight, lean * 0.38),
	], false, 'catmullrom', 0.4);
	const baseR = 0.22, topR = 0.085;
	const trunkGeo = new THREE.TubeGeometry(curve, 16, baseR, 24, false);
	taperTube(trunkGeo, curve, baseR, (t) => THREE.MathUtils.lerp(baseR, topR, t));
	trunkGeo.computeVertexNormals();
	trunkGeo.computeBoundingSphere();

	const bark = cloneTextureSet(barkTexture(), 3, 9);
	const trunkMat = new THREE.MeshStandardMaterial({
		map: bark.map, normalMap: bark.normalMap, roughnessMap: bark.roughnessMap,
		envMap: envMap || null, envMapIntensity: 0.5,
	});
	wind.apply(trunkMat, { bendLength: trunkHeight, strength: 0.045, speed: 0.55 });
	const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, NUM_TREES);
	trunks.castShadow = true;
	trunks.receiveShadow = true;
	trunks.frustumCulled = false;
	trunks.name = 'PalmTrunks';

	const frondLen = 2.5, frondWidth = 0.5;
	const frondGeo = new THREE.PlaneGeometry(frondWidth, frondLen, 1, 6);
	frondGeo.translate(0, frondLen / 2, 0);
	frondGeo.computeVertexNormals();
	const frondMat = new THREE.MeshStandardMaterial({
		map: foliageTexture(), alphaTest: 0.5, side: THREE.DoubleSide, transparent: false,
		roughness: 0.85, metalness: 0, envMap: envMap || null, envMapIntensity: 0.4,
	});
	wind.apply(frondMat, { bendLength: frondLen, strength: 0.3, speed: 1.7 });
	const fronds = new THREE.InstancedMesh(frondGeo, frondMat, NUM_TREES * FRONDS_PER_TREE);
	fronds.castShadow = true;
	fronds.frustumCulled = false;
	fronds.name = 'PalmFronds';

	const crownLocal = curve.getPoint(1);
	const dummy = new THREE.Object3D();
	const frondDummy = new THREE.Object3D();
	let frondIdx = 0;
	let placed = 0, attempts = 0;
	while (placed < NUM_TREES && attempts < NUM_TREES * 10) {
		attempts++;
		const ang = Math.random() * Math.PI * 2;
		const dist = 18 + Math.random() * 175;
		const x = sampler.poolC.x + Math.cos(ang) * dist;
		const z = sampler.poolC.z + Math.sin(ang) * dist;
		if (sampler.distToTrack(x, z) < 15) continue;
		if (sampler.distToPoolEdge(x, z) < 3) continue;
		const y = sampler.heightAt(x, z);
		const scale = 0.85 + Math.random() * 0.5;

		dummy.position.set(x, y, z);
		dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
		dummy.scale.setScalar(scale);
		dummy.updateMatrix();
		trunks.setMatrixAt(placed, dummy.matrix);

		for (let f = 0; f < FRONDS_PER_TREE; f++) {
			const fa = (f / FRONDS_PER_TREE) * Math.PI * 2 + Math.random() * 0.3;
			const pitch = THREE.MathUtils.degToRad(52 + Math.random() * 22);
			frondDummy.position.copy(crownLocal);
			frondDummy.quaternion.identity();
			frondDummy.rotateY(fa);
			frondDummy.rotateZ(-pitch);
			frondDummy.scale.setScalar(0.85 + Math.random() * 0.35);
			frondDummy.updateMatrix();
			const combined = new THREE.Matrix4().multiplyMatrices(dummy.matrix, frondDummy.matrix);
			fronds.setMatrixAt(frondIdx++, combined);
		}
		placed++;
	}
	// 万一敷地が狭く配置しきれなかった場合の安全策（見えない位置に縮退させる）
	for (let i = placed; i < NUM_TREES; i++) {
		dummy.position.set(sampler.siteCenter.x, sampler.heightAt(sampler.siteCenter.x, sampler.siteCenter.z), sampler.siteCenter.z);
		dummy.scale.setScalar(0.001);
		dummy.updateMatrix();
		trunks.setMatrixAt(i, dummy.matrix);
		for (let f = 0; f < FRONDS_PER_TREE; f++) fronds.setMatrixAt(frondIdx++, dummy.matrix);
	}

	trunks.instanceMatrix.needsUpdate = true;
	fronds.instanceMatrix.needsUpdate = true;

	group.add(trunks, fronds);
	return { group };
}

// ===========================================================================
// スタートタワー
// ===========================================================================

function buildStartTower(track, sampler, envMap) {
	const group = new THREE.Group(); group.name = 'StartTower';
	const f0 = track.frameAt(0);
	const top = f0.position;
	const groundY = sampler.heightAt(top.x, top.z);
	const height = Math.max(5, top.y - groundY);
	const half = 3.2;

	const fwd = new THREE.Vector3(f0.tangent.x, 0, f0.tangent.z);
	if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, 1); else fwd.normalize();
	const worldUp = new THREE.Vector3(0, 1, 0);
	const right = new THREE.Vector3().crossVectors(fwd, worldUp);
	if (right.lengthSq() < 1e-6) right.set(1, 0, 0); else right.normalize();
	const basis = new THREE.Matrix4().makeBasis(right, worldUp, fwd);
	// 最終アートディレクション修正 (確定原因、実機で raycaster により特定):
	// このタワーは「原点 = チューブの s=0 の X/Z」を中心に、床(platform)を
	// 前後 half*2+0.4 = 6.8m の正方形で組んでいた。s=0 のチューブ断面
	// (半径 ~5.2m の開いた内部空間) も同じ X/Z を中心に存在するため、
	// プラットフォームの前半分とキャノピー屋根がチューブ自身の内部体積に
	// 幾何学的に食い込んでいた。カメラをどう直しても (ChaseCamera / タイトル
	// フライスルー両方) ライド開始直後は必ずこの重なりの中/直近に入ってしまい
	// 「樋が茶色い」と繰り返し誤診断されていた実体はこれ (raycaster で
	// TowerCanopy — fiberglassTextures('#e8863a') という文字通りの
	// 橙褐色 — が距離1.2m で最初にヒットすると確認済み)。プラットフォーム
	// 全体を s=0 から手前 (-tangent) に SETBACK だけ下げ、チューブの
	// 最初の数メートルとの重なりを減らす。
	const SETBACK = 2.6; // m, behind s=0
	const origin = new THREE.Vector3(top.x, groundY, top.z).addScaledVector(fwd, -SETBACK);

	function place(geo) {
		geo.applyMatrix4(basis);
		geo.translate(origin.x, origin.y, origin.z);
		return geo;
	}

	const wood = cloneTextureSet(woodTextures(), 3, 3);
	const metal = cloneTextureSet(metalTextures('#767c82'), 2, 4);
	const woodGeos = [];
	const metalGeos = [];

	const postR = 0.16;
	const corners = [[-half, -half], [half, -half], [half, half], [-half, half]];
	for (const [lx, lz] of corners) {
		const g = new THREE.CylinderGeometry(postR, postR * 1.15, height, 24);
		g.translate(lx, height / 2, lz);
		metalGeos.push(place(g));
	}
	// 筋交い（背面 X ブレース）
	metalGeos.push(place(cylinderBetween(new THREE.Vector3(-half, 0.15, -half), new THREE.Vector3(half, height * 0.55, -half), 0.05, 0.05, 24)));
	metalGeos.push(place(cylinderBetween(new THREE.Vector3(half, 0.15, -half), new THREE.Vector3(-half, height * 0.55, -half), 0.05, 0.05, 24)));

	// プラットフォーム床
	woodGeos.push(place(box(0, height, 0, half * 2 + 0.4, 0.18, half * 2 + 0.4)));
	// 階段踊り場
	woodGeos.push(place(box(0, height * 0.5, -half - 0.6, half * 2 + 0.2, 0.15, 1.6)));

	function addFlight(y0, y1, z0, z1, xOff) {
		const steps = 9;
		for (let i = 0; i < steps; i++) {
			const t = (i + 0.5) / steps;
			const g = new THREE.BoxGeometry(1.1, 0.06, (Math.abs(z1 - z0) / steps) * 1.6);
			g.translate(xOff, THREE.MathUtils.lerp(y0, y1, t), THREE.MathUtils.lerp(z0, z1, t));
			woodGeos.push(place(g));
		}
	}
	addFlight(0.15, height * 0.5, -half - 1.5, -half - 0.65, half + 0.7);
	addFlight(height * 0.5, height - 0.1, -half - 0.55, half * 0.1, -(half + 0.7));

	// 階段の手すり
	metalGeos.push(place(cylinderBetween(new THREE.Vector3(half + 0.7, 0.9, -half - 1.5), new THREE.Vector3(half + 0.7, height * 0.5 + 0.9, -half - 0.65), 0.035, 0.035, 24)));
	metalGeos.push(place(cylinderBetween(new THREE.Vector3(-(half + 0.7), height * 0.5 + 0.9, -half - 0.55), new THREE.Vector3(-(half + 0.7), height + 0.9, half * 0.1), 0.035, 0.035, 24)));

	// プラットフォーム周囲の手すり
	const railY = height + 0.9;
	const ring = [[-half, -half], [half, -half], [half, half], [-half, half], [-half, -half]];
	for (let i = 0; i < 4; i++) {
		const a = new THREE.Vector3(ring[i][0], railY, ring[i][1]);
		const b = new THREE.Vector3(ring[i + 1][0], railY, ring[i + 1][1]);
		metalGeos.push(place(cylinderBetween(a, b, 0.03, 0.03, 24)));
		metalGeos.push(place(cylinderBetween(new THREE.Vector3(ring[i][0], height, ring[i][1]), new THREE.Vector3(ring[i][0], railY, ring[i][1]), 0.025, 0.025, 24)));
	}

	const woodMat = new THREE.MeshStandardMaterial({ map: wood.map, normalMap: wood.normalMap, roughnessMap: wood.roughnessMap, envMap: envMap || null, envMapIntensity: 0.5 });
	const woodMesh = new THREE.Mesh(mergeSafe(woodGeos), woodMat);
	woodMesh.castShadow = true; woodMesh.receiveShadow = true; woodMesh.name = 'TowerWood';
	group.add(woodMesh);

	const metalMat = new THREE.MeshStandardMaterial({ map: metal.map, normalMap: metal.normalMap, roughnessMap: metal.roughnessMap, envMap: envMap || null, envMapIntensity: 1.0, metalness: 0.75, roughness: 0.45 });
	const metalMesh = new THREE.Mesh(mergeSafe(metalGeos), metalMat);
	metalMesh.castShadow = true; metalMesh.receiveShadow = true; metalMesh.name = 'TowerMetal';
	group.add(metalMesh);

	// 屋根（キャノピー）
	// 最終アートディレクション修正: 元は height+1.7 (プラットフォーム床から
	// 約1.7m) の高さで、チューブの s=0 断面の内部空間 (半径~5.2mの開口部、
	// 床から壁の縁まで約3.8m) のちょうど真ん中の高さに来ていた —
	// 上のコメント参照。プラットフォームの SETBACK だけでは水平方向にしか
	// 逃げられない (この円錐の底面半径 half*1.7=5.44m は SETBACK=2.6m より
	// 大きく、水平移動だけではチューブの開口部に届いてしまう) ので、
	// 垂直方向にも十分な余裕を持たせる: 底面がチューブの内部空間
	// (床から最大 ~3.8m + カメラの lift 分の余裕) より確実に高い位置に
	// 来るよう、床から 8m 上げる。
	const canopy = cloneTextureSet(fiberglassTextures('#e8863a'), 4, 2);
	const canopyGeo = new THREE.ConeGeometry(half * 1.7, 1.7, 24, 1, true);
	canopyGeo.translate(0, height + 8.0, 0);
	place(canopyGeo);
	const canopyMat = new THREE.MeshStandardMaterial({
		map: canopy.map, normalMap: canopy.normalMap, roughnessMap: canopy.roughnessMap,
		envMap: envMap || null, envMapIntensity: 0.6, side: THREE.DoubleSide,
	});
	const canopyMesh = new THREE.Mesh(canopyGeo, canopyMat);
	canopyMesh.castShadow = true; canopyMesh.name = 'TowerCanopy';
	group.add(canopyMesh);

	return group;
}

// ===========================================================================
// 監視塔（ライフガードチェア）
// ===========================================================================

function buildLifeguardTower(sampler, envMap) {
	const group = new THREE.Group(); group.name = 'LifeguardTower';
	const ang = 2.2;
	const dist = sampler.poolR + 16;
	const cx = sampler.poolC.x + Math.cos(ang) * dist;
	const cz = sampler.poolC.z + Math.sin(ang) * dist;
	const gy = sampler.heightAt(cx, cz);
	const seatH = 2.6;
	const half = 0.9;

	const wood = cloneTextureSet(woodTextures(), 2, 2);
	const metal = cloneTextureSet(metalTextures('#8a5a34'), 2, 2);

	const legGeos = [];
	const corners = [[-half, -half], [half, -half], [half, half], [-half, half]];
	for (const [lx, lz] of corners) {
		legGeos.push(cylinderBetween(
			new THREE.Vector3(cx + lx * 1.7, gy, cz + lz * 1.7),
			new THREE.Vector3(cx + lx, gy + seatH, cz + lz),
			0.07, 0.05, 24));
	}
	for (let i = 1; i <= 2; i++) {
		const t = i / 3;
		for (let s = 0; s < 4; s++) {
			const [ax, az] = corners[s];
			const [bx, bz] = corners[(s + 1) % 4];
			const pa = new THREE.Vector3(cx + THREE.MathUtils.lerp(ax * 1.7, ax, t), gy + seatH * t, cz + THREE.MathUtils.lerp(az * 1.7, az, t));
			const pb = new THREE.Vector3(cx + THREE.MathUtils.lerp(bx * 1.7, bx, t), gy + seatH * t, cz + THREE.MathUtils.lerp(bz * 1.7, bz, t));
			legGeos.push(cylinderBetween(pa, pb, 0.035, 0.035, 24));
		}
	}
	// パラソル用ポールもここに合流させ、ドローコールを増やさない
	legGeos.push(cylinderBetween(new THREE.Vector3(cx, gy + seatH + 0.6, cz), new THREE.Vector3(cx, gy + seatH + 1.75, cz), 0.03, 0.03, 24));

	const legMat = new THREE.MeshStandardMaterial({ map: metal.map, normalMap: metal.normalMap, roughnessMap: metal.roughnessMap, envMap: envMap || null, envMapIntensity: 0.8, metalness: 0.6, roughness: 0.5 });
	const legs = new THREE.Mesh(mergeSafe(legGeos), legMat);
	legs.castShadow = true; legs.name = 'LifeguardFrame';
	group.add(legs);

	const seatGeos = [
		box(cx, gy + seatH + 0.08, cz, half * 2, 0.1, half * 2),
		box(cx, gy + seatH + 0.5, cz - half + 0.05, half * 1.8, 0.7, 0.08),
	];
	const seatMat = new THREE.MeshStandardMaterial({ map: wood.map, normalMap: wood.normalMap, roughnessMap: wood.roughnessMap, envMap: envMap || null, envMapIntensity: 0.5 });
	const seat = new THREE.Mesh(mergeSafe(seatGeos), seatMat);
	seat.castShadow = true; seat.receiveShadow = true; seat.name = 'LifeguardSeat';
	group.add(seat);

	const canopy = cloneTextureSet(fiberglassTextures('#e0483f'), 4, 2);
	const canopyGeo = new THREE.ConeGeometry(1.6, 0.7, 24, 1, true);
	canopyGeo.translate(cx, gy + seatH + 2.0, cz);
	const canopyMat = new THREE.MeshStandardMaterial({ map: canopy.map, normalMap: canopy.normalMap, roughnessMap: canopy.roughnessMap, envMap: envMap || null, envMapIntensity: 0.6, side: THREE.DoubleSide });
	const canopyMesh = new THREE.Mesh(canopyGeo, canopyMat);
	canopyMesh.castShadow = true; canopyMesh.name = 'LifeguardUmbrella';
	group.add(canopyMesh);

	return group;
}

// ===========================================================================
// 更衣室風の建物
// ===========================================================================

function buildChangingRoom(sampler, envMap) {
	const group = new THREE.Group(); group.name = 'ChangingRoom';
	const ang = -2.0;
	const dist = sampler.poolR + 20;
	const cx = sampler.poolC.x + Math.cos(ang) * dist;
	const cz = sampler.poolC.z + Math.sin(ang) * dist;
	const gy = sampler.heightAt(cx, cz);
	const w = 9, d = 5, h = 3.1;

	const concrete = cloneTextureSet(concreteTextures(), 6, 2);
	const wallMat = new THREE.MeshStandardMaterial({ map: concrete.map, normalMap: concrete.normalMap, roughnessMap: concrete.roughnessMap, envMap: envMap || null, envMapIntensity: 0.5 });
	const walls = new THREE.Mesh(mergeSafe([box(cx, gy + h / 2, cz, w, h, d)]), wallMat);
	walls.castShadow = true; walls.receiveShadow = true; walls.name = 'ChangingWalls';
	group.add(walls);

	const wood = cloneTextureSet(woodTextures(), 3, 1);
	const roofGeo = box(cx, gy + h + 0.1, cz, w + 0.6, 0.2, d + 0.6);
	const roofMat = new THREE.MeshStandardMaterial({ map: wood.map, normalMap: wood.normalMap, roughnessMap: wood.roughnessMap, envMap: envMap || null, envMapIntensity: 0.5, color: 0x9fb3ad });
	const roof = new THREE.Mesh(roofGeo, roofMat);
	roof.castShadow = true; roof.receiveShadow = true; roof.name = 'ChangingRoof';
	group.add(roof);

	const doorT = cloneTextureSet(metalTextures('#22262b'), 1, 2);
	const doorGeos = [
		box(cx - w / 2 + 1.1, gy + 1.05, cz + d / 2 + 0.02, 0.9, 2.1, 0.06),
		box(cx + w / 2 - 1.1, gy + 1.05, cz + d / 2 + 0.02, 0.9, 2.1, 0.06),
	];
	const doorMat = new THREE.MeshStandardMaterial({ map: doorT.map, normalMap: doorT.normalMap, roughnessMap: doorT.roughnessMap, envMap: envMap || null, envMapIntensity: 0.4, metalness: 0.3, roughness: 0.7 });
	const doors = new THREE.Mesh(mergeSafe(doorGeos), doorMat);
	doors.name = 'ChangingDoors';
	group.add(doors);

	return group;
}

// ===========================================================================
// パラソル (Instanced)
// ===========================================================================

function buildParasols(sampler, envMap) {
	const group = new THREE.Group(); group.name = 'Parasols';
	const COUNT = 20;

	const poleGeo = new THREE.CylinderGeometry(0.035, 0.045, 2.4, 24);
	poleGeo.translate(0, 1.2, 0);
	const metal = cloneTextureSet(metalTextures('#d8dde0'), 1, 3);
	const poleMat = new THREE.MeshStandardMaterial({ map: metal.map, normalMap: metal.normalMap, roughnessMap: metal.roughnessMap, envMap: envMap || null, envMapIntensity: 0.9, metalness: 0.7, roughness: 0.4 });
	const poles = new THREE.InstancedMesh(poleGeo, poleMat, COUNT);
	poles.castShadow = true; poles.receiveShadow = true; poles.name = 'ParasolPoles';

	const canopyGeo = new THREE.ConeGeometry(1.45, 0.6, 24, 1, true);
	canopyGeo.translate(0, 2.55, 0);
	const canopyTex = cloneTextureSet(fiberglassTextures('#ffffff'), 5, 2);
	const canopyMat = new THREE.MeshStandardMaterial({
		map: canopyTex.map, normalMap: canopyTex.normalMap, roughnessMap: canopyTex.roughnessMap,
		envMap: envMap || null, envMapIntensity: 0.55, side: THREE.DoubleSide,
	});
	const canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, COUNT);
	canopies.castShadow = true; canopies.name = 'ParasolCanopies';

	const palette = [0xe0483f, 0xf2a71b, 0x2f8f6e, 0x2f6fa3, 0xffffff];
	const dummy = new THREE.Object3D();
	const c = new THREE.Color();
	let placed = 0, attempts = 0;
	while (placed < COUNT && attempts < COUNT * 8) {
		attempts++;
		const ang = Math.random() * Math.PI * 2;
		const dist = sampler.poolR + 6 + Math.random() * 22;
		const x = sampler.poolC.x + Math.cos(ang) * dist;
		const z = sampler.poolC.z + Math.sin(ang) * dist;
		if (sampler.distToTrack(x, z) < 14) continue;
		const y = sampler.heightAt(x, z);
		dummy.position.set(x, y, z);
		dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
		dummy.scale.setScalar(0.9 + Math.random() * 0.25);
		dummy.updateMatrix();
		poles.setMatrixAt(placed, dummy.matrix);
		canopies.setMatrixAt(placed, dummy.matrix);
		c.setHex(palette[placed % palette.length]);
		canopies.setColorAt(placed, c);
		placed++;
	}
	for (let i = placed; i < COUNT; i++) {
		dummy.position.set(sampler.siteCenter.x, sampler.heightAt(sampler.siteCenter.x, sampler.siteCenter.z), sampler.siteCenter.z);
		dummy.scale.setScalar(0.001);
		dummy.updateMatrix();
		poles.setMatrixAt(i, dummy.matrix);
		canopies.setMatrixAt(i, dummy.matrix);
		c.setHex(palette[i % palette.length]);
		canopies.setColorAt(i, c);
	}
	poles.instanceMatrix.needsUpdate = true;
	canopies.instanceMatrix.needsUpdate = true;
	if (canopies.instanceColor) canopies.instanceColor.needsUpdate = true;

	group.add(poles, canopies);
	return group;
}

// ===========================================================================
// デッキチェア (Instanced + merged shape)
// ===========================================================================

function buildLoungers(sampler, envMap) {
	const group = new THREE.Group(); group.name = 'Loungers';
	const COUNT = 14;

	const bedGeo = box(0, 0.42, 0, 0.64, 0.07, 1.9);
	const backGeo = new THREE.BoxGeometry(0.64, 0.07, 0.7);
	backGeo.rotateX(THREE.MathUtils.degToRad(-32));
	backGeo.translate(0, 0.58, -0.95);
	const legPositions = [[-0.27, 0.85], [0.27, 0.85], [-0.27, -0.85], [0.27, -0.85]];
	const legGeos = legPositions.map(([lx, lz]) => cylinderBetween(
		new THREE.Vector3(lx, 0, lz), new THREE.Vector3(lx, 0.42, lz), 0.022, 0.022, 24));
	const loungerGeo = mergeSafe([bedGeo, backGeo, ...legGeos]);

	const resin = cloneTextureSet(fiberglassTextures('#f5f2e9'), 2, 3);
	const mat = new THREE.MeshStandardMaterial({
		map: resin.map, normalMap: resin.normalMap, roughnessMap: resin.roughnessMap,
		envMap: envMap || null, envMapIntensity: 0.5,
	});
	const mesh = new THREE.InstancedMesh(loungerGeo, mat, COUNT);
	mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = 'Loungers';

	const dummy = new THREE.Object3D();
	let placed = 0, attempts = 0;
	while (placed < COUNT && attempts < COUNT * 8) {
		attempts++;
		const ang = Math.random() * Math.PI * 2;
		const dist = sampler.poolR + 4 + Math.random() * 20;
		const x = sampler.poolC.x + Math.cos(ang) * dist;
		const z = sampler.poolC.z + Math.sin(ang) * dist;
		if (sampler.distToTrack(x, z) < 13) continue;
		const y = sampler.heightAt(x, z);
		dummy.position.set(x, y, z);
		dummy.rotation.set(0, ang + Math.PI / 2 + (Math.random() - 0.5) * 0.6, 0);
		dummy.updateMatrix();
		mesh.setMatrixAt(placed, dummy.matrix);
		placed++;
	}
	for (let i = placed; i < COUNT; i++) {
		dummy.position.set(sampler.siteCenter.x, sampler.heightAt(sampler.siteCenter.x, sampler.siteCenter.z), sampler.siteCenter.z);
		dummy.scale.setScalar(0.001);
		dummy.updateMatrix();
		mesh.setMatrixAt(i, dummy.matrix);
	}
	mesh.instanceMatrix.needsUpdate = true;
	group.add(mesh);
	return group;
}

// ===========================================================================
// フェンス（コース近傍は自動的に途切れる）
// ===========================================================================

function buildFence(sampler, envMap) {
	const group = new THREE.Group(); group.name = 'Fence';
	const R = sampler.poolR + 10;
	const startAng = 2.6, endAng = startAng + Math.PI * 1.1;
	const segments = 40;

	const metal = cloneTextureSet(metalTextures('#e7e2d5'), 1, 2);
	const mat = new THREE.MeshStandardMaterial({ map: metal.map, normalMap: metal.normalMap, roughnessMap: metal.roughnessMap, envMap: envMap || null, envMapIntensity: 0.7, metalness: 0.55, roughness: 0.5 });

	const geos = [];
	let prev = null;
	for (let i = 0; i <= segments; i++) {
		const t = i / segments;
		const ang = THREE.MathUtils.lerp(startAng, endAng, t);
		const x = sampler.poolC.x + Math.cos(ang) * R;
		const z = sampler.poolC.z + Math.sin(ang) * R;
		if (sampler.distToTrack(x, z) < 10) { prev = null; continue; }
		const y = sampler.heightAt(x, z);
		const base = new THREE.Vector3(x, y, z);
		geos.push(cylinderBetween(base, base.clone().add(new THREE.Vector3(0, 1.05, 0)), 0.035, 0.035, 12));
		if (prev) {
			geos.push(cylinderBetween(prev.clone().add(new THREE.Vector3(0, 0.9, 0)), base.clone().add(new THREE.Vector3(0, 0.9, 0)), 0.02, 0.02, 10));
			geos.push(cylinderBetween(prev.clone().add(new THREE.Vector3(0, 0.5, 0)), base.clone().add(new THREE.Vector3(0, 0.5, 0)), 0.02, 0.02, 10));
		}
		prev = base;
	}
	const mesh = new THREE.Mesh(mergeSafe(geos), mat);
	mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = 'Fence';
	group.add(mesh);
	return group;
}

// ===========================================================================
// 給水塔
// ===========================================================================

function buildWaterTower(sampler, envMap) {
	const group = new THREE.Group(); group.name = 'WaterTower';
	const ang = 1.0;
	const dist = sampler.poolR + 46;
	const cx = sampler.poolC.x + Math.cos(ang) * dist;
	const cz = sampler.poolC.z + Math.sin(ang) * dist;
	const gy = sampler.heightAt(cx, cz);
	const legH = 8.5, legSpread = 2.4, tankH = 3.2, tankR = 2.1;

	const metal = cloneTextureSet(metalTextures('#767c82'), 1, 4);
	const legGeos = [];
	const legCorners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
	for (const [lx, lz] of legCorners) {
		legGeos.push(cylinderBetween(
			new THREE.Vector3(cx + lx * legSpread, gy, cz + lz * legSpread),
			new THREE.Vector3(cx + lx * legSpread * 0.28, gy + legH, cz + lz * legSpread * 0.28),
			0.12, 0.09, 24));
	}
	for (let i = 1; i <= 3; i++) {
		const t = i / 4;
		for (let s = 0; s < 4; s++) {
			const [ax, az] = legCorners[s];
			const [bx, bz] = legCorners[(s + 1) % 4];
			const pa = new THREE.Vector3(cx + THREE.MathUtils.lerp(ax * legSpread, ax * legSpread * 0.28, t), gy + legH * t, cz + THREE.MathUtils.lerp(az * legSpread, az * legSpread * 0.28, t));
			const pb = new THREE.Vector3(cx + THREE.MathUtils.lerp(bx * legSpread, bx * legSpread * 0.28, t), gy + legH * t, cz + THREE.MathUtils.lerp(bz * legSpread, bz * legSpread * 0.28, t));
			legGeos.push(cylinderBetween(pa, pb, 0.04, 0.04, 24));
		}
	}
	const legMat = new THREE.MeshStandardMaterial({ map: metal.map, normalMap: metal.normalMap, roughnessMap: metal.roughnessMap, envMap: envMap || null, envMapIntensity: 0.9, metalness: 0.75, roughness: 0.45 });
	const legs = new THREE.Mesh(mergeSafe(legGeos), legMat);
	legs.castShadow = true; legs.name = 'WaterTowerLegs';
	group.add(legs);

	const tank = cloneTextureSet(metalTextures('#3f7f92'), 3, 1.5);
	const tankGeo = new THREE.CylinderGeometry(tankR, tankR, tankH, 24);
	tankGeo.translate(cx, gy + legH + tankH / 2, cz);
	const capGeo = new THREE.ConeGeometry(tankR * 1.02, tankH * 0.35, 24);
	capGeo.translate(cx, gy + legH + tankH + tankH * 0.175, cz);
	const tankMat = new THREE.MeshStandardMaterial({ map: tank.map, normalMap: tank.normalMap, roughnessMap: tank.roughnessMap, envMap: envMap || null, envMapIntensity: 0.8, metalness: 0.5, roughness: 0.5 });
	const tankMesh = new THREE.Mesh(mergeSafe([tankGeo, capGeo]), tankMat);
	tankMesh.castShadow = true; tankMesh.receiveShadow = true; tankMesh.name = 'WaterTowerTank';
	group.add(tankMesh);

	return group;
}

// ===========================================================================
// 遠景：山並み + 水平線の海
// ===========================================================================

function buildDistantScenery(sampler, envMap) {
	const group = new THREE.Group(); group.name = 'DistantScenery';
	const { x: cx, z: cz } = sampler.siteCenter;
	const baseY = sampler.heightAt(cx, cz) - 4;

	const mtCount = 28;
	const mtRadius = 210;
	const ringInner = [];
	const ringOuter = [];
	for (let i = 0; i <= mtCount; i++) {
		const a = (i / mtCount) * Math.PI * 2;
		const rNoise = 1 + (fbm(Math.cos(a) * 3 + 11, Math.sin(a) * 3 + 11, 3) - 0.5) * 0.35;
		const peakH = 26 + fbm(Math.cos(a) * 4, Math.sin(a) * 4, 4) * 46;
		const rr = mtRadius * rNoise;
		ringInner.push(new THREE.Vector3(cx + Math.cos(a) * rr, baseY + peakH, cz + Math.sin(a) * rr));
		ringOuter.push(new THREE.Vector3(cx + Math.cos(a) * rr, baseY - 6, cz + Math.sin(a) * rr));
	}
	const positions = [];
	const uvs = [];
	for (let i = 0; i < mtCount; i++) {
		const a0 = ringOuter[i], a1 = ringOuter[i + 1];
		const b0 = ringInner[i], b1 = ringInner[i + 1];
		positions.push(a0.x, a0.y, a0.z, b0.x, b0.y, b0.z, b1.x, b1.y, b1.z);
		positions.push(a0.x, a0.y, a0.z, b1.x, b1.y, b1.z, a1.x, a1.y, a1.z);
		for (let k = 0; k < 6; k++) uvs.push(0, 0);
	}
	const mtGeo = new THREE.BufferGeometry();
	mtGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	mtGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
	mtGeo.computeVertexNormals();
	mtGeo.computeBoundingSphere();

	const rock = cloneTextureSet(rockTextures(), 30, 6);
	const mtMat = new THREE.MeshStandardMaterial({
		map: rock.map, normalMap: rock.normalMap, roughnessMap: rock.roughnessMap,
		envMap: envMap || null, envMapIntensity: 0.35, color: 0xaeb9be,
	});
	const mountains = new THREE.Mesh(mtGeo, mtMat);
	mountains.name = 'Mountains';
	mountains.castShadow = false;
	mountains.receiveShadow = false;
	mountains.frustumCulled = false;
	group.add(mountains);

	const seaY = baseY - 2.5;
	const seaGeo = new THREE.PlaneGeometry(1600, 1600, 2, 2);
	seaGeo.rotateX(-Math.PI / 2);
	seaGeo.translate(cx, seaY, cz);
	const seaTex = cloneTextureSet(seaWaveTextures(), 90, 90);
	const seaMat = new THREE.MeshStandardMaterial({
		color: 0x1c5a72,
		map: seaTex.map,
		normalMap: seaTex.normalMap,
		roughnessMap: seaTex.roughnessMap,
		metalness: 0.05,
		roughness: 1,
		envMap: envMap || null,
		envMapIntensity: 1.1,
	});
	const sea = new THREE.Mesh(seaGeo, seaMat);
	sea.name = 'Sea';
	sea.receiveShadow = false;
	sea.castShadow = false;
	sea.frustumCulled = false;
	group.add(sea);

	return { group };
}

// ===========================================================================
// 雲（billboard、riderPos に正対する Y 軸ビルボード）
// ===========================================================================

function buildClouds(sampler) {
	const group = new THREE.Group(); group.name = 'Clouds';
	const COUNT = 22;
	const tex = cloudTexture();
	const geo = new THREE.PlaneGeometry(1, 1);
	const mat = new THREE.MeshBasicMaterial({
		map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide,
		toneMapped: false, opacity: 0.92,
	});
	const clouds = new THREE.InstancedMesh(geo, mat, COUNT);
	clouds.frustumCulled = false;
	clouds.castShadow = false;
	clouds.receiveShadow = false;
	clouds.name = 'CloudBillboards';

	const baseY = sampler.heightAt(sampler.siteCenter.x, sampler.siteCenter.z) + 95;
	const infos = [];
	const dummy = new THREE.Object3D();
	for (let i = 0; i < COUNT; i++) {
		const ang = Math.random() * Math.PI * 2;
		const dist = 60 + Math.random() * 260;
		const x = sampler.siteCenter.x + Math.cos(ang) * dist;
		const z = sampler.siteCenter.z + Math.sin(ang) * dist;
		const y = baseY + (Math.random() - 0.5) * 30;
		const scale = 26 + Math.random() * 40;
		infos.push({ x, y, z, scale });
		dummy.position.set(x, y, z);
		dummy.scale.setScalar(scale);
		dummy.updateMatrix();
		clouds.setMatrixAt(i, dummy.matrix);
	}
	clouds.instanceMatrix.needsUpdate = true;
	group.add(clouds);

	function update(dt, riderPos) {
		if (!riderPos) return;
		for (let i = 0; i < COUNT; i++) {
			const info = infos[i];
			const dx = riderPos.x - info.x;
			const dz = riderPos.z - info.z;
			const ay = Math.atan2(dx, dz);
			dummy.position.set(info.x, info.y, info.z);
			dummy.rotation.set(0, ay, 0);
			dummy.scale.setScalar(info.scale);
			dummy.updateMatrix();
			clouds.setMatrixAt(i, dummy.matrix);
		}
		clouds.instanceMatrix.needsUpdate = true;
	}

	return { group, update };
}

// ===========================================================================
// 背景用の装飾スライダー（プレイヤーのコースとは無関係）
// ===========================================================================

function buildBackgroundSlides(sampler, envMap) {
	const group = new THREE.Group(); group.name = 'BackgroundSlides';
	const configs = [
		{ ang: 3.6, dist: 34, turns: 2.2, height: 22, radius: 5.5, tint: [1.0, 0.55, 0.35] },
		{ ang: 4.3, dist: 46, turns: 1.6, height: 16, radius: 4.5, tint: [0.4, 0.75, 1.0] },
		{ ang: 5.0, dist: 30, turns: 1.2, height: 12, radius: 3.6, tint: [0.5, 1.0, 0.55] },
	];

	const fiber = cloneTextureSet(fiberglassTextures('#ffffff'), 3, 20);
	const mat = new THREE.MeshStandardMaterial({
		map: fiber.map, normalMap: fiber.normalMap, roughnessMap: fiber.roughnessMap,
		vertexColors: true, envMap: envMap || null, envMapIntensity: 0.6,
	});

	function tintGeo(g, tint) {
		const count = g.attributes.position.count;
		const colors = new Float32Array(count * 3);
		for (let i = 0; i < count; i++) { colors[i * 3] = tint[0]; colors[i * 3 + 1] = tint[1]; colors[i * 3 + 2] = tint[2]; }
		g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
		return g;
	}

	const geos = [];
	for (const cfg of configs) {
		const cx = sampler.poolC.x + Math.cos(cfg.ang) * (sampler.poolR + cfg.dist);
		const cz = sampler.poolC.z + Math.sin(cfg.ang) * (sampler.poolR + cfg.dist);
		if (sampler.distToTrack(cx, cz) < cfg.radius + 25) continue;
		const baseY = sampler.heightAt(cx, cz);
		const pts = [];
		const N = 46;
		for (let i = 0; i <= N; i++) {
			const t = i / N;
			const a = t * Math.PI * 2 * cfg.turns;
			pts.push(new THREE.Vector3(cx + Math.cos(a) * cfg.radius, baseY + cfg.height * (1 - t) + 2, cz + Math.sin(a) * cfg.radius));
		}
		const curve = new THREE.CatmullRomCurve3(pts);
		const tube = new THREE.TubeGeometry(curve, 90, 0.85, 24, false);
		geos.push(tintGeo(tube, cfg.tint));

		for (let i = 6; i < N; i += 10) {
			const t = i / N;
			const a = t * Math.PI * 2 * cfg.turns;
			const px = cx + Math.cos(a) * cfg.radius, pz = cz + Math.sin(a) * cfg.radius;
			const py = baseY + cfg.height * (1 - t) + 2;
			const legG = cylinderBetween(new THREE.Vector3(px, sampler.heightAt(px, pz), pz), new THREE.Vector3(px, py - 0.9, pz), 0.12, 0.12, 24);
			geos.push(tintGeo(legG, [0.55, 0.55, 0.55]));
		}
	}

	if (geos.length > 0) {
		const mesh = new THREE.Mesh(mergeSafe(geos), mat);
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		mesh.name = 'BackgroundSlides';
		group.add(mesh);
	}
	return group;
}

// ===========================================================================
// エントリポイント
// ===========================================================================

export function createEnvironment(scene, track, envMap) {
	const group = new THREE.Group();
	group.name = 'Environment';

	const sampler = createTerrainSampler(track);
	const wind = createWindSwaySystem();

	group.add(buildTerrain(sampler, envMap));
	group.add(buildGroundPatches(sampler, envMap));
	group.add(buildPool(sampler, envMap));

	const palms = buildPalms(sampler, envMap, wind);
	group.add(palms.group);

	group.add(buildStartTower(track, sampler, envMap));
	group.add(buildLifeguardTower(sampler, envMap));
	group.add(buildChangingRoom(sampler, envMap));
	group.add(buildParasols(sampler, envMap));
	group.add(buildLoungers(sampler, envMap));
	group.add(buildFence(sampler, envMap));
	group.add(buildWaterTower(sampler, envMap));

	const distant = buildDistantScenery(sampler, envMap);
	group.add(distant.group);

	const clouds = buildClouds(sampler);
	group.add(clouds.group);

	group.add(buildBackgroundSlides(sampler, envMap));

	scene.add(group);

	function update(dt, riderPos) {
		wind.update(dt);
		clouds.update(dt, riderPos);
	}

	return { group, update };
}
