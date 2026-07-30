// 部屋: 内向きの面だけを描く(ドールハウス方式)。カメラが壁の外に出ても
// 室内が見通せる。コライダーは壁厚のあるボックス。

import * as THREE from 'three'
import { PhysicsWorld } from '../physics/PhysicsWorld'
import { DOOR, ROOM } from '../sim/constants'
import { floorMat, wallMat, woodDarkMat, whiteMat } from '../gfx/materials'

export const WINDOW_RECT = { z0: -0.55, z1: 0.75, y0: 0.9, y1: 1.9 } // +x壁

export class Room {
  group = new THREE.Group()

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
}
