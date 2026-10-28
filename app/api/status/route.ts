import {auth,pipelines,required,ist} from '../../../lib/core';
import {status} from '../../../lib/runner';
export const dynamic='force-dynamic'; export const runtime='nodejs';
export async function GET(req:Request){if(!auth(req,'ADMIN_TOKEN'))return Response.json({error:'Unauthorized'},{status:401});try{required();return Response.json({ok:true,now:ist().label,pipelines:await Promise.all(pipelines().map(status))},{headers:{'cache-control':'no-store'}})}catch(e){return Response.json({error:e instanceof Error?e.message:'Status failed'},{status:500})}}
