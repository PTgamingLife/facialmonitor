# stair-kids-pro 交接說明

極光玻璃風格的「小朋友下樓梯」單人版，純靜態網頁，沒有建置步驟。直接開 `index.html`，或用任何靜態伺服器提供這個資料夾。

## 檔案
- `sk_game.js`：規則核心，包含樓梯生成與物理，純邏輯、不碰 DOM。數值照原作 pjh-eric/stair-kids
- `sk_render.js`：Canvas 繪圖。角色有 sprite 就畫 sprite，沒有就退回向量繪製
- `sk_main.js`：選單、輸入、音效、主迴圈
- `sk_assets/<角色id>/`：8 格黏土角色 PNG，已去背，以 idle 高度 256px 為基準：run0～run3、idle、fall、hurt、land
- `sk_assets/raw/`：Higgsfield 生成的原始 sprite sheet，白底、4×2 格
- `tools/sk_slice.py`：把 sheet 去背並切格，用法 `python tools/sk_slice.py <sheet.png> sk_assets/<id>`

## 狀態
- 四位角色（aurora 小光、coral 珊珊、frost 冰冰、tide 阿潮）都已完成 sprite。
- 所有程式參數一律加 `sk_` 前綴。

## 部署注意

`sk_assets/raw/`(Higgsfield 原始 sprite sheet,4 張共約 17MB)**沒有放進線上版** ——
遊戲執行時不會讀它,它只是 `tools/sk_slice.py` 的輸入。要重切 sprite 時
從原始封包把那個資料夾放回來即可。
