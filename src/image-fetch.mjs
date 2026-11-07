import dns from 'node:dns/promises';
import net from 'node:net';
function publicIP(ip){if(net.isIPv4(ip)){const [a,b]=ip.split('.').map(Number);return !([0,10,127].includes(a)||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168||a===100&&b>=64&&b<=127);}return !/^(::|fc|fd|fe[89ab]|ff)/i.test(ip);}
export async function validateImageURL(value,{lookup=dns.lookup}={}){const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.port&&!['80','443'].includes(u.port))throw new Error('图片地址不受支持');const host=u.hostname.replace(/^\[|\]$/g,'');const ips=net.isIP(host)?[{address:host}]:await lookup(host,{all:true});if(!ips.length||ips.some(x=>!publicIP(x.address)))throw new Error('图片地址必须是公开网络资源');return u;}
export async function fetchImage(url,{fetchImpl=fetch,signal,sourceURL,validate=validateImageURL,maxBytes=10*1024*1024}={}){
 for(let hop=0;hop<5;hop++){const u=await validate(url);const r=await fetchImpl(u,{redirect:'manual',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000),headers:{Accept:'image/png,image/jpeg,image/webp,image/gif',...(sourceURL?{Referer:new URL(sourceURL).origin+'/'}:{})}});
  if([301,302,303,307,308].includes(r.status)){await r.body?.cancel();const loc=r.headers.get('location');if(!loc)throw new Error('图片重定向地址缺失');url=new URL(loc,u).href;continue;}
  if(!r.ok){await r.body?.cancel();throw new Error(`图片下载 HTTP ${r.status}；原链接可能过期，请正常重访原文刷新资源`);}if(Number(r.headers.get('content-length'))>maxBytes){await r.body?.cancel();throw new Error('图片超过10MB限制');}
  const mime=(r.headers.get('content-type')||'').split(';')[0].toLowerCase();if(!['image/jpeg','image/png','image/webp','image/gif'].includes(mime)){await r.body?.cancel();throw new Error('图片格式不受支持（需要PNG/JPEG/WebP/GIF）');}
  const reader=r.body.getReader(),parts=[];let size=0;try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>maxBytes)throw new Error('图片超过10MB限制');parts.push(value);}}finally{await reader.cancel().catch(()=>{});}const bytes=Buffer.concat(parts);if(bytes.length<16)throw new Error('图片内容为空或损坏');return {bytes,mime};
 }throw new Error('图片重定向次数过多');
}
