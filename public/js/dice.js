// CSS 3D die. tumble() spins it; land(n) settles on face n with a couple of
// extra turns; set(n) shows n with no motion.
const PIPS = { 1: [4], 2: [2, 6], 3: [2, 4, 6], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
const PLACE = {
  1: 'translateZ(var(--h))',
  6: 'rotateY(180deg) translateZ(var(--h))',
  3: 'rotateY(90deg) translateZ(var(--h))',
  4: 'rotateY(-90deg) translateZ(var(--h))',
  5: 'rotateX(90deg) translateZ(var(--h))',
  2: 'rotateX(-90deg) translateZ(var(--h))',
};
const SHOW = {
  1: 'rotateX(0deg) rotateY(0deg)',
  6: 'rotateX(0deg) rotateY(180deg)',
  3: 'rotateX(0deg) rotateY(-90deg)',
  4: 'rotateX(0deg) rotateY(90deg)',
  5: 'rotateX(-90deg) rotateY(0deg)',
  2: 'rotateX(90deg) rotateY(0deg)',
};

export function createDie(root, size = 120) {
  root.classList.add('die-scene');
  root.style.setProperty('--die-size', `${size}px`);
  const cube = document.createElement('div');
  cube.className = 'die';
  for (let n = 1; n <= 6; n++) {
    const f = document.createElement('div');
    f.className = 'face';
    f.style.transform = PLACE[n];
    for (let i = 0; i < 9; i++) {
      const p = document.createElement('span');
      if (PIPS[n].includes(i)) p.className = 'pip';
      f.appendChild(p);
    }
    cube.appendChild(f);
  }
  root.replaceChildren(cube);
  let turns = 0;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  return {
    tumble() {
      cube.style.transition = 'none';
      cube.classList.add('tumbling');
      root.classList.add('rolling');
    },
    land(n) {
      root.classList.remove('rolling');
      cube.classList.remove('tumbling');
      if (reduced) { cube.style.transition = 'none'; cube.style.transform = SHOW[n]; return; }
      turns += 2;
      cube.style.transition = 'transform 900ms cubic-bezier(.2,.8,.2,1)';
      // Force a style flush instead of waiting for requestAnimationFrame, which
      // never fires in a background tab or on a locked phone. The final face
      // must be right even if nobody saw the animation.
      void cube.offsetWidth;
      cube.style.transform = `rotateX(${turns * 360}deg) rotateY(${turns * 360}deg) ${SHOW[n]}`;
    },
    set(n) {
      root.classList.remove('rolling');
      cube.classList.remove('tumbling');
      cube.style.transition = 'none';
      cube.style.transform = n ? SHOW[n] : 'rotateX(-25deg) rotateY(35deg)';
    },
  };
}
