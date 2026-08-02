import { kidsRoom } from './rooms/kids.js';
import { bedroomRoom } from './rooms/bedroom.js';
import { livingRoom } from './rooms/living.js';
import { kitchenRoom } from './rooms/kitchen.js';

/** 部屋の並び順（左右矢印はこの順で巡回） */
export const ROOMS = [kidsRoom, bedroomRoom, livingRoom, kitchenRoom];

export function getRoom(id) {
  return ROOMS.find((r) => r.id === id) ?? ROOMS[0];
}
