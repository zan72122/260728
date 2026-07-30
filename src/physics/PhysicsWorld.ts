import RAPIER from '@dimforge/rapier3d-compat'
import { DT } from '../sim/constants'

export const GROUP_STATIC = 0x0001
export const GROUP_DOOR = 0x0002
export const GROUP_PROP = 0x0004
export const GROUP_CHAR = 0x0008

export function groups(membership: number, filter: number): number {
  return (membership << 16) | filter
}

export class PhysicsWorld {
  world: RAPIER.World

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
    this.world.timestep = DT
  }

  step(): void {
    this.world.step()
  }

  addStaticBox(
    cx: number,
    cy: number,
    cz: number,
    hx: number,
    hy: number,
    hz: number
  ): RAPIER.Collider {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(cx, cy, cz))
    const col = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz).setCollisionGroups(
        groups(GROUP_STATIC, GROUP_DOOR | GROUP_PROP | GROUP_CHAR)
      ),
      body
    )
    return col
  }
}
