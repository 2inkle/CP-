// 컴퓨터(AI) 플레이어 로직 - 샹텐 기반 휴리스틱 + 페르소나(조패 경향) 규칙 반영
// + 공통 판단 레이어: 우케이레 비교, 정교화된 안전패 판정, 기초 후로 전략

const SHANTEN_PENALTY = 15;
const UKEIRE_WEIGHT = 0.5; // 동률 샹텐일 때 남은 대기패 수 1장당 가중치

function withGoal(persona, ctx) {
  return Object.assign({}, ctx, { goal: resolveGoal(persona, ctx) });
}

// 특정 13장 손패의 우케이레(다음 샹텐으로 나아가게 하는 패 종류/장수)를 계산한다.
// totalTiles는 자기 손패에 이미 있는 수를 뺀 대략치(가시패 차감은 하지 않음 - 동률 후보 비교용 근사치)
function computeUkeire(hand13, numSetsNeeded) {
  const counts = countsFromTiles(hand13);
  const baseShanten = calcShanten(counts, numSetsNeeded);
  let tileTypes = 0, totalTiles = 0;
  for (let i = 0; i < 34; i++) {
    if (counts[i] >= 4) continue;
    counts[i]++;
    const sh = calcShanten(counts, numSetsNeeded);
    if (sh < baseShanten) { tileTypes++; totalTiles += 4 - (counts[i] - 1); }
    counts[i]--;
  }
  return { tileTypes, totalTiles };
}

function aiChooseDiscard(hand14, melds, persona, ctx) {
  persona = persona || STANDARD_PERSONA;
  ctx = withGoal(persona, ctx || {});
  const numSetsNeeded = 4 - melds.length;
  let bestShanten = 99;
  const candidates = [];
  for (let i = 0; i < hand14.length; i++) {
    const rest = hand14.slice(0, i).concat(hand14.slice(i + 1));
    const sh = calcShanten(countsFromTiles(rest), numSetsNeeded);
    candidates.push({ tile: hand14[i], shanten: sh, rest });
    if (sh < bestShanten) bestShanten = sh;
  }
  for (const c of candidates) {
    c.score = -(c.shanten - bestShanten) * SHANTEN_PENALTY
      + sumWeights(persona.discardRules, ctx, c.tile, c.shanten);
  }
  // 우케이레 비교: 최소 샹텐으로 동률인 후보들 사이에서는 실제 대기 폭이 넓은 쪽을 선호
  const bestCandidates = candidates.filter(c => c.shanten === bestShanten);
  if (bestCandidates.length > 1) {
    for (const c of bestCandidates) {
      const { totalTiles } = computeUkeire(c.rest, numSetsNeeded);
      c.score += totalTiles * UKEIRE_WEIGHT;
    }
  }
  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // 그래도 동률이면: 도라가 아니고, 고립된 자패/노두패를 우선 버림
    const tieScore = t => {
      let s = 0;
      if (t.red) s -= 5; // 적도라는 최대한 유지
      if (t.suit === 'z') s += 2;
      else if (t.rank === 1 || t.rank === 9) s += 1;
      return s;
    };
    return tieScore(b.tile) - tieScore(a.tile);
  });
  return candidates[0].tile;
}

// game.js에서 이미 텐파이(리치 가능) 여부를 확인한 뒤 호출됨.
// 기본 판단: 특별한 조건(페르소나의 riichiRules)이 없으면 텐파이가 되는 순간 무조건 리치한다
// (리치는 절대다수 상황에서 기대값이 양수이므로, "판단하지 않고 늘 리치"가 오히려 올바른 기본 전략).
function aiWantsRiichi(hand14, melds, seatWind, roundWind, persona, ctx) {
  if (!melds.every(m => m.kind === 'ankan')) return false;
  persona = persona || STANDARD_PERSONA;
  const decision = evaluateGate(persona.riichiRules, withGoal(persona, ctx || {}));
  if (decision === 'dama') return false;
  return true;
}

// 안깡 여부 결정. kanRules가 없는 페르소나는 절대 깡하지 않는다 (기존 동작 유지)
function aiDecideAnkan(player, persona, ctx, kanOptions) {
  persona = persona || STANDARD_PERSONA;
  if (!persona.kanRules || persona.kanRules.length === 0) return null;
  const goalCtx = withGoal(persona, ctx || {});
  for (const opt of kanOptions) {
    for (const rule of persona.kanRules) {
      if (rule.when(goalCtx, opt) && rule.decision === 'kan') return opt;
    }
  }
  return null;
}

// 안전패 판정: 겐부츠/리치 후 통과패/카베(0) · 스지·이치노리·자패 3장 노출(1) · 위험(2)
// assessingPlayer = 이 판정을 하는(버릴지 고민하는) 본인 — 그 사람이 "보이는" 정보 기준으로 판단한다.
// forceEvaluate=true면 리치하지 않은 상대(후로 위협 등)도 평가한다.
function estimateTileDanger(tile, opponent, assessingPlayer, forceEvaluate = false) {
  if (!opponent) return 0;
  if (!opponent.riichi && !forceEvaluate) return 0;

  const sameTile = t => t.suit === tile.suit && t.rank === tile.rank;
  if (opponent.discards.some(sameTile)) return 0; // 겐부츠

  // 카베: 이 패가 이미 4장 다 보이면(내가 보는 기준) 상대가 들고 있을 수 없어 절대 안전
  if (assessingPlayer && typeof visibleCountOf === 'function' && visibleCountOf(tile, assessingPlayer) >= 4) return 0;

  // 리치 이후 아무나 이 패를 버렸는데 그 상대가 론을 안 했다면(=지나감) 그 상대에게는 안전
  if (opponent.riichi && Number.isInteger(opponent.riichiTimelineIdx) && typeof state !== 'undefined' && Array.isArray(state.discardTimeline)) {
    const passedSinceRiichi = state.discardTimeline.slice(opponent.riichiTimelineIdx).some(e => sameTile(e.tile));
    if (passedSinceRiichi) return 0;
  }

  if (tile.suit === 'z') {
    const seen = (assessingPlayer && typeof visibleCountOf === 'function') ? visibleCountOf(tile, assessingPlayer) : 0;
    return seen >= 3 ? 1 : 2; // 자패는 3장 이상 노출되면(마지막 1장) 비교적 안전
  }

  const suji1 = tile.rank - 3, suji2 = tile.rank + 3;
  const hasSuji = opponent.discards.some(t => t.suit === tile.suit && (t.rank === suji1 || t.rank === suji2));
  if (hasSuji) return 1;

  // 이치노리(one-chance): 인접한 숫자패가 3장 이상 보이면 그쪽 료멘이 성립하기 어려움
  if (assessingPlayer && typeof visibleCountOf === 'function') {
    const leftCount = tile.rank > 1 ? visibleCountOf({ suit: tile.suit, rank: tile.rank - 1 }, assessingPlayer) : 4;
    const rightCount = tile.rank < 9 ? visibleCountOf({ suit: tile.suit, rank: tile.rank + 1 }, assessingPlayer) : 4;
    if (leftCount >= 3 || rightCount >= 3) return 1;
  }

  return 2;
}

function computeCallResultShanten(hand, melds, callType, tile, chiOption) {
  const remaining = hand.slice();
  if (callType === 'pon') {
    let removed = 0;
    for (let i = remaining.length - 1; i >= 0 && removed < 2; i--) {
      if (remaining[i].suit === tile.suit && remaining[i].rank === tile.rank) { remaining.splice(i, 1); removed++; }
    }
  } else {
    const need = [chiOption.rank, chiOption.rank + 1, chiOption.rank + 2].filter(r => r !== tile.rank);
    for (const r of need) {
      const idx = remaining.findIndex(t => t.suit === tile.suit && t.rank === r);
      if (idx >= 0) remaining.splice(idx, 1);
    }
  }
  return minShantenAfterAnyDiscard(remaining, new Array(melds.length + 1));
}

// 만들어질 멘츠 3장 중에 요구패(노두/자패)가 있는지
function callMeldHasTerminalHonor(callType, tile, chiOption) {
  if (callType === 'pon') return isTerminalOrHonor(tile);
  const ranks = [chiOption.rank, chiOption.rank + 1, chiOption.rank + 2];
  return ranks.some(r => r === 1 || r === 9);
}

// 상대가 버린 패에 대해 퐁/치를 할지 결정 (론은 game.js에서 별도로 항상 처리)
function aiDecideCallOnDiscard(player, tile, discarderIdx, callerIdx, seatWind, roundWind, ctx, opts) {
  const persona = player.persona || STANDARD_PERSONA;
  ctx = withGoal(persona, ctx || {});
  const ownShanten = ctx.ownShanten !== undefined ? ctx.ownShanten : calcShanten(countsFromTiles(player.hand), 4 - player.melds.length);

  const candidates = [];
  if (opts.canPon) candidates.push({ type: 'pon' });
  for (const co of (opts.chiOptions || [])) candidates.push({ type: 'chi', chiOption: co });

  let vetoed = false;
  const evaluated = [];
  for (const cand of candidates) {
    const resultShanten = computeCallResultShanten(player.hand, player.melds, cand.type, tile, cand.chiOption);
    const isYakuhaiTileFlag = tile.suit === 'z' && isYakuhaiTile(tile.suit, tile.rank, seatWind, roundWind);
    const hasTerminalHonor = callMeldHasTerminalHonor(cand.type, tile, cand.chiOption);
    const candCtx = Object.assign({}, ctx, {
      callType: cand.type, ownShanten, resultShanten,
      callTile: tile, isYakuhaiTile: isYakuhaiTileFlag, callHasTerminalHonor: hasTerminalHonor
    });
    evaluated.push({ cand, resultShanten, isYakuhaiTileFlag, hasTerminalHonor });
    const decision = evaluateGate(persona.callRules, candCtx);
    if (decision === 'call') return { action: cand.type, chiOption: cand.chiOption };
    if (decision === 'pass') vetoed = true; // 명시적 거부 -> 폴백으로 내려가지 않음
  }
  if (vetoed) return { action: 'pass' };

  // ---- 기초전략 폴백 (페르소나가 특별히 정해둔 규칙이 없을 때) ----
  // 1) 역패 트리플렛은 항상 좋음 (확정 야쿠 + 속도)
  const yakuhaiPon = evaluated.find(e => e.cand.type === 'pon' && e.isYakuhaiTileFlag);
  if (yakuhaiPon) return { action: 'pon' };

  // 2) 그 외 콜은: 샹텐이 나빠지지 않고, 야쿠 경로가 남아있을 때만
  //    - 이미 후로한 손패(오픈)면 이미 야쿠를 노리는 중이라 보고 효율 위주로 진행
  //    - 멘젠 손패면 탄야오(요구패 없는 형태)가 유지되는 콜만 허용 (야쿠 없는 함정 방지)
  const isAlreadyOpen = player.melds.length > 0;
  for (const e of evaluated) {
    if (e.resultShanten > ownShanten) continue;
    if (isAlreadyOpen || !e.hasTerminalHonor) return { action: e.cand.type, chiOption: e.cand.chiOption };
  }
  return { action: 'pass' };
}

if (typeof module !== 'undefined') {
  module.exports = { aiChooseDiscard, aiWantsRiichi, aiDecideCallOnDiscard, aiDecideAnkan, estimateTileDanger, computeUkeire };
}
