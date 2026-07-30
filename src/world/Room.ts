// 部屋: 内向きの面だけを描く(ドールハウス方式)。カメラが壁の外に出ても
// 室内が見通せる。コライダーは壁厚のあるボックス。

import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { PhysicsWorld } from '../physics/PhysicsWorld'
import { DOOR, ROOM } from '../sim/constants'
import {
  floorMat,
  wallMat,
  woodDarkMat,
  whiteMat,
  rugMat,
  makeWettable,
} from '../gfx/materials'
import { fabricTexture, paintingTexture } from '../gfx/textures'

export const WINDOW_RECT = { z0: -0.55, z1: 0.75, y0: 0.9, y1: 1.9 } // +x壁

export class Room {
  group = new THREE.Group()
  // 壁ごとの装飾(額縁・カーテン等)。カメラがその壁の外に出たら隠す
  // (壁自体は内向き面で外から見えないため、裏面だけ宙に浮いて見えるのを防ぐ)
  private decorBack = new THREE.Group()
  private decorLeft = new THREE.Group()
  private decorRight = new THREE.Group()

  constructor(physics: PhysicsWorld) {
    const W = ROOM.width
    const D = ROOM.depth
    const H = ROOM.height
    const T = ROOM.wallThickness
    const hw = W / 2
    const hd = D / 2

    const wall = wallMat()
    const white = whiteMat()

    const plane = (
      w: number,
      h: number,
      mat: THREE.Material,
      px: number,
      py: number,
      pz: number,
      ry = 0,
      rx = 0
    ) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat)
      m.position.set(px, py, pz)
      m.rotation.set(rx, ry, 0)
      m.receiveShadow = true
      this.group.add(m)
      return m
    }

    // 床・天井
    const floor = plane(W, D, floorMat(), 0, 0, 0, 0, -Math.PI / 2)
    floor.receiveShadow = true
    plane(W, D, white, 0, H, 0, 0, Math.PI / 2)

    // 前壁(z=-hd, ドアあり) — ドア開口の周囲を分割して張る
    const dx0 = DOOR.hingeX
    const dx1 = DOOR.hingeX + DOOR.width
    const dh = DOOR.height
    // 左
    plane(dx0 - -hw, H, wall, (-hw + dx0) / 2, H / 2, -hd)
    // 右
    plane(hw - dx1, H, wall, (dx1 + hw) / 2, H / 2, -hd)
    // 上
    plane(dx1 - dx0, H - dh, wall, (dx0 + dx1) / 2, (H + dh) / 2, -hd)

    // 後壁
    plane(W, H, wall, 0, H / 2, hd, Math.PI)
    // 左壁
    plane(D, H, wall, -hw, H / 2, 0, Math.PI / 2)

    // 右壁(x=+hw, 窓あり)
    const wz0 = WINDOW_RECT.z0
    const wz1 = WINDOW_RECT.z1
    const wy0 = WINDOW_RECT.y0
    const wy1 = WINDOW_RECT.y1
    // 窓の前後・上下を分割
    plane(wz0 - -hd, H, wall, hw, H / 2, (-hd + wz0) / 2, -Math.PI / 2)
    plane(hd - wz1, H, wall, hw, H / 2, (wz1 + hd) / 2, -Math.PI / 2)
    plane(wz1 - wz0, wy0, wall, hw, wy0 / 2, (wz0 + wz1) / 2, -Math.PI / 2)
    plane(wz1 - wz0, H - wy1, wall, hw, (H + wy1) / 2, (wz0 + wz1) / 2, -Math.PI / 2)

    // ドア枠
    const frameMat = woodDarkMat()
    const frame = (w: number, h: number, d: number, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), frameMat)
      m.position.set(x, y, z)
      m.castShadow = true
      m.receiveShadow = true
      this.group.add(m)
    }
    frame(0.06, dh + 0.06, T, dx0 - 0.03, dh / 2, -hd)
    frame(0.06, dh + 0.06, T, dx1 + 0.03, dh / 2, -hd)
    frame(dx1 - dx0 + 0.12, 0.06, T, (dx0 + dx1) / 2, dh + 0.03, -hd)

    // 窓枠+ガラス
    const wcx = hw
    const wg = new THREE.Mesh(
      new THREE.PlaneGeometry(wz1 - wz0, wy1 - wy0),
      new THREE.MeshStandardMaterial({
        color: 0xcfe8ea,
        transparent: true,
        opacity: 0.18,
        roughness: 0.05,
        metalness: 0.1,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    )
    wg.position.set(wcx, (wy0 + wy1) / 2, (wz0 + wz1) / 2)
    wg.rotation.y = -Math.PI / 2
    wg.renderOrder = 5
    this.group.add(wg)
    const wf = (w: number, h: number, y: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, h, w), frameMat)
      m.position.set(wcx, y, z)
      this.group.add(m)
    }
    wf(wz1 - wz0 + 0.1, 0.05, wy0 - 0.025, (wz0 + wz1) / 2)
    wf(wz1 - wz0 + 0.1, 0.05, wy1 + 0.025, (wz0 + wz1) / 2)
    wf(0.05, wy1 - wy0 + 0.1, (wy0 + wy1) / 2, wz0 - 0.025)
    wf(0.05, wy1 - wy0 + 0.1, (wy0 + wy1) / 2, wz1 + 0.025)
    // 窓の中桟
    wf(0.03, wy1 - wy0, (wy0 + wy1) / 2, (wz0 + wz1) / 2)

    // ---- 建築ディテール(巾木・廻り縁・ケーシング) ----
    // 1メッシュに結合してドローコールを抑える
    const trims: THREE.BufferGeometry[] = []
    const trim = (w: number, h: number, d: number, x: number, y: number, z: number) => {
      trims.push(new THREE.BoxGeometry(w, h, d).translate(x, y, z))
    }
    const bbH = 0.09
    const bbT = 0.018
    // 巾木(ドア開口を避ける)
    trim(dx0 + hw, bbH, bbT, (-hw + dx0) / 2, bbH / 2, -hd + bbT / 2)
    trim(hw - dx1, bbH, bbT, (dx1 + hw) / 2, bbH / 2, -hd + bbT / 2)
    trim(W, bbH, bbT, 0, bbH / 2, hd - bbT / 2)
    trim(bbT, bbH, D, -hw + bbT / 2, bbH / 2, 0)
    trim(bbT, bbH, D, hw - bbT / 2, bbH / 2, 0)
    // 廻り縁
    const cmH = 0.05
    const cmT = 0.02
    trim(W, cmH, cmT, 0, H - cmH / 2, -hd + cmT / 2)
    trim(W, cmH, cmT, 0, H - cmH / 2, hd - cmT / 2)
    trim(cmT, cmH, D, -hw + cmT / 2, H - cmH / 2, 0)
    trim(cmT, cmH, D, hw - cmT / 2, H - cmH / 2, 0)
    // ドアケーシング(枠の外側の平板)
    const caW = 0.09
    const caT = 0.022
    trim(caW, dh + caW, caT, dx0 - 0.06 - caW / 2 + 0.06, (dh + caW) / 2, -hd + caT / 2)
    trim(caW, dh + caW, caT, dx1 + 0.06 + caW / 2 - 0.06, (dh + caW) / 2, -hd + caT / 2)
    trim(dx1 - dx0 + 0.12 + caW * 2, caW, caT, (dx0 + dx1) / 2, dh + 0.06 + caW / 2, -hd + caT / 2)
    // 窓ケーシング+窓台
    trim(caT, wy1 - wy0 + caW * 2, caW, hw - caT / 2, (wy0 + wy1) / 2, wz0 - 0.05 - caW / 2 + 0.05)
    trim(caT, wy1 - wy0 + caW * 2, caW, hw - caT / 2, (wy0 + wy1) / 2, wz1 + 0.05 + caW / 2 - 0.05)
    trim(caT, caW, wz1 - wz0 + 0.1 + caW * 2, hw - caT / 2, wy1 + 0.05 + caW / 2, (wz0 + wz1) / 2)
    trim(0.07, 0.03, wz1 - wz0 + 0.2, hw - 0.045, wy0 - 0.04, (wz0 + wz1) / 2)
    const trimMat = makeWettable(
      new THREE.MeshStandardMaterial({ color: 0xf4f2ec, roughness: 0.35, metalness: 0.05 })
    )
    const trimMesh = new THREE.Mesh(mergeGeometries(trims), trimMat)
    trimMesh.castShadow = true
    trimMesh.receiveShadow = true
    this.group.add(trimMesh)

    // ---- カーテン(窓の両脇、波形を焼き込んだ静的メッシュ) ----
    const curtainMat = makeWettable(
      new THREE.MeshStandardMaterial({
        map: fabricTexture(142, 152, 168),
        roughness: 1,
        metalness: 0,
        side: THREE.DoubleSide,
      })
    )
    for (const side of [-1, 1]) {
      const cg = new THREE.PlaneGeometry(0.42, wy1 - wy0 + 0.5, 16, 8)
      const pos = cg.getAttribute('position') as THREE.BufferAttribute
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i)
        pos.setZ(i, 0.045 * Math.sin(x * 34) + 0.025 * Math.sin(x * 15 + 1.7))
      }
      cg.computeVertexNormals()
      const cm = new THREE.Mesh(cg, curtainMat)
      cm.position.set(
        hw - 0.1,
        (wy0 + wy1) / 2 + 0.12,
        side > 0 ? wz1 + 0.12 : wz0 - 0.12
      )
      cm.rotation.y = -Math.PI / 2
      cm.castShadow = true
      this.decorRight.add(cm)
    }
    // カーテンレール
    const rail = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, wz1 - wz0 + 0.55, 8),
      woodDarkMat()
    )
    rail.rotation.x = Math.PI / 2
    rail.position.set(hw - 0.1, wy1 + 0.28, (wz0 + wz1) / 2)
    this.decorRight.add(rail)

    // ---- ラグ(テーブル下) ----
    const rug = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.014, 1.25), rugMat())
    rug.position.set(0.6, 0.007, 0.55)
    rug.rotation.y = 0.08
    rug.receiveShadow = true
    this.group.add(rug)

    // ---- 額縁 ----
    const framePic = (
      w: number,
      h: number,
      x: number,
      y: number,
      z: number,
      ry: number,
      seed: number
    ) => {
      const g = new THREE.Group()
      const fr = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.03), woodDarkMat())
      fr.castShadow = true
      g.add(fr)
      const pic = new THREE.Mesh(
        new THREE.PlaneGeometry(w - 0.07, h - 0.07),
        new THREE.MeshStandardMaterial({ map: paintingTexture(seed), roughness: 0.85 })
      )
      pic.position.z = 0.017
      g.add(pic)
      g.position.set(x, y, z)
      g.rotation.y = ry
      return g
    }
    this.decorBack.add(framePic(0.52, 0.68, -0.85, 1.5, hd - 0.03, Math.PI, 0))
    this.decorLeft.add(framePic(0.62, 0.46, -hw + 0.03, 1.5, 0.65, Math.PI / 2, 1))
    this.group.add(this.decorBack, this.decorLeft, this.decorRight)

    // ---- シーリングローズ(照明の根本) ----
    const rose = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.025, 24), whiteMat())
    rose.position.set(0, H - 0.012, 0.25)
    this.group.add(rose)

    // ---- コライダー ----
    // 床・天井
    physics.addStaticBox(0, -0.1, 0, hw + 0.5, 0.1, hd + 0.5)
    physics.addStaticBox(0, H + 0.1, 0, hw + 0.5, 0.1, hd + 0.5)
    // 前壁(ドア開口を避けて3分割)
    const zc = -hd - T / 2
    physics.addStaticBox((-hw + dx0) / 2, H / 2, zc, (dx0 + hw) / 2, H / 2, T / 2)
    physics.addStaticBox((dx1 + hw) / 2, H / 2, zc, (hw - dx1) / 2, H / 2, T / 2)
    physics.addStaticBox((dx0 + dx1) / 2, (H + dh) / 2, zc, (dx1 - dx0) / 2, (H - dh) / 2, T / 2)
    // 後壁・左壁・右壁(窓はガラスで塞がっている扱い)
    physics.addStaticBox(0, H / 2, hd + T / 2, hw, H / 2, T / 2)
    physics.addStaticBox(-hw - T / 2, H / 2, 0, T / 2, H / 2, hd)
    physics.addStaticBox(hw + T / 2, H / 2, 0, T / 2, H / 2, hd)
  }

  /** カメラが壁の外にあるとき、その壁の装飾を隠す */
  updateCulling(camPos: THREE.Vector3): void {
    this.decorBack.visible = camPos.z < ROOM.depth / 2 + 0.05
    this.decorLeft.visible = camPos.x > -ROOM.width / 2 - 0.05
    this.decorRight.visible = camPos.x < ROOM.width / 2 + 0.05
  }
}
