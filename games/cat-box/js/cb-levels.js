// cb-levels.js — 10 關關卡資料(格子座標,36 x 60;外框牆由引擎自動加)
// 角色尺寸:貓 5x5、紙箱 6x4、狗 6x5;地板上角色 y:貓/狗 54、紙箱 55
(function (cb_root) {
  const CB_LEVELS = [
    { // 1 教學:拔插銷
      name: '紙箱從天而降', hint: '點金色插銷,把紙箱放下來!',
      walls: [[11, 6, 1, 26], [24, 6, 1, 26]],
      pins: [{ x: 12, y: 31, len: 12, dir: 'h', handle: 'r' }],
      box: [15, 27], cat: [15, 54],
    },
    { // 2 小心岩漿
      name: '小心岩漿', hint: '岩漿碰到貓咪就失敗了',
      walls: [[3, 6, 1, 26], [15, 6, 1, 26], [20, 6, 1, 26], [32, 6, 1, 26]],
      lava: [[4, 20, 11, 11]],
      pins: [{ x: 4, y: 31, len: 11, handle: 'l' }, { x: 21, y: 31, len: 11, handle: 'r' }],
      box: [23, 27], cat: [15, 54],
    },
    { // 3 水能滅火(上:紙箱 中:水 下:岩漿)
      name: '水能滅火', hint: '水碰到岩漿會變成石頭',
      walls: [[5, 4, 1, 33], [18, 4, 1, 33]],
      water: [[6, 20, 12, 8]], lava: [[6, 31, 12, 5]],
      pins: [{ x: 6, y: 18, len: 12, handle: 'r' }, { x: 6, y: 28, len: 12, handle: 'r' }, { x: 6, y: 36, len: 12, handle: 'r' }],
      box: [9, 14], cat: [27, 54],
    },
    { // 4 石頭砸狗
      name: '石頭砸狗', hint: '狗狗看到貓咪會衝過來',
      walls: [[12, 20, 1, 17], [21, 20, 1, 17], [26, 10, 1, 23], [33, 10, 1, 23]],
      rock: [[13, 29, 8, 7]],
      pins: [{ x: 13, y: 36, len: 8, handle: 'l' }, { x: 27, y: 32, len: 6, handle: 'r' },
        { x: 12, y: 46, len: 13, dir: 'v', handle: 't' }],
      box: [27, 28], dogs: [[14, 54]], cat: [3, 54],
    },
    { // 5 岩漿趕狗,再用水降溫
      name: '先燙再澆', hint: '紙箱怕岩漿,記得降溫',
      walls: [[13, 18, 1, 19], [20, 18, 1, 19], [27, 18, 1, 19]],
      lava: [[14, 26, 6, 10]], water: [[21, 18, 6, 14]],
      pins: [{ x: 14, y: 36, len: 6, handle: 'l' }, { x: 21, y: 32, len: 6, handle: 'l' },
        { x: 28, y: 36, len: 7, handle: 'l' }, { x: 12, y: 46, len: 13, dir: 'v', handle: 't' }],
      box: [28, 32], dogs: [[14, 54]], cat: [3, 54],
    },
    { // 6 兩隻狗,只需要處理一隻
      name: '左右為難', hint: '不是每根插銷都要拔',
      walls: [[7, 8, 1, 24], [14, 8, 1, 24], [24, 20, 1, 12]],
      rock: [[8, 20, 6, 11]], lava: [[25, 22, 10, 9]],
      pins: [{ x: 8, y: 31, len: 6, handle: 'r' }, { x: 1, y: 31, len: 6, handle: 'l' },
        { x: 25, y: 31, len: 10, handle: 'r' },
        { x: 14, y: 46, len: 13, dir: 'v', handle: 't' }, { x: 24, y: 46, len: 13, dir: 'v', handle: 't' }],
      box: [1, 27], dogs: [[8, 54], [28, 54]], cat: [17, 54],
    },
    { // 7 側邊洩洪
      name: '側邊洩洪', hint: '岩漿也可以往旁邊流走',
      walls: [[11, 6, 1, 18], [11, 31, 1, 14], [1, 44, 10, 1], [24, 6, 1, 26]],
      lava: [[12, 24, 12, 7]],
      pins: [{ x: 12, y: 16, len: 12, handle: 'r' }, { x: 12, y: 31, len: 12, handle: 'r' },
        { x: 11, y: 24, len: 7, dir: 'v', handle: 't' }],
      box: [15, 12], cat: [27, 54],
    },
    { // 8 洩洪趕狗 + 水
      name: '一石三鳥', hint: '岩漿、水、紙箱,順序最重要',
      walls: [[11, 6, 1, 26], [24, 4, 1, 20], [24, 31, 1, 1]],
      water: [[25, 4, 10, 9]], lava: [[12, 24, 12, 7]],
      pins: [{ x: 12, y: 16, len: 12, handle: 'l' }, { x: 12, y: 31, len: 12, handle: 'l' },
        { x: 24, y: 24, len: 7, dir: 'v', handle: 't' }, { x: 25, y: 13, len: 10, handle: 'r' },
        { x: 10, y: 46, len: 13, dir: 'v', handle: 't' }],
      box: [15, 12], dogs: [[17, 54]], cat: [2, 54],
    },
    { // 9 三層塔
      name: '三層塔', hint: '由下往上想一想',
      walls: [[18, 2, 1, 34], [31, 2, 1, 34]],
      water: [[19, 11, 12, 9]], lava: [[19, 25, 12, 6]],
      pins: [{ x: 19, y: 10, len: 12, handle: 'r' }, { x: 19, y: 20, len: 12, handle: 'r' },
        { x: 19, y: 31, len: 12, handle: 'r' }, { x: 12, y: 46, len: 13, dir: 'v', handle: 't' }],
      box: [22, 6], dogs: [[22, 54]], cat: [3, 54],
    },
    { // 10 終極
      name: '貓咪大冒險', hint: '想清楚再拔!',
      walls: [[13, 4, 1, 20], [13, 31, 1, 10], [8, 40, 5, 1], [22, 4, 1, 33], [27, 18, 1, 13]],
      lava: [[14, 24, 8, 7]], rock: [[28, 20, 7, 10]],
      pins: [{ x: 14, y: 16, len: 8, handle: 'r' }, { x: 14, y: 31, len: 8, handle: 'r' },
        { x: 13, y: 24, len: 7, dir: 'v', handle: 't' }, { x: 28, y: 30, len: 7, handle: 'r' },
        { x: 12, y: 46, len: 13, dir: 'v', handle: 't' }, { x: 24, y: 46, len: 13, dir: 'v', handle: 't' }],
      box: [15, 12], dogs: [[3, 54], [28, 54]], cat: [16, 54],
    },
  ];
  if (typeof module !== 'undefined' && module.exports) module.exports = CB_LEVELS;
  else cb_root.CB_LEVELS = CB_LEVELS;
})(typeof window !== 'undefined' ? window : globalThis);
