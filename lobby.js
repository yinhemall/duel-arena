let token = localStorage.getItem('duel_token') || null;
let me = { username: null, balance: 0, wins: 0, losses: 0 };
let socket = null;
let myRole = null;
let myX = 20, myFacing = 1;
let moveInterval = null;
let joyActive = false;
let hpBefore = 1000;

if (!token) {
  window.location.href = 'index.html';
}

const $ = (sel) => document.querySelector(sel);

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
  $(id).classList.add('active');
}
function showModal(id) { $(id).classList.add('active'); }
function hideModal(id) { $(id).classList.remove('active'); }
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._h); toast._h = setTimeout(() => t.classList.remove('show'), 2400);
}
function attachRipple(el) {
  el.addEventListener('pointerdown', (e) => {
    const r = el.getBoundingClientRect();
    el.style.setProperty('--rx', (e.clientX - r.left) + 'px');
    el.style.setProperty('--ry', (e.clientY - r.top) + 'px');
    el.classList.remove('ripple'); void el.offsetWidth; el.classList.add('ripple');
  });
}
document.querySelectorAll('.btn-primary, .btn-secondary, .play-banner, .action-btn').forEach(attachRipple);

async function refreshMe() {
  try {
    const res = await fetch('/api/me', { headers: { Authorization: 'Bearer ' + token } });
    const data = await res.json();
    if (!res.ok) throw new Error();
    me = data;
    $('#lobby-username').textContent = me.username;
    $('#lobby-balance').textContent = me.balance;
    $('#lobby-wins').textContent = me.wins;
    $('#lobby-losses').textContent = me.losses;
  } catch {
    logout();
  }
}

$('#btn-logout').addEventListener('click', logout);
function logout() {
  localStorage.removeItem('duel_token');
  if (socket) socket.disconnect();
  window.location.href = 'index.html';
}

$('#btn-play').addEventListener('click', () => {
  $('#play-error').textContent = ''; $('#room-waiting').textContent = '';
  $('#input-room-code').value = '';
  showModal('#modal-play');
});
$('#btn-close-modal').addEventListener('click', () => hideModal('#modal-play'));

$('#btn-create-room').addEventListener('click', () => {
  socket.emit('create_room');
  $('#room-waiting').textContent = '正在建立房間…';
});
$('#btn-join-room').addEventListener('click', () => {
  const code = $('#input-room-code').value.trim();
  if (!/^\d{4}$/.test(code)) { $('#play-error').textContent = '請輸入 4 位數房間號碼'; return; }
  socket.emit('join_room', { code: code });
  $('#room-waiting').textContent = '正在加入房間…';
});

function connectSocket() {
  if (socket) socket.disconnect();
  socket = io({ auth: { token: token } });

  socket.on('room_created', (data) => {
    $('#room-waiting').textContent = '房間已建立！號碼：#' + data.code + '　（把號碼傳給朋友）';
  });

  socket.on('match_found', (data) => {
    myRole = data.youAre;
    hideModal('#modal-play');
    startBattleUI(data.opponentName, data.roomCode);
  });

  socket.on('opponent_move', (data) => moveFighter(opponentEl(), data.x, data.facing));
  socket.on('opponent_action', (data) => playAction(opponentEl(), data.type));

  socket.on('hp_update', (data) => {
    setHp('#hp-fill-p1', '#hp-pct-p1', data.p1hp);
    setHp('#hp-fill-p2', '#hp-pct-p2', data.p2hp);
    const hitEl = data.hitOn === 'p1' ? $('#fighter-p1') : $('#fighter-p2');
    hitEl.classList.remove('hit-flash'); void hitEl.offsetWidth; hitEl.classList.add('hit-flash');
  });

  socket.on('timer_update', (data) => {
    $('#timer-display').textContent = data.secondsLeft + 's';
  });

  socket.on('game_over', (data) => {
    stopMoveLoop();
    $('#gameover-title').textContent = data.youWin ? '🎉 YOU WIN' : '💀 YOU LOSE';
    $('#gameover-before').textContent = hpBefore;
    $('#gameover-after').textContent = data.newBalance;
    const deltaEl = $('#gameover-delta');
    deltaEl.textContent = '(' + (data.delta > 0 ? '+' : '') + data.delta + ')';
    deltaEl.className = data.delta > 0 ? 'delta-positive' : 'delta-negative';
    $('#rematch-status').textContent = '';
    showModal('#screen-gameover');
    me.balance = data.newBalance;
  });

  socket.on('rematch_waiting', (data) => {
    $('#rematch-status').textContent = data.votes === 1 ? '等待對手同意再戰…' : '';
  });
  socket.on('rematch_start', () => {
    hideModal('#screen-gameover');
    resetBattleUI();
  });

  socket.on('opponent_left', () => {
    toast('對手已離開房間');
    stopMoveLoop();
    hideModal('#screen-gameover');
    hideModal('#modal-play');
    showScreen('#screen-lobby');
    refreshMe();
  });

  socket.on('error_msg', (data) => {
    $('#play-error').textContent = data.message;
    $('#room-waiting').textContent = '';
  });
}

function opponentEl() { return myRole === 'p1' ? $('#fighter-p2') : $('#fighter-p1'); }
function meEl() { return myRole === 'p1' ? $('#fighter-p1') : $('#fighter-p2'); }

function startBattleUI(opponentName, roomCode) {
  hpBefore = me.balance;
  $('#hp-name-p1').textContent = myRole === 'p1' ? '你' : opponentName;
  $('#hp-name-p2').textContent = myRole === 'p1' ? opponentName : '你';
  $('#battle-room-code').textContent = '房間 #' + roomCode;
  resetBattleUI();
  showScreen('#screen-battle');
}

function resetBattleUI() {
  setHp('#hp-fill-p1', '#hp-pct-p1', 100);
  setHp('#hp-fill-p2', '#hp-pct-p2', 100);
  $('#timer-display').textContent = '90s';
  myX = myRole === 'p1' ? 20 : 80;
  myFacing = myRole === 'p1' ? 1 : -1;
  moveFighter($('#fighter-p1'), 20, 1);
  moveFighter($('#fighter-p2'), 80, -1);
}

function setHp(fillSel, pctSel, hp) {
  $(fillSel).style.width = hp + '%';
  $(pctSel).textContent = hp + '%';
}

function moveFighter(el, x, facing) {
  el.style.left = x + '%';
  el.style.transform = 'translate(-50%, 0) scaleX(' + facing + ')';
}

function playAction(el, type) {
  if (type === 'jump') {
    el.classList.add('jumping');
    setTimeout(() => el.classList.remove('jumping'), 320);
  } else if (type === 'dash') {
    el.classList.add('dashing');
    setTimeout(() => el.classList.remove('dashing'), 220);
  } else if (type === 'attack') {
    el.classList.add('attacking');
    setTimeout(() => el.classList.remove('attacking'), 200);
  }
}

const joyOuter = $('#joystick-outer');
const joyThumb = $('#joystick-thumb');
const joyZone = $('#joystick-zone');
let joyMoveDir = 0;

function joyStart(e) { joyActive = true; joyHandle(e); startMoveLoop(); }
function joyHandle(e) {
  if (!joyActive) return;
  const touch = e.touches ? e.touches[0] : e;
  const rect = joyOuter.getBoundingClientRect();
  const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
  let dx = touch.clientX - cx, dy = touch.clientY - cy;
  const max = rect.width / 2 - 10;
  const dist = Math.min(Math.hypot(dx, dy), max);
  const angle = Math.atan2(dy, dx);
  const tx = Math.cos(angle) * dist, ty = Math.sin(angle) * dist;
  joyThumb.style.transform = 'translate(' + tx + 'px, ' + ty + 'px)';
  joyMoveDir = dx > 15 ? 1 : dx < -15 ? -1 : 0;
  if (joyMoveDir !== 0) myFacing = joyMoveDir;
  e.preventDefault();
}
function joyEnd() {
  joyActive = false; joyMoveDir = 0;
  joyThumb.style.transform = 'translate(0,0)';
  stopMoveLoop();
}
joyZone.addEventListener('touchstart', joyStart, { passive: false });
joyZone.addEventListener('touchmove', joyHandle, { passive: false });
joyZone.addEventListener('touchend', joyEnd);
joyZone.addEventListener('touchcancel', joyEnd);
joyZone.addEventListener('mousedown', joyStart);
window.addEventListener('mousemove', (e) => { if (joyActive) joyHandle(e); });
window.addEventListener('mouseup', joyEnd);

function startMoveLoop() {
  if (moveInterval) return;
  moveInterval = setInterval(() => {
    if (joyMoveDir === 0) return;
    myX = Math.max(0, Math.min(100, myX + joyMoveDir * 1.8));
    moveFighter(meEl(), myX, myFacing);
    socket.emit('player_move', { x: myX, facing: myFacing });
  }, 40);
}
function stopMoveLoop() { clearInterval(moveInterval); moveInterval = null; }

function bindAction(btn, type, emitAttack) {
  btn.addEventListener('touchstart', (e) => { e.preventDefault(); trigger(); }, { passive: false });
  btn.addEventListener('mousedown', trigger);
  function trigger() {
    playAction(meEl(), type);
    socket.emit('player_action', { type: type });
    if (emitAttack) socket.emit('attack');
  }
}
bindAction($('#btn-jump'), 'jump', false);
bindAction($('#btn-dash'), 'dash', false);
bindAction($('#btn-attack'), 'attack', true);

$('#btn-rematch').addEventListener('click', () => {
  socket.emit('rematch_request');
  $('#rematch-status').textContent = '已送出再戰請求…';
});
$('#btn-main-menu').addEventListener('click', () => {
  socket.emit('leave_room');
  hideModal('#screen-gameover');
  showScreen('#screen-lobby');
  refreshMe();
});

(async function init() {
  connectSocket();
  await refreshMe();
})();
