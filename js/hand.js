// 손패 분석: 화료 판정, 텐파이/샹텐 계산, 분해(멘츠 구성) 열거

function tileTypeIndex(suit, rank) {
  if (suit === 'm') return rank - 1;
  if (suit === 'p') return rank - 1 + 9;
  if (suit === 's') return rank - 1 + 18;
  if (suit === 'z') return rank - 1 + 27;
}
function indexToTile(idx) {
  if (idx < 9) return { suit: 'm', rank: idx + 1 };
  if (idx < 18) return { suit: 'p', rank: idx - 9 + 1 };
  if (idx < 27) return { suit: 's', rank: idx - 18 + 1 };
  return { suit: 'z', rank: idx - 27 + 1 };
}

function countsFromTiles(tiles) {
  const counts = new Array(34).fill(0);
  for (const t of tiles) counts[tileTypeIndex(t.suit, t.rank)]++;
  return counts;
}

// ---------- 완전 분해 (4-n세트 + 1쌍, 정확히 맞아떨어져야 함) ----------
// numSets: 필요한 멘츠(세트) 개수 (오픈 멘츠 제외한 나머지)
function decomposeExact(counts, numSets) {
  const results = [];
  const work = counts.slice();

  function firstNonEmpty(from) {
    for (let i = from; i < 34; i++) if (work[i] > 0) return i;
    return -1;
  }

  function rec(sets, pairUsed, setsList, pairTile) {
    const idx = firstNonEmpty(0);
    if (idx === -1) {
      if (sets === numSets && pairUsed) {
        results.push({ sets: setsList.slice(), pair: pairTile });
      }
      return;
    }
    const t = indexToTile(idx);
    // 쌍(암각/대기용 페어) - 아직 페어를 안 썼다면
    if (!pairUsed && work[idx] >= 2) {
      work[idx] -= 2;
      rec(sets, true, setsList, { suit: t.suit, rank: t.rank });
      work[idx] += 2;
    }
    // 각자(트리플렛)
    if (sets < numSets && work[idx] >= 3) {
      work[idx] -= 3;
      setsList.push({ type: 'triplet', suit: t.suit, rank: t.rank });
      rec(sets + 1, pairUsed, setsList, pairTile);
      setsList.pop();
      work[idx] += 3;
    }
    // 순자(시퀀스) - 숫자패 & rank<=7
    if (sets < numSets && t.suit !== 'z' && t.rank <= 7) {
      const i1 = idx + 1, i2 = idx + 2;
      if (work[i1] > 0 && work[i2] > 0) {
        work[idx]--; work[i1]--; work[i2]--;
        setsList.push({ type: 'sequence', suit: t.suit, rank: t.rank });
        rec(sets + 1, pairUsed, setsList, pairTile);
        setsList.pop();
        work[idx]++; work[i1]++; work[i2]++;
      }
    }
    // 만약 위 어떤 것도 idx를 완전히 못비웠다면 -> 이 분해 경로는 실패 (가지치기됨: 아무 진행 없으면 return)
  }

  rec(0, false, [], null);
  return results;
}

function isChiitoitsu(counts) {
  let pairs = 0, kinds = 0;
  for (let i = 0; i < 34; i++) {
    if (counts[i] === 0) continue;
    kinds++;
    if (counts[i] === 2) pairs++;
    else return false; // 3장 이상 있으면 치또이 불가 (엄밀 규칙)
  }
  return pairs === 7 && kinds === 7;
}

const KOKUSHI_IDX = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];
function isKokushi(counts) {
  let kinds = 0, hasPair = false;
  for (const i of KOKUSHI_IDX) {
    if (counts[i] > 0) kinds++;
    if (counts[i] >= 2) hasPair = true;
  }
  for (let i = 0; i < 34; i++) {
    if (!KOKUSHI_IDX.includes(i) && counts[i] > 0) return false;
  }
  return kinds === 13 && hasPair;
}

// 완전한 화료 여부 판정 (14장 기준, concealedCounts + 오픈멘츠 수 고려)
function checkWin(concealedCounts, numSetsNeeded) {
  const decomps = decomposeExact(concealedCounts, numSetsNeeded);
  const chiitoi = numSetsNeeded === 4 ? isChiitoitsu(concealedCounts) : false;
  const kokushi = numSetsNeeded === 4 ? isKokushi(concealedCounts) : false;
  return { standard: decomps, chiitoi, kokushi, isWin: decomps.length > 0 || chiitoi || kokushi };
}

// ---------- 샹텐 계산 (표준형) ----------
function shantenStandard(counts) {
  let best = 8;
  const work = counts.slice();

  function firstNonEmpty(from) {
    for (let i = from; i < 34; i++) if (work[i] > 0) return i;
    return -1;
  }

  function finish(sets, partials, hasPair) {
    const usable = Math.min(partials, 4 - sets);
    const pairBonus = hasPair ? 1 : 0;
    const sh = (4 - sets) * 2 - usable - pairBonus;
    if (sh < best) best = sh;
  }

  function rec(sets, partials, hasPair) {
    if (sets + partials >= 5 && hasPair) { finish(sets, partials, hasPair); return; }
    const idx = firstNonEmpty(0);
    if (idx === -1) { finish(sets, partials, hasPair); return; }
    const t = indexToTile(idx);
    let branched = false;

    if (work[idx] >= 3) {
      work[idx] -= 3;
      rec(sets + 1, partials, hasPair);
      work[idx] += 3;
      branched = true;
    }
    if (t.suit !== 'z' && t.rank <= 7 && work[idx + 1] > 0 && work[idx + 2] > 0) {
      work[idx]--; work[idx + 1]--; work[idx + 2]--;
      rec(sets + 1, partials, hasPair);
      work[idx]++; work[idx + 1]++; work[idx + 2]++;
      branched = true;
    }
    if (work[idx] >= 2) {
      work[idx] -= 2;
      if (!hasPair) {
        rec(sets, partials, true);
      }
      rec(sets, partials + 1, hasPair);
      work[idx] += 2;
      branched = true;
    }
    if (t.suit !== 'z' && t.rank <= 8 && work[idx + 1] > 0) {
      work[idx]--; work[idx + 1]--;
      rec(sets, partials + 1, hasPair);
      work[idx]++; work[idx + 1]++;
      branched = true;
    }
    if (t.suit !== 'z' && t.rank <= 7 && work[idx + 2] > 0) {
      work[idx]--; work[idx + 2]--;
      rec(sets, partials + 1, hasPair);
      work[idx]++; work[idx + 2]++;
      branched = true;
    }
    // 고립패로 취급 (스킵)
    work[idx]--;
    rec(sets, partials, hasPair);
    work[idx]++;
  }

  rec(0, 0, false);
  return best;
}

function shantenChiitoi(counts) {
  let pairs = 0, kinds = 0;
  for (let i = 0; i < 34; i++) {
    if (counts[i] === 0) continue;
    kinds++;
    if (counts[i] >= 2) pairs++;
  }
  pairs = Math.min(pairs, 7);
  return 6 - pairs + Math.max(0, 7 - kinds);
}

function shantenKokushi(counts) {
  let kinds = 0, hasPair = false;
  for (const i of KOKUSHI_IDX) {
    if (counts[i] > 0) kinds++;
    if (counts[i] >= 2) hasPair = true;
  }
  return 13 - kinds - (hasPair ? 1 : 0);
}

// 전체 샹텐 (오픈멘츠 고려: counts는 손패(암패)만, numSetsNeeded = 4 - 오픈멘츠수)
function calcShanten(counts, numSetsNeeded) {
  if (numSetsNeeded === 4) {
    return Math.min(shantenStandard(counts), shantenChiitoi(counts), shantenKokushi(counts));
  }
  // 부르기(퐁/치/깡)가 있으면 치또이/국사는 불가능 - 표준형만 계산
  return shantenStandardWithFixedSets(counts, numSetsNeeded);
}

function shantenStandardWithFixedSets(counts, numSetsNeeded) {
  // sets 개수 목표를 numSetsNeeded로 낮춰서 계산 (오픈멘츠는 이미 완성된 세트로 취급됨)
  let best = 8;
  const work = counts.slice();
  function firstNonEmpty(from) { for (let i = from; i < 34; i++) if (work[i] > 0) return i; return -1; }
  function finish(sets, partials, hasPair) {
    const capSets = Math.min(sets, numSetsNeeded);
    const usable = Math.min(partials, numSetsNeeded - capSets);
    const pairBonus = hasPair ? 1 : 0;
    const sh = (numSetsNeeded - capSets) * 2 - usable - pairBonus;
    if (sh < best) best = sh;
  }
  function rec(sets, partials, hasPair) {
    if (sets >= numSetsNeeded && hasPair) { finish(sets, partials, hasPair); return; }
    const idx = firstNonEmpty(0);
    if (idx === -1) { finish(sets, partials, hasPair); return; }
    const t = indexToTile(idx);
    if (work[idx] >= 3) { work[idx] -= 3; rec(sets + 1, partials, hasPair); work[idx] += 3; }
    if (t.suit !== 'z' && t.rank <= 7 && work[idx + 1] > 0 && work[idx + 2] > 0) {
      work[idx]--; work[idx + 1]--; work[idx + 2]--;
      rec(sets + 1, partials, hasPair);
      work[idx]++; work[idx + 1]++; work[idx + 2]++;
    }
    if (work[idx] >= 2) {
      work[idx] -= 2;
      if (!hasPair) rec(sets, partials, true);
      rec(sets, partials + 1, hasPair);
      work[idx] += 2;
    }
    if (t.suit !== 'z' && t.rank <= 8 && work[idx + 1] > 0) {
      work[idx]--; work[idx + 1]--;
      rec(sets, partials + 1, hasPair);
      work[idx]++; work[idx + 1]++;
    }
    if (t.suit !== 'z' && t.rank <= 7 && work[idx + 2] > 0) {
      work[idx]--; work[idx + 2]--;
      rec(sets, partials + 1, hasPair);
      work[idx]++; work[idx + 2]++;
    }
    work[idx]--;
    rec(sets, partials, hasPair);
    work[idx]++;
  }
  rec(0, 0, false);
  return best;
}

if (typeof module !== 'undefined') {
  module.exports = {
    tileTypeIndex, indexToTile, countsFromTiles, decomposeExact,
    isChiitoitsu, isKokushi, checkWin, calcShanten, KOKUSHI_IDX
  };
}
