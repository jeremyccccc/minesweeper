import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { LEVELS, createGame, applyAction, canChord, getFinalFiftyFiftyPair, verifyReplay } from "../rules.js";
import { validGameId } from "../api/games.js";

const mines = [0, 2, 9, 10, 11, 20, 30, 40, 50, 60];

function finalBoard(otherIndex = 1) {
  const game = createGame("easy", mines);
  game.started = true;
  for (const cell of game.flat) {
    cell.revealed = !cell.mine && cell.index !== otherIndex;
    cell.flagged = cell.mine && cell.index !== 0;
  }
  game.flags = 9;
  game.revealed = 70;
  return game;
}

test("final 50/50: either direct choice wins and visible clues never change", () => {
  for (const index of [0, 1]) {
    const game = finalBoard();
    const clues = game.flat.filter(cell => cell.revealed).map(cell => [cell, cell.adjacent]);
    assert.equal(getFinalFiftyFiftyPair(game).length, 2);
    applyAction(game, { type: "reveal", index });
    assert.equal(game.won, true);
    clues.forEach(([cell, number]) => assert.equal(cell.adjacent, number));
  }
});

test("final 50/50: either flag is correct, then remaining safe square wins", () => {
  for (const index of [0, 1]) {
    const game = finalBoard();
    applyAction(game, { type: "flag", index });
    assert.equal(game.flat[index].mine, true);
    applyAction(game, { type: "reveal", index: index === 0 ? 1 : 0 });
    assert.equal(game.won, true);
  }
});

test("deducible final two squares do not receive guessing protection", () => {
  const game = finalBoard(80);
  assert.equal(getFinalFiftyFiftyPair(game), null);
  applyAction(game, { type: "reveal", index: 0 });
  assert.equal(game.ended, true);
  assert.equal(game.won, false);
});

test("wrong flags disable final protection", () => {
  const game = finalBoard();
  game.flat[2].flagged = false;
  game.flat[3].flagged = true;
  game.flat[3].revealed = false;
  assert.equal(getFinalFiftyFiftyPair(game), null);
});

test("first click and its neighbors are safe with the mine count preserved", () => {
  const game = createGame("easy", mines);
  applyAction(game, { type: "reveal", index: 0 });
  assert.equal(game.flat[0].adjacent, 0);
  assert.equal(game.flat[0].mine, false);
  assert.equal(game.flat.filter(cell => cell.mine).length, 10);
});

function winningMoves(level = "easy") {
  let seed = 123456789;
  const game = createGame(level, undefined, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  });
  const initial = game.flat.filter(cell => cell.mine).map(cell => cell.index);
  const moves = [];
  const act = (type, index) => {
    const move = { type, index };
    moves.push(move);
    applyAction(game, move);
  };
  act("reveal", 0);
  while (!game.ended) {
    const next = game.flat.find(cell => !cell.mine && !cell.revealed);
    assert.ok(next);
    act("reveal", next.index);
  }
  return { initial, moves, game };
}

test("server replay accepts complete wins in all three difficulties", () => {
  for (const level of Object.keys(LEVELS)) {
    const { initial, moves } = winningMoves(level);
    assert.equal(verifyReplay(level, initial, moves), true);
    assert.equal(verifyReplay(level, initial, moves.slice(0, -1)), false);
    assert.equal(verifyReplay(level, initial, [...moves, { type: "flag", index: 0 }]), false);
  }
});

test("replay rejects malformed, empty and out-of-bounds operations", () => {
  for (const moves of [null, [], [{ type: "win", index: 0 }], [{ type: "reveal", index: -1 }], [{ type: "reveal", index: 81 }]]) {
    assert.equal(verifyReplay("easy", mines, moves), false);
  }
});

test("chording the last safe square completes the board", () => {
  const game = winningMoves().game;
  game.ended = game.won = false;
  const last = game.flat.find(cell => !cell.mine && cell.adjacent > 0);
  last.revealed = false;
  game.revealed--;
  game.flat.filter(cell => cell.mine).forEach(cell => { cell.flagged = true; });
  const origin = last.nearby.find(cell => canChord(cell));
  assert.ok(origin);
  const changed = applyAction(game, { type: "chord", index: origin.index });
  assert.equal(game.won, true);
  assert.ok(changed.has(last));
});

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
const response = data => ({ ok: true, json: async () => data });

function browser(fetcher = async () => response({ scores: [], mines, gameId: "00000000-0000-4000-8000-000000000001" })) {
  const elements = new Map();
  let sprite = 0;
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      textContent: "", children: [], style: {}, listeners: {}, clientLeft: 0, clientTop: 0,
      addEventListener(type, fn) { this.listeners[type] = fn; },
      replaceChildren() { this.children = []; }, append(child) { this.children.push(child); },
      getBoundingClientRect() { return { left: 0, top: 0, width: 342, height: 342 }; },
      getContext() { return { drawImage() {}, fillRect() {}, setTransform() {}, beginPath() {}, moveTo() {}, lineTo() {}, fill() {}, strokeRect() {}, fillText() {} }; }
    });
    return elements.get(id);
  };
  const clock = { now: 0 };
  const context = vm.createContext({
    LEVELS, createGame, applyAction, canChord, AbortController, console, fetch: fetcher,
    performance: { now: () => clock.now }, navigator: {},
    setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {},
    window: { addEventListener() {} },
    document: { querySelector: element, querySelectorAll: () => [], createElement: () => element(`sprite${sprite++}`), addEventListener() {} }
  });
  const source = readFileSync(new URL("../game.js", import.meta.url), "utf8")
    .replace(/^import .*;\r?\n/, "")
    .replace(/initGame\(\);\s*initializeOnlineFeatures\(\);\s*$/, "");
  vm.runInContext(source, context);
  const run = source => vm.runInContext(source, context);
  run("initGame()");
  return { run, clock, elements, context };
}

test("mouse press is instant; dragging and compatibility click cannot act twice", () => {
  const { run } = browser();
  const result = run(`(() => {
    cells[0][0].flagged = cells[0][1].flagged = true;
    gameState.flags = 2;
    boardEl.listeners.pointerdown({ pointerType: 'mouse', button: 0, clientX: 19, clientY: 19 });
    const immediate = !cells[0][0].flagged;
    boardEl.listeners.click({ detail: 1, clientX: 57, clientY: 19 });
    return { immediate, otherFlag: cells[0][1].flagged, moves: round.moves.length };
  })()`);
  assert.equal(result.immediate, true);
  assert.equal(result.otherFlag, true);
  assert.equal(result.moves, 1);
});

test("right press and contextmenu create just one flag operation", () => {
  const { run } = browser();
  assert.equal(run(`(() => {
    boardEl.listeners.pointerdown({ pointerType: 'mouse', button: 2, clientX: 19, clientY: 19 });
    boardEl.listeners.contextmenu({ preventDefault() {}, clientX: 19, clientY: 19 });
    return cells[0][0].flagged && round.moves.length === 1;
  })()`), true);
});

test("clock catches up after throttling and continues beyond 999 seconds", () => {
  const { run, clock } = browser();
  run("reveal(cells[0][0])");
  clock.now = 1005500;
  run("updateTimer()");
  assert.equal(run("seconds"), 1005);
  assert.equal(run("timerEl.textContent"), "1005");
});

test("late ranking responses cannot overwrite a newer difficulty/range", async () => {
  const first = deferred(), second = deferred();
  let calls = 0;
  const { run } = browser(() => ++calls === 1 ? first.promise : second.promise);
  const old = run("renderRanking()");
  const current = run("level = 'hard'; rankingRange = 'history'; renderRanking()");
  second.resolve(response({ scores: [{ username: "new", seconds: 12 }] }));
  await current;
  first.resolve(response({ scores: [{ username: "old", seconds: 1 }] }));
  await old;
  assert.equal(run("rankingLevelEl.textContent"), "高级");
  assert.equal(run("rankingListEl.children[0].children[0].textContent"), "new");
});

test("late score upload cannot replace the new round's status", async () => {
  const score = deferred();
  let submitted;
  const { run } = browser((path, options) => {
    if (path === "/api/scores" && options?.method === "POST") {
      submitted = JSON.parse(options.body);
      return score.promise;
    }
    return Promise.resolve(response({ scores: [], mines, gameId: "00000000-0000-4000-8000-000000000001" }));
  });
  run("activeUser='alice'; started=true; round.player='alice'; round.gameId='00000000-0000-4000-8000-000000000002'; round.startPromise=Promise.resolve(); finish(true)");
  await new Promise(resolve => setImmediate(resolve));
  run("initGame(); reveal(cells[0][0]); statusEl.textContent='新一局进行中'");
  score.resolve(response({ seconds: 22, isRecord: true }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(run("statusEl.textContent"), "新一局进行中");
  assert.equal(submitted.gameId, "00000000-0000-4000-8000-000000000002");
  assert.equal("seconds" in submitted, false);
});

test("late ranked-board preparation never replaces a game already in progress", async () => {
  const pending = deferred();
  const { run } = browser(() => pending.promise);
  const preparing = run("activeUser='alice'; prepareRankedGame()");
  run("reveal(cells[0][0]); globalThis.originalBoard=gameState");
  pending.resolve(response({ gameId: "00000000-0000-4000-8000-000000000001", mines }));
  await preparing;
  assert.equal(run("gameState === originalBoard"), true);
  assert.equal(run("round.gameId"), null);
  assert.equal(run("gameState.started"), true);
});

function scoreEndpoint(rows, player = { id: 7 }) {
  const queries = [];
  const context = vm.createContext({
    console, verifyReplay, validGameId,
    currentPlayer: async () => player, ensureSchema: async () => {},
    process: { env: {} },
    database: () => async (strings, ...values) => {
      queries.push({ sql: strings.join("?"), values });
      return rows.shift() || [];
    }
  });
  const source = readFileSync(new URL("../api/scores.js", import.meta.url), "utf8")
    .replace(/^import .*;\r?\n/gm, "").replace("export default async function handler", "async function handler");
  vm.runInContext(source, context);
  return {
    queries,
    async post(body) {
      const res = { status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
      await context.handler({ method: "POST", body }, res);
      return res;
    }
  };
}

const gameId = "00000000-0000-4000-8000-000000000001";
test("score endpoint rejects direct seconds submissions and unauthenticated players", async () => {
  const server = scoreEndpoint([]);
  assert.equal((await server.post({ level: "easy", seconds: 0 })).code, 400);
  assert.equal(server.queries.length, 0);
  assert.equal((await scoreEndpoint([], null).post({ gameId })).code, 401);
});

test("score endpoint rejects incomplete replays, missing, unstarted and expired games", async () => {
  for (const run of [null, { valid: false }, { valid: true }, { valid: true, started_at: new Date(), level: "easy", mine_indices: mines }]) {
    const server = scoreEndpoint([run ? [run] : []]);
    const result = await server.post({ gameId, moves: [{ type: "reveal", index: 0 }] });
    assert.ok([400, 409].includes(result.code));
    assert.equal(server.queries.length, 1);
  }
});

test("valid completed replay uses server timing and one atomic score write", async () => {
  const { initial, moves } = winningMoves();
  const server = scoreEndpoint([
    [{ valid: true, started_at: new Date(), level: "easy", mine_indices: initial }],
    [{ seconds: 27, isRecord: true }]
  ]);
  const result = await server.post({ gameId, moves, seconds: 0 });
  assert.equal(result.code, 200);
  assert.equal(result.data.seconds, 27);
  assert.equal(server.queries.length, 2);
  assert.match(server.queries[1].sql, /WITH claimed AS/);
  assert.match(server.queries[1].sql, /completed_at IS NULL/);
});

test("retry of completed run returns saved time without another ranking write", async () => {
  const server = scoreEndpoint([[{ valid: true, started_at: new Date(), completed_at: new Date(), score_seconds: 34 }]]);
  const result = await server.post({ gameId, moves: [] });
  assert.equal(result.code, 200);
  assert.equal(result.data.seconds, 34);
  assert.equal(server.queries.length, 1);
});
