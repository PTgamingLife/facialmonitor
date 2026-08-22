import { authorizeCronHash } from "../_shared/cron-auth.ts";
import { infoCard, push } from "../_shared/line.ts";
import { insert, patch, remove, select } from "../_shared/db.ts";

const HASH = Deno.env.get("HEALTHBOT_TIP_PUSH_SECRET_SHA256") ?? "";
type Challenge={id:string;user_id:string;health_focus:string;starts_on:string;plan:Array<Record<string,unknown>>};

function today(){return new Date().toLocaleDateString("sv-SE",{timeZone:"Asia/Taipei"});}
Deno.serve(async(req)=>{
  if(req.method!=="POST") return new Response("method not allowed",{status:405});
  const denied=await authorizeCronHash(req,"x-tip-push-secret",HASH); if(denied)return denied;
  const rows=await select<Challenge>("sb_health_challenges",`status=eq.active&starts_on=lte.${today()}&select=id,user_id,health_focus,starts_on,plan&limit=1000`);
  let sent=0,failed=0;
  for(const c of rows){
    const day=Math.floor((Date.parse(today())-Date.parse(c.starts_on))/86400000)+1;
    if(day>14){await patch("sb_health_challenges",`id=eq.${c.id}`,{status:"completed",completed_at:new Date().toISOString()});continue;}
    const line=(await select<{line_user_id:string}>("line_users",`sb_user_id=eq.${c.user_id}&unfollowed_at=is.null&select=line_user_id&limit=1`))[0];
    if(!line)continue;
    const claim=await insert("sb_health_challenge_deliveries",{challenge_id:c.id,day_no:day},{returning:true,ignoreConflict:true});
    if(!claim)continue;
    const t=c.plan[day-1]??{};
    const ok=await push(line.line_user_id,infoCard({
      title:`🌿 14 天挑戰 Day ${day}｜${String(t.title??"今日任務")}`,
      subtitle:String(t.task??"完成今天的小任務。"),
      rows:[{label:"健康重點",value:c.health_focus},{label:"為什麼",value:String(t.why??"建立健康習慣")}],
      note:"依最近一次健康檢測安排；若感到不適請停止，並諮詢醫療專業人員。",
      altText:`14 天健康挑戰 Day ${day}`,
    }));
    if(ok){
      sent++;
    }else{
      // 只有成功送達才保留冪等占位。LINE 暫時失敗時清除，讓排程可補送。
      await remove("sb_health_challenge_deliveries",`challenge_id=eq.${c.id}&day_no=eq.${day}`);
      failed++;
    }
  }
  return Response.json({ok:failed===0,sent,failed});
});
