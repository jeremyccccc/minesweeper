"use strict";

const LEVELS = {
  easy: { rows: 9, cols: 9, mines: 10, size: 38 },
  medium: { rows: 16, cols: 16, mines: 40, size: 32 },
  hard: { rows: 16, cols: 30, mines: 99, size: 28 }
};

const boardEl = document.querySelector("#board");
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
  generateMinefield();
  timerEl.textContent = "000";
  mineCountEl.textContent = formatNumber(config.mines);
  resetEl.textContent = "🙂";
  statusEl.textContent = "点击任意格子开始";
  boardEl.replaceChildren();
  boardEl.style.gridTemplateColumns = `repeat(${config.cols}, var(--cell-size))`;
  boardEl.style.setProperty("--cell-size", `${config.size}px`);

  cells.flat().forEach(cell => {
    const button = document.createElement("button");
    button.className = "cell";
    button.type = "button";
    button.setAttribute("role", "gridcell");
    button.setAttribute("aria-label", `第 ${cell.row + 1} 行，第 ${cell.col + 1} 列，未翻开`);
    button.dataset.row = cell.row;
    button.dataset.col = cell.col;
    cell.el = button;
    boardEl.append(button);
  });
}

function neighbors(row, col) {
  const found = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const next = cells[row + dr]?.[col + dc];
      if (next) found.push(next);
    }
  }
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

function reveal(cell) {
  if (ended || cell.revealed || cell.flagged) return;
  if (!started) startGame(cell);
  if (cell.mine) {
    cell.revealed = true;
    cell.el.classList.add("revealed");
    cell.el.classList.add("mine", "exploded");
    finish(false);
    return;
  }

  const queue = [cell];
  const queued = new Set(queue);
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    if (current.revealed || current.flagged || current.mine) continue;
    current.revealed = true;
    current.el.classList.add("revealed");
    current.el.setAttribute("aria-label", current.adjacent ? `周围有 ${current.adjacent} 个雷` : "安全空格");
    revealed++;
    if (current.adjacent) {
      current.el.textContent = current.adjacent;
      current.el.classList.add(`n${current.adjacent}`);
    } else {
      neighbors(current.row, current.col).forEach(next => {
        if (!queued.has(next) && !next.revealed && !next.flagged && !next.mine) {
          queued.add(next);
          queue.push(next);
        }
      });
    }
  }
  checkWin();
}

function toggleFlag(cell) {
  if (ended || cell.revealed) return;
  cell.flagged = !cell.flagged;
  flags += cell.flagged ? 1 : -1;
  cell.el.classList.toggle("flagged", cell.flagged);
  cell.el.setAttribute("aria-label", cell.flagged ? "已插旗" : "未翻开");
  mineCountEl.textContent = formatNumber(LEVELS[level].mines - flags);
}

function chord(cell) {
  if (!cell.revealed || !cell.adjacent || ended) return;
  const around = neighbors(cell.row, cell.col);
  if (around.filter(item => item.flagged).length === cell.adjacent) {
    around.forEach(reveal);
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
    if (cell.mine && !cell.flagged) cell.el.classList.add("revealed", "mine");
    if (!cell.mine && cell.flagged) cell.el.classList.add("wrong");
  });
}

function getCell(target) {
  const button = target.closest(".cell");
  if (!button) return null;
  return cells[Number(button.dataset.row)]?.[Number(button.dataset.col)];
}

boardEl.addEventListener("click", event => {
  const clickedCell = getCell(event.target);
  if (clickedCell && clickedCell === mouseHandledCell) {
    mouseHandledCell = null;
    return;
  }
  if (longPressed) { longPressed = false; return; }
  const cell = clickedCell;
  if (!cell) return;
  cell.revealed ? chord(cell) : reveal(cell);
});

boardEl.addEventListener("contextmenu", event => {
  event.preventDefault();
  const cell = getCell(event.target);
  if (!cell) return;
  cell.revealed ? chord(cell) : toggleFlag(cell);
});

boardEl.addEventListener("pointerdown", event => {
  const cell = getCell(event.target);
  if (!cell) return;
  if (event.pointerType === "mouse") {
    if (event.button === 0) {
      mouseHandledCell = cell;
      cell.revealed ? chord(cell) : reveal(cell);
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
