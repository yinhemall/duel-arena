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

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB 連線成功'))
  .catch(err => console.error('MongoDB 連線失敗：', err.message));

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

const rooms = new Map();
const BET_AMOUNT = 500;
const MATCH_SECONDS = 90;
const ATTACK_RANGE = 14;
const ATTACK_DAMAGE = 12;
const ATTACK_COOLDOWN = 450;

function genRoomCode() {
  let code;
  do {
    code = String(Math.floor(1000 + Math.random() * 9000));
  } while (rooms.has(code));
  return code;
}

function authSocket(socket, next) {
  try {
    const token = socket.handshake.auth && socket.handshake.auth.token;
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

  const p1 = room.p1;
  const p2 = room.p2;
  const winner = winnerFighter || (p1.hp >= p2.hp ? p1 : p2);
  const loser = winner === p1 ? p2 : p1;

  try {
    const winnerUser = await User.findByIdAndUpdate(winner.userId, { $inc: { balance: BET_AMOUNT, wins: 1 } }, { new: true });
    const loserUser = await User.findByIdAndUpdate(loser.userId, { $inc: { balance: -BET_AMOUNT, losses: 1 } }, { new: true });

    io.to(winner.socketId).emit('game_over', {
      youWin: true, newBalance: winnerUser.balance, delta: BET_AMOUNT
    });
    io.to(loser.socketId).emit('game_over', {
      youWin: false, newBalance: loserUser.balance, delta: -BET_AMOUNT
    });
  } catch (err) {
    io.to(room.code).emit('error_msg', { message: '結算時發生錯誤，請聯絡管理員' });
  }
}

io.on('connection', (socket) => {

  socket.on('create_room', () => {
    const code = genRoomCode();
    const room = { code: code, p1: freshFighter(socket), p2: null, active: false, timerHandle: null, timeLeft: MATCH_SECONDS };
    rooms.set(code, room);
    socket.join(code);
    socket.roomCode = code;
    socket.emit('room_created', { code: code });
  });

  socket.on('join_room', (data) => {
    const code = data.code;
    const room = rooms.get(code);
    if (!room) return socket.emit('error_msg', { message: '找不到這個房間號碼' });
    if (room.p2) return socket.emit('error_msg', { message: '這個房間已經滿了' });
    if (room.p1.userId === socket.userId) return socket.emit('error_msg', { message: '不能加入自己創建的房間' });

    room.p2 = freshFighter(socket);
    socket.join(code);
    socket.roomCode = code;
    room.active = true;

    io.to(room.p1.socketId).emit('match_found', { youAre: 'p1', opponentName: room.p2.username, roomCode: code });
    io.to(room.p2.socketId).emit('match_found', { youAre: 'p2', opponentName: room.p1.username, roomCode: code });
    startCountdownAndTimer(room);
  });

  socket.on('player_move', (data) => {
    const room = rooms.get(socket.roomCode);
    if (!room || !room.active) return;
    const me = room.p1.socketId === socket.id ? room.p1 : room.p2;
    const opp = room.p1.socketId === socket.id ? room.p2 : room.p1;
    if (!me || !opp) return;
    me.x = Math.max(0, Math.min(100, data.x));
    me.facing = data.facing;
    io.to(opp.socketId).emit('opponent_move', { x: me.x, facing: me.facing });
  });

  socket.on('player_action', (data) => {
    const room = rooms.get(socket.roomCode);
    if (!room || !room.active) return;
    const opp = room.p1.socketId === socket.id ? room.p2 : room.p1;
    if (!opp) return;
    io.to(opp.socketId).emit('opponent_action', { type: data.type });
  });

  socket.on('attack', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || !room.active) return;
    const me = room.p1.socketId === socket.id ? room.p1 : room.p2;
    const opp = room.p1.socketId === socket.id ? room.p2 : room.p1;
    if (!me || !opp) return;

    const now = Date.now();
    if (now - me.lastAttack < ATTACK_COOLDOWN) return;
    me.lastAttack = now;

    const facingOpponent = (me.facing === 1 && opp.x >= me.x) || (me.facing === -1 && opp.x <= me.x);
    const dist = Math.abs(me.x - opp.x);

    if (dist <= ATTACK_RANGE && facingOpponent) {
      opp.hp = Math.max(0, opp.hp - ATTACK_DAMAGE);
      io.to(room.code).emit('hp_update', { p1hp: room.p1.hp, p2hp: room.p2.hp, hitOn: opp.socketId === room.p1.socketId ? 'p1' : 'p2' });
      if (opp.hp <= 0) {
        endMatch(room, me);
      }
    }
  });

  socket.on('rematch_request', () => {
    const room = rooms.get(socket.roomCode);
    if (!room) return;
    room.rematchVotes = room.rematchVotes || new Set();
    room.rematchVotes.add(socket.id);
    io.to(room.code).emit('rematch_waiting', { votes: room.rematchVotes.size });

    if (room.rematchVotes.size === 2) {
      room.rematchVotes = new Set();
      room.p1.hp = 100; room.p1.x = 20; room.p1.lastAttack = 0;
      room.p2.hp = 100; room.p2.x = 80; room.p2.lastAttack = 0;
      room.active = true;
      io.to(room.code).emit('rematch_start');
      startCountdownAndTimer(room);
    }
  });

  socket.on('leave_room', function () { leaveRoom(socket); });
  socket.on('disconnect', function () { leaveRoom(socket); });

  function leaveRoom(socket) {
    const room = rooms.get(socket.roomCode);
    if (!room) return;
    clearInterval(room.timerHandle);
    io.to(room.code).emit('opponent_left');
    rooms.delete(room.code);
  }
});

server.listen(PORT, function () {
  console.log('伺服器啟動於 port ' + PORT);
});
