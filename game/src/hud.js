// The HUD: DOM over the canvas. Updated from state every frame, but a value is only
// written to the DOM when it changes, so the HUD costs nothing when the game is idle.
import { WEAPONS, GRENADE_PRICE, GRENADE_MAX } from './weapons.js';
import { FUSE_TIME, BUY_TIME } from './state.js';

function el(id) {
  return document.getElementById(id);
}

export function createHud(onPlay, onBuy) {
  const cache = {};
  let paused = false;
  const setText = (id, value) => {
    if (cache[id] !== value) {
      cache[id] = value;
      el(id).textContent = value;
    }
  };
  const setWidth = (id, value) => {
    if (cache[id] !== value) {
      cache[id] = value;
      el(id).style.width = value;
    }
  };
  const setShow = (id, show) => {
    if (cache[id] !== show) {
      cache[id] = show;
      el(id).classList.toggle('hidden', !show);
    }
  };

  // Buy menu: one card per item, click or keys 1-4 while it is open.
  const buyItems = [
    { id: 'smg', key: '1', name: 'Kestrel SMG', price: WEAPONS.smg.price, desc: 'Fast, close range. 28 rounds.' },
    { id: 'rifle', key: '2', name: 'VK-9 Rifle', price: WEAPONS.rifle.price, desc: 'Accurate, hard hitting. 30 rounds.' },
    { id: 'shotgun', key: '3', name: 'M870 Scatter', price: WEAPONS.shotgun.price, desc: 'Eight pellets, point blank. 6 shells.' },
    { id: 'grenade', key: '4', name: 'Frag Grenade', price: GRENADE_PRICE, desc: `Blast radius 6.5 m. Max ${GRENADE_MAX}.` },
  ];
  const menu = el('buy-items');
  for (const item of buyItems) {
    const card = document.createElement('button');
    card.className = 'buy-card';
    card.innerHTML = `<b>[${item.key}] ${item.name}</b><span>$${item.price}</span><i>${item.desc}</i>`;
    card.addEventListener('click', () => onBuy(item.id));
    menu.appendChild(card);
  }
  el('overlay-btn').addEventListener('click', onPlay);

  return {
    frame(S, spread) {
      const p = S.player;
      const ws = p.current === 'primary' ? p.weapons.primary : p.weapons.pistol;
      const def = ws ? WEAPONS[ws.id] : WEAPONS.pistol;
      setText('health-num', `${Math.max(0, Math.ceil(p.hp))}`);
      setWidth('health-fill', `${Math.max(0, p.hp)}%`);
      el('health-fill').classList.toggle('low', p.hp <= 30);
      setText('ammo-mag', ws ? `${ws.mag}` : '—');
      setText('ammo-reserve', ws ? `/ ${ws.reserve}` : '');
      setText('weapon-name', def.name + (ws && ws.reloading ? ' — reloading' : ''));
      setText('grenades', `◉ ${p.grenades}`);
      setText('money', `$${S.money}`);
      const timerText = S.charge.state === 'planted'
        ? `💣 ${Math.ceil(S.charge.fuseT)}`
        : S.phase === 'buy'
          ? `BUY ${Math.ceil(BUY_TIME - S.phaseT)}`
          : `${Math.floor(S.roundTime / 60)}:${String(Math.floor(S.roundTime % 60)).padStart(2, '0')}`;
      setText('timer', timerText);
      el('timer').classList.toggle('danger', S.charge.state === 'planted');
      setText('score', `V ${S.wins.V} — ${S.wins.S} S`);
      setText('round-label', `ROUND ${S.round}`);
      setText('objective', S.charge.state === 'planted'
        ? `Defend the planted charge at site ${S.charge.site}`
        : S.charge.state === 'carried'
          ? 'Plant the charge at site A or B — hold E inside a site'
          : 'Eliminate the Sentinels');
      // Crosshair gap follows the current spread.
      const gap = Math.round(6 + spread * 900);
      if (cache.gap !== gap) {
        cache.gap = gap;
        el('crosshair').style.setProperty('--gap', `${gap}px`);
      }
      setShow('crosshair', p.alive && (S.phase === 'round' || S.phase === 'buy'));
      // Hitmarker: 120 ms after a hit, longer on a kill.
      const hitAge = S.lastHit ? (S.time - S.lastHit.t) * 1000 : 9999;
      const showHit = hitAge < (S.lastHit && S.lastHit.kill ? 260 : 120);
      setShow('hitmarker', showHit);
      el('hitmarker').classList.toggle('kill', !!(S.lastHit && S.lastHit.kill));
      // Damage vignette: 300 ms after being hurt.
      const hurtAge = S.lastHurtT ? (S.time - S.lastHurtT) * 1000 : 9999;
      el('vignette').style.opacity = hurtAge < 300 ? String(0.55 * (1 - hurtAge / 300)) : '0';
      // Plant / defuse progress.
      const planting = S.plantChannel > 0;
      setShow('plant-bar', planting || S.charge.state === 'planted');
      if (planting) {
        setText('plant-label', `PLANTING ${Math.round(S.plantChannel * 100)}%`);
        setWidth('plant-fill', `${S.plantChannel * 100}%`);
      } else if (S.charge.state === 'planted') {
        setText('plant-label', S.charge.defuser ? `DEFUSE ${Math.round((S.charge.defuseT / 5) * 100)}%` : `CHARGE — ${Math.ceil(S.charge.fuseT)}s`);
        setWidth('plant-fill', `${(S.charge.fuseT / FUSE_TIME) * 100}%`);
      }
      // Killfeed.
      const feedText = S.feed.map((f) => f.text).join('\n');
      setText('feed', feedText);
      // Banner.
      const bannerAge = S.banner ? S.time - S.banner.t : 9999;
      setShow('banner', !!S.banner && bannerAge < 3.5);
      if (S.banner && bannerAge < 3.5) {
        setText('banner-title', S.banner.title);
        setText('banner-sub', S.banner.sub);
      }
      // Buy menu.
      setShow('buy-menu', S.buyOpen && S.phase === 'buy');
      setShow('buy-hint', S.phase === 'buy' && !S.buyOpen);
      // Overlay screens: menu, match end, or paused (pointer lock lost mid-round).
      const wantOverlay = S.phase === 'menu' || S.phase === 'matchEnd' || paused;
      if (cache.overlay !== wantOverlay) {
        cache.overlay = wantOverlay;
        el('overlay').classList.toggle('hidden', !wantOverlay);
        if (wantOverlay && !paused) {
          if (S.phase === 'menu') {
            setText('overlay-title', 'EMBERLINE');
            setText('overlay-sub', 'A tactical FPS in Ember Yard. Vanguard attacks, Sentinels defend.\nWASD move · mouse aim · click fire · R reload · 1/2 weapons · G grenade\nHold E to plant the charge at A or B · B buys between rounds · first to 3 rounds wins.');
            setText('overlay-btn', 'CLICK TO DEPLOY');
          } else {
            const won = S.matchWinner === 'V';
            setText('overlay-title', won ? 'MATCH WON' : 'MATCH LOST');
            setText('overlay-sub', `Vanguard ${S.wins.V} — ${S.wins.S} Sentinels. Press Enter to play again.`);
            setText('overlay-btn', 'PLAY AGAIN');
          }
        }
      }
    },
    showPaused(isPaused) {
      paused = isPaused;
      if (isPaused) {
        setText('overlay-title', 'PAUSED');
        setText('overlay-sub', 'Click to resume.');
        setText('overlay-btn', 'RESUME');
        el('overlay').classList.remove('hidden');
        cache.overlay = true;
      } else {
        cache.overlay = false;
      }
    },
  };
}
