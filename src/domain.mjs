import {createHash} from 'node:crypto';
export function parseCount(value){
 if(value==null||value==='')return null;
 if(typeof value==='number')return Number.isFinite(value)&&value>=0?Math.round(value):null;
 const s=String(value).trim().replace(/,/g,'');
 if(/^(赞|点赞|收藏|评论|转发|分享|阅读|浏览|--|暂无)$/.test(s))return null;
 const m=s.match(/(\d+(?:\.\d+)?)\s*(亿|万|千|[kKmMwW])?/);if(!m)return null;
 const scale={亿:1e8,万:1e4,千:1e3,k:1e3,m:1e6,w:1e4};return Math.round(Number(m[1])*(scale[m[2]?.toLowerCase()]||1));
}
export function contentHash(text){return createHash('sha256').update(String(text||'').replace(/\s+/g,' ').trim()).digest('hex');}
export function canonical(platform,input){
 try{let u=new URL(input);for(let hop=0;hop<4&&['so.toutiao.com','sou.toutiao.com'].includes(u.hostname)&&u.pathname.includes('jump');hop++){const target=u.searchParams.get('url');if(!target)break;u=new URL(target);}if(u.hostname==='article.zlink.toutiao.com'&&u.searchParams.get('h5_url'))u=new URL(u.searchParams.get('h5_url'));
 const host=u.hostname, p=u.pathname;let id;
 if(platform==='douyin'&&/(^|\.)douyin\.com$/.test(host)){id=p.match(/\/(?:video|note)\/(\d+)/)?.[1]||u.searchParams.get('modal_id');if(id)return{id,url:`https://www.douyin.com/video/${id}`};}
 if(platform==='xiaohongshu'&&/(^|\.)xiaohongshu\.com$/.test(host)){id=p.match(/\/(?:explore|search_result)\/([a-f\d]{24})/i)?.[1];if(id){const token=u.searchParams.get('xsec_token');const safe=new URL(`https://www.xiaohongshu.com/explore/${id}`);if(token)safe.searchParams.set('xsec_token',token);safe.searchParams.set('xsec_source','pc_search');return{id,url:safe.href};}}
 if(platform==='toutiao'&&/(^|\.)toutiao\.com$/.test(host)){id=p.match(/\/(article|video|w|group)\/(\d+)/);if(id)return{id:id[2],url:`https://www.toutiao.com/${id[1]}/${id[2]}/`};const legacy=p.match(/^\/a(\d+)\/?$/);if(legacy)return{id:legacy[1],url:u.href};const group=u.searchParams.get('group_id');if(group&&/^\d+$/.test(group))return{id:group,url:`https://www.toutiao.com/article/${group}/`};}
 if(platform==='zhihu'&&/(^|\.)zhihu\.com$/.test(host)){const answer=p.match(/\/question\/\d+\/answer\/(\d+)/),article=p.match(/^\/p\/(\d+)/);if(answer)return{id:'answer-'+answer[1],url:`https://www.zhihu.com${p}`};if(article)return{id:'article-'+article[1],url:`https://zhuanlan.zhihu.com/p/${article[1]}`};}
 if(platform==='csdn'&&host==='blog.csdn.net'){id=p.match(/\/([^/]+)\/article\/details\/(\d+)/);if(id)return{id:id[2],url:`https://blog.csdn.net/${id[1]}/article/details/${id[2]}`};}
 }catch{}return null;
}
export function classifyAccess({url='',title='',text='',status=200}){
 const combined=title+'\n'+text.slice(0,18000);
 if(/您当前请求存在异常|暂时限制本次访问/.test(combined)||(/"code"\s*:\s*40362\b/.test(text)&&text.length<4000))return{code:'access_denied',message:'知乎返回访问保护 40362：当前请求存在异常，暂时限制本次访问；请在保留的页面人工检查'};
 if(/30001[23]|当前网络存在风险|安全限制|操作过于频繁|请求过于频繁|访问异常|访问受限/.test(title+' '+url+(text.length<4000?' '+text:'')))return{code:'risk_controlled',message:'平台安全保护或网络风险限制，需在浏览器中人工检查',cooldownMs:7200000};
 if(/验证码中间页|安全验证|完成验证|拖动.*滑块|请.*验证.*继续|verifycenter|captcha|\/account\/unhuman/i.test(title+' '+url)||/请完成以下验证|请拖动滑块|请按顺序点击|完成安全验证/.test(text))return{code:'verification_required',message:'平台要求人工验证，请打开登录浏览器处理'};
 if(status===401||/登录后.*(搜索|查看)|登录后查看更多|请先登录/.test(text)||/\/signin(?:\?|$)|\/login(?:\?|$)/.test(url))return{code:'login_required',message:'当前页面需要登录，请打开登录浏览器完成登录'};
 if(status===403||status===429)return{code:'access_denied',message:`平台返回 HTTP ${status}，未读取到内容`};
 if(status>=500)return{code:'network_error',message:`平台返回 HTTP ${status}`};
 return null;
}
export const terminalStates=['completed','partial','no_results','login_required','verification_required','risk_controlled','access_denied','failed','stopped','interrupted'];
export function deriveTaskState(stages){
 if(stages.every(s=>s.status==='completed'))return'completed';
 if(stages.some(s=>!terminalStates.includes(s.status)))return'running';
 if(stages.some(s=>s.accepted>0))return'partial';
 return stages.every(s=>s.status==='stopped')?'stopped':'blocked';
}
