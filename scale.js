const GAME_W = 900;
const GAME_H = 420;

function initScaling() {
  const root = document.getElementById('game-root');
  const rotateOverlay = document.getElementById('rotate-overlay');
  if (!root) return;

  function getViewport() {
    if (window.visualViewport) {
      return { w: window.visualViewport.width, h: window.visualViewport.height };
    }
    return { w: window.innerWidth, h: window.innerHeight };
  }

  function applyScale() {
    const vp = getViewport();
    const isPortrait = vp.h > vp.w;

    if (isPortrait) {
      if (rotateOverlay) rotateOverlay.classList.add('show');
      root.style.visibility = 'hidden';
      return;
    } else {
      if (rotateOverlay) rotateOverlay.classList.remove('show');
      root.style.visibility = 'visible';
    }

    const scale = Math.min(vp.w / GAME_W, vp.h / GAME_H);
    const offsetX = (vp.w - GAME_W * scale) / 2;
    const offsetY = (vp.h - GAME_H * scale) / 2;

    root.style.transform = 'translate(' + offsetX + 'px, ' + offsetY + 'px) scale(' + scale + ')';
  }

  applyScale();
  window.addEventListener('resize', applyScale);
  window.addEventListener('orientationchange', function () {
    setTimeout(applyScale, 150);
    setTimeout(applyScale, 400);
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', applyScale);
    window.visualViewport.addEventListener('scroll', applyScale);
  }

  if (screen.orientation && screen.orientation.lock) {
    screen.orientation.lock('landscape').catch(function () {});
  }
}

document.addEventListener('DOMContentLoaded', initScaling);
