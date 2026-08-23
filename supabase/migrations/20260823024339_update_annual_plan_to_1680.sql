-- 年費方案調整為 1,680 元，維持全年 12 次檢測，並加入健康管理服務說明。
-- 付款入帳 RPC 仍會從 sb_products 讀取金額與次數，不信任前端傳值。
update public.sb_products
set label = '年費健康管理方案：每月 1 次檢測＋專業健康管理師建議與報告',
    amount = 1680,
    credits = 12,
    active = true
where code = 'facial-scan-annual';

do $$
begin
  if not exists (
    select 1 from public.sb_products
    where code = 'facial-scan-annual'
      and amount = 1680
      and credits = 12
      and active
  ) then
    raise exception 'facial-scan-annual update failed';
  end if;
end
$$;
