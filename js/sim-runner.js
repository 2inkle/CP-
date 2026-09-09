// 헤드리스 AI 시뮬레이터 — 렌더링/딜레이 없이 다수 국을 자동 진행하고 지표+로그를 남긴다.
// game.js/ai.js/personas.js의 전역 함수를 오버라이드해서 동작한다 (원본 파일은 건드리지 않음).

const SIM_HISTORY_KEY = 'mahjong_sim_history';
const SIM_MAX_LOG_LINES = 5000;
const SIM_WATCHDOG_MS = 1500; // 이 시간 동안 국이 안 넘어가면 강제로 다음 턴을 다시 걸어준다

let sim = null; // 현재 실행 중인 시뮬레이션 상태

function simLog(msg) {
  if (!sim) return;
  const line = `[${((performance.now() - sim.startTs) / 1000).toFixed(1)}s] ${msg}`;
  sim.logLines.push(line);
  if (sim.logLines.length > SIM_MAX_LOG_LINES) sim.logLines.shift();
  const el = document.getElementById('log');
  if (el) {
    el.textContent += line + '\n';
    el.scrollTop = el.scrollHeight;
  }
}

function snapshotStateForDiag() {
  try {
    return {
      handNo: state.handNo, dealerIdx: state.dealerIdx, wall: state.wall.length,
      players: state.players.map(p => ({ id: p.id, isHuman: p.isHuman, persona: p.persona && p.persona.id, hand: p.hand.length, melds: p.melds.map(m => m.kind), riichi: p.riichi, discards: p.discards.length }))
    };
  } catch (e) { return { error: String(e) }; }
}

function setupSimOverrides() {
  window.sleep = () => Promise.resolve();
  window.renderAll = () => {};
  window.renderActionPanel = () => {};
  window.showResultOverlay = () => Promise.resolve();
  window.logMsg = () => {};

  const origDoPon = window.doPon;
  window.doPon = function(player) { const r = origDoPon.apply(this, arguments); if (sim && player.id === sim.targetSeatId) sim.calledThisHand = true; return r; };
  const origDoChi = window.doChi;
  window.doChi = function(player) { const r = origDoChi.apply(this, arguments); if (sim && player.id === sim.targetSeatId) sim.calledThisHand = true; return r; };

  const origSetupHand = window.setupHand;
  window.setupHand = function() {
    if (sim) { sim.calledThisHand = false; sim.targetCtxHistory = []; }
    return origSetupHand.apply(this, arguments);
  };

  // 페르소나 판단 스냅샷: 대상 좌석의 buildAiContext 호출마다 목표/샹텐/폴드여부를 기록
  const origBuildAiContext = window.buildAiContext;
  window.buildAiContext = function(player) {
    const ctx = origBuildAiContext.apply(this, arguments);
    if (sim && player.id === sim.targetSeatId) {
      const folded = ctx.threatLevel >= 1 && typeof ctx.shouldFold === 'function' && ctx.shouldFold();
      const snap = { turn: player.discards.length, shanten: ctx.ownShanten, goal: resolveGoal(player.persona, ctx), threatLevel: ctx.threatLevel, isBehind: ctx.isBehind, folded };
      sim.lastTargetCtx = snap;
      sim.targetCtxHistory.push(snap);
    }
    return ctx;
  };

  const origResolveWin = window.resolveWin;
  window.resolveWin = async function(winInfos) {
    sim.handsDone++;
    sim.lastProgressTs = performance.now();
    const discarderIdx = winInfos[0].isTsumo ? -1 : findLastDiscarderIdx();
    const targetWon = winInfos.find(i => i.player.id === sim.targetSeatId);
    const targetDealtIn = (!winInfos[0].isTsumo && discarderIdx === sim.targetSeatId && !targetWon);

    if (targetWon) { sim.wins++; sim.winPoints += targetWon.win.total; sim.winDetails.push({ han: targetWon.win.han, fu: targetWon.win.fu, total: targetWon.win.total, isTsumo: targetWon.isTsumo }); }
    if (targetDealtIn) sim.dealIns++;
    if (sim.calledThisHand) sim.calledHands++;

    const outcome = targetWon ? (targetWon.isTsumo ? 'win-tsumo' : 'win-ron') : (targetDealtIn ? 'dealt-in' : (winInfos.some(i => true) ? 'other-won' : 'unknown'));
    sim.handRecords.push({
      game: sim.gamesDone + 1, hand: sim.handsDone, outcome,
      finalGoal: sim.lastTargetCtx ? sim.lastTargetCtx.goal : null,
      finalShanten: sim.lastTargetCtx ? sim.lastTargetCtx.shanten : null,
      foldedAnyTurn: sim.targetCtxHistory.some(c => c.folded),
      turns: sim.targetCtxHistory.length
    });
    simLog(`국#${sim.handsDone} 종료: ${outcome} (목표=${sim.lastTargetCtx ? sim.lastTargetCtx.goal : '?'}, 샹텐=${sim.lastTargetCtx ? sim.lastTargetCtx.shanten : '?'}, 폴드경험=${sim.targetCtxHistory.some(c => c.folded)})`);

    const r = await origResolveWin.apply(this, arguments);
    updateStatsUI();
    return r;
  };

  const origDraw = window.handleExhaustiveDraw;
  window.handleExhaustiveDraw = async function() {
    sim.handsDone++;
    sim.lastProgressTs = performance.now();
    if (sim.calledThisHand) sim.calledHands++;
    const targetTenpai = sim.lastTargetCtx ? sim.lastTargetCtx.shanten === 0 : null;
    if (targetTenpai !== null) { sim.drawCount++; if (targetTenpai) sim.drawTenpaiCount++; }
    sim.handRecords.push({
      game: sim.gamesDone + 1, hand: sim.handsDone, outcome: targetTenpai ? 'draw-tenpai' : 'draw-noten',
      finalGoal: sim.lastTargetCtx ? sim.lastTargetCtx.goal : null,
      finalShanten: sim.lastTargetCtx ? sim.lastTargetCtx.shanten : null,
      foldedAnyTurn: sim.targetCtxHistory.some(c => c.folded),
      turns: sim.targetCtxHistory.length
    });
    simLog(`국#${sim.handsDone} 유국: 텐파이여부=${targetTenpai} (목표=${sim.lastTargetCtx ? sim.lastTargetCtx.goal : '?'}, 샹텐=${sim.lastTargetCtx ? sim.lastTargetCtx.shanten : '?'})`);

    const r = await origDraw.apply(this, arguments);
    updateStatsUI();
    return r;
  };

  window.endGame = function() {
    sim.gamesDone++;
    const target = state.players[sim.targetSeatId];
    const sorted = [...state.players].sort((a, b) => b.score - a.score);
    const rank = sorted.findIndex(p => p.id === target.id) + 1;
    sim.ranks.push(rank);
    if (rank === 1) sim.firstPlaceGames++;
    simLog(`=== 게임#${sim.gamesDone} 종료: 순위 ${rank}위 (점수 ${target.score}) ===`);
    if (sim.handsDone < sim.targetHands && sim.running) newGame();
    else finishSim();
  };

  const origRunHand = window.runHand;
  window.runHand = async function() {
    if (!sim || !sim.running || sim.handsDone >= sim.targetHands) { if (sim) finishSim(); return; }
    if (state && state.players && state.players[sim.targetSeatId]) {
      const tp = state.players[sim.targetSeatId];
      tp.isHuman = false;
      if (!tp.persona || tp.persona.id !== sim.targetPersonaId) {
        tp.persona = PERSONAS.find(p => p.id === sim.targetPersonaId) || STANDARD_PERSONA;
      }
    }
    return origRunHand.apply(this, arguments);
  };

  const origNewGame = window.newGame;
  window.newGame = function() {
    if (sim.oppMode === 'random') {
      const pool = PERSONAS.map(p => p.id).filter(id => id !== sim.targetPersonaId || PERSONAS.length === 1);
      const seats = [0, 1, 2].map(() => pool[Math.floor(Math.random() * pool.length)]);
      // targetSeatId(보통 0)에 대응하는 selectedPersonaIds 인덱스는 건드리지 않음(runHand에서 강제 지정하므로 무관)
      selectedPersonaIds = seats;
    } else {
      selectedPersonaIds = sim.fixedOpponents.slice();
    }
    return origNewGame.apply(this, arguments);
  };
}

function finishSim() {
  if (!sim || !sim.running) return;
  sim.running = false;
  simLog(`=== 시뮬레이션 종료: ${sim.handsDone}국 / ${sim.gamesDone}게임 (워치독 개입 ${sim.watchdogKicks}회) ===`);
  clearInterval(sim.watchdogTimer);
  saveSimToHistory();
  updateStatsUI();
  document.getElementById('startBtn').disabled = false;
  document.getElementById('stopBtn').disabled = true;
  document.getElementById('status').textContent = '완료';
}

function startWatchdog() {
  sim.lastProgressTs = performance.now();
  sim.watchdogTimer = setInterval(() => {
    if (!sim || !sim.running) return;
    if (performance.now() - sim.lastProgressTs > SIM_WATCHDOG_MS) {
      sim.watchdogKicks++;
      const snap = snapshotStateForDiag();
      simLog(`⚠ 워치독 개입 #${sim.watchdogKicks}: ${SIM_WATCHDOG_MS}ms 동안 진행 없음 -> runHand() 재시도. 당시 상태: ${JSON.stringify(snap)}`);
      sim.lastProgressTs = performance.now();
      runHand();
    }
  }, 500);
}

function updateStatsUI() {
  if (!sim) return;
  const hands = sim.handsDone || 1;
  const games = sim.gamesDone || 0;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('s_winrate', games ? `${(sim.firstPlaceGames / games * 100).toFixed(1)}% (${sim.firstPlaceGames}/${games}게임)` : '-');
  set('s_avgrank', sim.ranks.length ? (sim.ranks.reduce((a, b) => a + b, 0) / sim.ranks.length).toFixed(2) : '-');
  set('s_avgpoint', sim.wins ? (sim.winPoints / sim.wins).toFixed(0) : '-');
  set('s_agari', `${(sim.wins / hands * 100).toFixed(1)}% (${sim.wins}/${hands}국)`);
  set('s_houjuu', `${(sim.dealIns / hands * 100).toFixed(1)}% (${sim.dealIns}/${hands}국)`);
  set('s_furo', `${(sim.calledHands / hands * 100).toFixed(1)}% (${sim.calledHands}/${hands}국)`);
  set('s_tenpai', sim.drawCount ? `${(sim.drawTenpaiCount / sim.drawCount * 100).toFixed(1)}% (${sim.drawTenpaiCount}/${sim.drawCount}유국)` : '-');
  const foldedHands = sim.handRecords.filter(r => r.foldedAnyTurn).length;
  set('s_fold', `${(foldedHands / hands * 100).toFixed(1)}% (${foldedHands}/${hands}국)`);
  document.getElementById('status').textContent = sim.running
    ? `진행 중... ${sim.handsDone}/${sim.targetHands}국 (게임 ${sim.gamesDone}회 완료)`
    : `완료: ${sim.handsDone}국 / ${sim.gamesDone}게임`;
}

function saveSimToHistory() {
  try {
    const history = JSON.parse(localStorage.getItem(SIM_HISTORY_KEY) || '[]');
    history.push({
      timestamp: new Date().toISOString(),
      targetPersonaId: sim.targetPersonaId,
      targetHands: sim.targetHands,
      handsDone: sim.handsDone,
      gamesDone: sim.gamesDone,
      wins: sim.wins, winPoints: sim.winPoints, dealIns: sim.dealIns, calledHands: sim.calledHands,
      firstPlaceGames: sim.firstPlaceGames, ranks: sim.ranks,
      drawCount: sim.drawCount, drawTenpaiCount: sim.drawTenpaiCount,
      watchdogKicks: sim.watchdogKicks,
      handRecords: sim.handRecords
    });
    while (history.length > 20) history.shift();
    localStorage.setItem(SIM_HISTORY_KEY, JSON.stringify(history));
    simLog(`localStorage에 이번 실행 결과 저장됨 (보관된 실행 기록 ${history.length}개)`);
  } catch (e) {
    simLog('⚠ localStorage 저장 실패: ' + e.message);
  }
}

function downloadSimResult() {
  if (!sim) return;
  const data = {
    timestamp: new Date().toISOString(),
    targetPersonaId: sim.targetPersonaId,
    targetHands: sim.targetHands,
    stats: {
      handsDone: sim.handsDone, gamesDone: sim.gamesDone,
      wins: sim.wins, winPoints: sim.winPoints, dealIns: sim.dealIns, calledHands: sim.calledHands,
      firstPlaceGames: sim.firstPlaceGames, ranks: sim.ranks,
      drawCount: sim.drawCount, drawTenpaiCount: sim.drawTenpaiCount, watchdogKicks: sim.watchdogKicks
    },
    handRecords: sim.handRecords,
    logLines: sim.logLines
  };
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mahjong-sim-${sim.targetPersonaId}-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function startSim() {
  const targetPersonaId = document.getElementById('targetPersona').value;
  const targetHands = parseInt(document.getElementById('targetHands').value, 10) || 300;
  const oppMode = document.getElementById('oppMode').value;

  sim = {
    running: true, startTs: performance.now(),
    targetSeatId: 0, targetPersonaId, targetHands, oppMode,
    fixedOpponents: ['standard', 'standard', 'standard'],
    handsDone: 0, gamesDone: 0,
    wins: 0, winPoints: 0, dealIns: 0, calledHands: 0, calledThisHand: false,
    firstPlaceGames: 0, ranks: [],
    drawCount: 0, drawTenpaiCount: 0,
    lastTargetCtx: null, targetCtxHistory: [],
    handRecords: [], logLines: [],
    watchdogKicks: 0, watchdogTimer: null, lastProgressTs: 0
  };

  document.getElementById('log').textContent = '';
  document.getElementById('startBtn').disabled = true;
  document.getElementById('stopBtn').disabled = false;
  simLog(`시뮬레이션 시작: 대상=${targetPersonaId}, 목표 ${targetHands}국, 상대=${oppMode}`);

  setupSimOverrides();
  startWatchdog();
  newGame();
}

function stopSim() {
  if (!sim) return;
  sim.running = false;
  clearInterval(sim.watchdogTimer);
  simLog('=== 사용자에 의해 중지됨 ===');
  saveSimToHistory();
  updateStatsUI();
  document.getElementById('startBtn').disabled = false;
  document.getElementById('stopBtn').disabled = true;
}

window.addEventListener('DOMContentLoaded', () => {
  const sel = document.getElementById('targetPersona');
  sel.innerHTML = PERSONAS.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  sel.value = 'seogaeul';

  document.getElementById('startBtn').onclick = startSim;
  document.getElementById('stopBtn').onclick = stopSim;
  document.getElementById('downloadBtn').onclick = downloadSimResult;
  document.getElementById('clearHistoryBtn').onclick = () => {
    localStorage.removeItem(SIM_HISTORY_KEY);
    alert('저장된 이전 실행 기록을 지웠습니다.');
  };
});
