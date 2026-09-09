// 컴퓨터(AI) 플레이어 로직 - 샹텐 기반 휴리스틱 + 페르소나(조패 경향) 규칙 반영

const SHANTEN_PENALTY = 15;

function withGoal(persona, ctx) {
  return Object.assign({}, ctx, { goal: resolveGoal(persona, ctx) });
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
    candidates.push({ tile: hand14[i], shanten: sh });
    if (sh < bestShanten) bestShanten = sh;
  }
  for (const c of candidates) {
    c.score = -(c.shanten - bestShanten) * SHANTEN_PENALTY
      + sumWeights(persona.discardRules, ctx, c.tile, c.shanten);
  }
  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // 동률이면: 도라가 아니고, 고립된 자패/노두패를 우선 버림
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

// game.js에서 이미 텐파이(리치 가능) 여부를 확인한 뒤 호출됨
function aiWantsRiichi(hand14, melds, seatWind, roundWind, persona, ctx) {
  if (!melds.every(m => m.kind === 'ankan')) return false;
  persona = persona || STANDARD_PERSONA;
  const decision = evaluateGate(persona.riichiRules, withGoal(persona, ctx || {}));
  if (decision === 'dama') return false;
  return true; // 규칙에 걸리지 않으면 기본: 텐파이면 항상 리치
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

// 안전패 판정: 겐부츠(0) / 스지·가베(1) / 위험(2)
// forceEvaluate=true면 리치하지 않은 상대(후로 위협 등)도 평가한다
function estimateTileDanger(tile, opponent, forceEvaluate = false) {
  if (!opponent) return 0;
  if (!opponent.riichi && !forceEvaluate) return 0;
  const inDiscard = opponent.discards.some(t => t.suit === tile.suit && t.rank === tile.rank);
  if (inDiscard) return 0;
  if (tile.suit === 'z') return 2; // 자패는 겐부츠가 아니면 간단히 위험으로 취급 (간략화)
  const suji1 = tile.rank - 3, suji2 = tile.rank + 3;
  const hasSuji = opponent.discards.some(t => t.suit === tile.suit && (t.rank === suji1 || t.rank === suji2));
  return hasSuji ? 1 : 2;
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
  for (const cand of candidates) {
    const resultShanten = computeCallResultShanten(player.hand, player.melds, cand.type, tile, cand.chiOption);
    const candCtx = Object.assign({}, ctx, {
      callType: cand.type, ownShanten, resultShanten,
      callTile: tile,
      isYakuhaiTile: tile.suit === 'z' && isYakuhaiTile(tile.suit, tile.rank, seatWind, roundWind),
      callHasTerminalHonor: callMeldHasTerminalHonor(cand.type, tile, cand.chiOption)
    });
    const decision = evaluateGate(persona.callRules, candCtx);
    if (decision === 'call') return { action: cand.type, chiOption: cand.chiOption };
    if (decision === 'pass') vetoed = true; // 명시적 거부 -> 폴백으로 내려가지 않음
  }

  // 폴백 (표준형 동작): 역패 트리플렛이면 퐁
  if (!vetoed && opts.canPon && tile.suit === 'z') {
    const isYakuhai = tile.rank >= 5 || tile.rank === seatWind || tile.rank === roundWind;
    if (isYakuhai) return { action: 'pon' };
  }
  return { action: 'pass' };
}

if (typeof module !== 'undefined') {
  module.exports = { aiChooseDiscard, aiWantsRiichi, aiDecideCallOnDiscard, aiDecideAnkan, estimateTileDanger };
}
