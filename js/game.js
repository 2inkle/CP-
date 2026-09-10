// 게임 진행 컨트롤러 + UI 렌더링
// 간략화 규칙: 깡은 안깡(暗槓)만 지원 (밍깡/가깡 미지원), 東風戦(동풍전, 1~4국) 단일 라운드

const PLAYER_NAMES = ['나', 'AI-1(下家)', 'AI-2(対面)', 'AI-3(上家)'];
const SEAT_SUFFIX = ['', '下家', '対面', '上家'];
const STARTING_SCORE = 25000;

let state = null;
let pendingResolver = null;
let selectedPersonaIds = ['standard', 'standard', 'standard']; // AI-1/2/3 순서

function waitForAction() {
  return new Promise(resolve => { pendingResolver = resolve; });
}
function resolveAction(payload) {
  if (pendingResolver) { const r = pendingResolver; pendingResolver = null; r(payload); }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function newGame() {
  state = {
    players: PLAYER_NAMES.map((name, i) => {
      const persona = i === 0 ? null : (PERSONAS.find(p => p.id === selectedPersonaIds[i - 1]) || STANDARD_PERSONA);
      return {
        id: i,
        name: (persona && persona.charName) ? `${persona.charName}(${SEAT_SUFFIX[i]})` : name,
        isHuman: i === 0,
        hand: [], melds: [], discards: [],
        riichi: false, riichiDeclaredAt: -1, ippatsuEligible: false,
        score: STARTING_SCORE, furiten: false,
        persona
      };
    }),
    dealerIdx: 0, roundWind: 1, handNo: 1, honba: 0, riichiSticks: 0,
    wall: [], deadWall: [], doraRevealed: 1, uraDoraTiles: [],
    log: []
  };
  logMsg('새 게임 시작! 東風戦 (동풍전), 컴퓨터 3명과 대국합니다.');
  runHand();
}

function logMsg(msg) {
  state.log.unshift(msg);
  if (state.log.length > 30) state.log.pop();
  renderLog();
}

function setupHand() {
  for (const p of state.players) {
    p.hand = []; p.melds = []; p.discards = [];
    p.riichi = false; p.riichiDeclaredAt = -1; p.riichiTimelineIdx = -1; p.ippatsuEligible = false; p.furiten = false;
    p.discardCalledAway = false; // 나가시만간 판정용: 이번 국에 이 사람 버림패가 콜(퐁/치)당한 적 있는지
  }
  state.anyCallMadeThisHand = false; // 천화/지화 판정용: 이번 국에 퐁/치/깡이 한 번이라도 있었는지
  state.discardTimeline = []; // 안전패(리치 후 통과패) 판정용: 이번 국의 전체 버림 순서 기록 {playerIdx, tile}
  let all = shuffle(createWallTiles());
  for (let r = 0; r < 13; r++) {
    for (let i = 0; i < 4; i++) {
      const p = state.players[(state.dealerIdx + i) % 4];
      p.hand.push(all.shift());
    }
  }
  state.deadWall = all.splice(all.length - 14, 14);
  state.wall = all;
  state.doraRevealed = 1;
  state.uraDoraTiles = state.deadWall.slice(5, 10);
  for (const p of state.players) p.hand = sortHand(p.hand);
}

function currentDoraIndicators() {
  return state.deadWall.slice(0, state.doraRevealed);
}

function seatWindOf(playerIdx) {
  return ((playerIdx - state.dealerIdx + 4) % 4) + 1;
}

// AI 페르소나 규칙이 참조할 상황 스냅샷
function buildAiContext(player) {
  const counts = countsFromTiles(player.hand);
  const suitCounts = { m: 0, p: 0, s: 0, z: 0 };
  for (const t of player.hand) suitCounts[t.suit]++;
  let targetSuit = null, maxCount = 0;
  for (const s of ['m', 'p', 's']) {
    if (suitCounts[s] > maxCount) { maxCount = suitCounts[s]; targetSuit = s; }
  }
  let cutSuit = null, minCount = Infinity;
  for (const s of ['m', 'p', 's']) {
    if (suitCounts[s] < minCount) { minCount = suitCounts[s]; cutSuit = s; }
  }

  const numSetsNeeded = 4 - player.melds.length;
  // 뽑은 직후(14장 등)에는 한 장을 버린 뒤의 샹텐이 실제 값이다
  const ownShanten = (player.hand.length % 3 === 2)
    ? minShantenAfterAnyDiscard(player.hand, player.melds)
    : calcShanten(counts, numSetsNeeded);

  const opponents = state.players.filter(p => p.id !== player.id);
  const riichiOpponents = opponents.filter(p => p.riichi);
  const turnNumber = player.discards.length;

  // 위협 판정: 리치 / 한 명이 2회 이상 후로 → 강함(2), 후로 1회 이상 + 순목 경과 → 경계(1)
  const furoCountOf = p => p.melds.filter(m => m.kind !== 'ankan').length;
  let threatLevel = 0;
  const threatPlayers = [];
  for (const opp of opponents) {
    const furo = furoCountOf(opp);
    let lv = 0;
    if (opp.riichi) lv = 2;
    else if (furo >= 2) lv = 2;
    else if (furo >= 1 && turnNumber >= 8) lv = 1;
    if (lv > 0) { threatPlayers.push(opp); threatLevel = Math.max(threatLevel, lv); }
  }

  const dora = currentDoraIndicators().map(nextDoraTile);
  const doraCountInHand = dora.reduce((sum, d) => sum + player.hand.filter(t => t.suit === d.suit && t.rank === d.rank).length, 0);

  const rank = 1 + state.players.filter(p => p.score > player.score).length;
  const maxOther = Math.max(...opponents.map(p => p.score));
  // 4위이거나, 1등이 아니면서 18000점 미만이면 불리한 상황
  const isBehind = rank === 4 || (rank !== 1 && player.score < 18000);
  // 2위와 1만점 이상 벌어진 단독 1위
  const hasBigLead = rank === 1 && (player.score - maxOther) >= 10000;

  let memoWaitCount = null, memoWinBase = null;

  const ctx = {
    suitCounts, targetSuit, cutSuit, turnNumber,
    seatWind: seatWindOf(player.id), roundWind: state.roundWind,
    anyOpponentRiichi: riichiOpponents.length > 0,
    dragonPairCount: counts.slice(31, 34).filter(c => c >= 2).length,
    doraCountInHand, ownShanten, isBehind, hasBigLead, rank, threatLevel,
    // 요구패 "장수"(중복 포함, 탕야오/대요구 판단용) — 예: 9m 3장은 이 카운트에 3으로 잡힘
    terminalHonorCount: player.hand.filter(isTerminalOrHonor).length,
    // 국사무쌍 전용: 실제 국사 샹텐(13종류 요구패 중 몇 종류를 가졌는지 기준). 위 terminalHonorCount와
    // 달리 같은 패를 여러 장 들고 있어도 "종류 수"만 세므로, 국사와 무관한 손패가 잘못 국사로 빠지지 않는다.
    kokushiShanten: shantenKokushi(counts),
    pairCount: counts.filter(c => c >= 2).length,
    bodyCount: player.melds.length + countCompleteSets(counts),

    countInHand: (tile) => counts[tileTypeIndex(tile.suit, tile.rank)],
    hasAdjacentInHand: (tile) => tile.suit !== 'z' && (
      (tile.rank > 1 && counts[tileTypeIndex(tile.suit, tile.rank - 1)] > 0) ||
      (tile.rank < 9 && counts[tileTypeIndex(tile.suit, tile.rank + 1)] > 0)
    ),
    isPartOfCompleteSet: (tile) => {
      const idx = tileTypeIndex(tile.suit, tile.rank);
      if (counts[idx] >= 3) return true;
      if (tile.suit === 'z') return false;
      for (let start = Math.max(1, tile.rank - 2); start <= Math.min(7, tile.rank); start++) {
        if (counts[tileTypeIndex(tile.suit, start)] > 0
          && counts[tileTypeIndex(tile.suit, start + 1)] > 0
          && counts[tileTypeIndex(tile.suit, start + 2)] > 0) return true;
      }
      return false;
    },
    discardedCountOf: (tile) => state.players.reduce((sum, p) =>
      sum + p.discards.filter(t => t.suit === tile.suit && t.rank === tile.rank).length, 0),

    dangerFor: (tile) => riichiOpponents.reduce((max, opp) => Math.max(max, estimateTileDanger(tile, opp, player)), 0),
    threatDangerFor: (tile) => threatPlayers.reduce((max, opp) => Math.max(max, estimateTileDanger(tile, opp, player, true)), 0),

    waitTileCount: () => {
      if (memoWaitCount === null) memoWaitCount = countRemainingWaitTiles(player);
      return memoWaitCount;
    },
    bestWinBase: () => {
      if (memoWinBase === null) memoWinBase = estimateBestWinValue(player);
      return memoWinBase;
    },
    ankanKeepsTenpai: (opt) => {
      const rest = player.hand.filter(t => !(t.suit === opt.suit && t.rank === opt.rank));
      return calcShanten(countsFromTiles(rest), numSetsNeeded - 1) === 0;
    }
  };

  // 진짜 접을 이유(리치)와 단순 경계(후로 2회 등)를 구분한다.
  // 후로만으로 threatLevel이 2까지 올라갈 수 있는데, 그것만으로 전면 오리를 시키면
  // "리치처럼 확정적인 위험에만 접는다"는 의도보다 훨씬 자주(거의 매 국) 접게 되어 버린다.
  const hasRiichiThreat = riichiOpponents.length > 0;
  // 위험도-가치 비교: 손패 가치(bestWinBase(), 역 없으면 0)와 대기 폭(waitTileCount())을
  // 위협 수준과 함께 저울질한다. 하네만급 이상(8000)은 위협이 있어도 계속 밀고, 만관 미만(2000)
  // + 좁은 대기(3장 이하) 조합만 텐파이에서도 접는다.
  ctx.shouldFold = () => {
    if (hasRiichiThreat && ctx.ownShanten >= 2) return true;
    if (hasRiichiThreat && ctx.ownShanten === 1 && ctx.threatLevel >= 2) {
      if (ctx.bestWinBase() >= 8000) return false;
      return true;
    }
    if (ctx.ownShanten === 0) {
      if (ctx.waitTileCount() <= 1) return true;
      if (hasRiichiThreat && ctx.threatLevel >= 2 && ctx.bestWinBase() < 2000 && ctx.waitTileCount() <= 3) return true;
    }
    return false;
  };

  return ctx;
}

// 완성된 멘츠(커쯔/슌쯔) 최대 개수
function countCompleteSets(counts) {
  const work = counts.slice();
  let best = 0;
  function rec(sets) {
    if (sets > best) best = sets;
    let idx = -1;
    for (let i = 0; i < 34; i++) if (work[i] > 0) { idx = i; break; }
    if (idx === -1) return;
    const t = indexToTile(idx);
    if (work[idx] >= 3) {
      work[idx] -= 3; rec(sets + 1); work[idx] += 3;
    }
    if (t.suit !== 'z' && t.rank <= 7 && work[idx + 1] > 0 && work[idx + 2] > 0) {
      work[idx]--; work[idx + 1]--; work[idx + 2]--;
      rec(sets + 1);
      work[idx]++; work[idx + 1]++; work[idx + 2]++;
    }
    work[idx]--; rec(sets); work[idx]++; // 이 패는 어느 멘츠에도 안 쓰는 경우
  }
  rec(0);
  return best;
}

// 해당 손패의 실제 대기패 목록 (34종을 하나씩 넣어 화료 성립 여부 확인)
function findWaitTiles(handTiles, numSetsNeeded) {
  const base = countsFromTiles(handTiles);
  const waits = [];
  for (let i = 0; i < 34; i++) {
    if (base[i] >= 4) continue;
    base[i]++;
    if (checkWin(base, numSetsNeeded).isWin) waits.push(indexToTile(i));
    base[i]--;
  }
  return waits;
}

// 후리텐 판정: 이미 후리텐이면 유지(리셋 안 함). 텐파이 상태에서 자신의 대기패 중
// 하나라도 자기 버림패(현재 손패 도달 이전의 것 포함)에 있으면 후리텐.
function isFuriten(player) {
  if (player.furiten) return true;
  const numSetsNeeded = 4 - player.melds.length;
  if (calcShanten(countsFromTiles(player.hand), numSetsNeeded) !== 0) return false;
  const waits = findWaitTiles(player.hand, numSetsNeeded);
  return waits.some(w => player.discards.some(d => d.suit === w.suit && d.rank === w.rank));
}

// 보이지 않는 곳에 남아있는 대기패 매수 (텐파이가 아니면 0)
function countRemainingWaitTiles(player) {
  const numSetsNeeded = 4 - player.melds.length;
  let bestCount = 0;
  for (let i = 0; i < player.hand.length; i++) {
    const kept = player.hand.slice(0, i).concat(player.hand.slice(i + 1));
    if (calcShanten(countsFromTiles(kept), numSetsNeeded) !== 0) continue;
    const waits = findWaitTiles(kept, numSetsNeeded);
    let total = 0;
    for (const w of waits) total += 4 - visibleCountOf(w, player);
    if (total > bestCount) bestCount = total;
  }
  return bestCount;
}

// 자기 손패 + 전원 버림패/공개 멘츠 + 도라 표시패에서 보이는 장수
function visibleCountOf(tile, player) {
  const match = t => t.suit === tile.suit && t.rank === tile.rank;
  let seen = player.hand.filter(match).length;
  for (const p of state.players) {
    seen += p.discards.filter(match).length;
    for (const m of p.melds) seen += m.tiles.filter(match).length;
  }
  seen += currentDoraIndicators().filter(match).length;
  return Math.min(seen, 4);
}

// 텐파이 손패를 실제 대기패로 화료시켜 봤을 때 나오는 최대 타점(base, 만관=2000)
function estimateBestWinValue(player) {
  const numSetsNeeded = 4 - player.melds.length;
  let bestBase = 0;
  for (let i = 0; i < player.hand.length; i++) {
    const kept = player.hand.slice(0, i).concat(player.hand.slice(i + 1));
    if (calcShanten(countsFromTiles(kept), numSetsNeeded) !== 0) continue;
    for (const w of findWaitTiles(kept, numSetsNeeded)) {
      const winTile = makeTile(w.suit, w.rank);
      const r = wouldWin(player, winTile, true, { riichi: false }, kept);
      if (r && r.base > bestBase) bestBase = r.base;
    }
  }
  return bestBase;
}

function wouldWin(player, tile, isTsumo, extra = {}, handTiles = null) {
  const concealed = (handTiles || player.hand).concat([tile]);
  const ctx = {
    concealedTiles: concealed, melds: player.melds, winTile: tile, isTsumo,
    seatWind: seatWindOf(player.id), roundWind: state.roundWind,
    riichi: player.riichi, doubleRiichi: false, ippatsu: false,
    isHaitei: false, isHoutei: false, isRinshan: false, isChankan: false,
    doraIndicators: currentDoraIndicators(),
    uraDoraIndicators: state.uraDoraTiles,
    isDealer: player.id === state.dealerIdx,
    ...extra
  };
  return evaluateHand(ctx);
}

async function runHand() {
  setupHand();
  renderAll();
  logMsg(`--- 東${state.handNo}국 ${state.honba}본장 (딜러: ${state.players[state.dealerIdx].name}) ---`);

  let turnIdx = state.dealerIdx;
  let mustDraw = true;
  let rinshan = false;
  let lastDiscardInfo = null;
  let anyCallMadeThisGoAround = false;

  while (true) {
    if (state.wall.length === 0 && !rinshan) {
      await handleExhaustiveDraw();
      return;
    }
    const player = state.players[turnIdx];
    state.__activeTurnIdx = turnIdx;
    let drawnTile = null;

    if (mustDraw) {
      drawnTile = rinshan ? state.deadWall.pop() : state.wall.pop();
      player.hand.push(drawnTile);
      renderAll();
      if (!player.isHuman) await sleep(500);

      const isHaitei = state.wall.length === 0 && !rinshan;
      const isFirstUninterruptedDraw = !rinshan && player.discards.length === 0 && !state.anyCallMadeThisHand;
      const isTenhou = isFirstUninterruptedDraw && player.id === state.dealerIdx;
      const isChiihou = isFirstUninterruptedDraw && player.id !== state.dealerIdx;
      const handBeforeDraw = player.hand.filter(t => t.uid !== drawnTile.uid);
      const win = wouldWin(player, drawnTile, true, { isRinshan: rinshan, isHaitei, isTenhou, isChiihou, ippatsu: player.riichi && player.ippatsuEligible }, handBeforeDraw);
      if (win) {
        if (player.isHuman) {
          logMsg('쯔모 가능! 화료하시겠습니까?');
          renderActionPanel([{ id: 'tsumo', label: '쯔모!' }, { id: 'skip', label: '넘기기' }]);
          const act = await waitForAction();
          if (act === 'tsumo') { await resolveWin([{ player, win, isTsumo: true, isRinshan: rinshan, isHaitei }]); return; }
        } else {
          await resolveWin([{ player, win, isTsumo: true, isRinshan: rinshan, isHaitei }]); return;
        }
      }

      // 안깡 체크
      const kanOptions = findAnkanOptions(player.hand);
      if (kanOptions.length > 0) {
        if (player.isHuman) {
          renderActionPanel([
            ...kanOptions.map(k => ({ id: 'ankan:' + k.key, label: `안깡(${tileLabel(k.suit, k.rank)})` })),
            { id: 'skip', label: '넘기기' }
          ]);
          const act = await waitForAction();
          if (act.startsWith('ankan:')) {
            const key = act.split(':')[1];
            const opt = kanOptions.find(k => k.key === key);
            doAnkan(player, opt);
            renderAll();
            rinshan = true; mustDraw = true;
            continue;
          }
        } else {
          const opt = aiDecideAnkan(player, player.persona, buildAiContext(player), kanOptions);
          if (opt) {
            doAnkan(player, opt);
            renderAll();
            rinshan = true; mustDraw = true;
            continue;
          }
        }
      }
      rinshan = false;
    }

    // ---- 리치 선언 여부 ----
    const isConcealed = player.melds.every(m => m.kind === 'ankan');
    let justDeclaredRiichi = false;
    if (isConcealed && !player.riichi && player.score >= 1000 && player.hand.length === 14) {
      const isTenpai = minShantenAfterAnyDiscard(player.hand, player.melds) === 0;
      if (isTenpai) {
        if (player.isHuman) {
          renderActionPanel([{ id: 'riichi', label: '리치 선언' }, { id: 'skip', label: '리치 안함' }]);
          const act = await waitForAction();
          if (act === 'riichi') { declareRiichi(player); justDeclaredRiichi = true; }
        } else if (aiWantsRiichi(player.hand, player.melds, seatWindOf(player.id), state.roundWind, player.persona, buildAiContext(player))) {
          declareRiichi(player);
          justDeclaredRiichi = true;
          logMsg(`${player.name} 리치!`);
        }
      }
    }

    // ---- 버림패 선택 ----
    let discardTile;
    if (player.riichi && !justDeclaredRiichi) {
      // 리치 후에는 뽑은 패를 그대로 버려야 함 (츠모기리)
      discardTile = (drawnTile && player.hand.some(t => t.uid === drawnTile.uid)) ? drawnTile : player.hand[player.hand.length - 1];
    } else if (player.isHuman) {
      renderActionPanel([]);
      logMsg('버릴 패를 클릭하세요.');
      discardTile = await waitForHumanTileClick(player);
    } else {
      discardTile = aiChooseDiscard(player.hand, player.melds, player.persona, buildAiContext(player));
    }

    const di = player.hand.findIndex(t => t.uid === discardTile.uid);
    player.hand.splice(di, 1);
    player.hand = sortHand(player.hand);
    player.discards.push(discardTile);
    state.__lastDiscarderIdx = turnIdx;
    if (player.riichi && player.riichiDeclaredAt === -1) {
      player.riichiDeclaredAt = player.discards.length - 1;
      player.riichiTimelineIdx = state.discardTimeline.length; // 이 버림(선언패)부터 안전패 판정에 포함
    }
    player.ippatsuEligible = player.riichi && player.discards.length - 1 === player.riichiDeclaredAt;
    state.discardTimeline.push({ playerIdx: turnIdx, tile: discardTile });

    renderAll();
    logMsg(`${player.name} 버림: ${tileLabel(discardTile.suit, discardTile.rank)}`);

    // 후리텐 상태 갱신: 텐파이 상태에서 자신의 대기패 중 하나라도 스스로 버린 적 있으면 후리텐
    // (지금 막 버린 패뿐 아니라, 예전에 버려서 손패에 없는 대기패도 포함해 매번 다시 계산)
    player.furiten = isFuriten(player);

    // 다른 3명의 콜 처리 (론 > 퐁/깡 > 치)
    const callResult = await resolveCalls(turnIdx, discardTile);

    if (callResult.type === 'ron') {
      await resolveWin(callResult.winners.map(w => ({ player: w.player, win: w.win, isTsumo: false, isHoutei: state.wall.length === 0 })));
      return;
    }
    if (callResult.type === 'pon' || callResult.type === 'chi') {
      turnIdx = callResult.playerIdx;
      mustDraw = false;
      // 리치 후 상대에게 콜 발생시 일발 무효
      for (const p of state.players) p.ippatsuEligible = false;
      continue;
    }

    // 콜 없음 -> 다음 사람 턴
    turnIdx = (turnIdx + 1) % 4;
    mustDraw = true;
  }
}

function minShantenAfterAnyDiscard(hand14, melds) {
  const numSetsNeeded = 4 - melds.length;
  let best = 99;
  for (let i = 0; i < hand14.length; i++) {
    const rest = hand14.slice(0, i).concat(hand14.slice(i + 1));
    const sh = calcShanten(countsFromTiles(rest), numSetsNeeded);
    if (sh < best) best = sh;
  }
  return best;
}

function findAnkanOptions(hand) {
  const counts = countsFromTiles(hand);
  const opts = [];
  for (let i = 0; i < 34; i++) {
    if (counts[i] === 4) {
      const t = indexToTile(i);
      opts.push({ key: t.suit + t.rank, suit: t.suit, rank: t.rank });
    }
  }
  return opts;
}

function doAnkan(player, opt) {
  const tiles = [];
  for (let i = player.hand.length - 1; i >= 0 && tiles.length < 4; i--) {
    if (player.hand[i].suit === opt.suit && player.hand[i].rank === opt.rank) {
      tiles.push(player.hand[i]); player.hand.splice(i, 1);
    }
  }
  player.melds.push({ kind: 'ankan', suit: opt.suit, rank: opt.rank, tiles, concealed: true });
  state.doraRevealed = Math.min(state.doraRevealed + 1, 5);
  state.anyCallMadeThisHand = true;
  logMsg(`${player.name} 안깡: ${tileLabel(opt.suit, opt.rank)}`);
}

function declareRiichi(player) {
  player.riichi = true;
  player.score -= 1000;
  state.riichiSticks += 1;
  player.ippatsuEligible = true;
}

async function resolveCalls(discarderIdx, tile) {
  // 1) 론 체크 (여러 명 동시 가능)
  const ronners = [];
  for (let off = 1; off <= 3; off++) {
    const idx = (discarderIdx + off) % 4;
    const p = state.players[idx];
    if (p.furiten) continue;
    const win = wouldWin(p, tile, false, { isHoutei: state.wall.length === 0, ippatsu: p.riichi && p.ippatsuEligible });
    if (win) {
      if (p.isHuman) {
        renderActionPanel([{ id: 'ron', label: '론!' }, { id: 'pass', label: '넘기기(후리텐 주의)' }]);
        logMsg('론 가능! 선언하시겠습니까?');
        const act = await waitForAction();
        if (act === 'ron') ronners.push({ player: p, win });
        else p.furiten = true;
      } else {
        ronners.push({ player: p, win });
      }
    }
  }
  if (ronners.length > 0) return { type: 'ron', winners: ronners };

  // 2) 퐁/깡(밍깡 미지원 - 퐁만) 체크
  for (let off = 1; off <= 3; off++) {
    const idx = (discarderIdx + off) % 4;
    const p = state.players[idx];
    if (p.riichi) continue; // 리치 중엔 퐁/치 불가
    const counts = countsFromTiles(p.hand);
    const cnt = counts[tileTypeIndex(tile.suit, tile.rank)];
    if (cnt >= 2) {
      let wants = false;
      if (p.isHuman) {
        renderActionPanel([{ id: 'pon', label: `퐁 (${tileLabel(tile.suit, tile.rank)})` }, { id: 'pass', label: '패스' }]);
        const act = await waitForAction();
        wants = act === 'pon';
      } else {
        const ctx = buildAiContext(p);
        const dec = aiDecideCallOnDiscard(p, tile, discarderIdx, idx, seatWindOf(idx), state.roundWind, ctx, { canPon: true, chiOptions: [] });
        wants = dec.action === 'pon';
      }
      if (wants) {
        doPon(p, tile, discarderIdx);
        return { type: 'pon', playerIdx: p.id };
      }
    }
  }

  // 3) 치 체크 (직전 사람 discard만, 오직 다음 순번 플레이어만 가능)
  const chiPlayerIdx = (discarderIdx + 1) % 4;
  const chiPlayer = state.players[chiPlayerIdx];
  if (!chiPlayer.riichi && tile.suit !== 'z') {
    const options = findChiOptions(chiPlayer.hand, tile);
    if (options.length > 0) {
      if (chiPlayer.isHuman) {
        renderActionPanel([
          ...options.map((o, i) => ({ id: 'chi:' + i, label: `치 (${o.label})` })),
          { id: 'pass', label: '패스' }
        ]);
        const act = await waitForAction();
        if (act.startsWith('chi:')) {
          const opt = options[parseInt(act.split(':')[1], 10)];
          doChi(chiPlayer, tile, opt, discarderIdx);
          return { type: 'chi', playerIdx: chiPlayer.id };
        }
      } else {
        const ctx = buildAiContext(chiPlayer);
        const dec = aiDecideCallOnDiscard(chiPlayer, tile, discarderIdx, chiPlayerIdx, seatWindOf(chiPlayerIdx), state.roundWind, ctx, { canPon: false, chiOptions: options });
        if (dec.action === 'chi') {
          doChi(chiPlayer, tile, dec.chiOption, discarderIdx);
          return { type: 'chi', playerIdx: chiPlayer.id };
        }
      }
    }
  }

  return { type: 'none' };
}

function findChiOptions(hand, tile) {
  const has = r => hand.some(t => t.suit === tile.suit && t.rank === r);
  const opts = [];
  if (tile.rank >= 3 && has(tile.rank - 1) && has(tile.rank - 2)) opts.push({ rank: tile.rank - 2, label: `${tile.rank - 2}${tile.suit}${tile.rank - 1}${tile.suit}${tile.rank}${tile.suit}` });
  if (tile.rank >= 2 && tile.rank <= 8 && has(tile.rank - 1) && has(tile.rank + 1)) opts.push({ rank: tile.rank - 1, label: `${tile.rank - 1}${tile.suit}${tile.rank}${tile.suit}${tile.rank + 1}${tile.suit}` });
  if (tile.rank <= 7 && has(tile.rank + 1) && has(tile.rank + 2)) opts.push({ rank: tile.rank, label: `${tile.rank}${tile.suit}${tile.rank + 1}${tile.suit}${tile.rank + 2}${tile.suit}` });
  return opts;
}

function doPon(player, tile, fromIdx) {
  const taken = [];
  for (let i = player.hand.length - 1; i >= 0 && taken.length < 2; i--) {
    if (player.hand[i].suit === tile.suit && player.hand[i].rank === tile.rank) { taken.push(player.hand[i]); player.hand.splice(i, 1); }
  }
  player.melds.push({ kind: 'pon', suit: tile.suit, rank: tile.rank, tiles: taken.concat([tile]), concealed: false, fromIdx });
  removeFromDiscard(fromIdx, tile);
  state.anyCallMadeThisHand = true;
  logMsg(`${player.name} 퐁!`);
}

function doChi(player, tile, opt, fromIdx) {
  const need = [opt.rank, opt.rank + 1, opt.rank + 2].filter(r => r !== tile.rank);
  const taken = [];
  for (const r of need) {
    const idx = player.hand.findIndex(t => t.suit === tile.suit && t.rank === r);
    taken.push(player.hand[idx]); player.hand.splice(idx, 1);
  }
  player.melds.push({ kind: 'chi', suit: tile.suit, rank: opt.rank, tiles: taken.concat([tile]), concealed: false, fromIdx });
  removeFromDiscard(fromIdx, tile);
  state.anyCallMadeThisHand = true;
  logMsg(`${player.name} 치!`);
}

function removeFromDiscard(fromIdx, tile) {
  const p = state.players[fromIdx];
  const i = p.discards.findIndex(t => t.uid === tile.uid);
  if (i >= 0) p.discards.splice(i, 1);
  p.discardCalledAway = true; // 나가시만간 무효화 (버림패가 퐁/치로 불려나감)
}

async function resolveWin(winInfos) {
  const dealerIdx = state.dealerIdx;
  let dealerWon = false;
  let logs = [];
  for (const info of winInfos) {
    const p = info.player;
    const r = info.win;
    const isDealer = p.id === dealerIdx;
    if (isDealer) dealerWon = true;
    let text = `${p.name} ${info.isTsumo ? '쯔모' : '론'} 화료! `;
    text += r.yaku.map(y => `${y.name}(${y.han}han)`).join(', ');
    text += ` / ${r.fu}부 ${r.han}판`;
    if (r.name) text += ` [${r.name}]`;
    text += ` -> ${r.total}점`;
    logs.push(text);

    if (info.isTsumo) {
      // 딜러가 화료하면 payments가 {ron, tsumoEach}(전원 동일 지불) 형태이고,
      // 논딜러가 화료하면 {ron, tsumoDealer, tsumoNonDealer}(딜러/비딜러 차등 지불) 형태다.
      const isWinnerDealer = p.id === dealerIdx;
      for (const other of state.players) {
        if (other.id === p.id) continue;
        const base = isWinnerDealer ? r.payments.tsumoEach
          : (other.id === dealerIdx ? r.payments.tsumoDealer : r.payments.tsumoNonDealer);
        const pay = base + state.honba * 100;
        other.score -= pay;
        p.score += pay;
      }
    }
  }

  if (!winInfos[0].isTsumo) {
    // 론: 버린 사람에게서만 지불 (모든 승자 각각 전액)
    const discarderIdx = findLastDiscarderIdx();
    for (const info of winInfos) {
      const total = info.win.payments.ron + state.honba * 300;
      state.players[discarderIdx].score -= total;
      info.player.score += total;
    }
  }

  winInfos[0].player.score += state.riichiSticks * 1000;
  state.riichiSticks = 0;

  for (const t of logs) logMsg(t);
  renderAll();
  await showResultOverlay(logs.join('\n'), false, winInfos[0].isTsumo ? '쯔모' : '론 화료');

  if (dealerWon) { state.honba += 1; }
  else { state.dealerIdx = (state.dealerIdx + 1) % 4; state.handNo += 1; state.honba = 0; }

  if (state.handNo > 4 && !dealerWon) { endGame(); return; }
  runHand();
}

function findLastDiscarderIdx() {
  // 마지막으로 discards 배열에 패가 추가된 사람 (콜에 의해 제거되지 않은 마지막 버림)
  return state.__lastDiscarderIdx;
}

// 나가시만간: 이번 국 내내 요구패(노두/자패)만 버렸고, 그 버림패가 한 번도 콜당하지 않았으면 성립
function checkNagashiMangan(player) {
  if (player.discardCalledAway) return false;
  if (player.discards.length === 0) return false;
  return player.discards.every(isTerminalOrHonor);
}

async function handleExhaustiveDraw() {
  const nagashiPlayers = state.players.filter(checkNagashiMangan);
  const tenpaiList = state.players.map(p => {
    const counts = countsFromTiles(p.hand);
    return calcShanten(counts, 4 - p.melds.length) === 0;
  });
  const tenpaiCount = tenpaiList.filter(Boolean).length;

  if (nagashiPlayers.length > 0) {
    // 나가시만간은 쯔모 만관과 동일하게 지불하고, 일반 텐파이/노텐 정산은 건너뛴다
    for (const p of nagashiPlayers) {
      const isWinnerDealer = p.id === state.dealerIdx;
      for (const other of state.players) {
        if (other.id === p.id) continue;
        const pay = (isWinnerDealer || other.id === state.dealerIdx)
          ? Math.ceil(2000 * 2 / 100) * 100
          : Math.ceil(2000 * 1 / 100) * 100;
        other.score -= pay;
        p.score += pay;
      }
      logMsg(`${p.name} 나가시만간! (요구패만 버림, 만관)`);
    }
    renderAll();
    await showResultOverlay(nagashiPlayers.map(p => `${p.name} 나가시만간! (만관)`).join('\n'), false, '나가시만간');

    const dealerContinues = tenpaiList[state.dealerIdx] || nagashiPlayers.some(p => p.id === state.dealerIdx);
    if (dealerContinues) { state.honba += 1; }
    else { state.dealerIdx = (state.dealerIdx + 1) % 4; state.handNo += 1; state.honba = 0; }

    if (state.handNo > 4 && !dealerContinues) { endGame(); return; }
    runHand();
    return;
  }

  logMsg(`유국(더 이상 뽑을 패 없음). 텐파이: ${tenpaiCount}명`);

  const table = { 0: [0, 0, 0, 0], 1: [3000, 0, 0, 0], 2: [1500, 1500, 0, 0], 3: [1000, 1000, 1000, 0], 4: [0, 0, 0, 0] };
  const payAmounts = table[tenpaiCount];
  let ti = 0, ni = 0;
  for (let i = 0; i < 4; i++) {
    if (tenpaiList[i]) { state.players[i].score += payAmounts[ti]; ti++; }
  }
  const notenPay = tenpaiCount > 0 ? Math.floor((payAmounts.reduce((a, b) => a + b, 0)) / (4 - tenpaiCount)) : 0;
  for (let i = 0; i < 4; i++) {
    if (!tenpaiList[i]) state.players[i].score -= notenPay;
  }

  renderAll();
  await showResultOverlay(`텐파이 ${tenpaiCount}명 (점수 정산 완료)`, false, '유국');

  const dealerTenpai = tenpaiList[state.dealerIdx];
  if (dealerTenpai) { state.honba += 1; }
  else { state.dealerIdx = (state.dealerIdx + 1) % 4; state.handNo += 1; state.honba = 0; }

  if (state.handNo > 4 && !dealerTenpai) { endGame(); return; }
  runHand();
}

function endGame() {
  const ranking = [...state.players].sort((a, b) => b.score - a.score);
  let msg = '=== 게임 종료 ===\n' + ranking.map((p, i) => `${i + 1}위: ${p.name} (${p.score}점)`).join('\n');
  logMsg(msg);
  renderActionPanel([{ id: 'newgame', label: '새 게임 시작' }]);
  waitForAction().then(act => { if (act === 'newgame') newGame(); });
  showResultOverlay(msg, true, '게임 종료');
}

// ============== 렌더링 ==============

function renderAll() {
  renderScores();
  renderDora();
  renderHands();
  renderDiscardsAll();
  renderWallCount();
}

function el(id) { return document.getElementById(id); }

const WIND_CHAR = { 1: '東', 2: '南', 3: '西', 4: '北' };

function renderScores() {
  for (const p of state.players) {
    const nameEl = el(`pname-${p.id}`); if (!nameEl) continue;
    nameEl.textContent = p.name;
    el(`pscore-${p.id}`).textContent = `${p.score.toLocaleString()}`;
    el(`wind-${p.id}`).textContent = WIND_CHAR[seatWindOf(p.id)];
    const tags = [];
    if (p.id === state.dealerIdx) tags.push('<span class="tag dealer">親</span>');
    if (p.riichi) tags.push('<span class="tag riichi">리치</span>');
    if (p.furiten) tags.push('<span class="tag furiten">후리텐</span>');
    el(`tags-${p.id}`).innerHTML = tags.join('');
    const seatCard = el(`seat-${p.id}`);
    if (seatCard) seatCard.classList.toggle('active-turn', state.__activeTurnIdx === p.id);
  }
  el('roundinfo').textContent = `${WIND_CHAR[state.roundWind]}${state.handNo}局`;
  el('honba-label').textContent = state.honba > 0 ? `${state.honba}本場` : '';
}

function renderDora() {
  const inds = currentDoraIndicators();
  el('dora-indicators').innerHTML = inds.map(t => tileHtml(t, { small: true })).join('');
}

function renderWallCount() {
  el('wallcount').textContent = `잔패 ${state.wall.length}`;
  el('stickcount').textContent = `공탁 ${state.riichiSticks}`;
}

function tileHtml(t, opts = {}) {
  const cls = ['tile'];
  if (opts.small) cls.push('small');
  if (t.red) cls.push('red');
  return `<div class="${cls.join(' ')}" data-uid="${t.uid}"><span class="glyph">${tileGlyph(t.suit, t.rank)}</span><span class="label">${tileLabel(t.suit, t.rank)}</span></div>`;
}

function meldHtml(m) {
  return `<div class="meld">${m.tiles.map(t => tileHtml(t, { small: true })).join('')}</div>`;
}

function backTilesHtml(count, small) {
  let out = '';
  for (let i = 0; i < count; i++) out += `<div class="tile back${small ? ' small' : ''}"></div>`;
  return out;
}

function renderHands() {
  for (const p of state.players) {
    const handBox = el(`hand-${p.id}`);
    if (!handBox) continue;
    if (p.isHuman) {
      handBox.innerHTML = p.hand.map(t => tileHtml(t)).join('') + p.melds.map(meldHtml).join('');
      [...handBox.querySelectorAll('.tile')].forEach(elm => {
        elm.onclick = () => { if (humanTileResolver) { const uid = parseInt(elm.dataset.uid, 10); const t = p.hand.find(x => x.uid === uid); humanTileResolver(t); humanTileResolver = null; } };
      });
    } else {
      handBox.innerHTML = backTilesHtml(p.hand.length, true) + p.melds.map(meldHtml).join('');
    }
  }
}

function renderDiscardsAll() {
  for (const p of state.players) {
    const box = el(`discards-${p.id}`);
    if (box) box.innerHTML = p.discards.map(t => tileHtml(t, { small: true })).join('');
  }
}

function renderLog() {
  el('log').innerHTML = state.log.map(m => `<div class="logline">${escapeHtml(m)}</div>`).join('');
}

function escapeHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>'); }

function renderActionPanel(buttons) {
  const box = el('actions');
  box.innerHTML = buttons.map(b => `<button class="actbtn" data-id="${b.id}">${b.label}</button>`).join('');
  [...box.querySelectorAll('.actbtn')].forEach(btn => {
    btn.onclick = () => { resolveAction(btn.dataset.id); box.innerHTML = ''; };
  });
}

let humanTileResolver = null;
function waitForHumanTileClick(player) {
  renderHands();
  return new Promise(resolve => { humanTileResolver = resolve; });
}

function showResultOverlay(text, isFinal = false, ribbon = '결과') {
  return new Promise(resolve => {
    const overlay = el('overlay');
    overlay.style.display = 'flex';
    el('overlay-ribbon').textContent = ribbon;
    el('overlay-text').innerText = text;
    el('overlay-close').textContent = isFinal ? '확인' : '다음 국으로';
    el('overlay-close').onclick = () => { overlay.style.display = 'none'; resolve(); };
    if (!isFinal) setTimeout(() => { if (overlay.style.display !== 'none') { overlay.style.display = 'none'; resolve(); } }, 8000);
  });
}

function setupPersonaPickers() {
  for (let i = 1; i <= 3; i++) {
    const sel = el(`persona-${i}`);
    sel.innerHTML = PERSONAS.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    sel.value = selectedPersonaIds[i - 1];
    sel.onchange = () => {
      selectedPersonaIds[i - 1] = sel.value;
      updatePersonaDesc();
    };
  }
  updatePersonaDesc();
}

function updatePersonaDesc() {
  const lines = selectedPersonaIds.map((id, i) => {
    const p = PERSONAS.find(x => x.id === id);
    return `AI-${i + 1}: ${p.desc}`;
  });
  el('persona-desc').innerHTML = lines.join('<br>');
}

window.addEventListener('DOMContentLoaded', () => {
  // index.html(실제 게임 화면)이 아닌 다른 페이지(예: sim.html 헤드리스 시뮬레이터)에서
  // game.js를 재사용할 수도 있으므로, 해당 UI 요소가 없으면 조용히 건너뛴다.
  if (!el('start-btn')) return;
  setupPersonaPickers();
  el('start-btn').onclick = () => { el('start-screen').style.display = 'none'; el('game-screen').style.display = 'block'; newGame(); };
  el('log-toggle').onclick = () => { el('log-panel').classList.toggle('open'); };
  el('log-close').onclick = () => { el('log-panel').classList.remove('open'); };
});
