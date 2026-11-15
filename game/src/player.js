// The player: acceleration-based movement with crouch and jump, AABB collision against
// the map, recoil that kicks the view and recovers. One object, no per-frame allocation.
import { collideCircle } from './world.js';

const EYE_STAND = 1.62;
const EYE_CROUCH = 1.15;
const RADIUS = 0.4;
const WALK = 4.2;
const CROUCH_SPEED = 2.2;
const SPRINT = 5.6;
const ACCEL = 42;
const FRICTION = 10;
const GRAVITY = -18;
const JUMP_V = 6.4;

export function createPlayer(x, z, yaw) {
  return {
    x, z, y: 0, vy: 0,
    vx: 0, vz: 0,
    yaw, pitch: 0,
    eye: EYE_STAND,
    crouch: false,
    onGround: true,
    hp: 100,
    alive: true,
    recoilPitch: 0,
    recoilYaw: 0,
    speed2d: 0,
    moveAmount: 0, // 0..1, how much the player is moving (drives spread)
  };
}

export function resetPlayer(p, x, z, yaw) {
  p.x = x;
  p.z = z;
  p.y = 0;
  p.vy = 0;
  p.vx = 0;
  p.vz = 0;
  p.yaw = yaw;
  p.pitch = 0;
  p.eye = EYE_STAND;
  p.crouch = false;
  p.onGround = true;
  p.hp = 100;
  p.alive = true;
  p.recoilPitch = 0;
  p.recoilYaw = 0;
  p.speed2d = 0;
  p.moveAmount = 0;
}

export function applyRecoil(p, pitchKick, yawKick) {
  p.recoilPitch += pitchKick;
  p.recoilYaw += yawKick;
}

export function look(p, dx, dy) {
  p.yaw -= dx * 0.0021;
  p.pitch -= dy * 0.0021;
  const limit = 1.53;
  if (p.pitch > limit) p.pitch = limit;
  if (p.pitch < -limit) p.pitch = -limit;
}

// One fixed step of movement. `keys` is the input Set; `wantSprint` needs Shift held.
export function stepPlayer(p, dt, keys, colliders) {
  if (!p.alive) return;
  const fwdX = -Math.sin(p.yaw);
  const fwdZ = -Math.cos(p.yaw);
  const rightX = Math.cos(p.yaw);
  const rightZ = -Math.sin(p.yaw);
  let ix = 0;
  let iz = 0;
  if (keys.has('KeyW')) {
    ix += fwdX;
    iz += fwdZ;
  }
  if (keys.has('KeyS')) {
    ix -= fwdX;
    iz -= fwdZ;
  }
  if (keys.has('KeyD')) {
    ix += rightX;
    iz += rightZ;
  }
  if (keys.has('KeyA')) {
    ix -= rightX;
    iz -= rightZ;
  }
  const len = Math.hypot(ix, iz);
  if (len > 0) {
    ix /= len;
    iz /= len;
  }
  p.crouch = keys.has('ControlLeft') || keys.has('KeyC');
  const sprint = keys.has('ShiftLeft') && !p.crouch && keys.has('KeyW');
  const speed = p.crouch ? CROUCH_SPEED : sprint ? SPRINT : WALK;
  p.vx += ix * ACCEL * dt;
  p.vz += iz * ACCEL * dt;
  // Friction pulls velocity toward the wanted speed instead of snapping it.
  const wantX = ix * speed;
  const wantZ = iz * speed;
  const k = Math.min(1, FRICTION * dt);
  p.vx += (wantX - p.vx) * k;
  p.vz += (wantZ - p.vz) * k;
  p.x += p.vx * dt;
  p.z += p.vz * dt;
  collideCircle(p, RADIUS, colliders);
  // Vertical: jump and gravity, ground is y = 0.
  if (keys.has('Space') && p.onGround) {
    p.vy = JUMP_V;
    p.onGround = false;
  }
  p.vy += GRAVITY * dt;
  p.y += p.vy * dt;
  if (p.y <= 0) {
    p.y = 0;
    p.vy = 0;
    p.onGround = true;
  }
  // Eye height eases between stand and crouch.
  const targetEye = p.crouch ? EYE_CROUCH : EYE_STAND;
  p.eye += (targetEye - p.eye) * Math.min(1, 12 * dt);
  p.speed2d = Math.hypot(p.vx, p.vz);
  p.moveAmount = Math.min(1, p.speed2d / WALK);
  // Recoil recovers toward zero; the view adds recoil on top of pitch/yaw.
  p.recoilPitch *= Math.max(0, 1 - 7 * dt);
  p.recoilYaw *= Math.max(0, 1 - 7 * dt);
}
