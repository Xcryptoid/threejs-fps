// Bots: two Vanguard allies push the sites with the player, five Sentinels hold them.
// Each bot thinks ten times a second (staggered), walks a waypoint graph, sees with a
// field-of-view cone plus a line-of-sight test, hears gunfire, and shoots in bursts with
// a reaction delay. When the charge is planted the nearest living Sentinel goes to defuse
// it and the allies fall back to guard the site.
import * as THREE from 'three';
import { collideCircle, losBlocked } from './world.js';
import { WEAPONS, createWeaponState, stepWeapon, weaponSpread, damageFalloff, resolveShot } from './weapons.js';
import { range } from './rng.js';

const FOV = 1.15; // half-angle of a bot's vision cone, ~66 degrees.
const SIGHT_RANGE = 42;
const HEAR_RANGE = 28;

export function nearestNode(waypoints, x, z) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < waypoints.length; i++) {
    const dx = waypoints[i].x - x;
    const dz = waypoints[i].z - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** BFS over the waypoint graph; returns the node list from `from` to `to`. */
export function findPath(edges, from, to) {
  if (from === to) return [to];
  const prev = new Array(64).fill(-1);
  const queue = [from];
  prev[from] = from;
  while (queue.length) {
    const cur = queue.shift();
    if (cur === to) break;
    for (const [a, b] of edges) {
      const next = a === cur ? b : b === cur ? a : -1;
      if (next !== -1 && prev[next] === -1) {
        prev[next] = cur;
        queue.push(next);
      }
    }
  }
  if (prev[to] === -1) return [to];
  const path = [];
  let cur = to;
  while (cur !== from) {
    path.unshift(cur);
    cur = prev[cur];
  }
  return path;
}

function makeMesh(scene, bot) {
  const color = bot.team === 'V' ? 0xe8862e : 0x6b93b8;
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x23211f, roughness: 0.8 });
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.05, 0.32), mat);
  body.position.y = 0.95;
  body.userData = { actor: bot, part: 'body' };
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.32, 0.32), dark);
  head.position.y = 1.68;
  head.userData = { actor: bot, part: 'head' };
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.7), dark);
  gun.position.set(0.25, 1.15, -0.35);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.08, 0.05), new THREE.MeshBasicMaterial({ color: 0xf2ead9 }));
  visor.position.set(0, 1.7, -0.17);
  group.add(body, head, gun, visor);
  group.position.set(bot.x, 0, bot.z);
  group.traverse((o) => {
    o.castShadow = true;
  });
  scene.add(group);
  bot.mesh = group;
  bot.bodyMesh = body;
  bot.headMesh = head;
}

export function createBot(id, name, team, x, z, yaw, weaponId, homeNode) {
  return {
    id, name, team, x, z, y: 0, yaw, pitch: 0,
    hp: 100, alive: true,
    weapon: createWeaponState(weaponId),
    state: 'hold',
    homeNode, goalNode: homeNode, path: [], pathI: 0,
    target: null, lastSeen: null, lastHeard: null,
    reactT: 0, burstLeft: 0, burstT: 0, pauseT: 0,
    thinkT: (id.charCodeAt(1) % 5) * 0.024,
    aimYaw: yaw, strafeDir: 1, strafeT: 0,
    defuseT: 0, siteGoal: null, speed: weaponId === 'shotgun' ? 3.0 : weaponId === 'smg' ? 3.8 : 3.4,
    mesh: null, bodyMesh: null, headMesh: null,
  };
}

export function spawnBots(S, scene, world) {
  const allies = [
    createBot('v1', 'Rook', 'V', world.spawns.attack[1].x, world.spawns.attack[1].z, 0, 'rifle', 7),
    createBot('v2', 'Havoc', 'V', world.spawns.attack[2].x, world.spawns.attack[2].z, 0, 'smg', 12),
  ];
  const enemies = [
    createBot('s1', 'Bastion', 'S', world.spawns.defendA[0].x, world.spawns.defendA[0].z, 0, 'rifle', 17),
    createBot('s2', 'Warden', 'S', world.spawns.defendA[1].x, world.spawns.defendA[1].z, 0, 'smg', 18),
    createBot('s3', 'Fable', 'S', world.spawns.defendB[0].x, world.spawns.defendB[0].z, 0, 'rifle', 19),
    createBot('s4', 'Onyx', 'S', world.spawns.defendB[1].x, world.spawns.defendB[1].z, 0, 'shotgun', 20),
    createBot('s5', 'Sable', 'S', world.spawns.defendMid[0].x, world.spawns.defendMid[0].z, 0, 'smg', 20),
  ];
  for (const b of [...allies, ...enemies]) makeMesh(scene, b);
  S.allies = allies;
  S.enemies = enemies;
  return { allies, enemies };
}

export function resetBot(bot, x, z, yaw, homeNode) {
  bot.x = x;
  bot.z = z;
  bot.yaw = yaw;
  bot.aimYaw = yaw;
  bot.hp = 100;
  bot.alive = true;
  bot.state = 'hold';
  bot.homeNode = homeNode;
  bot.goalNode = homeNode;
  bot.path = [];
  bot.pathI = 0;
  bot.target = null;
  bot.lastSeen = null;
  bot.lastHeard = null;
  bot.burstLeft = 0;
  bot.defuseT = 0;
  bot.siteGoal = null;
  bot.weapon = createWeaponState(bot.weapon.id);
  if (bot.mesh) {
    bot.mesh.visible = true;
    bot.mesh.rotation.set(0, 0, 0);
    bot.mesh.position.set(x, 0, z);
  }
}

function canSee(bot, target, world) {
  if (!target.alive) return false;
  const dx = target.x - bot.x;
  const dz = target.z - bot.z;
  const dist = Math.hypot(dx, dz);
  if (dist > SIGHT_RANGE) return false;
  const want = Math.atan2(-dx, -dz);
  let diff = want - bot.yaw;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  if (Math.abs(diff) > FOV) return false;
  return !losBlocked(bot.x, bot.z, target.x, target.z, world.colliders);
}

function nearestVisibleEnemy(S, bot, world, foes) {
  let best = null;
  let bestD = Infinity;
  for (const f of foes) {
    if (!f.alive) continue;
    const d = Math.hypot(f.x - bot.x, f.z - bot.z);
    if (d < bestD && canSee(bot, f, world)) {
      best = f;
      bestD = d;
    }
  }
  return best;
}

function setPath(bot, world, node) {
  const from = nearestNode(world.waypoints, bot.x, bot.z);
  bot.path = findPath(world.edges, from, node);
  bot.pathI = 0;
  bot.goalNode = node;
}

function followPath(bot, world, dt) {
  if (bot.pathI >= bot.path.length) return true;
  const node = world.waypoints[bot.path[bot.pathI]];
  const dx = node.x - bot.x;
  const dz = node.z - bot.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.5) {
    bot.pathI += 1;
    return bot.pathI >= bot.path.length;
  }
  const step = bot.speed * dt;
  bot.x += (dx / d) * step;
  bot.z += (dz / d) * step;
  bot.yaw = Math.atan2(-dx, -dz);
  return false;
}

export function hearShot(S, x, z, shooterTeam) {
  for (const bot of [...S.allies, ...S.enemies]) {
    if (!bot.alive || bot.team === shooterTeam) continue;
    const d = Math.hypot(bot.x - x, bot.z - z);
    if (d < HEAR_RANGE && (bot.state === 'hold' || bot.state === 'patrol')) {
      bot.lastHeard = { x, z, t: S.time };
      if (bot.state === 'hold') bot.state = 'seek';
    }
  }
}

/** One fixed step for every bot. `hooks` carries the sim's damage + shot plumbing. */
export function stepBots(S, world, dt, raycaster, shootables, hooks) {
  const all = [...S.allies, ...S.enemies];
  for (const bot of all) {
    if (!bot.alive) continue;
    stepWeapon(bot.weapon, dt);
    bot.thinkT -= dt;
    const foes = bot.team === 'V' ? S.enemies : [S.player, ...S.allies];
    if (bot.thinkT <= 0) {
      bot.thinkT = 0.12;
      think(S, bot, world, foes);
    }
    act(S, bot, world, dt, raycaster, shootables, hooks);
    // Keep the mesh on the bot.
    if (bot.mesh) {
      bot.mesh.position.set(bot.x, 0, bot.z);
      bot.mesh.rotation.y = bot.yaw;
    }
  }
}

function think(S, bot, world, foes) {
  const seen = nearestVisibleEnemy(S, bot, world, foes);
  if (seen) {
    if (bot.target !== seen) bot.reactT = range(S.random, 0.3, 0.5);
    bot.target = seen;
    bot.lastSeen = { x: seen.x, z: seen.z, t: S.time };
    bot.state = 'engage';
    return;
  }
  if (bot.state === 'engage') {
    // Lost sight: keep the last known spot for a while, then give up.
    if (bot.lastSeen && S.time - bot.lastSeen.t < 2.5) bot.state = 'seek';
    else {
      bot.target = null;
      bot.state = bot.team === 'S' ? 'hold' : 'patrol';
    }
  }
  if (S.charge.state === 'planted') {
    if (bot.team === 'S' && bot.state !== 'engage') {
      // The nearest living Sentinel goes for the defuse; the rest hold the site.
      const defuser = nearestDefuser(S);
      bot.state = defuser === bot ? 'defuse' : 'guard';
    } else if (bot.team === 'V' && bot.state !== 'engage') {
      bot.state = 'guard';
    }
  }
}

function nearestDefuser(S) {
  let best = null;
  let bestD = Infinity;
  for (const b of S.enemies) {
    if (!b.alive) continue;
    const d = Math.hypot(b.x - S.charge.x, b.z - S.charge.z);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}

function act(S, bot, world, dt, raycaster, shootables, hooks) {
  const charge = S.charge;
  if (bot.state === 'engage' && bot.target && bot.target.alive) {
    const t = bot.target;
    const dx = t.x - bot.x;
    const dz = t.z - bot.z;
    const dist = Math.hypot(dx, dz);
    bot.yaw = Math.atan2(-dx, -dz);
    // Strafe sideways and hold a fighting distance.
    bot.strafeT -= dt;
    if (bot.strafeT <= 0) {
      bot.strafeT = range(S.random, 0.5, 1.1);
      bot.strafeDir = S.random() < 0.5 ? -1 : 1;
    }
    let mx = 0;
    let mz = 0;
    if (dist > 20) {
      mx = -Math.sin(bot.yaw);
      mz = -Math.cos(bot.yaw);
    } else if (dist < 7) {
      mx = Math.sin(bot.yaw);
      mz = Math.cos(bot.yaw);
    }
    const px = Math.cos(bot.yaw) * bot.strafeDir;
    const pz = -Math.sin(bot.yaw) * bot.strafeDir;
    bot.x += (mx * 0.6 + px * 0.8) * bot.speed * 0.5 * dt;
    bot.z += (mz * 0.6 + pz * 0.8) * bot.speed * 0.5 * dt;
    collideCircle(bot, 0.4, world.colliders);
    // Fire in bursts once the reaction delay has passed.
    bot.reactT -= dt;
    if (bot.reactT <= 0) {
      if (bot.burstLeft > 0) {
        bot.burstT -= dt;
        if (bot.burstT <= 0 && bot.weapon.cooldown <= 0 && !bot.weapon.reloading) {
          bot.burstT = 60 / WEAPONS[bot.weapon.id].rpm;
          botFire(S, bot, world, raycaster, shootables, hooks);
          bot.burstLeft -= 1;
        }
      } else {
        bot.pauseT -= dt;
        if (bot.pauseT <= 0) {
          bot.burstLeft = 3 + Math.floor(S.random() * 3);
          bot.pauseT = range(S.random, 0.5, 0.9);
          if (bot.weapon.mag === 0) {
            bot.weapon.reloading = true;
            bot.weapon.reloadT = WEAPONS[bot.weapon.id].reloadTime;
          }
        }
      }
    }
    return;
  }
  if (bot.state === 'defuse') {
    const d = Math.hypot(charge.x - bot.x, charge.z - bot.z);
    if (d > 2) {
      setPathIfNeeded(bot, world, nearestNode(world.waypoints, charge.x, charge.z));
      followPath(bot, world, dt);
      collideCircle(bot, 0.4, world.colliders);
    } else {
      bot.yaw = Math.atan2(-(charge.x - bot.x), -(charge.z - bot.z));
      charge.defuseT += dt;
      charge.defuser = bot;
      if (charge.defuseT >= 5) hooks.onDefused(bot);
    }
    return;
  }
  if (bot.state === 'guard' && charge.state === 'planted') {
    const site = charge.site === 'A' ? world.sites.A : world.sites.B;
    const d = Math.hypot(site.cx - bot.x, site.cz - bot.z);
    if (d > 4) {
      setPathIfNeeded(bot, world, nearestNode(world.waypoints, site.cx, site.cz));
      followPath(bot, world, dt);
      collideCircle(bot, 0.4, world.colliders);
    } else {
      bot.yaw += dt * 0.6;
    }
    return;
  }
  if (bot.state === 'seek' && bot.lastSeen) {
    const arrived = followPath(bot, world, dt);
    collideCircle(bot, 0.4, world.colliders);
    if (arrived || (bot.lastHeard && S.time - bot.lastHeard.t > 4)) {
      bot.state = bot.team === 'S' ? 'hold' : 'patrol';
      bot.lastHeard = null;
    }
    return;
  }
  if (bot.state === 'seek' && bot.lastHeard) {
    setPathIfNeeded(bot, world, nearestNode(world.waypoints, bot.lastHeard.x, bot.lastHeard.z));
    followPath(bot, world, dt);
    collideCircle(bot, 0.4, world.colliders);
    return;
  }
  if (bot.team === 'V' && (bot.state === 'patrol' || bot.state === 'hold')) {
    // Allies push the site they were assigned at round start.
    const goal = bot.siteGoal ?? bot.homeNode;
    if (bot.goalNode !== goal || bot.pathI >= bot.path.length) {
      setPath(bot, world, goal);
    }
    const arrived = followPath(bot, world, dt);
    collideCircle(bot, 0.4, world.colliders);
    if (arrived) bot.state = 'hold';
    return;
  }
  // Sentinels hold: scan slowly.
  bot.yaw += dt * 0.25;
}

function setPathIfNeeded(bot, world, node) {
  if (bot.goalNode !== node || bot.pathI >= bot.path.length) setPath(bot, world, node);
}

/** Ray-sphere test; returns the distance along the ray or Infinity. */
function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox;
  const ly = cy - oy;
  const lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return Infinity;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return Infinity;
  return tca - Math.sqrt(r2 - d2);
}

function botFire(S, bot, world, raycaster, shootables, hooks) {
  const def = WEAPONS[bot.weapon.id];
  if (bot.weapon.mag <= 0) return;
  bot.weapon.mag -= 1;
  bot.weapon.cooldown = 60 / def.rpm;
  const t = bot.target;
  const dist = Math.hypot(t.x - bot.x, t.z - bot.z);
  const spread = weaponSpread(def, 0.4, false, true, 0) + 0.025 + dist * 0.0015;
  const origin = new THREE.Vector3(bot.x, 1.45, bot.z);
  const aimX = t.x - bot.x;
  const aimY = (t.y + 1.3) - 1.45;
  const aimZ = t.z - bot.z;
  const len = Math.hypot(aimX, aimY, aimZ) || 1;
  const dir = new THREE.Vector3(
    aimX / len + (S.random() * 2 - 1) * spread,
    aimY / len + (S.random() * 2 - 1) * spread,
    aimZ / len + (S.random() * 2 - 1) * spread,
  ).normalize();
  const hit = resolveShot(raycaster, origin, dir, 80, shootables);
  const meshDist = hit ? hit.dist : Infinity;
  const muzzle = new THREE.Vector3(bot.x - Math.sin(bot.yaw) * 0.5, 1.4, bot.z - Math.cos(bot.yaw) * 0.5);
  hooks.onBotShot(bot, muzzle, hit ? hit.point : origin.clone().add(dir.clone().multiplyScalar(40)));
  // The player has no hit mesh, so test the ray against the player's two spheres.
  if (t === S.player) {
    const chest = raySphere(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, t.x, t.y + 1.1, t.z, 0.45);
    const head = raySphere(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, t.x, t.y + 1.55, t.z, 0.22);
    const playerDist = Math.min(chest, head);
    if (playerDist < meshDist) {
      const amount = Math.round(def.damage * damageFalloff(def, playerDist) * (head < chest ? def.headMult : 1) * 0.7);
      hooks.damageActor(t, amount, bot, head < chest);
      return;
    }
  }
  // A teammate in the line of fire blocks the shot but takes no damage.
  if (hit && hit.actor && hit.actor.team && hit.actor.team === bot.team) return;
  if (hit && hit.actor && hit.actor !== S.player) {
    const amount = Math.round(def.damage * damageFalloff(def, hit.dist) * (hit.part === 'head' ? def.headMult : 1) * 0.7);
    hooks.damageActor(hit.actor, amount, bot, hit.part === 'head');
  }
}
