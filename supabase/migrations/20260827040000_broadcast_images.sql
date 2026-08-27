-- 給七則圖文接上主視覺
--
-- 8/28 那則用的是見證截圖(直式,走 image_layout = 'message'),不在這裡動。
-- 其餘六則用 make-broadcast-images.py 產生的 1560x1014 主視覺,
-- 剛好是 infoCard hero 的 20:13,不會被 cover 裁到。

update public.line_broadcasts b
   set image_url = 'https://ptgaminglife.github.io/facialmonitor/img/broadcast/' || v.key || '.png'
  from (values
    ('你有 1 次免費檢測還沒用',                 'free-credit'),
    ('你有一次抽獎機會還沒用',                   'lottery'),
    ('為什麼是臉和舌頭？',                       'why-face'),
    ('你上一次好好看自己的身體，是什麼時候？',   'record'),
    ('一個人容易放棄，兩個人比較走得下去',       'together'),
    ('舌頭上的那層苔，其實每天都在變',           'tongue')
  ) as v(title, key)
 where b.title = v.title
   and b.status = 'draft';
