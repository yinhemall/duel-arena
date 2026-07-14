const GAME_W = 960;
const GAME_H = 480;

function initScaling() {
  const root = document.getElementById('game-root');
  const rotateOverlay = document.getElementById('rotate-overlay');
  if (!root) return;

  function applyScale() {
    const isPortrait = window.innerHeight > window.innerWidth;

    if (isPortrait) {
      if (rotateOverlay) rotateOverlay.classList.add('show');
      root.style.visibility = 'hidden';
      return;
    } else {
      if (rotateOverlay) rotateOverlay.classList.remove('show');
      root.style.visibility = 'visible';
    }

    const scale = Math.min(window.innerWidth / GAME_W, window.innerHeight / GAME_H);
    const offsetX = (window.innerWidth - GAME_W * scale) / 2;
    const offsetY = (window.innerHeight - GAME_H * scale) / 2;

    root.style.transform = 'translate(' + offsetX + 'px, ' + offsetY + 'px) scale(' + scale + ')';
  }

  applyScale();
  window.addEventListener('resize', applyScale);
  window.addEventListener('orientationchange', function () { setTimeout(applyScale, 100); });

  if (screen.orientation && screen.orientation.lock) {
    screen.orientation.lock('landscape').catch(function () {});
  }
}

document.addEventListener('DOMContentLoaded', initScaling);
