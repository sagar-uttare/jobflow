import { randomUUID } from 'node:crypto';
import { publicCopy, type Pipeline } from './core';
import { get, set, lock, unlock, redis } from './redis';
import { oldest, remove, extract, lookup, send, websiteFromEmail, cleanJobFormat, type Image } from './integrations';
type Step='pending'|'sending'|'sent'|'skipped';
type Job={image:Image;privateText:string;publicText:string;privateStep:Step;publicStep:Step;created:string;warning?:string};
const key=(p:Pipeline)=>`jobbot:v1:pending:${p.name}`;
async function record(p:Pipeline,level:string,message:string){await redis('LPUSH',`jobbot:v1:history:${p.name}`,JSON.stringify({time:new Date().toISOString(),level,message}));await redis('LTRIM',`jobbot:v1:history:${p.name}`,0,29);}
async function prepare(image:Image){
 const result=await extract(image);let text=cleanJobFormat(result.text),warning='';
   const website=websiteFromEmail(text);if(website){if(/^🌐 Website:/m.test(text))text=text.replace(/^🌐 Website:[^\n]*/m,`🌐 Website: ${website}`);else text+=`\n\n🌐 Website: ${website}`;}
   try{const found=await lookup(result.recruiter,result.company);if(found.hr){if(/🔗\s*LinkedIn:/i.test(text))text=text.replace(/(🔗[ \t]*LinkedIn:)[ \t]*[^\n]*/i,`$1 ${found.hr}`);else text+=`\n🔗 LinkedIn: ${found.hr}`;}if(found.company){const line=`🏢 Company LinkedIn: ${found.company}`;if(/^🏢 Company LinkedIn:.*$/m.test(text))text=text.replace(/^🏢 Company LinkedIn:.*$/m,line);else {const lines=text.split('\n');const at=lines.findIndex(x=>/^🔗\s*LinkedIn:/i.test(x));if(at>=0)lines.splice(at+1,0,line);else lines.push(line);text=lines.join('\n');}}if(found.hr||found.company)warning='LinkedIn matches are unverified; confirm the profiles.';}catch{warning='Tavily lookup failed; posted without searched LinkedIn profiles.'}
 return {text,warning};
}
export async function run(p:Pipeline,dry=false){
 const lk=`jobbot:v1:lock:${p.name}`,token=randomUUID();if(!(await lock(lk,token,180)))return {ok:false,message:'Pipeline already running; try again later.'};
 try{
  let job=await get<Job>(key(p));
  if(job&&!dry&&(job.privateStep==='sending'||job.publicStep==='sending'))return {ok:false,message:'A Telegram delivery has an uncertain outcome. Check the channel and reconcile before retrying.',needsReview:true};
  if(dry){const image=job?.image||await oldest(p);if(!image)return {ok:true,message:'ImageKit folder is empty.'};const x=await prepare(image);return {ok:true,message:'Dry run: no messages sent or images deleted.',image:image.name,privateText:x.text,publicText:publicCopy(x.text,p),warning:x.warning};}
  if(!job){const image=await oldest(p);if(!image){await record(p,'idle','ImageKit folder is empty.');return {ok:true,message:'ImageKit folder is empty.'};}
   const {text,warning}=await prepare(image);
   const publicText=publicCopy(text,p);
   // Fail closed if contact details leak outside the expected labels.
   const withoutCta=publicText.replace(p.ctaUrl,'');
   if(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(withoutCta)||/linkedin\.com\/(?:in|company)\//i.test(withoutCta)||/\b(?:apply\s*(?:here|now|link)|contact|phone|whatsapp|mobile)\s*[:：]?\s*(?:https?:\/\/|\+?\d)/i.test(withoutCta))throw Error('Public copy may contain contact details outside the masked fields; image retained for review');
   job={image,privateText:text,publicText,privateStep:p.privateChannel?'pending':'skipped',publicStep:p.publicChannel?'pending':'skipped',created:new Date().toISOString(),warning};await set(key(p),job);
  }
  for(const [field,channel,text] of [['privateStep',p.privateChannel,job.privateText],['publicStep',p.publicChannel,job.publicText]] as const){
   if(job[field]!=='pending')continue;
   // Persist intent before the network call. Never automatically resend an ambiguous delivery.
   job[field]='sending';await set(key(p),job);
   try{await send(channel,text)}catch(e){const msg=e instanceof Error?e.message:String(e);if(msg.startsWith('Telegram rejected:')||msg.startsWith('Post exceeds')){job[field]='pending';await set(key(p),job);}await record(p,'error',msg);return {ok:false,message:msg,needsReview:job[field]==='sending'};}
   job[field]='sent';await set(key(p),job);
  }
  await remove(job.image.fileId);await redis('DEL',key(p));await record(p,'success',`Posted and deleted ${job.image.name}`);return {ok:true,message:`Posted and deleted ${job.image.name}`,warning:job.warning};
 }catch(e){const message=e instanceof Error?e.message:String(e);await record(p,'error',message).catch(()=>{});return {ok:false,message};}finally{await unlock(lk,token).catch(()=>{});}
}
export async function reconcile(p:Pipeline,channel:'private'|'public',delivered:boolean){const lk=`jobbot:v1:lock:${p.name}`,token=randomUUID();if(!(await lock(lk,token,180)))throw Error('Pipeline is running');try{const j=await get<Job>(key(p));if(!j)throw Error('No pending job');const field=channel==='private'?'privateStep':'publicStep';if(j[field]!=='sending')throw Error('This channel is not awaiting review');j[field]=delivered?'sent':'pending';await set(key(p),j);await record(p,'review',`${channel} marked ${delivered?'delivered':'not delivered'} by admin`);}finally{await unlock(lk,token)}}
export async function scheduleEnabled(p:Pipeline){const v=await redis('GET',`jobbot:v1:schedule:${p.name}`);return v!=='off';}
export async function setSchedule(p:Pipeline,enabled:boolean){await redis('SET',`jobbot:v1:schedule:${p.name}`,enabled?'on':'off');}
export async function status(p:Pipeline){const enabled=await scheduleEnabled(p);const job=await get<Job>(key(p));const history=await redis('LRANGE',`jobbot:v1:history:${p.name}`,0,14);return {name:p.name,scheduleEnabled:enabled,folder:p.folder,privateChannel:p.privateChannel,publicChannel:p.publicChannel,slots:p.slots,pending:job?{image:job.image.name,privateStep:job.privateStep,publicStep:job.publicStep,created:job.created,warning:job.warning}:null,history:(history||[]).map((x:string)=>JSON.parse(x))};}
