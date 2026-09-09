// 역(야쿠) 판정, 부(후) 계산, 점수 계산

const WIND_NAME = { 1: '동', 2: '남', 3: '서', 4: '북' };

function isYakuhaiTile(suit, rank, seatWind, roundWind) {
  if (suit !== 'z') return false;
  if (rank >= 5) return true; // 삼원패
  if (rank === seatWind) return true;
  if (rank === roundWind) return true;
  return false;
}

function meldToSet(meld) {
  if (meld.kind === 'chi') return { type: 'sequence', suit: meld.suit, rank: meld.rank, concealed: false, tiles: meld.tiles };
  if (meld.kind === 'pon') return { type: 'triplet', suit: meld.suit, rank: meld.rank, concealed: false, tiles: meld.tiles };
  if (meld.kind === 'ankan') return { type: 'quad', suit: meld.suit, rank: meld.rank, concealed: true, tiles: meld.tiles };
  if (meld.kind === 'minkan' || meld.kind === 'kakan') return { type: 'quad', suit: meld.suit, rank: meld.rank, concealed: false, tiles: meld.tiles };
}

function allTilesOfHand(concealedTiles, melds) {
  let all = [...concealedTiles];
  for (const m of melds) all = all.concat(m.tiles);
  return all;
}

function isAllSuitOnly(tiles) {
  const suits = new Set(tiles.filter(t => t.suit !== 'z').map(t => t.suit));
  const hasHonor = tiles.some(t => t.suit === 'z');
  return { suits, hasHonor };
}

// 대기(웨이트) 후보 생성: decomposition 안에서 winTile이 들어갈 수 있는 자리들을 모두 찾는다
function findWaitCandidates(concealedSets, pair, winTile) {
  const candidates = [];
  if (pair.suit === winTile.suit && pair.rank === winTile.rank) {
    candidates.push({ kind: 'tanki' });
  }
  concealedSets.forEach((s, i) => {
    if (s.type === 'triplet' && s.suit === winTile.suit && s.rank === winTile.rank) {
      candidates.push({ kind: 'triplet', setIndex: i });
    }
    if (s.type === 'sequence' && s.suit === winTile.suit && winTile.rank >= s.rank && winTile.rank <= s.rank + 2) {
      const ranks = [s.rank, s.rank + 1, s.rank + 2];
      const others = ranks.filter(r => r !== winTile.rank);
      let shape;
      if (others[1] - others[0] === 1) {
        if (others[0] === 1 && others[1] === 2) shape = 'penchan';
        else if (others[0] === 8 && others[1] === 9) shape = 'penchan';
        else shape = 'ryanmen';
      } else {
        shape = 'kanchan';
      }
      candidates.push({ kind: 'sequence', setIndex: i, shape });
    }
  });
  if (candidates.length === 0) candidates.push({ kind: 'tanki' }); // fallback safety
  return candidates;
}

function fuForSet(set, isOpenTriplet) {
  const terminalHonor = set.suit === 'z' || set.rank === 1 || set.rank === 9;
  if (set.type === 'sequence') return 0;
  if (set.type === 'triplet') {
    if (isOpenTriplet || !set.concealed) return terminalHonor ? 4 : 2;
    return terminalHonor ? 8 : 4;
  }
  if (set.type === 'quad') {
    if (set.concealed) return terminalHonor ? 32 : 16;
    return terminalHonor ? 16 : 8;
  }
  return 0;
}

function roundUp10(n) { return Math.ceil(n / 10) * 10; }

function evaluateHand(ctx) {
  const {
    concealedTiles, melds, winTile, isTsumo, seatWind, roundWind,
    riichi, doubleRiichi, ippatsu, isHaitei, isHoutei, isRinshan, isChankan,
    doraIndicators, uraDoraIndicators, isDealer
  } = ctx;

  const numSetsNeeded = 4 - melds.length;
  const concealedCounts = countsFromTiles(concealedTiles);
  const allTiles = allTilesOfHand(concealedTiles, melds);
  const fullyConcealed = melds.every(m => m.kind === 'ankan');

  const doraTiles = doraIndicators.map(ind => nextDoraTile(ind));
  const uraTiles = (riichi ? uraDoraIndicators : []).map(ind => nextDoraTile(ind));

  function countMatches(tileList, tile) {
    return tileList.filter(t => t.suit === tile.suit && t.rank === tile.rank).length;
  }

  let doraCount = 0;
  for (const d of doraTiles) doraCount += countMatches(allTiles, d);
  let uraCount = 0;
  for (const d of uraTiles) uraCount += countMatches(allTiles, d);
  const akaCount = allTiles.filter(t => t.red).length;

  const results = [];

  // ---------- 국사무쌍 (역만) ----------
  if (numSetsNeeded === 4 && isKokushi(concealedCounts)) {
    results.push({ yaku: [{ name: '국사무쌍', han: 13 }], han: 13, fu: 0, yakuman: 1 });
  }

  // ---------- 치또이츠 ----------
  if (numSetsNeeded === 4 && isChiitoitsu(concealedCounts)) {
    const yakuList = [{ name: '치또이츠', han: 2 }];
    let han = 2, fu = 25;
    const { suits, hasHonor } = isAllSuitOnly(allTiles);
    if (suits.size === 1 && !hasHonor) { yakuList.push({ name: '친이츠', han: 6 }); han += 6; }
    else if (suits.size === 1 && hasHonor) { yakuList.push({ name: '혼이츠', han: 3 }); han += 3; }
    if (allTiles.every(t => t.suit === 'z' || t.rank === 1 || t.rank === 9)) { yakuList.push({ name: '혼로또우', han: 2 }); han += 2; }
    if (riichi) { yakuList.push({ name: doubleRiichi ? '더블리치' : '리치', han: doubleRiichi ? 2 : 1 }); han += doubleRiichi ? 2 : 1; }
    if (ippatsu) { yakuList.push({ name: '일발', han: 1 }); han += 1; }
    if (isTsumo) { yakuList.push({ name: '멘젠쯔모', han: 1 }); han += 1; }
    if (isHaitei && isTsumo) { yakuList.push({ name: '하이테이', han: 1 }); han += 1; }
    if (isHoutei && !isTsumo) { yakuList.push({ name: '호우테이', han: 1 }); han += 1; }
    if (doraCount) { yakuList.push({ name: `도라`, han: doraCount }); han += doraCount; }
    if (uraCount) { yakuList.push({ name: `우라도라`, han: uraCount }); han += uraCount; }
    if (akaCount) { yakuList.push({ name: `적도라`, han: akaCount }); han += akaCount; }
    results.push({ yaku: yakuList, han, fu, yakuman: 0 });
  }

  // ---------- 표준형 ----------
  if (numSetsNeeded === 4 || melds.length > 0) {
    const decomps = decomposeExact(concealedCounts, numSetsNeeded);
    for (const d of decomps) {
      const meldSets = melds.map(meldToSet);
      // d.sets는 손패(암패) 분해 결과이므로 기본적으로 전부 암패(concealed)다.
      // (론으로 완성된 트리플렛만 아래에서 개별적으로 명커로 재취급됨)
      const concealedSets = d.sets.map(s => ({ ...s, concealed: true }));
      const allSets = meldSets.concat(concealedSets);
      const pair = d.pair;
      const waitCandidates = findWaitCandidates(d.sets, pair, winTile);

      for (const wait of waitCandidates) {
        // 이 후보에서 안커우 제외 대상 결정 (론으로 완성된 트리플렛은 명커로 취급)
        let openedSetGlobalIndex = -1;
        if (!isTsumo && wait.kind === 'triplet') {
          // d.sets 안의 인덱스를 allSets 인덱스로 변환
          openedSetGlobalIndex = meldSets.length + wait.setIndex;
        }

        const evaluatedSets = allSets.map((s, i) => {
          if (s.type === 'triplet') {
            const forcedOpen = (i === openedSetGlobalIndex);
            return { ...s, isOpenForFu: forcedOpen || !s.concealed };
          }
          return s;
        });

        let fu = 20;
        const isRon = !isTsumo;
        if (fullyConcealed && isRon) fu += 10;

        for (const s of evaluatedSets) fu += fuForSet(s, s.isOpenForFu);

        if (wait.kind === 'kanchan' || wait.kind === 'penchan' || wait.kind === 'tanki') fu += 2;

        if (pair.suit === 'z' && isYakuhaiTile(pair.suit, pair.rank, seatWind, roundWind)) {
          let pairFu = 0;
          if (pair.rank >= 5) pairFu += 2;
          if (pair.rank === seatWind) pairFu += 2;
          if (pair.rank === roundWind) pairFu += 2;
          fu += pairFu;
        }

        const isMenzen = fullyConcealed;
        const allSequences = evaluatedSets.every(s => s.type === 'sequence');
        const pairIsYakuhai = pair.suit === 'z' && isYakuhaiTile(pair.suit, pair.rank, seatWind, roundWind);
        const pinfuEligible = isMenzen && allSequences && !pairIsYakuhai && wait.kind === 'sequence' && wait.shape === 'ryanmen';

        if (isTsumo && !pinfuEligible) fu += 2;
        if (pinfuEligible) fu = isTsumo ? 20 : 30;

        const yakuList = [];
        let han = 0;

        if (riichi) { const h = doubleRiichi ? 2 : 1; yakuList.push({ name: doubleRiichi ? '더블리치' : '리치', han: h }); han += h; }
        if (ippatsu) { yakuList.push({ name: '일발', han: 1 }); han += 1; }
        if (isTsumo && isMenzen) { yakuList.push({ name: '멘젠쯔모', han: 1 }); han += 1; }
        if (pinfuEligible) { yakuList.push({ name: '핀후', han: 1 }); han += 1; }

        const tanyao = allTiles.every(t => t.suit !== 'z' && t.rank !== 1 && t.rank !== 9);
        if (tanyao) { yakuList.push({ name: '탄야오', han: 1 }); han += 1; }

        // 이페이코 (멘젠 한정)
        if (isMenzen) {
          const seqKeys = d.sets.filter(s => s.type === 'sequence').map(s => `${s.suit}${s.rank}`);
          const seen = new Set(); let iipeikou = false;
          for (const k of seqKeys) { if (seen.has(k)) iipeikou = true; seen.add(k); }
          if (iipeikou) { yakuList.push({ name: '이페이코', han: 1 }); han += 1; }
        }

        // 야쿠하이 (역패)
        for (const s of evaluatedSets) {
          if ((s.type === 'triplet' || s.type === 'quad') && s.suit === 'z') {
            let cnt = 0;
            if (s.rank >= 5) cnt += 1;
            if (s.rank === seatWind) cnt += 1;
            if (s.rank === roundWind) cnt += 1;
            if (cnt > 0) {
              const label = s.rank >= 5 ? ['白', '發', '中'][s.rank - 5] : WIND_NAME[s.rank] + '풍';
              yakuList.push({ name: `역패(${label})`, han: cnt }); han += cnt;
            }
          }
        }

        // 산쇼쿠 도우준
        const seqBySuit = { m: new Set(), p: new Set(), s: new Set() };
        for (const s of evaluatedSets) if (s.type === 'sequence') seqBySuit[s.suit].add(s.rank);
        let sanshoku = false;
        for (let r = 1; r <= 7; r++) { if (seqBySuit.m.has(r) && seqBySuit.p.has(r) && seqBySuit.s.has(r)) sanshoku = true; }
        if (sanshoku) { const h = isMenzen ? 2 : 1; yakuList.push({ name: '산쇼쿠도우준', han: h }); han += h; }

        // 산쇼쿠 도우코우
        const trplBySuit = { m: new Set(), p: new Set(), s: new Set() };
        for (const s of evaluatedSets) if ((s.type === 'triplet' || s.type === 'quad') && s.suit !== 'z') trplBySuit[s.suit].add(s.rank);
        let sanshokuDouko = false;
        for (let r = 1; r <= 9; r++) { if (trplBySuit.m.has(r) && trplBySuit.p.has(r) && trplBySuit.s.has(r)) sanshokuDouko = true; }
        if (sanshokuDouko) { yakuList.push({ name: '산쇼쿠도우코우', han: 2 }); han += 2; }

        // 잇츠우
        for (const suit of ['m', 'p', 's']) {
          if (seqBySuit[suit].has(1) && seqBySuit[suit].has(4) && seqBySuit[suit].has(7)) {
            const h = isMenzen ? 2 : 1; yakuList.push({ name: '잇츠우', han: h }); han += h;
          }
        }

        // 챤타 / 준찬
        const allSetsHaveTerminalOrHonor = evaluatedSets.every(s => {
          if (s.type === 'sequence') return s.rank === 1 || s.rank === 7;
          return s.suit === 'z' || s.rank === 1 || s.rank === 9;
        }) && (pair.suit === 'z' || pair.rank === 1 || pair.rank === 9);
        if (allSetsHaveTerminalOrHonor) {
          const hasAnyHonor = evaluatedSets.some(s => s.suit === 'z') || pair.suit === 'z';
          if (hasAnyHonor) { const h = isMenzen ? 2 : 1; yakuList.push({ name: '챤타', han: h }); han += h; }
          else { const h = isMenzen ? 3 : 2; yakuList.push({ name: '준찬타이야오', han: h }); han += h; }
        }

        // 토이토이
        const allTriplets = evaluatedSets.every(s => s.type === 'triplet' || s.type === 'quad');
        if (allTriplets) { yakuList.push({ name: '토이토이', han: 2 }); han += 2; }

        // 산안커우 (안커우 3개 이상, 콴깡 포함)
        const ankouCount = evaluatedSets.filter(s => (s.type === 'triplet' && !s.isOpenForFu) || (s.type === 'quad' && s.concealed)).length;
        if (ankouCount >= 3) { yakuList.push({ name: '산안커우', han: 2 }); han += 2; }

        // 산칸츠
        const kanCount = evaluatedSets.filter(s => s.type === 'quad').length;
        if (kanCount >= 3) { yakuList.push({ name: '산칸츠', han: 2 }); han += 2; }

        // 혼로또우
        if (allTriplets && allTiles.every(t => t.suit === 'z' || t.rank === 1 || t.rank === 9)) {
          yakuList.push({ name: '혼로또우', han: 2 }); han += 2;
        }

        // 쇼우산겐
        const dragonSets = evaluatedSets.filter(s => (s.type === 'triplet' || s.type === 'quad') && s.suit === 'z' && s.rank >= 5);
        if (dragonSets.length === 2 && pair.suit === 'z' && pair.rank >= 5) { yakuList.push({ name: '쇼우산겐', han: 2 }); han += 2; }

        // 혼이츠 / 친이츠
        const { suits: usedSuits, hasHonor } = isAllSuitOnly(allTiles);
        if (usedSuits.size === 1) {
          if (hasHonor) { const h = isMenzen ? 3 : 2; yakuList.push({ name: '혼이츠', han: h }); han += h; }
          else { const h = isMenzen ? 6 : 5; yakuList.push({ name: '친이츠', han: h }); han += h; }
        }

        if (isHaitei && isTsumo) { yakuList.push({ name: '하이테이', han: 1 }); han += 1; }
        if (isHoutei && !isTsumo) { yakuList.push({ name: '호우테이', han: 1 }); han += 1; }
        if (isRinshan) { yakuList.push({ name: '린샨카이호우', han: 1 }); han += 1; }
        if (isChankan) { yakuList.push({ name: '창깡', han: 1 }); han += 1; }

        if (doraCount) { yakuList.push({ name: '도라', han: doraCount }); han += doraCount; }
        if (uraCount) { yakuList.push({ name: '우라도라', han: uraCount }); han += uraCount; }
        if (akaCount) { yakuList.push({ name: '적도라', han: akaCount }); han += akaCount; }

        // ---------- 역만 체크 ----------
        let yakuman = 0; const yakumanNames = [];
        if (dragonSets.length === 3) { yakumanNames.push('다이산겐'); yakuman++; }
        if (ankouCount >= 4) { yakumanNames.push('스우안커우'); yakuman++; }
        if (allTiles.every(t => t.suit === 'z')) { yakumanNames.push('츠이이소우'); yakuman++; }
        if (allTiles.every(t => t.suit !== 'z' && (t.rank === 1 || t.rank === 9))) { yakumanNames.push('친로우토우'); yakuman++; }
        const isGreen = t => (t.suit === 's' && [2, 3, 4, 6, 8].includes(t.rank)) || (t.suit === 'z' && t.rank === 6);
        if (allTiles.every(isGreen)) { yakumanNames.push('류이소우'); yakuman++; }
        const windSets = evaluatedSets.filter(s => (s.type === 'triplet' || s.type === 'quad') && s.suit === 'z' && s.rank <= 4);
        if (windSets.length === 4) { yakumanNames.push('다이스우시이'); yakuman++; }
        else if (windSets.length === 3 && pair.suit === 'z' && pair.rank <= 4) { yakumanNames.push('쇼우스우시이'); yakuman++; }

        if (yakuman > 0) {
          results.push({ yaku: yakumanNames.map(n => ({ name: n, han: 13 })), han: 13 * yakuman, fu: 0, yakuman });
          continue;
        }

        // 役이 하나도 없으면 (도라만 있는 경우) 화료 불가 취급 -> 스킵
        const hasRealYaku = yakuList.some(y => !['도라', '우라도라', '적도라'].includes(y.name));
        if (!hasRealYaku) continue;

        fu = roundUp10(fu);
        results.push({ yaku: yakuList, han, fu, yakuman: 0 });
      }
    }
  }

  if (results.length === 0) return null;

  results.sort((a, b) => scorePoints(b, isDealer).total - scorePoints(a, isDealer).total);
  const best = results[0];
  const score = scorePoints(best, isDealer);
  return { ...best, ...score };
}

function limitName(han, yakuman) {
  if (yakuman >= 2) return `${yakuman}배 역만`;
  if (yakuman === 1) return '역만';
  if (han >= 13) return '역만';
  if (han >= 11) return '산바이만';
  if (han >= 8) return '바이만';
  if (han >= 6) return '하네만';
  return null;
}

function scorePoints(result, isDealer) {
  const { han, fu, yakuman } = result;
  let base;
  if (yakuman > 0) base = 8000 * yakuman;
  else if (han >= 13) base = 8000;
  else if (han >= 11) base = 6000;
  else if (han >= 8) base = 4000;
  else if (han >= 6) base = 3000;
  else {
    base = fu * Math.pow(2, han + 2);
    if (base > 2000) base = 2000; // 만관 상한
  }
  const name = limitName(han, yakuman) || (base === 2000 ? '만관' : null);

  let total, payments;
  if (isDealer) {
    const each = Math.ceil(base * 2 / 100) * 100;
    total = each * 3;
    payments = { ron: Math.ceil(base * 6 / 100) * 100, tsumoEach: each };
  } else {
    const fromDealer = Math.ceil(base * 2 / 100) * 100;
    const fromNonDealer = Math.ceil(base * 1 / 100) * 100;
    total = fromDealer + fromNonDealer * 2;
    payments = { ron: Math.ceil(base * 4 / 100) * 100, tsumoDealer: fromDealer, tsumoNonDealer: fromNonDealer };
  }
  return { total, payments, name, base };
}

if (typeof module !== 'undefined') {
  module.exports = { evaluateHand, scorePoints, isYakuhaiTile };
}
