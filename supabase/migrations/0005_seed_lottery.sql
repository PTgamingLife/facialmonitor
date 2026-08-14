-- ============================================================
-- 首批抽獎獎品與抽獎成本
--
-- 這支是「資料設定」而不是結構變更,可以重複執行:
-- 獎品用 where not exists 保護,重跑不會長出第二筆。
-- 之後要調整點數或加獎品,直接改資料就好,不用改程式也不用重新部署。
-- ============================================================

-- 抽一次的成本:100 點(0002 的預設值是 30)
update sb_point_rules
   set points = 100, updated_at = now()
 where rule_key = 'lottery_draw';

-- 首批獎品。
-- 目前池子裡只有這一個,所以 weight 給多少都是必中;
-- 等加入第二個獎品之後,weight 才會真的決定相對中獎機率。
insert into sb_lottery_prizes (name, description, image_url, stock, weight, sort, active)
select '個人健康全面高級諮詢',
       '一對一深度健康諮詢。依你的面舌診報告與體質,量身規劃調理方向。',
       null,      -- 之後有主視覺再 update image_url,Flex 卡片會自動略過空圖
       10,        -- 人力服務,先開 10 份
       100,
       1,
       true
 where not exists (
   select 1 from sb_lottery_prizes where name = '個人健康全面高級諮詢'
 );
