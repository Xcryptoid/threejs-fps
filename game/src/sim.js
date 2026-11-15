// The simulation: one fixed step owns the round flow (menu -> buy -> round -> round end),
// the player's shooting and planting, the bots' hooks, grenades, money and win checks.
// Rendering only reads this state; it never writes it.
import * as THREE from 'three';
import { ROUND_TIME, BUY_TIME, FUSE_TIME, PLANT_TIME, MATCH_WINS, feedLine, setBanner } from './state.js';
import { createPlayer, resetPlayer, stepPlayer, look, applyRecoil } from './player.js';
import { spawnBots, resetBot, stepBots, hearShot } from './bots.js';
import {
  WEAPONS, GRENADE_PRICE, GRENADE_MAX, createWeaponState, refillWeapon, startReload,
  stepWeapon, weaponSpread, damageFalloff, resolveShot, createGrenade, stepGrenade, explodeGrenade,
} from './weapons.js';
import { inSite } from './world.js';

const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _muzzle = new THREE.Vector3();

export function createSim(S, world, scene, audio, fx) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = 90;
  const sim = {
    S, world, scene, audio, fx, raycaster,
    shootables: [],
    prevKeys: new Set(),
    prevFiring: false,
    bobPhase: 0,
  };
  // Player + bots.
  S.player = createPlayer(world.spawns.attack[0].x, world.spawns.attack[0].z, 0);
  S.player.weapons = { pistol: createWeaponState('pistol'), primary: null };
  S.player.current = 'pistol';
  S.player.grenades = 0;
  spawnBots(S, scene, world);
  rebuildShootables(sim);
  return sim;
}

function rebuildShootables(sim) {
  const { S, world } = sim;
  const list = [...world.shootables];
  for (const b of [...S.allies, ...S.enemies]) {
    if (b.alive) list.push(b.bodyMesh, b.headMesh);
  }
  sim.shootables = list;
}

function currentWeapon(S) {
  const p = S.player;
  return p.current === 'primary' ? p.weapons.primary : p.weapons.pistol;
}

function switchWeapon(S, which, audio) {
  const p = S.player;
  if (which === 'primary' && !p.weapons.primary) return;
  if (p.current === which) return;
  p.current = which;
  audio.click();
}

export function initRound(sim, first) {
  const { S, world } = sim;
  S.phase = 'buy';
  S.phaseT = 0;
  S.roundTime = ROUND_TIME;
  S.charge = { state: 'carried', site: null, x: 0, z: 0, plantT: 0, fuseT: 0, defuseT: 0, defuser: null };
  S.grenades = [];
  S.tracers = [];
  S.plantChannel = 0;
  S.defuseChannel = 0;
  S.buyOpen = false;
  S.roundWinner = null;
  const p = S.player;
  resetPlayer(p, world.spawns.attack[0].x, world.spawns.attack[0].z, 0);
  refillWeapon(p.weapons.pistol);
  if (p.weapons.primary) refillWeapon(p.weapons.primary);
  p.current = p.weapons.primary ? 'primary' : 'pistol';
  const siteGoal = S.random() < 0.5 ? 11 : 16; // waypoint node at site A or B
  S.allies[0].siteGoal = siteGoal;
  S.allies[1].siteGoal = siteGoal;
  resetBot(S.allies[0], world.spawns.attack[1].x, world.spawns.attack[1].z, 0, 7);
  resetBot(S.allies[1], world.spawns.attack[2].x, world.spawns.attack[2].z, 0, 12);
  resetBot(S.enemies[0], world.spawns.defendA[0].x, world.spawns.defendA[0].z, 0, 17);
  resetBot(S.enemies[1], world.spawns.defendA[1].x, world.spawns.defendA[1].z, 0, 18);
  resetBot(S.enemies[2], world.spawns.defendB[0].x, world.spawns.defendB[0].z, 0, 19);
  resetBot(S.enemies[3], world.spawns.defendB[1].x, world.spawns.defendB[1].z, 0, 20);
  resetBot(S.enemies[4], world.spawns.defendMid[0].x, world.spawns.defendMid[0].z, 0, 20);
  rebuildShootables(sim);
  if (first) setBanner(S, 'EMBERLINE', 'Plant the charge at A or B — or eliminate the Sentinels.');
}

export function startMatch(sim) {
  const { S } = sim;
  S.round = 1;
  S.wins = { V: 0, S: 0 };
  S.kills = { V: 0, S: 0 };
  S.money = 800;
  S.feed = [];
  const p = S.player;
  p.weapons.primary = null;
  p.grenades = 0;
  initRound(sim, true);
}

function endRound(sim, winner, reason) {
  const { S, audio } = sim;
  if (S.phase !== 'round') return;
  S.phase = 'roundEnd';
  S.phaseT = 0;
  S.roundWinner = winner;
  S.wins[winner] += 1;
  const won = winner === 'V';
  S.money += won ? 3000 : 1400;
  setBanner(S, won ? 'ROUND WON' : 'ROUND LOST', reason);
  feedLine(S, `${won ? 'Vanguard' : 'Sentinels'} take round ${S.round} — ${reason}`);
  if (won) audio.win();
  else audio.lose();
}

function endMatch(sim) {
  const { S, audio } = sim;
  S.phase = 'matchEnd';
  S.phaseT = 0;
  S.matchWinner = S.wins.V >= MATCH_WINS ? 'V' : 'S';
  const won = S.matchWinner === 'V';
  setBanner(S, won ? 'MATCH WON' : 'MATCH LOST', `Vanguard ${S.wins.V} — ${S.wins.S} Sentinels`);
  if (won) audio.win();
  else audio.lose();
}

export function damageActor(sim, actor, amount, attacker, isHead) {
  const { S, audio, fx } = sim;
  if (!actor.alive) return;
  actor.hp -= amount;
  const isPlayer = actor === S.player;
  if (isPlayer) {
    S.lastHurtT = S.time;
    S.plantChannel = 0;
    audio.hurt();
  } else if (attacker === S.player) {
    S.stats.hits += 1;
    if (isHead) S.stats.headshots += 1;
    S.lastHit = { t: S.time, kill: false };
    audio.hit(false);
  }
  if (actor.hp > 0) return;
  actor.hp = 0;
  actor.alive = false;
  if (isPlayer) {
    S.player.deadT = S.time;
  } else {
    // Fall over and stop blocking shots.
    if (actor.mesh) {
      actor.mesh.rotation.x = -Math.PI / 2;
      actor.mesh.position.y = 0.25;
    }
    rebuildShootables(sim);
  }
  const attackerName = attacker === S.player ? 'You' : attacker.name;
  const victimName = isPlayer ? 'You' : actor.name;
  feedLine(S, `${attackerName} ▸ ${victimName}${isHead ? ' (headshot)' : ''}`);
  if (attacker && attacker.team) {
    S.kills[attacker.team] += 1;
    if (attacker.team === 'V') S.money += 300;
  }
  if (attacker === S.player) {
    S.lastHit = { t: S.time, kill: true };
    audio.hit(true);
  }
}

function playerShoot(sim) {
  const { S, world, audio, fx, raycaster } = sim;
  const p = S.player;
  const ws = currentWeapon(S);
  if (!ws || ws.cooldown > 0 || ws.reloading || ws.mag <= 0) {
    if (ws && ws.mag <= 0 && !ws.reloading) audio.dry();
    return;
  }
  const def = WEAPONS[ws.id];
  ws.mag -= 1;
  ws.cooldown = 60 / def.rpm;
  ws.bloom = Math.min(0.05, ws.bloom + 0.004);
  S.stats.shots += 1;
  // Direction from the view (including recoil) plus seeded spread.
  const pitch = p.pitch + p.recoilPitch;
  const yaw = p.yaw + p.recoilYaw;
  _fwd.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
  _origin.set(p.x, p.y + p.eye, p.z);
  const spread = weaponSpread(def, p.moveAmount, p.crouch, p.onGround, ws.bloom);
  _muzzle.copy(_origin).addScaledVector(_fwd, 0.6);
  _muzzle.x += Math.cos(yaw) * 0.22;
  _muzzle.z += -Math.sin(yaw) * 0.22;
  _muzzle.y -= 0.18;
  for (let pellet = 0; pellet < def.pellets; pellet++) {
    _dir.copy(_fwd);
    _dir.x += (S.random() * 2 - 1) * spread;
    _dir.y += (S.random() * 2 - 1) * spread;
    _dir.z += (S.random() * 2 - 1) * spread;
    _dir.normalize();
    const hit = resolveShot(raycaster, _origin, _dir, 90, sim.shootables);
    const end = hit ? hit.point : _origin.clone().addScaledVector(_dir, 40);
    fx.tracer(_muzzle, end);
    if (hit && hit.actor) {
      // No friendly fire: an ally in the way blocks the shot.
      if (hit.actor.team === 'V') {
        fx.impact(hit.point);
      } else {
        const amount = Math.round(def.damage * damageFalloff(def, hit.dist) * (hit.part === 'head' ? def.headMult : 1));
        damageActor(sim, hit.actor, amount, p, hit.part === 'head');
      }
    } else if (hit) {
      fx.impact(hit.point);
    }
  }
  applyRecoil(p, def.kick, (S.random() * 2 - 1) * def.kick * 0.4);
  fx.muzzleFlash(_muzzle);
  audio.shot(def.kind);
  hearShot(S, p.x, p.z, 'V');
}

function throwGrenade(sim) {
  const { S, audio } = sim;
  const p = S.player;
  if (p.grenades <= 0 || S.phase !== 'round') return;
  p.grenades -= 1;
  const pitch = p.pitch + p.recoilPitch;
  const yaw = p.yaw + p.recoilYaw;
  _fwd.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
  const g = createGrenade(
    p.x, p.y + p.eye - 0.2, p.z,
    _fwd.x * 14, _fwd.y * 14 + 3.5, _fwd.z * 14,
    p,
  );
  S.grenades.push(g);
  audio.click();
}

export function buy(sim, id) {
  const { S, audio } = sim;
  if (S.phase !== 'buy') return false;
  const p = S.player;
  if (id === 'grenade') {
    if (p.grenades >= GRENADE_MAX || S.money < GRENADE_PRICE) return false;
    S.money -= GRENADE_PRICE;
    p.grenades += 1;
    audio.click();
    return true;
  }
  const def = WEAPONS[id];
  if (!def || def.price === 0) return false;
  if (p.weapons.primary && p.weapons.primary.id === id) return false;
  if (S.money < def.price) return false;
  S.money -= def.price;
  p.weapons.primary = createWeaponState(id);
  p.current = 'primary';
  audio.click();
  return true;
}

function checkRoundEnd(sim) {
  const { S } = sim;
  if (S.phase !== 'round') return;
  const vAlive = S.player.alive || S.allies.some((b) => b.alive);
  const sAlive = S.enemies.some((b) => b.alive);
  if (!sAlive) endRound(sim, 'V', 'All Sentinels eliminated.');
  else if (!vAlive && S.charge.state !== 'planted') endRound(sim, 'S', 'All Vanguard eliminated.');
  else if (S.roundTime <= 0 && S.charge.state !== 'planted') endRound(sim, 'S', 'Time expired — the charge was never planted.');
}

export function stepSim(sim, dt, input) {
  const { S, world, audio, fx } = sim;
  const p = S.player;
  const keys = input.state.keys;
  const pressed = (code) => keys.has(code) && !sim.prevKeys.has(code);
  S.time += dt;

  // Phase timers.
  S.phaseT += dt;
  if (S.phase === 'buy' && S.phaseT >= BUY_TIME) {
    S.phase = 'round';
    S.phaseT = 0;
    S.buyOpen = false;
    feedLine(S, `Round ${S.round} — plant the charge at A or B.`);
  } else if (S.phase === 'round') {
    if (S.charge.state !== 'planted') S.roundTime = Math.max(0, S.roundTime - dt);
    else {
      S.charge.fuseT -= dt;
      if (S.charge.fuseT <= 0) {
        S.charge.state = 'detonated';
        fx.explosion(new THREE.Vector3(S.charge.x, 0.6, S.charge.z));
        audio.explosion();
        endRound(sim, 'V', 'The charge detonated.');
      }
    }
  } else if (S.phase === 'roundEnd' && S.phaseT >= 4) {
    if (S.wins.V >= MATCH_WINS || S.wins.S >= MATCH_WINS) endMatch(sim);
    else {
      S.round += 1;
      initRound(sim, false);
    }
  }

  // Menu / match-end restarts.
  if ((S.phase === 'menu' || S.phase === 'matchEnd') && pressed('Enter')) {
    audio.unlock();
    startMatch(sim);
  }
  if (pressed('KeyM')) {
    S.muted = !S.muted;
    audio.setMuted(S.muted);
  }

  // Buy menu toggle (buy phase only).
  if (S.phase === 'buy' && pressed('KeyB')) {
    S.buyOpen = !S.buyOpen;
    audio.click();
  }
  if (S.buyOpen) {
    if (pressed('Digit1')) buy(sim, 'smg');
    if (pressed('Digit2')) buy(sim, 'rifle');
    if (pressed('Digit3')) buy(sim, 'shotgun');
    if (pressed('Digit4')) buy(sim, 'grenade');
  }

  const playing = S.phase === 'round' || S.phase === 'buy';
  if (playing && p.alive) {
    // Look.
    const lookDelta = input.takeLook();
    look(p, lookDelta.x, lookDelta.y);
    // Movement.
    stepPlayer(p, dt, keys, world.colliders);
    sim.bobPhase += p.speed2d * dt * 1.6;
    // Weapons.
    const ws = currentWeapon(S);
    if (ws) stepWeapon(ws, dt);
    if (!S.buyOpen && pressed('Digit1')) switchWeapon(S, 'pistol', audio);
    if (!S.buyOpen && pressed('Digit2')) switchWeapon(S, 'primary', audio);
    if (pressed('KeyR') && ws) {
      if (startReload(ws)) audio.reload();
    }
    // Firing: auto weapons hold, semi weapons fire on the press edge.
    const firing = input.state.firing;
    const def = ws ? WEAPONS[ws.id] : null;
    if (S.phase === 'round' && ws && !ws.reloading) {
      if (def.auto && firing) playerShoot(sim);
      else if (!def.auto && firing && !sim.prevFiring) playerShoot(sim);
    }
    if (pressed('KeyG')) throwGrenade(sim);
    // Planting: hold E inside a site while carrying the charge.
    if (S.phase === 'round' && S.charge.state === 'carried' && keys.has('KeyE')) {
      const site = inSite(p.x, p.z, world.sites);
      if (site) {
        S.plantChannel += dt / PLANT_TIME;
        if (S.plantChannel >= 1) {
          S.charge.state = 'planted';
          S.charge.site = site;
          S.charge.x = p.x;
          S.charge.z = p.z;
          S.charge.fuseT = FUSE_TIME;
          S.charge.defuseT = 0;
          S.plantChannel = 0;
          S.stats.plants += 1;
          S.money += 300;
          feedLine(S, `You planted the charge at site ${site} — ${FUSE_TIME}s to detonation.`);
          audio.plantDone();
        }
      } else {
        S.plantChannel = 0;
      }
    } else {
      S.plantChannel = Math.max(0, S.plantChannel - dt * 2);
    }
  }

  // Bots fight only once the round starts; the buy phase is a freeze time.
  if (S.phase === 'round') {
    stepBots(S, world, dt, sim.raycaster, sim.shootables, {
      damageActor: (actor, amount, attacker, isHead) => damageActor(sim, actor, amount, attacker, isHead),
      onBotShot: (bot, muzzle, end) => {
        fx.tracer(muzzle, end);
        fx.botMuzzle(bot, muzzle);
        audio.enemyShot();
        hearShot(S, bot.x, bot.z, bot.team);
      },
      onDefused: (bot) => {
        S.charge.state = 'defused';
        S.stats.defuses += 1;
        feedLine(S, `${bot.name} defused the charge.`);
        endRound(sim, 'S', 'The charge was defused.');
      },
    });
  }

  // Grenades.
  for (const g of S.grenades) stepGrenade(g, dt, world.colliders);
  for (const g of S.grenades) {
    if (!g.dead) continue;
    fx.explosion(new THREE.Vector3(g.x, g.y, g.z));
    audio.explosion();
    explodeGrenade(g, [S.player, ...S.allies, ...S.enemies], (actor, amount, attacker, isHead) =>
      damageActor(sim, actor, amount, attacker, isHead),
    );
  }
  S.grenades = S.grenades.filter((g) => !g.dead);

  // Transient effects age out.
  S.tracers = S.tracers.filter((t) => S.time - t.t < 0.07);

  checkRoundEnd(sim);
  sim.prevKeys = new Set(keys);
  sim.prevFiring = input.state.firing;
}
