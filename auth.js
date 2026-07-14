let token = localStorage.getItem('duel_token') || null;
let authMode = 'login';

const $ = (sel) => document.querySelector(sel);

function attachRipple(el) {
  el.addEventListener('pointerdown', (e) => {
    const r = el.getBoundingClientRect();
    el.style.setProperty('--rx', (e.clientX - r.left) + 'px');
    el.style.setProperty('--ry', (e.clientY - r.top) + 'px');
    el.classList.remove('ripple'); void el.offsetWidth; el.classList.add('ripple');
  });
}
document.querySelectorAll('.btn-primary, .btn-secondary').forEach(attachRipple);

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('touchend', (e) => { e.preventDefault(); btn.click(); }, { passive: false });
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
    const res = await fetch('/api/' + authMode, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username, password: password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '發生錯誤');
    localStorage.setItem('duel_token', data.token);
    window.location.href = 'lobby.html';
  } catch (err) {
    $('#auth-error').textContent = err.message;
  } finally {
    $('#btn-auth-submit').disabled = false;
  }
});

(async function init() {
  if (!token) return;
  try {
    const res = await fetch('/api/me', { headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) throw new Error();
    window.location.href = 'lobby.html';
  } catch {
    localStorage.removeItem('duel_token');
  }
})();
