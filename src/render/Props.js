/**
 * Props.js (A5 ENVIRONMENT)
 * -------------------------------------------------------------------------
 * コース沿いの小物一式。`createProps(track, envMap): THREE.Group` を返す
 * （このモジュール自体に update() は無い — 静的な装飾のみ）。
 *
 * - 注意書き看板（日本語、プロシージャル CanvasTexture）
 * - 投光器（メッシュのみ、実ライトなし）
 * - 樋の継ぎ目リング + ボルト
 * - 給水パイプ・ホース
 * - トンネル区間の光の筋（AdditiveBlending）
 * - 旗・ブイ・観葉植物
 *
 * すべて InstancedMesh か BufferGeometryUtils.mergeGeometries でまとめ、
 * ドローコールを抑える。
 */
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { TRACK_DESIGN } from '../track/TrackDesign.js';
import {
	cloneTextureSet,
	metalTextures,
	concreteTextures,
	foliageTexture,
	signTexture,
	lightBeamTexture,
	flagTexture,
	buoyStripeTexture,
} from './TextureLab.js';

// ===========================================================================
// 汎用ヘルパ（Environment.js と同型だが、単体 import 可能性のためこの
// ファイル内に閉じて複製する）
// ===========================================================================

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

/** トンネル区間 [s0,s1] の一覧。track.frameAt(s).tunnel を step 刻みで走査する。 */
function findTunnelRanges(track, step = 1.0) {
	const ranges = [];
	let inTunnel = false;
	let startS = 0;
	const len = track.length;
	for (let s = 0; s <= len; s += step) {
		const isT = !!track.frameAt(s).tunnel;
		if (isT && !inTunnel) { inTunnel = true; startS = s; }
		else if (!isT && inTunnel) { inTunnel = false; ranges.push([startS, s]); }
	}
	if (inTunnel) ranges.push([startS, len]);
	return ranges;
}

// ===========================================================================
// 注意書き看板
// ===========================================================================

function buildSigns(track, envMap) {
	const group = new THREE.Group(); group.name = 'Signs';
	const messages = [
		['スピード注意'],
		['頭上注意'],
		['安全バーを確認'],
		['手を離さないで'],
	];
	const len = track.length;
	const count = 10;

	const metalSet = cloneTextureSet(metalTextures('#5c6066'), 1, 2);
	const postMat = new THREE.MeshStandardMaterial({
		map: metalSet.map, normalMap: metalSet.normalMap, roughnessMap: metalSet.roughnessMap,
		envMap: envMap || null, envMapIntensity: 0.7, metalness: 0.6, roughness: 0.55,
	});

	const postGeos = [];
	const boardsByMsg = messages.map(() => []);
	const up = new THREE.Vector3(0, 1, 0);
	const dummy = new THREE.Object3D();

	for (let i = 0; i < count; i++) {
		const t = (i + 0.5) / count;
		const s = t * len;
		const f = track.frameAt(s);
		if (f.tunnel) continue;
		const side = i % 2 === 0 ? 1 : -1;
		const outward = f.radius * (f.widthScale || 1) + 2.2;
		const groundPt = f.position.clone().addScaledVector(f.binormal, side * outward).addScaledVector(f.normal, -f.radius * 0.6);
		const postTop = groundPt.clone().addScaledVector(up, 1.7);
		postGeos.push(cylinderBetween(groundPt, postTop, 0.035, 0.045, 24));

		const boardCenter = postTop.clone().addScaledVector(up, 0.5);
		dummy.position.copy(boardCenter);
		dummy.up.set(0, 1, 0);
		dummy.lookAt(boardCenter.clone().add(f.tangent));
		dummy.updateMatrix();
		const boardGeo = new THREE.PlaneGeometry(1.05, 0.5);
		boardGeo.applyMatrix4(dummy.matrix);
		boardsByMsg[i % messages.length].push(boardGeo);
	}

	if (postGeos.length > 0) {
		const postMesh = new THREE.Mesh(mergeSafe(postGeos), postMat);
		postMesh.castShadow = true;
		postMesh.name = 'SignPosts';
		group.add(postMesh);
	}

	messages.forEach((msg, idx) => {
		const geos = boardsByMsg[idx];
		if (geos.length === 0) return;
		const tex = signTexture(msg);
		const mat = new THREE.MeshStandardMaterial({
			map: tex, roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide,
			envMap: envMap || null, envMapIntensity: 0.4,
		});
		const mesh = new THREE.Mesh(mergeSafe(geos), mat);
		mesh.castShadow = true;
		mesh.name = 'SignBoard_' + idx;
		group.add(mesh);
	});

	return group;
}

// ===========================================================================
// 投光器（メッシュのみ、実ライトは足さない）
// ===========================================================================

function buildFloodlights(track, envMap) {
	const group = new THREE.Group(); group.name = 'Floodlights';
	const len = track.length;
	const count = 16;

	const bodyGeo = new THREE.BoxGeometry(0.34, 0.24, 0.5);
	const armGeo = cylinderBetween(new THREE.Vector3(0, -0.35, 0), new THREE.Vector3(0, 0, 0), 0.03, 0.05, 24);
	const housingGeo = mergeSafe([bodyGeo, armGeo]);
	const metalSet = cloneTextureSet(metalTextures('#2c2f33'), 1, 1);
	const housingMat = new THREE.MeshStandardMaterial({
		map: metalSet.map, normalMap: metalSet.normalMap, roughnessMap: metalSet.roughnessMap,
		envMap: envMap || null, envMapIntensity: 0.6, metalness: 0.7, roughness: 0.4,
	});
	const housing = new THREE.InstancedMesh(housingGeo, housingMat, count);
	housing.castShadow = false;
	housing.receiveShadow = false;
	housing.name = 'FloodlightHousings';

	const lensGeo = new THREE.CircleGeometry(0.15, 16);
	lensGeo.translate(0, 0, -0.26);
	const lensMat = new THREE.MeshPhysicalMaterial({
		map: metalSet.map, normalMap: metalSet.normalMap, roughnessMap: metalSet.roughnessMap,
		color: 0xfff6d8, roughness: 0.2, metalness: 0.0, transmission: 0.35, clearcoat: 0.6,
		side: THREE.DoubleSide, envMap: envMap || null, envMapIntensity: 1.2,
	});
	const lens = new THREE.InstancedMesh(lensGeo, lensMat, count);
	lens.castShadow = false;
	lens.receiveShadow = false;
	lens.name = 'FloodlightLenses';

	const dummy = new THREE.Object3D();
	for (let i = 0; i < count; i++) {
		const t = (i + 0.5) / count;
		const s = t * len;
		const f = track.frameAt(s);
		const side = i % 2 === 0 ? -1 : 1;
		const outward = f.radius * (f.widthScale || 1) + 1.6;
		const pos = f.position.clone().addScaledVector(f.binormal, side * outward).addScaledVector(f.normal, 1.4);
		dummy.position.copy(pos);
		dummy.up.set(0, 1, 0);
		dummy.lookAt(f.position);
		dummy.updateMatrix();
		housing.setMatrixAt(i, dummy.matrix);
		lens.setMatrixAt(i, dummy.matrix);
	}
	housing.instanceMatrix.needsUpdate = true;
	lens.instanceMatrix.needsUpdate = true;

	group.add(housing, lens);
	return group;
}

// ===========================================================================
// 樋の継ぎ目リング + ボルト（track.surfaceAt / surfaceNormalAt のみを使い、
// SplineTrack の内部定数に依存しない）
// ===========================================================================

function buildSeams(track, envMap) {
	const group = new THREE.Group(); group.name = 'ChuteSeams';
	const len = track.length;
	const spacing = 8;
	const N = 20;

	const metalSet = cloneTextureSet(metalTextures('#9199a1'), 2, 1);
	const mat = new THREE.MeshStandardMaterial({
		map: metalSet.map, normalMap: metalSet.normalMap, roughnessMap: metalSet.roughnessMap,
		envMap: envMap || null, envMapIntensity: 0.8, metalness: 0.7, roughness: 0.4,
	});

	const ringGeos = [];
	const boltGeos = [];
	for (let s = spacing; s < len - 3; s += spacing) {
		const pts = [];
		for (let j = 0; j <= N; j++) {
			const lateral = -1 + (2 * j) / N;
			pts.push(track.surfaceAt(s, lateral, 0.025));
		}
		const curve = new THREE.CatmullRomCurve3(pts);
		// 継ぎ目リング自体は目立つので丸みを保つ (14 分割)。ボルトは全域で
		// 数百個がひとつのバッファに焼き込まれる極小パーツなので、過剰な
		// 分割はドローコールを増やさずとも頂点数だけを無駄に肥大化させる
		// — 見た目に影響しない範囲でやや控えめにする。
		ringGeos.push(new THREE.TubeGeometry(curve, N, 0.03, 14, false));

		for (let j = 2; j < N; j += 4) {
			const lateral = -1 + (2 * j) / N;
			const p = track.surfaceAt(s, lateral, 0.03);
			const g = new THREE.SphereGeometry(0.045, 10, 8);
			g.translate(p.x, p.y, p.z);
			boltGeos.push(g);
		}
	}

	if (ringGeos.length > 0) {
		const rings = new THREE.Mesh(mergeSafe(ringGeos), mat);
		rings.name = 'SeamRings';
		rings.castShadow = true;
		group.add(rings);
	}
	if (boltGeos.length > 0) {
		const bolts = new THREE.Mesh(mergeSafe(boltGeos), mat);
		bolts.name = 'SeamBolts';
		bolts.castShadow = true;
		group.add(bolts);
	}
	return group;
}

// ===========================================================================
// 給水パイプ・ホース（スタート付近）
// ===========================================================================

function buildSupplyPipes(track, envMap) {
	const group = new THREE.Group(); group.name = 'SupplyPipes';
	const f0 = track.frameAt(0);
	const base = f0.position;
	const fwd = new THREE.Vector3(f0.tangent.x, 0, f0.tangent.z);
	if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, 1); else fwd.normalize();
	const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
	if (right.lengthSq() < 1e-6) right.set(1, 0, 0); else right.normalize();

	const metalSet = cloneTextureSet(metalTextures('#4c6b7a'), 2, 2);
	const mat = new THREE.MeshStandardMaterial({
		map: metalSet.map, normalMap: metalSet.normalMap, roughnessMap: metalSet.roughnessMap,
		envMap: envMap || null, envMapIntensity: 0.7, metalness: 0.65, roughness: 0.45,
	});

	const geos = [];
	const p0 = base.clone().addScaledVector(right, 4.5).addScaledVector(fwd, -2);
	const p1 = p0.clone().add(new THREE.Vector3(0, 2.4, 0));
	const p2 = p1.clone().addScaledVector(fwd, 3.5);
	const p3 = p2.clone().add(new THREE.Vector3(0, -1.8, 0));
	geos.push(cylinderBetween(p0, p1, 0.08, 0.08, 24));
	geos.push(cylinderBetween(p1, p2, 0.07, 0.07, 24));
	geos.push(cylinderBetween(p2, p3, 0.07, 0.07, 24));

	// コイル状のホース
	const coilCenter = base.clone().addScaledVector(right, 3.2).addScaledVector(fwd, -3.5);
	const coilPts = [];
	const turns = 3, coilR = 0.35;
	for (let i = 0; i <= 48; i++) {
		const t = i / 48;
		const a = t * Math.PI * 2 * turns;
		coilPts.push(new THREE.Vector3(
			coilCenter.x + Math.cos(a) * coilR,
			coilCenter.y + 0.05 + t * 0.5,
			coilCenter.z + Math.sin(a) * coilR,
		));
	}
	geos.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(coilPts), 64, 0.035, 24, false));

	const mesh = new THREE.Mesh(mergeSafe(geos), mat);
	mesh.castShadow = true;
	mesh.receiveShadow = true;
	mesh.name = 'SupplyPipes';
	group.add(mesh);
	return group;
}

// ===========================================================================
// トンネル区間の光の筋（AdditiveBlending） — 臨場感の要
// ===========================================================================

function buildTunnelLightBeams(track, envMap) {
	const group = new THREE.Group(); group.name = 'TunnelLightBeams';
	const ranges = findTunnelRanges(track, 1.0);
	const spacing = 5.5;

	const placementsS = [];
	for (const [s0, s1] of ranges) {
		const rangeLen = s1 - s0;
		if (rangeLen < 3) continue;
		const n = Math.max(1, Math.round(rangeLen / spacing));
		for (let i = 0; i < n; i++) placementsS.push(s0 + (i + 0.5) * (rangeLen / n));
	}
	if (placementsS.length === 0) return group;

	const beamTex = lightBeamTexture();
	const beamGeo = new THREE.PlaneGeometry(1, 1, 1, 1);
	beamGeo.translate(0, -0.5, 0); // ピボットを上端（天井の取り付け点）に
	const mat = new THREE.MeshBasicMaterial({
		map: beamTex, transparent: true, blending: THREE.AdditiveBlending,
		depthWrite: false, side: THREE.DoubleSide, toneMapped: false, color: 0xfff1cf,
	});
	const beams = new THREE.InstancedMesh(beamGeo, mat, placementsS.length);
	beams.castShadow = false;
	beams.receiveShadow = false;
	beams.frustumCulled = false;
	beams.name = 'TunnelLightBeams';

	const dummy = new THREE.Object3D();
	placementsS.forEach((s, i) => {
		const f = track.frameAt(s);
		const r = f.radius * (f.widthScale || 1);
		const lateralJitter = (Math.random() - 0.5) * r * 0.6;
		const ceiling = f.position.clone().addScaledVector(f.normal, r * 1.55).addScaledVector(f.binormal, lateralJitter);
		const basis = new THREE.Matrix4().makeBasis(f.binormal, f.normal, f.tangent);
		dummy.position.copy(ceiling);
		dummy.quaternion.setFromRotationMatrix(basis);
		dummy.rotateX(THREE.MathUtils.degToRad(-15 + Math.random() * 30));
		dummy.rotateY(THREE.MathUtils.degToRad((Math.random() - 0.5) * 20));
		const width = Math.max(0.5, r * (0.7 + Math.random() * 0.5));
		const beamLen = r * (2.0 + Math.random() * 0.8);
		dummy.scale.set(width, beamLen, 1);
		dummy.updateMatrix();
		beams.setMatrixAt(i, dummy.matrix);
	});
	beams.instanceMatrix.needsUpdate = true;

	group.add(beams);
	return group;
}

// ===========================================================================
// 旗
// ===========================================================================

function buildFlags(track, envMap) {
	const group = new THREE.Group(); group.name = 'Flags';
	const len = track.length;
	const sampleCount = 12;
	const placements = [];
	for (let i = 0; i < sampleCount; i++) {
		const t = (i + 0.5) / sampleCount;
		const s = t * len;
		const f = track.frameAt(s);
		if (f.tunnel) continue;
		const side = i % 2 === 0 ? 1 : -1;
		const outward = f.radius * (f.widthScale || 1) + 1.6;
		const pos = f.position.clone().addScaledVector(f.binormal, side * outward).addScaledVector(f.normal, -f.radius * 0.5);
		placements.push(pos);
	}
	if (placements.length === 0) return group;

	const metalSet = cloneTextureSet(metalTextures('#c9ccd0'), 1, 3);
	const poleMat = new THREE.MeshStandardMaterial({
		map: metalSet.map, normalMap: metalSet.normalMap, roughnessMap: metalSet.roughnessMap,
		envMap: envMap || null, envMapIntensity: 0.7, metalness: 0.6, roughness: 0.5,
	});
	const poleGeo = new THREE.CylinderGeometry(0.025, 0.03, 1.8, 24);
	poleGeo.translate(0, 0.9, 0);
	const poles = new THREE.InstancedMesh(poleGeo, poleMat, placements.length);
	poles.castShadow = true;
	poles.name = 'FlagPoles';

	// 「静止した中間フラッター」形状（波打った旗布）
	const flagShape = new THREE.PlaneGeometry(0.6, 0.32, 6, 1);
	const fpos = flagShape.attributes.position;
	for (let i = 0; i < fpos.count; i++) {
		const x = fpos.getX(i);
		const t = THREE.MathUtils.clamp(x / 0.6 + 0.5, 0, 1);
		fpos.setZ(i, Math.sin(t * Math.PI * 1.4) * 0.09);
	}
	flagShape.translate(0.3, 1.62, 0);
	flagShape.computeVertexNormals();
	const flagTex = flagTexture('#e63946', '#f7f7f2');
	const flagMat = new THREE.MeshStandardMaterial({
		map: flagTex, side: THREE.DoubleSide, roughness: 0.65, metalness: 0,
		envMap: envMap || null, envMapIntensity: 0.35,
	});
	const flags = new THREE.InstancedMesh(flagShape, flagMat, placements.length);
	flags.castShadow = true;
	flags.name = 'Flags';

	const dummy = new THREE.Object3D();
	placements.forEach((pos, i) => {
		dummy.position.copy(pos);
		dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
		dummy.updateMatrix();
		poles.setMatrixAt(i, dummy.matrix);
		flags.setMatrixAt(i, dummy.matrix);
	});
	poles.instanceMatrix.needsUpdate = true;
	flags.instanceMatrix.needsUpdate = true;

	group.add(poles, flags);
	return group;
}

// ===========================================================================
// ブイ（着水プールの縁）
// ===========================================================================

function buildBuoys(envMap) {
	const group = new THREE.Group(); group.name = 'Buoys';
	const poolC = new THREE.Vector3(TRACK_DESIGN.poolCenter[0], TRACK_DESIGN.poolCenter[1], TRACK_DESIGN.poolCenter[2]);
	const poolR = TRACK_DESIGN.poolRadius;
	const count = 10;

	const tex = buoyStripeTexture();
	const geo = new THREE.SphereGeometry(0.28, 32, 16);
	geo.scale(1, 0.65, 1);
	const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4, metalness: 0.05, envMap: envMap || null, envMapIntensity: 0.6 });
	const buoys = new THREE.InstancedMesh(geo, mat, count);
	buoys.castShadow = true;
	buoys.name = 'Buoys';

	const dummy = new THREE.Object3D();
	for (let i = 0; i < count; i++) {
		const ang = (i / count) * Math.PI * 2;
		const r = poolR * 0.82;
		const x = poolC.x + Math.cos(ang) * r;
		const z = poolC.z + Math.sin(ang) * r;
		const y = poolC.y + 0.14;
		dummy.position.set(x, y, z);
		dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
		dummy.updateMatrix();
		buoys.setMatrixAt(i, dummy.matrix);
	}
	buoys.instanceMatrix.needsUpdate = true;
	group.add(buoys);
	return group;
}

// ===========================================================================
// 観葉植物
// ===========================================================================

function buildPottedPlants(track, envMap) {
	const group = new THREE.Group(); group.name = 'PottedPlants';
	const len = track.length;
	const sampleCount = 10;
	const placements = [];
	for (let i = 0; i < sampleCount; i++) {
		const t = (i + 0.3) / sampleCount;
		const s = t * len;
		const f = track.frameAt(s);
		if (f.tunnel) continue;
		const side = i % 2 === 0 ? -1 : 1;
		const outward = f.radius * (f.widthScale || 1) + 3.2;
		const pos = f.position.clone().addScaledVector(f.binormal, side * outward).addScaledVector(f.normal, -f.radius * 0.7);
		placements.push(pos);
	}
	if (placements.length === 0) return group;

	const potGeo = new THREE.CylinderGeometry(0.22, 0.16, 0.32, 24);
	potGeo.translate(0, 0.16, 0);
	const potTex = cloneTextureSet(concreteTextures(), 1, 1);
	const potMat = new THREE.MeshStandardMaterial({
		map: potTex.map, normalMap: potTex.normalMap, roughnessMap: potTex.roughnessMap,
		envMap: envMap || null, envMapIntensity: 0.5, color: 0xb36a44,
	});
	const pots = new THREE.InstancedMesh(potGeo, potMat, placements.length);
	pots.castShadow = true;
	pots.receiveShadow = true;
	pots.name = 'PlantPots';

	const leafGeo = new THREE.PlaneGeometry(0.4, 0.6, 1, 3);
	leafGeo.translate(0, 0.3, 0);
	const foliageMat = new THREE.MeshStandardMaterial({
		map: foliageTexture(), alphaTest: 0.5, side: THREE.DoubleSide, transparent: false,
		roughness: 0.85, metalness: 0, envMap: envMap || null, envMapIntensity: 0.4,
	});
	const leafPerPlant = 3;
	const leaves = new THREE.InstancedMesh(leafGeo, foliageMat, placements.length * leafPerPlant);
	leaves.castShadow = true;
	leaves.name = 'PlantLeaves';

	const dummy = new THREE.Object3D();
	const leafDummy = new THREE.Object3D();
	let leafIdx = 0;
	placements.forEach((pos, i) => {
		dummy.position.copy(pos);
		dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
		dummy.updateMatrix();
		pots.setMatrixAt(i, dummy.matrix);

		for (let k = 0; k < leafPerPlant; k++) {
			leafDummy.position.set(0, 0.3, 0);
			leafDummy.quaternion.identity();
			leafDummy.rotateY((k / leafPerPlant) * Math.PI * 2 + Math.random() * 0.5);
			leafDummy.rotateZ(THREE.MathUtils.degToRad(18 + Math.random() * 12));
			leafDummy.scale.setScalar(0.8 + Math.random() * 0.3);
			leafDummy.updateMatrix();
			const combined = new THREE.Matrix4().multiplyMatrices(dummy.matrix, leafDummy.matrix);
			leaves.setMatrixAt(leafIdx++, combined);
		}
	});
	pots.instanceMatrix.needsUpdate = true;
	leaves.instanceMatrix.needsUpdate = true;

	group.add(pots, leaves);
	return group;
}

// ===========================================================================
// エントリポイント
// ===========================================================================

export function createProps(track, envMap) {
	const group = new THREE.Group();
	group.name = 'Props';

	group.add(buildSigns(track, envMap));
	group.add(buildFloodlights(track, envMap));
	group.add(buildSeams(track, envMap));
	group.add(buildSupplyPipes(track, envMap));
	group.add(buildTunnelLightBeams(track, envMap));
	group.add(buildFlags(track, envMap));
	group.add(buildBuoys(envMap));
	group.add(buildPottedPlants(track, envMap));

	return group;
}
