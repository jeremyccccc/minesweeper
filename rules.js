// Shared by the browser and score verifier so both use exactly the same rules.
export const LEVELS = {
  easy: { rows: 9, cols: 9, mines: 10, size: 38 },
  medium: { rows: 16, cols: 16, mines: 40, size: 32 },
  hard: { rows: 16, cols: 30, mines: 99, size: 28 }
};

export function createGame(level, mineIndices, random = Math.random) {
  const config = LEVELS[level];
  if (!config) throw new Error("无效难度");
  const cells = Array.from({ length: config.rows }, (_, row) =>
    Array.from({ length: config.cols }, (_, col) => ({
      row, col, index: row * config.cols + col, mine: false, adjacent: 0,
      revealed: false, flagged: false, nearby: []
    }))
  );
  const flat = cells.flat();
  for (const cell of flat) {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const next = cells[cell.row + dr]?.[cell.col + dc];
        if (next && next !== cell) cell.nearby.push(next);
      }
    }
  }
  if (!mineIndices) {
    const choices = flat.map(cell => cell.index);
    for (let i = choices.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [choices[i], choices[j]] = [choices[j], choices[i]];
    }
    mineIndices = choices.slice(0, config.mines);
  }
  if (!Array.isArray(mineIndices) || mineIndices.length !== config.mines ||
      new Set(mineIndices).size !== config.mines ||
      !mineIndices.every(index => Number.isInteger(index) && index >= 0 && index < flat.length)) {
    throw new Error("无效棋盘");
  }
  mineIndices.forEach(index => { flat[index].mine = true; });
  const game = { level, cells, flat, started: false, ended: false, won: false, flags: 0, revealed: 0 };
  recalculateNumbers(game);
  return game;
}

function recalculateNumbers(game) {
  game.flat.forEach(cell => { cell.adjacent = 0; });
  game.flat.filter(cell => cell.mine).forEach(cell => {
    cell.nearby.forEach(next => { next.adjacent++; });
  });
}

function makeFirstClickSafe(game, cell) {
  const safeZone = new Set([cell, ...cell.nearby]);
  const mines = [...safeZone].filter(item => item.mine);
  const destinations = game.flat.filter(item => !safeZone.has(item) && !item.mine);
  mines.forEach((item, index) => {
    item.mine = false;
    destinations[index].mine = true;
  });
  if (mines.length) recalculateNumbers(game);
}

export function getFinalFiftyFiftyPair(game) {
  if (game.ended || game.flat.length - LEVELS[game.level].mines - game.revealed !== 1) return null;
  const candidates = game.flat.filter(cell => !cell.revealed && !cell.flagged);
  if (candidates.length !== 2 || candidates.filter(cell => cell.mine).length !== 1 ||
      game.flat.some(cell => cell.flagged && !cell.mine)) return null;
  const [a, b] = candidates;
  // Swapping the mine must leave EVERY visible clue unchanged.
  if (game.flat.some(cell => cell.revealed &&
      cell.nearby.includes(a) !== cell.nearby.includes(b))) return null;
  return candidates;
}

function protectFinalChoice(game, cell, shouldBeMine) {
  if (cell.mine === shouldBeMine) return;
  const pair = getFinalFiftyFiftyPair(game);
  if (!pair || !pair.includes(cell)) return;
  const other = pair[0] === cell ? pair[1] : pair[0];
  cell.mine = shouldBeMine;
  other.mine = !shouldBeMine;
  recalculateNumbers(game);
}

export function canChord(cell) {
  return cell.revealed && cell.adjacent > 0 &&
    cell.nearby.filter(item => item.flagged).length === cell.adjacent;
}

export function applyAction(game, action) {
  if (!action || !["reveal", "flag", "chord"].includes(action.type) ||
      !Number.isInteger(action.index) || !game.flat[action.index]) throw new Error("无效操作");
  const changed = new Set();
  const cell = game.flat[action.index];
  if (game.ended) return changed;

  function reveal(target, protectGuess) {
    if (game.ended || target.revealed || target.flagged) return;
    if (!game.started) {
      makeFirstClickSafe(game, target);
      game.started = true;
    }
    if (protectGuess) protectFinalChoice(game, target, false);
    if (target.mine) {
      target.revealed = true;
      target.exploded = true;
      game.ended = true;
      changed.add(target);
      return;
    }
    const queue = [target];
    const queued = new Set(queue);
    for (let i = 0; i < queue.length; i++) {
      const next = queue[i];
      if (next.revealed || next.flagged || next.mine) continue;
      next.revealed = true;
      changed.add(next);
      game.revealed++;
      if (!next.adjacent) next.nearby.forEach(item => {
        if (!item.revealed && !item.flagged && !item.mine && !queued.has(item)) {
          queued.add(item);
          queue.push(item);
        }
      });
    }
    if (game.revealed === game.flat.length - LEVELS[game.level].mines) {
      game.ended = true;
      game.won = true;
    }
  }

  if (action.type === "flag" && !cell.revealed) {
    if (!cell.flagged) protectFinalChoice(game, cell, true);
    cell.flagged = !cell.flagged;
    game.flags += cell.flagged ? 1 : -1;
    changed.add(cell);
  } else if (action.type === "reveal") {
    reveal(cell, true);
  } else if (action.type === "chord" && canChord(cell)) {
    cell.nearby.forEach(item => reveal(item, false));
  }
  return changed;
}

export function verifyReplay(level, mineIndices, moves) {
  if (!Array.isArray(mineIndices) || !Array.isArray(moves) || !moves.length || moves.length > 20000) return false;
  try {
    const game = createGame(level, mineIndices);
    for (const move of moves) {
      if (game.ended) return false;
      applyAction(game, move);
    }
    return game.won;
  } catch {
    return false;
  }
}
