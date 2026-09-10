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
      // 형식텐파이: 패산이 거의 안 남았으면 노텐 벌부는 확정 손실인데 상대가 화료할 턴은 얼마
      // 남지 않았다. 텐파이/1샹텐이면 오리를 풀고 텐파이 성립·유지를 노린다(아래 상시 수비
      // 가중치가 남아 있어 같은 값이면 여전히 안전패를 고른다).
      { when: (c) => c.wallRemaining <= 16 && c.ownShanten <= 1, decision: 'normal' },
      // 완전 포기(배타오리)는 정말 가망이 없을 때만: 3샹텐 이상이거나, 순목이 늦었거나(9순 이후),
      // 텐파이인데 shouldFold()가 걸린 경우(=대기가 죽었거나 타점이 없는 텐파이).
      { when: (c) => c.threatLevel >= 1 && c.shouldFold()
          && (c.ownShanten >= 3 || c.turnNumber >= 9 || c.ownShanten === 0), decision: 'fold' },
      // 그 사이 구간(주로 이른 순목의 1~2샹텐 + 리치 상대)은 반오리: 손패를 통째로 버리지는
      // 않되 안전패를 우선한다. 예전엔 이 구간까지 전부 전면 후퇴라 전체 국의 40% 이상을
      // 스스로 포기했고, 그게 화료율을 가장 크게 깎고 있었다.
      { when: (c) => c.threatLevel >= 1 && c.shouldFold(), decision: 'guard' },
      // 큰 격차 1위 + 위협 감지 → 손패를 키우기보다 안전패를 우선 (공격성 저하)
      { when: (c) => c.hasBigLead && c.threatLevel >= 1, decision: 'cautious' },
      // 국사무쌍은 진짜로 가까울 때만 노린다. 무작위 13장 손패도 우연히 요구패 종류가 평균
      // 8~9종 가까이 스쳐가므로(자패/노두가 전체 패의 약 38%), 느슨한 기준(예: 6종류 이상)은
      // 실전에서 거의 매 국 걸려버려 국사만 쫓다 보통 손패로는 절대 화료를 못 하게 만드는
      // 버그성 결과를 냈다. 국사 샹텐이 표준형 샹텐보다 뚜렷이 앞설 때만 갈아탄다.
      { when: (c) => c.kokushiShanten <= 3 && c.kokushiShanten <= c.ownShanten, decision: 'kokushi' },
      // 치또이쯔도 국사와 같은 이유로 실제 치또이 샹텐 기준으로 판단한다. 예전 기준
      // (pairCount >= 3, "2장 이상인 종류가 3개")은 표준형 샹텐과 비교를 안 해서 흔한 손패도
      // 걸핏하면 치또이로 전환시켰다. 치또이는 7종류 페어가 필요한 느린 손패라 동률로는 부족하고
      // "표준형보다 확실히 앞설 때"(<=2)만 갈아탄다 — A/B 실측에서도 <=3보다 우세했다.
      { when: (c) => c.chiitoiShanten <= 2 && c.chiitoiShanten <= c.ownShanten && c.bodyCount < 2, decision: 'chiitoi' },
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

      // ===== 반오리(guard): 손패는 살리되 안전을 위해 샹텐 1까지는 양보 =====
      // 안전패 +10 / 위험패 -10 조합은 SHANTEN_PENALTY(15)보다 크고 2배(30)보다 작다 →
      // "샹텐 1 손해를 감수하고 안전패를 버리는 것"까지는 하되 2 손해는 보지 않는다.
      { when: (c, t) => c.goal === 'guard' && c.threatDangerFor(t) === 0, weight: 10 },
      { when: (c, t) => c.goal === 'guard' && c.threatDangerFor(t) === 1, weight: 4 },
      { when: (c, t) => c.goal === 'guard' && c.threatDangerFor(t) === 2, weight: -10 },

      // ===== 밀 때의 상시 약한 수비(표준형의 PUSH_FOLD_RULES와 같은 취지) =====
      // 합이 SHANTEN_PENALTY(15)보다 작아(5+5=10) 샹텐·우케이레를 절대 깎지 않고,
      // "효율이 같은 후보들 사이에서만" 안전한 쪽으로 기운다. 기존엔 오리 모드가 아니면
      // 위험도를 아예 안 봐서, 미는 동안 방총을 줄일 수단이 전혀 없었다.
      { when: (c, t) => c.goal !== 'fold' && c.goal !== 'cautious' && c.goal !== 'guard'
          && c.threatLevel >= 1 && c.threatDangerFor(t) === 0, weight: 5 },
      { when: (c, t) => c.goal !== 'fold' && c.goal !== 'cautious' && c.goal !== 'guard'
          && c.threatLevel >= 1 && c.threatDangerFor(t) === 2, weight: -5 },

      // ===== 깡을 하지 않고 4장을 그대로 들고 간다 =====
      // -25는 SHANTEN_PENALTY(15)를 넘어 샹텐을 희생하면서까지 4장을 쥐게 만들었다. 텐파이가
      // 되면 어차피 kanRules가 깡을 하므로, 그 전에 손패 효율까지 깎을 이유는 없다 → -12로 낮춰
      // "효율이 같을 때만 4장을 유지"하는 버릇으로 남긴다.
      { when: (c, t) => c.goal !== 'fold' && c.countInHand(t) === 4, weight: -12 },

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
      // 텐파이가 아닐 때만 강제한다 (텐파이는 절대 깨지 않음). 절일문 자체가 목적이 아니라
      // 손패를 정리하는 수단이므로, ① 이미 완성된 몸통(커쯔/슌쯔)은 그 수트라도 건드리지 않고
      // ② 이 버림으로 샹텐이 최선(ownShanten)보다 나빠지면 가중치를 주지 않는다.
      // 가중치도 누적 20에서 8로 낮췄다 — 우케이레(대기 폭) 보정이 장당 0.5점이라 20 앞에서는
      // 늘 무시됐기 때문이다. A/B 실측: 유국텐파이 47.3% -> 58.0%, 화료율 16.1% -> 17.2%.
      { when: (c, t, resultShanten) => c.goal === 'normal' && c.ownShanten > 0 && t.suit === c.cutSuit
          && !c.isPartOfCompleteSet(t) && resultShanten <= c.ownShanten, weight: 5 },
      { when: (c, t, resultShanten) => c.goal === 'normal' && c.ownShanten > 0 && t.suit === c.cutSuit
          && c.suitCounts[c.cutSuit] <= 3 && !c.isPartOfCompleteSet(t) && resultShanten <= c.ownShanten, weight: 3 },
      { when: (c, t) => c.goal === 'normal' && c.countInHand(t) >= 2, weight: -6 },
      { when: (c, t) => c.goal === 'normal' && c.countInHand(t) === 1 && t.suit !== 'z' && c.hasAdjacentInHand(t), weight: 4 },
      { when: (c, t, resultShanten) => c.goal === 'normal' && t.suit === 'z'
          && isYakuhaiTile(t.suit, t.rank, c.seatWind, c.roundWind) && resultShanten > 0, weight: -5 },
      // 위험 상황(threatLevel >= 1)에서 이미 2장 이상 버려진 자패가 손에 들어오면 역패 여부와
      // 무관하게 절대 안전패로 보고 비축했다가 텐파이 성립 순간 방출한다. 위험하지 않을 때는
      // 굳이 쥐고 있을 이유가 없어(위 -5 역패 선호나 손패 효율에 맡기면 됨) 위험 상황으로만
      // 한정했고, "역패"가 아니라 "자패" 전체로 넓힌 것은 위험할 때는 역 여부보다 방총 회피가
      // 우선이기 때문이다(손님 바람패도 2장 이상 버려졌으면 역패와 마찬가지로 사실상 안전패).
      { when: (c, t, resultShanten) => c.goal === 'normal' && c.threatLevel >= 1 && t.suit === 'z'
          && c.discardedCountOf(t) >= 2 && resultShanten > 0, weight: -12 }
      // 수비 규칙 없음 → 오리 모드가 아닌 한 위험패도 그대로 민다
    ],

    riichiRules: [
      { when: (c) => c.goal === 'fold' || c.goal === 'cautious', decision: 'dama' },
      { when: (c) => c.anyOpponentRiichi, decision: 'chase' },   // 추격리치 (아래 만관 규칙을 가로챔)
      // 역이 하나도 없는 텐파이(bestWinHan() === 0)는 다마로는 화료 자체가 불가능하다.
      // "타점이 모일 때까지 기다린다"는 아래 규칙을 그대로 적용하면 영영 리치를 못 걸고
      // 텐파이인 채로 유국까지 가버리므로, 이 경우엔 판수와 무관하게 무조건 리치를 건다.
      { when: (c) => c.bestWinHan() === 0, decision: 'riichi' },
      // 역(도라 포함, 리치 제외)의 판수 + 리치 한 판을 더해 4판(하네만권)에 못 미치면 보류하고
      // 계속 손패를 키운다. 4판 이상이면 그 순간 리치를 걸어 확정짓는다.
      { when: (c) => (c.bestWinHan() + 1) < 4, decision: 'dama' }
    ],

    // 텐파이에서 안깡해도 텐파이가 유지되면(=영상개화 가능) 즉시 깡, 그 외엔 절대 안 함
    kanRules: [
      { when: (c, opt) => c.ownShanten === 0 && c.goal !== 'fold' && c.goal !== 'cautious'
          && c.ankanKeepsTenpai(opt), decision: 'kan' }
    ],

    callRules: [
      { when: (c) => c.goal === 'fold' || c.goal === 'cautious', decision: 'pass' },
      // 반오리 중에는 샹텐이 확실히 줄어드는 콜만 받는다(그래야 텐파이까지 가서 다시 밀 수 있다)
      { when: (c) => c.goal === 'guard' && c.resultShanten < c.ownShanten, decision: 'call' },
      { when: (c) => c.goal === 'guard', decision: 'pass' },
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
