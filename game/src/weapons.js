// Weapons: four guns and a frag grenade. Hits are hitscan against the map and the actors'
// hit meshes; damage falls off with distance and doubles on a headshot. The viewmodel is
// a small set of boxes parented to the camera, kicked back on every shot.
import * as THREE from 'three';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P12 Sidearm', kind: 'pistol', damage: 26, headMult: 2,
    rpm: 320, auto: false, mag: 12, reserve: 48, reloadTime: 1.1,
    spread: 0.012, kick: 0.009, price: 0, pellets: 1,
  },
  smg: {
    id: 'smg', name: 'Kestrel SMG', kind: 'smg', damage: 22, headMult: 2,
    rpm: 750, auto: true, mag: 28, reserve: 84, reloadTime: 1.9,
    spread: 0.02, kick: 0.006, price: 1500, pellets: 1,
  },
  rifle: {
    id: 'rifle', name: 'VK-9 Rifle', kind: 'rifle', damage: 34, headMult: 2,
    rpm: 600, auto: true, mag: 30, reserve: 90, reloadTime: 2.2,
    spread: 0.011, kick: 0.011, price: 2700, pellets: 1,
  },
  shotgun: {
    id: 'shotgun', name: 'M870 Scatter', kind: 'shotgun', damage: 12, headMult: 2,
    rpm: 70, auto: false, mag: 6, reserve: 24, reloadTime: 2.6,
    spread: 0.05, kick: 0.03, price: 1700, pellets: 8,
  },
};

export const GRENADE_PRICE = 300;
export const GRENADE_MAX = 2;

export function createWeaponState(id) {
  const def = WEAPONS[id];
  return { id, mag: def.mag, reserve: def.reserve, cooldown: 0, reloading: false, reloadT: 0, bloom: 0 };
}

export function refillWeapon(ws) {
  const def = WEAPONS[ws.id];
  ws.mag = def.mag;
  ws.reserve = def.reserve;
  ws.reloading = false;
  ws.reloadT = 0;
  ws.cooldown = 0;
  ws.bloom = 0;
}

export function startReload(ws) {
  const def = WEAPONS[ws.id];
  if (ws.reloading || ws.mag === def.mag || ws.reserve <= 0) return false;
  ws.reloading = true;
  ws.reloadT = def.reloadTime;
  return true;
}

export function stepWeapon(ws, dt) {
  ws.cooldown = Math.max(0, ws.cooldown - dt);
  ws.bloom = Math.max(0, ws.bloom - dt * 0.05);
  if (ws.reloading) {
    ws.reloadT -= dt;
    if (ws.reloadT <= 0) {
      const def = WEAPONS[ws.id];
      const need = def.mag - ws.mag;
      const take = Math.min(need, ws.reserve);
      ws.mag += take;
      ws.reserve -= take;
      ws.reloading = false;
    }
  }
}

/** Spread in radians: base, widened by movement and air, narrowed by crouch, plus bloom. */
export function weaponSpread(def, moveAmount, crouch, onGround, bloom) {
  let s = def.spread;
  if (!onGround) s *= 2.5;
  else if (moveAmount > 0.05) s *= 1 + moveAmount * 0.9;
  if (crouch) s *= 0.7;
  return s + bloom;
}

export function damageFalloff(def, dist) {
  if (dist < 15) return 1;
  if (dist < 30) return 0.85;
  return 0.65;
}

// --- Hitscan ---------------------------------------------------------------

/**
 * Cast one pellet. `targets` is the flat list of meshes to test (map + actor hit meshes).
 * Returns null, or { point, dist, actor, part } where actor is the bot/player object the
 * mesh belongs to (from mesh.userData) and part is 'head' or 'body'.
 */
export function resolveShot(raycaster, origin, dir, maxDist, targets) {
  raycaster.set(origin, dir);
  raycaster.far = maxDist;
  const hits = raycaster.intersectObjects(targets, false);
  if (!hits.length) return null;
  const hit = hits[0];
  const ud = hit.object.userData;
  return {
    point: hit.point,
    dist: hit.distance,
    actor: ud.actor ?? null,
    part: ud.part ?? 'body',
  };
}

// --- Viewmodel -------------------------------------------------------------

export function buildViewmodel(camera) {
  const group = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x3a352f, roughness: 0.5, metalness: 0.5 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xe8862e, roughness: 0.4, metalness: 0.3 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.55), dark);
  body.position.set(0, -0.02, -0.1);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.3), dark);
  barrel.position.set(0, 0.01, -0.48);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.08), accent);
  sight.position.set(0, 0.07, -0.25);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.1), dark);
  grip.position.set(0, -0.12, 0.08);
  grip.rotation.x = 0.3;
  group.add(body, barrel, sight, grip);
  group.position.set(0.28, -0.24, -0.45);
  camera.add(group);
  let kick = 0;
  return {
    group,
    kick(amount) {
      kick = Math.min(0.09, kick + amount);
    },
    setWeapon(kind) {
      // The shotgun reads longer and wider; the pistol shorter. One model, three stances.
      if (kind === 'shotgun') {
        body.scale.set(1.25, 1.15, 1.25);
        barrel.scale.set(1.3, 1.3, 1.2);
      } else if (kind === 'pistol') {
        body.scale.set(0.85, 0.9, 0.7);
        barrel.scale.set(0.9, 0.9, 0.6);
      } else {
        body.scale.set(1, 1, 1);
        barrel.scale.set(1, 1, 1);
      }
    },
    update(dt, moveAmount, bobPhase) {
      kick = Math.max(0, kick - dt * 0.5);
      const bob = Math.sin(bobPhase) * 0.008 * moveAmount;
      group.position.z = -0.45 + kick;
      group.position.y = -0.24 + bob;
    },
  };
}

// --- Grenades --------------------------------------------------------------

export function createGrenade(x, y, z, vx, vy, vz, owner) {
  return { x, y, z, vx, vy, vz, owner, fuse: 2.2, bounced: false, dead: false };
}

function pointInColliders(x, z, colliders, pad) {
  for (const c of colliders) {
    if (x > c.x0 - pad && x < c.x1 + pad && z > c.z0 - pad && z < c.z1 + pad) return true;
  }
  return false;
}

export function stepGrenade(g, dt, colliders) {
  g.vy -= 14 * dt;
  const nx = g.x + g.vx * dt;
  if (!pointInColliders(nx, g.z, colliders, 0.12)) g.x = nx;
  else g.vx *= -0.35;
  const nz = g.z + g.vz * dt;
  if (!pointInColliders(g.x, nz, colliders, 0.12)) g.z = nz;
  else g.vz *= -0.35;
  g.y += g.vy * dt;
  if (g.y <= 0.12) {
    g.y = 0.12;
    g.vy = Math.abs(g.vy) > 1.2 ? -g.vy * 0.4 : 0;
    g.vx *= 0.7;
    g.vz *= 0.7;
    g.bounced = true;
  }
  g.fuse -= dt;
  if (g.fuse <= 0) g.dead = true;
}

/** Radius damage with falloff; `damageActor(actor, amount, attacker)` is the sim's hook. */
export function explodeGrenade(g, actors, damageActor) {
  const R = 6.5;
  for (const a of actors) {
    if (!a.alive) continue;
    const dx = a.x - g.x;
    const dz = a.z - g.z;
    const dy = (a.y + 1) - g.y;
    const d = Math.hypot(dx, dy, dz);
    if (d > R) continue;
    const amount = Math.round(120 * (1 - (d / R) * 0.75));
    damageActor(a, amount, g.owner, false);
  }
}
