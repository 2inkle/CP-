// 패(타일) 정의 및 유틸리티
// suit: 'm'(만수), 'p'(통수), 's'(삭수), 'z'(자패: 1동2남3서4북5백6발7중)

const SUITS = ['m', 'p', 's', 'z'];

const HONOR_NAMES = {
  1: '東', 2: '南', 3: '西', 4: '北', 5: '白', 6: '發', 7: '中'
};
const HONOR_NAMES_KR = {
  1: '동', 2: '남', 3: '서', 4: '북', 5: '백', 6: '발', 7: '중'
};

// 유니코드 마작 타일 코드포인트
function tileGlyph(suit, rank) {
  if (suit === 'z') {
    // 1동 2남 3서 4북 5백 6발 7중
    const map = {
      1: 0x1F000, 2: 0x1F001, 3: 0x1F002, 4: 0x1F003,
      6: 0x1F005, // 발(초록룡)
      7: 0x1F004, // 중(빨강룡)
      5: 0x1F006  // 백(하얀룡)
    };
    return String.fromCodePoint(map[rank]);
  }
  if (suit === 'm') return String.fromCodePoint(0x1F006 + rank); // 1F007=1m .. 1F00F=9m
  if (suit === 's') return String.fromCodePoint(0x1F00F + rank); // 1F010=1s .. 1F018=9s
  if (suit === 'p') return String.fromCodePoint(0x1F018 + rank); // 1F019=1p .. 1F021=9p
  return '?';
}

function tileLabel(suit, rank) {
  if (suit === 'z') return HONOR_NAMES_KR[rank];
  return `${rank}${suit}`;
}

let __uid = 0;
function makeTile(suit, rank, red = false) {
  return { uid: __uid++, suit, rank, red, key: `${suit}${rank}` };
}

function createWallTiles() {
  const tiles = [];
  for (const suit of ['m', 'p', 's']) {
    for (let rank = 1; rank <= 9; rank++) {
      for (let i = 0; i < 4; i++) {
        const red = (rank === 5 && i === 0); // 각 수트 5 중 1장은 적도라
        tiles.push(makeTile(suit, rank, red));
      }
    }
  }
  for (let rank = 1; rank <= 7; rank++) {
    for (let i = 0; i < 4; i++) tiles.push(makeTile('z', rank, false));
  }
  return tiles; // 136장
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function sortHand(tiles) {
  const order = { m: 0, p: 1, s: 2, z: 3 };
  return [...tiles].sort((a, b) => {
    if (a.suit !== b.suit) return order[a.suit] - order[b.suit];
    return a.rank - b.rank;
  });
}

function tileEquals(a, b) {
  return a.suit === b.suit && a.rank === b.rank;
}

function isTerminalOrHonor(t) {
  if (t.suit === 'z') return true;
  return t.rank === 1 || t.rank === 9;
}

function isHonor(t) { return t.suit === 'z'; }
function isTerminal(t) { return t.suit !== 'z' && (t.rank === 1 || t.rank === 9); }

// 다음 도라(다음 패)를 구한다 (도라 지시패 -> 실제 도라)
function nextDoraTile(indicator) {
  if (indicator.suit === 'z') {
    if (indicator.rank <= 4) { // 풍패 순환 東南西北
      const nextRank = indicator.rank === 4 ? 1 : indicator.rank + 1;
      return { suit: 'z', rank: nextRank };
    } else { // 삼원패 순환 白發中
      const cycle = { 5: 6, 6: 7, 7: 5 };
      return { suit: 'z', rank: cycle[indicator.rank] };
    }
  }
  const nextRank = indicator.rank === 9 ? 1 : indicator.rank + 1;
  return { suit: indicator.suit, rank: nextRank };
}

if (typeof module !== 'undefined') {
  module.exports = { createWallTiles, shuffle, sortHand, tileEquals, tileGlyph, tileLabel, isTerminalOrHonor, isHonor, isTerminal, nextDoraTile, HONOR_NAMES_KR };
}
