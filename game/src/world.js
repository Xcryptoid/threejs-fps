// EMBER YARD: the map. One walled industrial yard, 48 x 36 m: attacker spawn south, two
// plant sites north (A west, B east), a furnace block in the middle with a lane past each
// side, crates and barrels for cover. All geometry is boxes and cylinders in the palette;
// the floor markings are one canvas texture drawn at build time, no image files.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Every solid box: x, z centre, width, depth, height, material key. Colliders match these.
const BOXES = [
  // Perimeter walls (height 4, thickness 1).
  { x: 0, z: -18.5, w: 50, d: 1, h: 4, mat: 'wall' },
  { x: 0, z: 18.5, w: 50, d: 1, h: 4, mat: 'wall' },
  { x: -24.5, z: 0, w: 1, d: 38, h: 4, mat: 'wall' },
  { x: 24.5, z: 0, w: 1, d: 38, h: 4, mat: 'wall' },
  // Interior stubs that make corners on the site approaches.
  { x: -14, z: -6, w: 1, d: 8, h: 3.2, mat: 'wall' },
  { x: 14, z: -6, w: 1, d: 8, h: 3.2, mat: 'wall' },
  // The furnace: the mid block, with a chimney.
  { x: 0, z: 0, w: 8, d: 4, h: 5, mat: 'metal' },
  { x: -2.5, z: 0, w: 1.5, d: 1.5, h: 7.5, mat: 'metal' },
  // Crates: low ones you can see over, tall ones you cannot.
  { x: -10, z: 6, w: 2.4, d: 2.4, h: 1.2, mat: 'crate' },
  { x: -12, z: 1, w: 2, d: 2, h: 1.2, mat: 'crateDark' },
  { x: 10, z: 6, w: 2.4, d: 2.4, h: 1.2, mat: 'crate' },
  { x: 12, z: 1, w: 2, d: 2, h: 1.2, mat: 'crateDark' },
  { x: -7, z: -8, w: 2.4, d: 2.4, h: 2.4, mat: 'crate' },
  { x: 7, z: -8, w: 2.4, d: 2.4, h: 2.4, mat: 'crate' },
  { x: -8, z: -12, w: 2, d: 2, h: 1.2, mat: 'crateDark' },
  { x: 8, z: -12, w: 2, d: 2, h: 1.2, mat: 'crateDark' },
  { x: -16, z: -14, w: 2, d: 2, h: 1.2, mat: 'crate' },
  { x: 16, z: -14, w: 2, d: 2, h: 1.2, mat: 'crate' },
  { x: -19, z: 3, w: 2.4, d: 2.4, h: 2.4, mat: 'crateDark' },
  { x: 19, z: 3, w: 2.4, d: 2.4, h: 2.4, mat: 'crateDark' },
  { x: -4, z: 11, w: 2, d: 2, h: 1.2, mat: 'crate' },
  { x: 4, z: 11, w: 2, d: 2, h: 1.2, mat: 'crate' },
];

const BARRELS = [
  { x: -18, z: -2, r: 0.7 },
  { x: -16.6, z: -2.6, r: 0.7 },
  { x: 18, z: -2, r: 0.7 },
  { x: 16.6, z: -2.6, r: 0.7 },
  { x: -3, z: -14, r: 0.7 },
  { x: 3, z: -14, r: 0.7 },
];

// Waypoint graph: bots walk these nodes. Edges join neighbours on the same lane.
export const WAYPOINTS = [
  { x: 0, z: 15 }, { x: -4, z: 15 }, { x: 4, z: 15 }, // 0-2 attacker spawn
  { x: 0, z: 10 }, { x: -6, z: 0 }, { x: 6, z: 0 }, { x: 0, z: -6 }, // 3-6 mid
  { x: -10, z: 12 }, { x: -16, z: 8 }, { x: -18, z: 0 }, { x: -16, z: -6 }, { x: -16, z: -12 }, // 7-11 west -> A
  { x: 10, z: 12 }, { x: 16, z: 8 }, { x: 18, z: 0 }, { x: 16, z: -6 }, { x: 16, z: -12 }, // 12-16 east -> B
  { x: -18, z: -13 }, { x: -13, z: -10 }, { x: 18, z: -13 }, { x: 13, z: -10 }, { x: 0, z: -9 }, // 17-21 holds
];
const EDGES = [
  [0, 1], [0, 2], [0, 3], [1, 7], [2, 12], [3, 4], [3, 5], [4, 6], [5, 6], [6, 20],
  [7, 8], [8, 9], [9, 10], [10, 11], [11, 17], [11, 18], [12, 13], [13, 14], [14, 15],
  [15, 16], [16, 19], [16, 20], [4, 9], [5, 14], [10, 20], [15, 20], [17, 18], [19, 20],
  [3, 7], [3, 12], [6, 11], [6, 16],
];

export const SITES = {
  A: { x0: -21, z0: -16, x1: -11, z1: -8, cx: -16, cz: -12 },
  B: { x0: 11, z0: -16, x1: 21, z1: -8, cx: 16, cz: -12 },
};

export const SPAWNS = {
  attack: [
    { x: 0, z: 15, yaw: 0 },
    { x: -4, z: 15, yaw: 0 },
    { x: 4, z: 15, yaw: 0 },
  ],
  defendA: [
    { x: -18, z: -13, yaw: 0 },
    { x: -13, z: -10, yaw: 0 },
  ],
  defendB: [
    { x: 18, z: -13, yaw: 0 },
    { x: 13, z: -10, yaw: 0 },
  ],
  defendMid: [{ x: 0, z: -9, yaw: 0 }],
};

function floorTexture() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 768;
  const g = c.getContext('2d');
  g.fillStyle = '#8a7a5c';
  g.fillRect(0, 0, 1024, 768);
  // Wear patches.
  for (let i = 0; i < 260; i++) {
    const x = Math.random() * 1024;
    const y = Math.random() * 768;
    g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.05)';
    g.beginPath();
    g.arc(x, y, 8 + Math.random() * 30, 0, Math.PI * 2);
    g.fill();
  }
  // Lane dashes down the middle and the two side lanes.
  g.fillStyle = 'rgba(242,234,217,0.35)';
  for (const x of [512, 170, 854]) {
    for (let y = 40; y < 730; y += 56) g.fillRect(x - 3, y, 6, 28);
  }
  // Site letters and hazard frames. Map x -24..24 -> 0..1024, z -18..18 -> 0..768.
  const mx = (x) => (x + 24) * (1024 / 48);
  const mz = (z) => (z + 18) * (768 / 36);
  for (const [site, color, letter] of [
    [SITES.A, '#e8862e', 'A'],
    [SITES.B, '#3fa7a0', 'B'],
  ]) {
    g.strokeStyle = color;
    g.lineWidth = 6;
    g.strokeRect(mx(site.x0), mz(site.z0), mx(site.x1) - mx(site.x0), mz(site.z1) - mz(site.z0));
    g.fillStyle = color;
    g.font = 'bold 150px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(letter, mx(site.cx), mz(site.cz));
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Circle (x, z, radius) pushed out of every AABB it overlaps; returns true on a hit. */
export function collideCircle(p, r, colliders) {
  let hit = false;
  for (const c of colliders) {
    const nx = Math.max(c.x0, Math.min(p.x, c.x1));
    const nz = Math.max(c.z0, Math.min(p.z, c.z1));
    const dx = p.x - nx;
    const dz = p.z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    hit = true;
    if (d2 > 1e-9) {
      const d = Math.sqrt(d2);
      p.x = nx + (dx / d) * r;
      p.z = nz + (dz / d) * r;
    } else {
      // Centre inside the box: push out along the smallest penetration axis.
      const pl = p.x - c.x0;
      const pr = c.x1 - p.x;
      const pt = p.z - c.z0;
      const pb = c.z1 - p.z;
      const m = Math.min(pl, pr, pt, pb);
      if (m === pl) p.x = c.x0 - r;
      else if (m === pr) p.x = c.x1 + r;
      else if (m === pt) p.z = c.z0 - r;
      else p.z = c.z1 + r;
    }
  }
  return hit;
}

/** True when the segment (x0,z0)-(x1,z1) crosses any tall collider (a wall that blocks sight). */
export function losBlocked(x0, z0, x1, z1, colliders) {
  const dx = x1 - x0;
  const dz = z1 - z0;
  for (const c of colliders) {
    if (!c.tall) continue;
    let t0 = 0;
    let t1 = 1;
    let ok = true;
    for (const [o, d, mn, mx] of [
      [x0, dx, c.x0, c.x1],
      [z0, dz, c.z0, c.z1],
    ]) {
      if (Math.abs(d) < 1e-9) {
        if (o < mn || o > mx) {
          ok = false;
          break;
        }
      } else {
        let ta = (mn - o) / d;
        let tb = (mx - o) / d;
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta);
        t1 = Math.min(t1, tb);
        if (t0 > t1) {
          ok = false;
          break;
        }
      }
    }
    if (ok) return true;
  }
  return false;
}

/** Which plant site (x, z) stands in, or null. */
export function inSite(x, z, sites) {
  for (const key of ['A', 'B']) {
    const s = sites[key];
    if (x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1) return key;
  }
  return null;
}

export function createWorld(scene) {
  const mats = {
    wall: new THREE.MeshStandardMaterial({ color: PALETTE.wall, roughness: 0.95 }),
    wallTop: new THREE.MeshStandardMaterial({ color: PALETTE.wallTop, roughness: 0.9 }),
    metal: new THREE.MeshStandardMaterial({ color: PALETTE.metal, roughness: 0.6, metalness: 0.4 }),
    crate: new THREE.MeshStandardMaterial({ color: PALETTE.crate, roughness: 0.9 }),
    crateDark: new THREE.MeshStandardMaterial({ color: PALETTE.crateDark, roughness: 0.9 }),
    barrel: new THREE.MeshStandardMaterial({ color: PALETTE.barrel, roughness: 0.7, metalness: 0.3 }),
    trim: new THREE.MeshBasicMaterial({ color: PALETTE.trim }),
    trimTeal: new THREE.MeshBasicMaterial({ color: PALETTE.siteB }),
  };
  const group = new THREE.Group();
  const colliders = [];
  const shootables = [];

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(48, 36),
    new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.95 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  for (const b of BOXES) {
    const mesh = new THREE.Mesh(boxGeo, mats[b.mat]);
    mesh.scale.set(b.w, b.h, b.d);
    mesh.position.set(b.x, b.h / 2, b.z);
    mesh.castShadow = b.h >= 2;
    mesh.receiveShadow = true;
    group.add(mesh);
    shootables.push(mesh);
    colliders.push({ x0: b.x - b.w / 2, z0: b.z - b.d / 2, x1: b.x + b.w / 2, z1: b.z + b.d / 2, tall: b.h >= 2 });
  }
  const barrelGeo = new THREE.CylinderGeometry(0.7, 0.7, 1.4, 12);
  for (const b of BARRELS) {
    const mesh = new THREE.Mesh(barrelGeo, mats.barrel);
    mesh.position.set(b.x, 0.7, b.z);
    mesh.castShadow = true;
    group.add(mesh);
    shootables.push(mesh);
    colliders.push({ x0: b.x - b.r, z0: b.z - b.r, x1: b.x + b.r, z1: b.z + b.r, tall: false });
  }
  // Ember trim along the tops of the two long walls, and the furnace slit.
  for (const z of [-18.4, 18.4]) {
    const trim = new THREE.Mesh(boxGeo, mats.trim);
    trim.scale.set(48, 0.12, 0.12);
    trim.position.set(0, 4.05, z);
    group.add(trim);
  }
  const slit = new THREE.Mesh(boxGeo, mats.trim);
  slit.scale.set(0.15, 3.4, 0.15);
  slit.position.set(0, 2.2, 2.05);
  group.add(slit);
  // Site corner posts, tinted per site.
  for (const [site, mat] of [
    [SITES.A, mats.trim],
    [SITES.B, mats.trimTeal],
  ]) {
    for (const [x, z] of [
      [site.x0, site.z0],
      [site.x1, site.z0],
      [site.x0, site.z1],
      [site.x1, site.z1],
    ]) {
      const post = new THREE.Mesh(boxGeo, mat);
      post.scale.set(0.18, 1.6, 0.18);
      post.position.set(x, 0.8, z);
      group.add(post);
    }
  }

  scene.add(group);
  return { group, colliders, shootables, sites: SITES, spawns: SPAWNS, waypoints: WAYPOINTS, edges: EDGES };
}
