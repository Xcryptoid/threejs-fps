// One state object for the whole game: phases, rounds, money, the charge, every actor and
// every transient effect. The sim owns it; rendering only reads it.
import { mulberry32 } from './rng.js';

export const ROUND_TIME = 100;
export const BUY_TIME = 15;
export const FUSE_TIME = 35;
export const PLANT_TIME = 3;
export const DEFUSE_TIME = 5;
export const MATCH_WINS = 3;

export function createState(seed) {
  return {
    seed,
    random: mulberry32(seed),
    time: 0,
    phase: 'menu', // menu | buy | round | roundEnd | matchEnd
    phaseT: 0,
    round: 1,
    wins: { V: 0, S: 0 },
    roundTime: ROUND_TIME,
    money: 800,
    kills: { V: 0, S: 0 },
    stats: { shots: 0, hits: 0, headshots: 0, plants: 0, defuses: 0 },
    // The charge: carried by the player while the round runs, then planted / gone.
    charge: { state: 'carried', site: null, x: 0, z: 0, plantT: 0, fuseT: 0, defuseT: 0, defuser: null },
    player: null,
    allies: [],
    enemies: [],
    grenades: [],
    tracers: [],
    flashes: [],
    feed: [], // killfeed lines {text, t}
    banner: null, // {title, sub, t}
    roundWinner: null,
    matchWinner: null,
    plantChannel: 0, // 0..1, the player's plant progress this hold
    defuseChannel: 0,
    buyOpen: false,
    muted: false,
    lastEvent: '',
  };
}

export function feedLine(S, text) {
  S.feed.push({ text, t: S.time });
  if (S.feed.length > 5) S.feed.shift();
}

export function setBanner(S, title, sub) {
  S.banner = { title, sub: sub ?? '', t: S.time };
}
