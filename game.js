"use strict";

const LEVELS = {
  easy: { rows: 9, cols: 9, mines: 10, size: 38 },
  medium: { rows: 16, cols: 16, mines: 40, size: 32 },
  hard: { rows: 16, cols: 30, mines: 99, size: 28 }
};

const boardEl = document.querySelector("#board");
const boardContext = boardEl.getContext("2d", { alpha: false });
const mineCountEl = document.querySelector("#mine-count");
const timerEl = document.querySelector("#timer");
const resetEl = document.querySelector("#reset");
const statusEl = document.querySelector("#status");
const levelButtons = [...document.querySelectorAll(".level")];
const accountInfoEl = document.querySelector("#account-info");
const loginOpenEl = document.querySelector("#login-open");
const loginDialogEl = document.querySelector("#login-dialog");
const loginFormEl = document.querySelector("#login-form");
const loginCloseEl = document.querySelector("#login-close");
const usernameEl = document.querySelector("#username");
const passwordEl = document.querySelector("#password");
const loginErrorEl = document.querySelector("#login-error");
const logoutEl = document.querySelector("#logout");
const rankingListEl = document.querySelector("#ranking-list");
const rankingLevelEl = document.querySelector("#ranking-level");
const rankingTabs = [...document.querySelectorAll(".ranking-tab")];

const LEVEL_NAMES = { easy: "初级", medium: "中级", hard: "高级" };

let level = "easy";
let cells = [];
let started = false;
let ended = false;
let seconds = 0;
let timerId = null;
let flags = 0;
let revealed = 0;
let pressTimer = null;
let longPressed = false;
let mouseHandledCell = null;
let activeUser = "";
let rankingRange = "week";

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "网络请求失败");
  return data;
}

async function saveWinningScore(time) {
  if (!activeUser) return false;
  const data = await api("/api/scores", { method: "POST", body: JSON.stringify({ level, seconds: time }) });
  renderRanking();
  return data.isRecord;
}

function renderAccount() {
  accountInfoEl.textContent = activeUser ? `已登录：${activeUser} · 胜利成绩将自动记录` : "当前为游客，登录后可记录成绩";
  logoutEl.hidden = !activeUser;
}

async function renderRanking() {
  rankingLevelEl.textContent = LEVEL_NAMES[level];
  rankingListEl.replaceChildren();
  const loading = document.createElement("li");
  loading.className = "empty";
  loading.textContent = "正在加载排行榜…";
  rankingListEl.append(loading);
  let rows;
  try {
    const data = await api(`/api/scores?level=${level}&range=${rankingRange}`);
    rows = data.scores.map(row => ({ name: row.username, time: row.seconds }));
  } catch (error) {
    loading.textContent = error.message === "数据库尚未连接" ? "部署后连接数据库即可启用排行榜" : error.message;
    return;
  }
  rankingListEl.replaceChildren();
  if (!rows.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = rankingRange === "week" ? "本周还没有成绩，来拿下第一名吧" : "还没有历史成绩";
    rankingListEl.append(empty);
    return;
  }
  rows.slice(0, 20).forEach(row => {
    const item = document.createElement("li");
    if (row.name === activeUser) item.classList.add("current");
    const name = document.createElement("span");
    name.className = "rank-name";
    name.textContent = row.name;
    const time = document.createElement("span");
    time.className = "rank-time";
    time.textContent = `${row.time} 秒`;
    item.append(name, time);
    rankingListEl.append(item);
  });
}

function formatNumber(number) {
  const clamped = Math.max(-99, Math.min(999, number));
  return clamped < 0 ? `-${String(Math.abs(clamped)).padStart(2, "0")}` : String(clamped).padStart(3, "0");
}

const NUMBER_COLORS = ["", "#0000ff", "#008a00", "#d80000", "#000080", "#800000", "#008080", "#000000", "#666666"];
let tileSprites = new Map();
const tileSpriteCache = new Map();

function drawCoveredCell(context, cell, x, y, size) {
  context.fillStyle = "#c9c9c9";
  context.fillRect(x, y, size, size);
  context.fillStyle = "rgba(255,255,255,.82)";
  context.beginPath();
  context.moveTo(x, y + size);
  context.lineTo(x, y);
  context.lineTo(x + size, y);
  context.lineTo(x + size - 2, y + 2);
  context.lineTo(x + 2, y + 2);
  context.lineTo(x + 2, y + size - 2);
  context.fill();
  context.fillStyle = "rgba(70,70,70,.38)";
  context.beginPath();
  context.moveTo(x, y + size);
  context.lineTo(x + size, y + size);
  context.lineTo(x + size, y);
  context.lineTo(x + size - 2, y + 2);
  context.lineTo(x + size - 2, y + size - 2);
  context.lineTo(x + 2, y + size - 2);
  context.fill();
  if (cell.flagged) drawSymbol(context, "⚑", x, y, size, "#e00000", .7);
  if (cell.wrong) drawSymbol(context, "×", x, y, size, "#d80000", .85);
}

function drawSymbol(context, symbol, x, y, size, color, scale = .75) {
  context.fillStyle = color;
  context.font = `900 ${Math.floor(size * scale)}px "Arial Black", "Segoe UI Symbol", sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(symbol, x + size / 2, y + size / 2 + 1);
}

function drawCellState(context, cell, x, y, size) {
  if (!cell.revealed) {
    drawCoveredCell(context, cell, x, y, size);
    return;
  }
  context.fillStyle = "#b4b4b4";
  context.fillRect(x, y, size, size);
  context.strokeStyle = "#8a8a8a";
  context.lineWidth = 1;
  context.strokeRect(x + .5, y + .5, size - 1, size - 1);
  if (cell.mine) drawSymbol(context, "✹", x, y, size, "#2e3732", .82);
  else if (cell.adjacent) drawSymbol(context, String(cell.adjacent), x, y, size, NUMBER_COLORS[cell.adjacent], .82);
}

function cellSpriteKey(cell) {
  if (!cell.revealed) return cell.wrong ? "wrong" : cell.flagged ? "flagged" : "covered";
  if (cell.exploded) return "exploded";
  if (cell.mine) return "mine";
  return `n${cell.adjacent}`;
}

function createTileSprite(cell, size, pixelRatio) {
  const sprite = document.createElement("canvas");
  sprite.width = Math.round(size * pixelRatio);
  sprite.height = Math.round(size * pixelRatio);
  const context = sprite.getContext("2d", { alpha: false });
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  drawCellState(context, cell, 0, 0, size);
  return sprite;
}

function buildTileSprites(size, pixelRatio) {
  const cacheKey = `${size}@${pixelRatio}`;
  if (tileSpriteCache.has(cacheKey)) {
    tileSprites = tileSpriteCache.get(cacheKey);
    return;
  }
  const sprites = new Map();
  const states = [
    ["covered", { revealed: false }],
    ["flagged", { revealed: false, flagged: true }],
    ["wrong", { revealed: false, flagged: true, wrong: true }],
    ["mine", { revealed: true, mine: true }],
    ["exploded", { revealed: true, mine: true, exploded: true }]
  ];
  for (let adjacent = 0; adjacent <= 8; adjacent++) states.push([`n${adjacent}`, { revealed: true, adjacent }]);
  states.forEach(([key, state]) => sprites.set(key, createTileSprite(state, size, pixelRatio)));
  tileSpriteCache.set(cacheKey, sprites);
  tileSprites = sprites;
}

function drawCell(cell) {
  const size = LEVELS[level].size;
  const x = cell.col * size;
  const y = cell.row * size;
  boardContext.drawImage(tileSprites.get(cellSpriteKey(cell)), x, y, size, size);
}

function renderBoard() {
  const { rows, cols, size } = LEVELS[level];
  boardContext.fillStyle = "#a6a6a6";
  boardContext.fillRect(0, 0, cols * size, rows * size);
  cells.flat().forEach(drawCell);
}

function initGame() {
  clearInterval(timerId);
  const config = LEVELS[level];
  started = false;
  ended = false;
  seconds = 0;
  flags = 0;
  revealed = 0;
  cells = Array.from({ length: config.rows }, (_, row) =>
    Array.from({ length: config.cols }, (_, col) => ({ row, col, mine: false, adjacent: 0, revealed: false, flagged: false }))
  );
  cells.flat().forEach(cell => neighbors(cell.row, cell.col));
  generateMinefield();
  timerEl.textContent = "000";
  mineCountEl.textContent = formatNumber(config.mines);
  resetEl.textContent = "🙂";
  statusEl.textContent = "点击任意格子开始";
  const pixelRatio = 1;
  const width = config.cols * config.size;
  const height = config.rows * config.size;
  boardEl.width = Math.round(width * pixelRatio);
  boardEl.height = Math.round(height * pixelRatio);
  boardEl.style.width = `${width}px`;
  boardEl.style.height = `${height}px`;
  boardContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  boardContext.imageSmoothingEnabled = false;
  buildTileSprites(config.size, pixelRatio);
  renderBoard();
}

function neighbors(row, col) {
  const origin = cells[row]?.[col];
  if (origin?.nearby) return origin.nearby;
  const found = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const next = cells[row + dr]?.[col + dc];
      if (next) found.push(next);
    }
  }
  if (origin) origin.nearby = found;
  return found;
}

function recalculateNumbers() {
  cells.flat().forEach(cell => { cell.adjacent = 0; });
  cells.flat().filter(cell => cell.mine).forEach(mine => {
    neighbors(mine.row, mine.col).forEach(cell => { cell.adjacent++; });
  });
}

function generateMinefield() {
  const { mines } = LEVELS[level];
  const choices = cells.flat();
  for (let i = choices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [choices[i], choices[j]] = [choices[j], choices[i]];
  }
  choices.slice(0, mines).forEach(cell => { cell.mine = true; });
  recalculateNumbers();
}

function makeFirstClickSafe(safeCell) {
  const safeZone = new Set([safeCell, ...neighbors(safeCell.row, safeCell.col)]);
  const minesToMove = [...safeZone].filter(cell => cell.mine);
  if (!minesToMove.length) return;
  const destinations = cells.flat().filter(cell => !safeZone.has(cell) && !cell.mine);
  minesToMove.forEach((mine, index) => {
    mine.mine = false;
    destinations[index].mine = true;
  });
  recalculateNumbers();
}

function startGame(firstCell) {
  makeFirstClickSafe(firstCell);
  started = true;
  statusEl.textContent = "游戏进行中";
  timerId = setInterval(() => {
    seconds = Math.min(999, seconds + 1);
    timerEl.textContent = formatNumber(seconds);
  }, 1000);
}

function reveal(cell, deferDraw = false) {
  if (ended || cell.revealed || cell.flagged) return [];
  if (!started) startGame(cell);
  if (cell.mine) {
    cell.revealed = true;
    cell.exploded = true;
    finish(false);
    return [];
  }

  if (cell.adjacent) {
    cell.revealed = true;
    revealed++;
    if (!deferDraw) drawCell(cell);
    checkWin();
    return [cell];
  }

  const queue = [cell];
  const queued = new Set(queue);
  const changed = [];
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    if (current.revealed || current.flagged || current.mine) continue;
    current.revealed = true;
    changed.push(current);
    revealed++;
    if (!current.adjacent) {
      neighbors(current.row, current.col).forEach(next => {
        if (!queued.has(next) && !next.revealed && !next.flagged && !next.mine) {
          queued.add(next);
          queue.push(next);
        }
      });
    }
  }
  if (!deferDraw) changed.forEach(drawCell);
  checkWin();
  return changed;
}

function toggleFlag(cell) {
  if (ended || cell.revealed) return;
  cell.flagged = !cell.flagged;
  flags += cell.flagged ? 1 : -1;
  mineCountEl.textContent = formatNumber(LEVELS[level].mines - flags);
  drawCell(cell);
}

function chord(cell) {
  if (!cell.revealed || !cell.adjacent || ended) return;
  const around = neighbors(cell.row, cell.col);
  if (around.filter(item => item.flagged).length === cell.adjacent) {
    const changed = around.flatMap(item => reveal(item, true));
    if (!ended) changed.forEach(drawCell);
  }
}

function checkWin() {
  const config = LEVELS[level];
  if (!ended && revealed === config.rows * config.cols - config.mines) finish(true);
}

function finish(won) {
  ended = true;
  clearInterval(timerId);
  resetEl.textContent = won ? "😎" : "😵";
  if (won) {
    if (activeUser) {
      statusEl.textContent = `完成！用时 ${seconds} 秒 · 正在同步成绩…`;
      saveWinningScore(seconds).then(isRecord => {
        statusEl.textContent = `完成！用时 ${seconds} 秒${isRecord ? " · 新的历史最佳！" : " · 已同步"}`;
      }).catch(error => { statusEl.textContent = `完成！用时 ${seconds} 秒 · ${error.message}`; });
    } else {
      statusEl.textContent = `完成！用时 ${seconds} 秒 · 登录后可记录成绩`;
    }
  } else {
    statusEl.textContent = "踩到雷了，再试一次吧";
  }

  cells.flat().forEach(cell => {
    if (cell.mine && !cell.flagged) cell.revealed = true;
    if (!cell.mine && cell.flagged) cell.wrong = true;
  });
  renderBoard();
}

function getCell(event) {
  const rect = boardEl.getBoundingClientRect();
  const { cols, rows } = LEVELS[level];
  const x = event.clientX - rect.left - boardEl.clientLeft;
  const y = event.clientY - rect.top - boardEl.clientTop;
  const col = Math.floor((x / (rect.width - boardEl.clientLeft * 2)) * cols);
  const row = Math.floor((y / (rect.height - boardEl.clientTop * 2)) * rows);
  return cells[row]?.[col] || null;
}

boardEl.addEventListener("click", event => {
  const clickedCell = getCell(event);
  if (clickedCell && clickedCell === mouseHandledCell) {
    mouseHandledCell = null;
    return;
  }
  if (longPressed) { longPressed = false; return; }
  const cell = clickedCell;
  if (!cell) return;
  if (cell.flagged) {
    toggleFlag(cell);
    return;
  }
  cell.revealed ? chord(cell) : reveal(cell);
});

boardEl.addEventListener("contextmenu", event => {
  event.preventDefault();
  const cell = getCell(event);
  if (!cell) return;
  cell.revealed ? chord(cell) : toggleFlag(cell);
});

boardEl.addEventListener("pointerdown", event => {
  const cell = getCell(event);
  if (!cell) return;
  if (event.pointerType === "mouse") {
    if (event.button === 0) {
      mouseHandledCell = cell;
      if (cell.flagged) toggleFlag(cell);
      else cell.revealed ? chord(cell) : reveal(cell);
    }
    return;
  }
  longPressed = false;
  pressTimer = setTimeout(() => {
    longPressed = true;
    toggleFlag(cell);
    navigator.vibrate?.(35);
  }, 480);
});

["pointerup", "pointercancel", "pointerleave"].forEach(type => {
  boardEl.addEventListener(type, event => {
    clearTimeout(pressTimer);
    if (event.pointerType === "mouse" && type !== "pointerup") mouseHandledCell = null;
  });
});

resetEl.addEventListener("click", initGame);
levelButtons.forEach(button => {
  button.addEventListener("click", () => {
    level = button.dataset.level;
    levelButtons.forEach(item => item.classList.toggle("active", item === button));
    initGame();
    renderRanking();
  });
});

loginOpenEl.addEventListener("click", () => {
  usernameEl.value = activeUser;
  passwordEl.value = "";
  loginErrorEl.textContent = "";
  loginDialogEl.showModal();
  usernameEl.focus();
});

loginCloseEl.addEventListener("click", () => loginDialogEl.close());
loginFormEl.addEventListener("submit", async event => {
  event.preventDefault();
  const name = usernameEl.value.trim().replace(/\s+/g, " ");
  const password = passwordEl.value;
  if (name.length < 1 || name.length > 16 || password.length < 6) {
    loginErrorEl.textContent = "昵称需为 1–16 个字符，密码至少 6 位";
    return;
  }
  loginErrorEl.textContent = "正在连接…";
  try {
    const data = await api("/api/auth", { method: "POST", body: JSON.stringify({ username: name, password, action: event.submitter?.dataset.action || "login" }) });
    activeUser = data.user.username;
    renderAccount();
    renderRanking();
    loginDialogEl.close();
  } catch (error) { loginErrorEl.textContent = error.message; }
});

logoutEl.addEventListener("click", async () => {
  try { await api("/api/auth", { method: "DELETE" }); } catch { /* Clear local state even if the network is unavailable. */ }
  activeUser = "";
  renderAccount();
  renderRanking();
  loginDialogEl.close();
});

rankingTabs.forEach(button => {
  button.addEventListener("click", () => {
    rankingRange = button.dataset.range;
    rankingTabs.forEach(item => item.classList.toggle("active", item === button));
    renderRanking();
  });
});

async function initializeOnlineFeatures() {
  try {
    const data = await api("/api/auth");
    activeUser = data.user?.username || "";
  } catch { activeUser = ""; }
  renderAccount();
  renderRanking();
}

initGame();
initializeOnlineFeatures();
