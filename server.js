require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { Server } = require('socket.io');
const User = require('./models/User');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- 資料庫連線 ----------
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB 連線成功'))
  .catch(err => console.error('❌ MongoDB 連線失敗：', err.message));

// ---------- 註冊 ----------
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password || username.length < 3 || password.length < 4) {
      return res.status(400).json({ error: '使用者名稱至少3碼，密碼至少4碼' });
    }
    const exists = await User.findOne({ username });
    if (exists) return res.status(400).json({ error: '這個使用者名稱已經被註冊了' });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ username, passwordHash });
    const token = jwt.sign({ id: user._id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, username: user.username, balance: user.balance });
  } catch (err) {
    res.status(500).json({ error: '註冊失敗，請稍後再試' });
  }
});

// ---------- 登入 ----------
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ error: '帳號或密碼錯誤' });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(400).json({ error: '帳號或密碼錯誤' });

    const token = jwt.sign({ id: user._id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, username: user.username, balance: user.balance });
  } catch (err) {
    res.status(500).json({ error: '登入失敗，請稍後再試' });
  }
});

// ---------- 用 token 拿最新資料（重新整理頁面用） ----------
app.get('/api/me', async (req, res) => {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(payload.id);
    if (!user) return res.status(401).json({ error: '請重新登入' });
    res.json({ username: user.username, balance: user.balance, wins: user.wins, losses: user.losses });
  } catch (err) {
    res.status(401).json({ error: '請重新登入' });
  }
});

// ================= Socket.io 即時對戰邏輯 =================

const rooms = new Map(); // code -> room state
const BET_AMOUNT = 500;
const MATCH_SECONDS = 90;
const ATTACK_RANGE = 14;   // 百分比距離內算命中
const ATTACK_DAMAGE = 12;
const ATTACK_COOLDOWN = 450; // ms

function genRoomCode() {
  let code;
  do {
    code = String(Math.floor(1000 + Math.random() * 9000));
  } while (rooms.has(code));
  return code;
}

function authSocket(socket, next) {
  try {
    const token = socket.handshake.auth?.token;
    const payload = jwt.verify(token, JWT_SECRET);
    socket.userId = payload.id;
    socket.username = payload.username;
    next();
  } catch (err) {
    next(new Error('unauthorized'));
  }
}
io.use(authSocket);

function freshFighter(socket) {
  return {
    socketId: socket.id,
    userId: socket.userId,
    username: socket.username,
    hp: 100,
    x: 20,
    facing: 1,
    lastAttack: 0
  };
}

function startCountdownAndTimer(room) {
  room.timeLeft = MATCH_SECONDS;
  clearInterval(room.timerHandle);
  room.timerHandle = setInterval(() => {
    if (!room.active) return;
    room.timeLeft -= 1;
    io.to(room.code).emit('timer_update', { secondsLeft: room.timeLeft });
    if (room.timeLeft <= 0) {
      endMatch(room, room.p1.hp === room.p2.hp ? null : (room.p1.hp > room.p2.hp ? room.p1 : room.p2));
    }
  }, 1000);
}

async function endMatch(room, winnerFighter) {
  if (!room.active) return;
  room.active = false;
  clearInterval(room.timerHandle);

  const { p1, p2 } = room;
  const winner = winnerFighter || (p1.hp >= p2.hp ? p1 : p2);
  const loser = winner === p1 ? p2 : p1;
