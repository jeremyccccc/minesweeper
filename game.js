import { LEVELS, createGame, applyAction, canChord } from "./rules.js";

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
let pressTimer = null;
let pressedCells = [];
let activeUser = "";
let rankingRange = "week";
let gameState;
let roundId = 0;
let round;
let startedAt = 0;
let rankingRequest = 0;
let rankingController;
let touchPress = null;

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "网络请求失败");
  return data;
}

async function saveWinningScore(snapshot) {
  await snapshot.startPromise;
  return api("/api/scores", {
    method: "POST",
    body: JSON.stringify({ gameId: snapshot.gameId, moves: snapshot.moves })
  });
}

async function prepareRankedGame() {
  const pendingRound = round;
  if (!started && pendingRound.player !== activeUser) {
    pendingRound.gameId = null;
    pendingRound.player = "";
  }
  if (!activeUser || pendingRound.preparing || pendingRound.gameId || pendingRound.moves.length || started) return;
  pendingRound.preparing = true;
  const player = activeUser;
  statusEl.textContent = "正在连接排行榜，可直接开始练习";
  try {
    const data = await api("/api/games", { method: "POST", body: JSON.stringify({ action: "new", level }) });
    if (round !== pendingRound || activeUser !== player || started || pendingRound.moves.length) return;
    gameState = createGame(level, data.mines);
    cells = gameState.cells;
    pendingRound.gameId = data.gameId;
    pendingRound.player = player;
    statusEl.textContent = "点击任意格子开始 · 本局可记录成绩";
  } catch {
    // Local play is always available even when the score service is offline.
    if (round === pendingRound && activeUser === player && !started && !pendingRound.moves.length) {
      statusEl.textContent = "点击任意格子开始 · 排行榜暂未连接，本局为练习";
    }
  } finally {
    pendingRound.preparing = false;
    if (round === pendingRound && activeUser && activeUser !== player) prepareRankedGame();
  }
}

function renderAccount() {
  accountInfoEl.textContent = activeUser ? `已登录：${activeUser} · 胜利成绩将自动记录` : "当前为游客，登录后可记录成绩";
  logoutEl.hidden = !activeUser;
}

async function renderRanking() {
  const request = ++rankingRequest;
  const requestedLevel = level;
  const requestedRange = rankingRange;
  rankingController?.abort();
  rankingController = new AbortController();
  rankingLevelEl.textContent = LEVEL_NAMES[requestedLevel];
  rankingListEl.replaceChildren();
  const loading = document.createElement("li");
  loading.className = "empty";
  loading.textContent = "正在加载排行榜…";
  rankingListEl.append(loading);
  let rows;
  try {
    const data = await api(`/api/scores?level=${requestedLevel}&range=${requestedRange}`, { signal: rankingController.signal });
    if (request !== rankingRequest) return;
    rows = data.scores.map(row => ({ name: row.username, time: row.seconds }));
  } catch (error) {
    if (request !== rankingRequest || error.name === "AbortError") return;
    loading.textContent = error.message === "数据库尚未连接" ? "部署后连接数据库即可启用排行榜" : error.message;
    return;
  }
  rankingListEl.replaceChildren();
  if (!rows.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = requestedRange === "week" ? "本周还没有成绩，来拿下第一名吧" : "还没有历史成绩";
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

function drawPressedCell(context, x, y, size) {
  context.fillStyle = "#bdbdbd";
  context.fillRect(x, y, size, size);
  context.strokeStyle = "#929292";
  context.lineWidth = 1;
  context.strokeRect(x + .5, y + .5, size - 1, size - 1);
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
    ["pressed", { pressed: true }],
    ["flagged", { revealed: false, flagged: true }],
    ["wrong", { revealed: false, flagged: true, wrong: true }],
    ["mine", { revealed: true, mine: true }],
    ["exploded", { revealed: true, mine: true, exploded: true }]
  ];
  for (let adjacent = 0; adjacent <= 8; adjacent++) states.push([`n${adjacent}`, { revealed: true, adjacent }]);
  states.forEach(([key, state]) => {
    if (state.pressed) {
      const sprite = document.createElement("canvas");
      sprite.width = Math.round(size * pixelRatio);
      sprite.height = Math.round(size * pixelRatio);
      const context = sprite.getContext("2d", { alpha: false });
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      drawPressedCell(context, 0, 0, size);
      sprites.set(key, sprite);
    } else {
      sprites.set(key, createTileSprite(state, size, pixelRatio));
    }
  });
  tileSpriteCache.set(cacheKey, sprites);
  tileSprites = sprites;
}

function drawCell(cell) {
  const size = LEVELS[level].size;
  const x = cell.col * size;
  const y = cell.row * size;
  boardContext.drawImage(tileSprites.get(cellSpriteKey(cell)), x, y, size, size);
}

function showPressPreview(cell) {
  clearPressPreview();
  if (ended || !cell.revealed || !cell.adjacent) return;
  const around = neighbors(cell.row, cell.col);
  if (canChord(cell, around)) return;
  pressedCells = around.filter(item => !item.revealed && !item.flagged);
  const size = LEVELS[level].size;
  const sprite = tileSprites.get("pressed");
  pressedCells.forEach(item => {
    boardContext.drawImage(sprite, item.col * size, item.row * size, size, size);
  });
}

function clearPressPreview() {
  if (!pressedCells.length) return;
  const previous = pressedCells;
  pressedCells = [];
  previous.forEach(drawCell);
}

function renderBoard() {
  const { rows, cols, size } = LEVELS[level];
  boardContext.fillStyle = "#a6a6a6";
  boardContext.fillRect(0, 0, cols * size, rows * size);
  cells.flat().forEach(drawCell);
}

function initGame() {
  clearInterval(timerId);
  clearTimeout(pressTimer);
  touchPress = null;
  round = { id: ++roundId, level, moves: [], gameId: null, player: "", startPromise: null };
  const config = LEVELS[level];
  started = false;
  ended = false;
  seconds = 0;
  startedAt = 0;
  pressedCells = [];
  gameState = createGame(level);
  cells = gameState.cells;
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
  prepareRankedGame();
}

function neighbors(row, col) {
  return cells[row]?.[col]?.nearby || [];
}

function updateTimer() {
  if (!started || ended) return;
  seconds = Math.floor(Math.max(0, performance.now() - startedAt) / 1000);
  timerEl.textContent = String(seconds).padStart(3, "0");
}

function startGame() {
  started = true;
  startedAt = performance.now();
  const ranked = round.gameId && round.player === activeUser;
  statusEl.textContent = activeUser && !ranked ? "游戏进行中 · 本局为练习，重开可重试连接排行榜" : "游戏进行中";
  if (ranked) {
    round.startPromise = api("/api/games", {
      method: "POST", body: JSON.stringify({ action: "start", gameId: round.gameId })
    });
    // Register a rejection handler now; the original promise is still checked at submission.
    round.startPromise.catch(() => {});
  }
  timerId = setInterval(updateTimer, 200);
}

function performAction(type, cell) {
  if (ended) return;
  clearPressPreview();
  const action = { type, index: cell.index };
  round.moves.push(action);
  const changed = applyAction(gameState, action);
  if (!started && gameState.started) startGame();
  mineCountEl.textContent = formatNumber(LEVELS[level].mines - gameState.flags);
  if (gameState.ended) finish(gameState.won);
  else changed.forEach(drawCell);
}

function reveal(cell) { performAction("reveal", cell); }
function toggleFlag(cell) { performAction("flag", cell); }
function chord(cell) { performAction("chord", cell); }

function finish(won) {
  updateTimer();
  ended = true;
  clearInterval(timerId);
  const finishedRound = round;
  const finishedTime = seconds;
  const finishedUser = activeUser;
  const stillCurrent = () => round === finishedRound && activeUser === finishedUser;
  resetEl.textContent = won ? "😎" : "😵";
  if (won) {
    if (activeUser && finishedRound.gameId && finishedRound.player === activeUser) {
      const snapshot = { ...finishedRound, moves: finishedRound.moves.map(move => ({ ...move })) };
      statusEl.textContent = `完成！用时 ${finishedTime} 秒 · 正在同步成绩…`;
      saveWinningScore(snapshot).then(data => {
        if (activeUser === finishedUser) renderRanking();
        if (!stillCurrent()) return;
        statusEl.textContent = `完成！用时 ${finishedTime} 秒 · 排行计时 ${data.seconds} 秒${data.isRecord ? " · 新的历史最佳！" : " · 已同步"}`;
      }).catch(error => {
        if (stillCurrent()) statusEl.textContent = `完成！用时 ${finishedTime} 秒 · 成绩未同步：${error.message}`;
      });
    } else {
      statusEl.textContent = `完成！用时 ${finishedTime} 秒 · ${activeUser ? "本局练习未计入排名，重开可重试连接" : "登录后可记录下一局成绩"}`;
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
  // Physical mouse/touch actions are handled exclusively by pointer events.
  if (event.detail !== 0 || ended) return;
  const cell = getCell(event);
  if (!cell) return;
  if (cell.flagged) {
    toggleFlag(cell);
    return;
  }
  cell.revealed ? chord(cell) : reveal(cell);
});

boardEl.addEventListener("contextmenu", event => {
  event.preventDefault();
});

boardEl.addEventListener("pointerdown", event => {
  const cell = getCell(event);
  if (!cell || ended) return;
  if (event.pointerType !== "touch") {
    if (event.button === 0) {
      if (cell.flagged) toggleFlag(cell);
      else if (!cell.revealed) reveal(cell);
      else if (canChord(cell)) chord(cell);
      else showPressPreview(cell);
    } else if (event.button === 2) {
      if (!cell.revealed) toggleFlag(cell);
      else if (canChord(cell)) chord(cell);
      else showPressPreview(cell);
    }
    return;
  }
  if (touchPress || event.isPrimary === false) return;
  const gesture = { id: event.pointerId, round, cell, x: event.clientX, y: event.clientY, long: false, cancelled: false };
  touchPress = gesture;
  pressTimer = setTimeout(() => {
    if (touchPress !== gesture || round !== gesture.round || gesture.cancelled) return;
    gesture.long = true;
    toggleFlag(cell);
    navigator.vibrate?.(35);
  }, 480);
});

boardEl.addEventListener("pointermove", event => {
  if (!touchPress || touchPress.id !== event.pointerId) return;
  if (Math.hypot(event.clientX - touchPress.x, event.clientY - touchPress.y) > 8) {
    touchPress.cancelled = true;
    clearTimeout(pressTimer);
  }
});

["pointerup", "pointercancel", "pointerleave"].forEach(type => {
  boardEl.addEventListener(type, event => {
    clearPressPreview();
    if (event.pointerType !== "touch" || !touchPress || touchPress.id !== event.pointerId) return;
    clearTimeout(pressTimer);
    const gesture = touchPress;
    touchPress = null;
    if (type === "pointerup" && !gesture.long && !gesture.cancelled && round === gesture.round && getCell(event) === gesture.cell) {
      const cell = gesture.cell;
      if (cell.flagged) toggleFlag(cell);
      else cell.revealed ? chord(cell) : reveal(cell);
    }
  });
});

window.addEventListener("blur", () => {
  clearPressPreview();
  clearTimeout(pressTimer);
  touchPress = null;
});
document.addEventListener("visibilitychange", updateTimer);

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
    prepareRankedGame();
    renderRanking();
    loginDialogEl.close();
  } catch (error) { loginErrorEl.textContent = error.message; }
});

logoutEl.addEventListener("click", async () => {
  try { await api("/api/auth", { method: "DELETE" }); } catch { /* Clear local state even if the network is unavailable. */ }
  activeUser = "";
  renderAccount();
  renderRanking();
  if (!started) {
    round.gameId = null;
    round.player = "";
  }
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
  prepareRankedGame();
  renderRanking();
}

initGame();
initializeOnlineFeatures();
