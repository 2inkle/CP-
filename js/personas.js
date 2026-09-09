// AI 페르소나(조패 경향) 규칙 엔진
// 규칙은 평범한 JS 조건함수(when)와 결과(then/decision/action)로 표현한다.
// 사람이 이 파일에 규칙을 계속 추가/수정하는 것만으로 새로운 성향을 만들 수 있다.

// gate 규칙: 순서대로 검사해 when(ctx)가 true인 첫 규칙의 decision을 반환. 없으면 null.
function evaluateGate(rules, ctx) {
  for (const r of (rules || [])) {
    if (r.when(ctx)) return r.decision;
  }
  return null;
}

// weight 규칙: when(ctx, tile, resultShanten)이 true인 모든 규칙의 weight를 합산.
// resultShanten = 그 패를 버렸을 때 남는 샹텐수
function sumWeights(rules, ctx, tile, resultShanten) {
  let sum = 0;
  for (const r of (rules || [])) {
    if (r.when(ctx, tile, resultShanten)) sum += r.weight;
  }
  return sum;
}

// 이번 턴에 노릴 목표(goal)를 하나 고른다. goalRules가 없으면 'normal'.
function resolveGoal(persona, ctx) {
  return evaluateGate(persona.goalRules, ctx) || 'normal';
}

// 공유 판단(모든 페르소나가 성향과 별개로 갖는 기본 실력): 진짜 위험(threatLevel>=1)할 때
// shouldFold() 판정이면 손패 가치를 접고 안전패 위주로 갈아타고, 그 정도까지는 아니면
// "밀되 같은 값이면 안전한 쪽" 정도로 살짝 기운다. 완전 무시도, 무조건 회피도 아닌 절충.
const PUSH_FOLD_RULES = [
  { when: (c, t) => c.threatLevel >= 1 && c.shouldFold() && c.threatDangerFor(t) === 0, weight: 100 },
  { when: (c, t) => c.threatLevel >= 1 && c.shouldFold() && c.threatDangerFor(t) === 1, weight: 40 },
  { when: (c, t) => c.threatLevel >= 1 && c.shouldFold() && c.threatDangerFor(t) === 2, weight: -100 },
  { when: (c, t) => c.threatLevel >= 1 && !c.shouldFold() && c.threatDangerFor(t) === 2, weight: -6 },
  { when: (c, t) => c.threatLevel >= 1 && !c.shouldFold() && c.threatDangerFor(t) === 0, weight: 6 }
];

// 속공형용 완화 버전: 어지간해서는 접지 않고 계속 미는 성향을 유지하되, 답이 없는 상황(샹텐 2 이상 +
// 강한 위협)에서만 최소한으로 접는다.
const SPEED_PUSH_RULES = [
  { when: (c, t) => c.threatLevel >= 2 && c.shouldFold() && c.ownShanten >= 2 && c.threatDangerFor(t) === 0, weight: 80 },
  { when: (c, t) => c.threatLevel >= 2 && c.shouldFold() && c.ownShanten >= 2 && c.threatDangerFor(t) === 2, weight: -80 },
  { when: (c, t) => c.threatLevel >= 1 && c.threatDangerFor(t) === 2, weight: -4 },
  { when: (c, t) => c.threatLevel >= 1 && c.threatDangerFor(t) === 0, weight: 4 }
];

const PERSONAS = [
  {
    id: 'standard',
    name: '표준형',
    desc: '샹텐·우케이레를 계산해 효율적으로 진행하고, 텐파이면 항상 리치. 위험할 땐 상황에 맞게 밀거나 접는다.',
    discardRules: [...PUSH_FOLD_RULES],
    riichiRules: [],
    callRules: []
  },
  {
    id: 'honitsu',
    name: '혼일색 지향 (공격형)',
    desc: '한 수트에 패가 몰리면 그 수트를 지키고 다른 수트를 먼저 정리. 콜은 자제하며 멘젠 유지. 위험할 땐 상황에 맞게 밀거나 접는다.',
    discardRules: [
      // 다른 숫자패 수트(목표 수트가 아닌)는 먼저 버림 (자패는 혼일색과 호환되므로 대상 아님)
      { when: (ctx, tile) => tile.suit !== 'z' && ctx.targetSuit && tile.suit !== ctx.targetSuit, weight: 6 },
      // 목표 수트 패는 최대한 유지
      { when: (ctx, tile) => ctx.targetSuit && tile.suit === ctx.targetSuit, weight: -8 },
      ...PUSH_FOLD_RULES
    ],
    riichiRules: [],
    callRules: []
  },
  {
    id: 'speed',
    name: '속공형',
    desc: '샹텐이 나아지면 치/퐁을 적극적으로 사용해 빠르게 진행. 리치보다 다마텐(무언의 텐파이)을 선호. 어지간하면 계속 밀어붙임.',
    discardRules: [...SPEED_PUSH_RULES],
    riichiRules: [
      { when: () => true, decision: 'dama' }
    ],
    callRules: [
      { when: (ctx) => ctx.resultShanten <= ctx.ownShanten, decision: 'call' }
    ]
  },
  {
    id: 'defense',
    name: '수비형',
    desc: '상대가 리치하면 겐부츠/스지 위주로 안전하게 버티고, 자신은 리치를 자제함.',
    discardRules: [
      { when: (ctx, tile) => ctx.anyOpponentRiichi && ctx.dangerFor(tile) === 0, weight: 25 },
      { when: (ctx, tile) => ctx.anyOpponentRiichi && ctx.dangerFor(tile) === 1, weight: 6 },
      { when: (ctx, tile) => ctx.anyOpponentRiichi && ctx.dangerFor(tile) === 2, weight: -25 }
    ],
    riichiRules: [
      { when: (ctx) => ctx.anyOpponentRiichi, decision: 'dama' }
    ],
    callRules: []
  },
  {
    id: 'seogaeul',
    name: '서가을',
    charName: '서가을',
    desc: '커쯔·역패 중심으로 한 수트를 끊고 2수트로 몰아가는 공격형. 상황에 따라 국사·치또이·대요구로 갈아타며, 큰 손이 아니면 리치를 미루다 남이 리치하면 즉시 추격리치.',

    // ---- 이번 턴에 노릴 목표 (위에서부터 먼저 걸리는 것) ----
    goalRules: [
      { when: (c) => c.threatLevel >= 1 && c.shouldFold(), decision: 'fold' },
      // 큰 격차 1위 + 위협 감지 → 손패를 키우기보다 안전패를 우선 (공격성 저하)
      { when: (c) => c.hasBigLead && c.threatLevel >= 1, decision: 'cautious' },
      { when: (c) => c.terminalHonorCount >= 6, decision: 'kokushi' },
      { when: (c) => c.pairCount >= 3 && c.bodyCount < 2, decision: 'chiitoi' },
      { when: (c) => c.isBehind && c.terminalHonorCount <= 2, decision: 'tanyao' },
      { when: (c) => c.isBehind && c.terminalHonorCount <= 5, decision: 'chanta' }
    ],

    discardRules: [
      // ===== 배타오리: 샹텐을 버리고 안전패만 =====
      { when: (c, t) => c.goal === 'fold' && c.threatDangerFor(t) === 0, weight: 100 },
      { when: (c, t) => c.goal === 'fold' && c.threatDangerFor(t) === 1, weight: 40 },
      { when: (c, t) => c.goal === 'fold' && c.threatDangerFor(t) === 2, weight: -100 },

      // ===== 신중 모드: 샹텐이 늘어도 안전패 우선 (같은 위험도끼리는 샹텐으로 비교) =====
      { when: (c, t) => c.goal === 'cautious' && c.threatDangerFor(t) === 0, weight: 45 },
      { when: (c, t) => c.goal === 'cautious' && c.threatDangerFor(t) === 1, weight: 20 },
      { when: (c, t) => c.goal === 'cautious' && c.threatDangerFor(t) === 2, weight: -45 },

      // ===== 깡을 하지 않고 4장을 그대로 들고 간다 =====
      { when: (c, t) => c.goal !== 'fold' && c.countInHand(t) === 4, weight: -25 },

      // ===== 국사무쌍 =====
      { when: (c, t) => c.goal === 'kokushi' && c.ownShanten > 0 && !isTerminalOrHonor(t), weight: 60 },
      { when: (c, t) => c.goal === 'kokushi' && c.ownShanten > 0 && isTerminalOrHonor(t) && c.countInHand(t) >= 3, weight: 30 },
      { when: (c, t) => c.goal === 'kokushi' && c.ownShanten > 0 && isTerminalOrHonor(t) && c.countInHand(t) <= 2, weight: -40 },

      // ===== 치또이쯔 (완성된 몸통은 건드리지 않음) =====
      { when: (c, t) => c.goal === 'chiitoi' && c.ownShanten > 0 && !c.isPartOfCompleteSet(t) && c.countInHand(t) === 1, weight: 25 },
      { when: (c, t) => c.goal === 'chiitoi' && c.ownShanten > 0 && !c.isPartOfCompleteSet(t) && c.countInHand(t) >= 3, weight: 30 },
      { when: (c, t) => c.goal === 'chiitoi' && c.ownShanten > 0 && !c.isPartOfCompleteSet(t) && c.countInHand(t) === 2, weight: -30 },

      // ===== 탕야오 (점수 불리 + 요구패가 적을 때) =====
      { when: (c, t) => c.goal === 'tanyao' && c.ownShanten > 0 && isTerminalOrHonor(t), weight: 30 },
      { when: (c, t) => c.goal === 'tanyao' && c.ownShanten > 0 && !isTerminalOrHonor(t), weight: -5 },

      // ===== 대요구 계열 (점수 불리 + 요구패가 많을 때) =====
      { when: (c, t) => c.goal === 'chanta' && c.ownShanten > 0 && t.suit !== 'z' && t.rank >= 4 && t.rank <= 6, weight: 30 },
      { when: (c, t) => c.goal === 'chanta' && c.ownShanten > 0 && isTerminalOrHonor(t), weight: -20 },

      // ===== 기본형: 절일문 + 커쯔 우선 + 역패 =====
      // 텐파이가 아닐 때만 강제한다 (텐파이는 절대 깨지 않음)
      { when: (c, t) => c.goal === 'normal' && c.ownShanten > 0 && t.suit === c.cutSuit, weight: 10 },
      { when: (c, t) => c.goal === 'normal' && c.ownShanten > 0 && t.suit === c.cutSuit && c.suitCounts[c.cutSuit] <= 3, weight: 10 },
      { when: (c, t) => c.goal === 'normal' && c.countInHand(t) >= 2, weight: -6 },
      { when: (c, t) => c.goal === 'normal' && c.countInHand(t) === 1 && t.suit !== 'z' && c.hasAdjacentInHand(t), weight: 4 },
      { when: (c, t, resultShanten) => c.goal === 'normal' && t.suit === 'z'
          && isYakuhaiTile(t.suit, t.rank, c.seatWind, c.roundWind) && resultShanten > 0, weight: -5 },
      // 2장 이상 버려진 역패 = 절대 안전패 → 품고 있다가 텐파이 성립 순간 방출
      { when: (c, t, resultShanten) => c.goal === 'normal' && t.suit === 'z'
          && isYakuhaiTile(t.suit, t.rank, c.seatWind, c.roundWind)
          && c.discardedCountOf(t) >= 2 && resultShanten > 0, weight: -12 }
      // 수비 규칙 없음 → 오리 모드가 아닌 한 위험패도 그대로 민다
    ],

    riichiRules: [
      { when: (c) => c.goal === 'fold' || c.goal === 'cautious', decision: 'dama' },
      { when: (c) => c.anyOpponentRiichi, decision: 'chase' },   // 추격리치 (아래 만관 규칙을 가로챔)
      { when: (c) => c.bestWinBase() <= 2000, decision: 'dama' } // 만관 이하 → 보류하고 더 키움
    ],

    // 텐파이에서 안깡해도 텐파이가 유지되면(=영상개화 가능) 즉시 깡, 그 외엔 절대 안 함
    kanRules: [
      { when: (c, opt) => c.ownShanten === 0 && c.goal !== 'fold' && c.goal !== 'cautious'
          && c.ankanKeepsTenpai(opt), decision: 'kan' }
    ],

    callRules: [
      { when: (c) => c.goal === 'fold' || c.goal === 'cautious', decision: 'pass' },
      // 몸통 2개 이상 + 퐁 기회 → 치또이를 버리고서라도 적극 후로
      { when: (c) => c.bodyCount >= 2 && c.callType === 'pon' && c.resultShanten <= c.ownShanten, decision: 'call' },
      { when: (c) => c.goal === 'kokushi' || c.goal === 'chiitoi', decision: 'pass' },
      { when: (c) => c.goal === 'tanyao' && c.callHasTerminalHonor, decision: 'pass' },
      { when: (c) => c.goal === 'chanta' && !c.callHasTerminalHonor, decision: 'pass' },
      { when: (c) => c.isBehind && c.resultShanten <= c.ownShanten, decision: 'call' }
      // 그 외에는 폴백(역패 커쯔만 퐁) → 평소엔 후로를 좀처럼 하지 않음
    ]
  }
];

const STANDARD_PERSONA = PERSONAS[0];

if (typeof module !== 'undefined') {
  module.exports = { PERSONAS, STANDARD_PERSONA, evaluateGate, sumWeights, resolveGoal };
}
