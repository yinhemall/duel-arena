// ============ 全域狀態 ============
let token = localStorage.getItem('duel_token') || null;
let me = { username: null, balance: 0, wins: 0, losses: 0 };
let socket = null;
let authMode = 'login';
let myRole = null;
let myX = 20, myFacing = 1;
let moveInterval = null;
let joyActive = false;
let hpBefore = 1000;

const $ = (sel) => document.querySelector(sel);
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
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
document.querySelectorAll('.btn-primary, .btn-secondary, .bento-play, .action-btn').forEach(attachRipple);

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    authMode = btn.dataset.tab;
    $('#btn-auth-label').textContent = authMode === 'login' ? '登入' : '註冊';
    $('#auth-error').textContent = '';
  });
});

$('#form-auth').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = $('#input-username').value.trim();
  const password = $('#input-password').value;
  $('#auth-error').textContent = '';
  $('#btn-auth-submit').disabled = true;
  try {
    const res = await fetch(`/api/${authMode}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '發生錯誤');
    token = data.token;
    localStorage.setItem('duel_token', token);
    me = { username: data.username, balance: data.balance, wins: 0, losses: 0 };
    enterLobby();
  } catch (err) {
    $('#auth-error').textContent = err.message;
  } finally {
    $('#btn-auth-submit').disabled = false;
  }
});

async function refreshMe() {
  try {
    const res = await fetch('/api/me', { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (!res.ok) throw new Error();
    me = data;
    $('#lobby-username').textContent = me.username;
    $('#lobby-balance').textContent = me.balance;
    $('#lobby-wins').textContent = me.wins;
    $('#lobby-losses').textContent = me.losses;
  } catch { logout(); }
}

async function enterLobby() {
  connectSocket();
  showScreen('#screen-lobby');
  await refreshMe();
}

$('#btn-logout').addEventListener('click', logout);
function logout() {
  localStorage.removeItem('duel_token'); token = null;
  if (socket) socket.disconnect();
  showScreen('#screen-auth');
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
  socket.emit('join_room', { code });
  $('#room-waiting').textContent = '正在加入房間…';
});

function connectSocket() {
  if (socket) socket.disconnect();
  socket = io({ auth: { token } });

  socket.on('room_created', ({ code }) => {
    $('#room-waiting').textContent = `房間已建立！號碼：#${code}　（把號碼傳給朋友）`;
  });

  socket.on('match_found', ({ youAre, opponentName, roomCode }) => {
    myRole = youAre;
    hideModal('#modal-play');
    startBattleUI(opponentName, roomCode);
  });

  socket.on('opponent_move', ({ x, facing }) => moveFighter(opponentEl(), x, facing));
  socket.on('opponent_action', ({ type }) => playAction(opponentEl(), type));

  socket.on('hp_update', ({ p1hp, p2hp, hitOn }) => {
    setHp('#hp-fill-p1', '#hp-pct-p1', p1hp);
    setHp('#hp-fill-p2', '#hp-pct-p2', p2hp);
    const hitEl = hitOn === 'p1' ? $('#fighter-p1') : $('#fighter-p2');
    hitEl.classList.remove('hit-flash'); void hitEl.offsetWidth; hitEl.classList.add('hit-flash');
  });

  socket.on('timer_update', ({ secondsLeft }) => {
    $('#timer-display').textContent = `${secondsLeft}s`;
  });

  socket.on('game_over', ({ youWin, newBalance, delta }) => {
    stopMoveLoop();
    $('#gameover-title').textContent = youWin ? '🎉 YOU WIN' : '💀 YOU LOSE';
    $('#gameover-before').textContent = hpBefore;
    $('#gameover-after').textContent = newBalance;
    const deltaEl = $('#gameover-delta');
    deltaEl.text
