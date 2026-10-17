import {NextRequest,NextResponse} from "next/server";
export const runtime="nodejs";
const allowed=new Set(["image/jpeg","image/png","image/webp","image/heic","image/heif"]);
const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export async function POST(req:NextRequest){
try{
if(!process.env.RESEND_API_KEY||!process.env.DM_CONTACT_FROM_EMAIL)return NextResponse.json({error:"The contact form is not yet connected. Please email info@dmpaintingdecorating.co.uk directly."},{status:503});
const length=Number(req.headers.get("content-length")||0);if(length>19*1024*1024)return NextResponse.json({error:"Photos are too large. Please reduce their size."},{status:413});
const fd=await req.formData();const get=(key:string)=>String(fd.get(key)||"").trim();if(get("website"))return NextResponse.json({ok:true});
const name=get("name"),email=get("email"),phone=get("phone"),location=get("location"),projectType=get("projectType"),message=get("message");
if(!name||name.length>120||!emailPattern.test(email)||email.length>180||!phone||phone.length>40||!location||location.length>120||!message||message.length>5000||get("consent")!=="on")return NextResponse.json({error:"Please check the required fields and try again."},{status:400});
const photos=fd.getAll("photos").filter((x):x is File=>x instanceof File);if(photos.length>6||photos.some(f=>!allowed.has(f.type)||f.size>5*1024*1024)||photos.reduce((n,f)=>n+f.size,0)>15*1024*1024)return NextResponse.json({error:"Please upload up to 6 supported photos, under 5 MB each and 15 MB in total."},{status:400});
const attachments=await Promise.all(photos.map(async f=>({filename:f.name.replace(/[^a-zA-Z0-9._-]/g,"_").slice(0,100)||"photo",content:Buffer.from(await f.arrayBuffer()).toString("base64")})));
const details=[["Name",name],["Email",email],["Phone",phone],["Area / postcode",location],["Project type",projectType],["Description",message]].map(([k,v])=>k+": "+v).join("\n\n");
const result=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":`Bearer ${process.env.RESEND_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({from:process.env.DM_CONTACT_FROM_EMAIL,to:["info@dmpaintingdecorating.co.uk"],reply_to:email,subject:"D&M decorating enquiry — "+location.replace(/[\r\n]/g," ").slice(0,80),text:details,attachments})});
if(!result.ok){console.error("D&M contact email failed",result.status);return NextResponse.json({error:"We couldn't send your enquiry. Please email info@dmpaintingdecorating.co.uk directly."},{status:502});}
return NextResponse.json({ok:true});
}catch(e){console.error("D&M contact error",e);return NextResponse.json({error:"We couldn't send your enquiry. Please email us directly."},{status:500});}
}
