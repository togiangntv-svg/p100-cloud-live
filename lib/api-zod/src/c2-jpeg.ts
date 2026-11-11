import { C2_IMAGE_LIMIT, failC2 } from './c2-vision.ts';
/** Deliberately limited to baseline single-scan JPEG. Unsupported marker families fail closed.
 * Structural inspection is NOT a decoder proof; caller must decode the sanitized output.
 */
export function sanitizeC2Jpeg(input:Uint8Array):Readonly<{bytes:Uint8Array;width:number;height:number;removed:number}>{
 if(!(input instanceof Uint8Array)||input.length<20||input.length>C2_IMAGE_LIMIT
 ||input[0]!==255||input[1]!==216)failC2('C2_JPEG_INVALID',400);
 const chunks:Uint8Array[]=[input.slice(0,2)];let i=2,width=0,height=0,sof=false,dqt=false,dht=false,removed=0;
 let iccCount=0,iccTotal=0;const iccSeq=new Set<number>();
 while(i<input.length){
  const start=i;if(input[i++]!==255)failC2('C2_JPEG_INVALID',400);
  const marker=input[i++];
  if(marker===255||marker===0||marker===216||marker===217||marker>=208&&marker<=215)failC2('C2_JPEG_UNSUPPORTED',400);
  if(i+2>input.length)failC2('C2_JPEG_INVALID',400);
  const len=(input[i]<<8)|input[i+1],end=i+len;
  if(len<2||end>input.length)failC2('C2_JPEG_INVALID',400);
  const data=input.subarray(i+2,end);
  if(marker===225||marker===254){removed++;i=end;continue;}
  if(marker===224){
   if(data.length<14||String.fromCharCode(...data.subarray(0,5))!=='JFIF\0'
   ||data.length!==14+3*data[12]*data[13])failC2('C2_JPEG_UNSUPPORTED',400);
  }else if(marker===226){
   if(data.length<14||String.fromCharCode(...data.subarray(0,12))!=='ICC_PROFILE\0'
   ||data[12]<1||data[13]<1||data[12]>data[13]||iccSeq.has(data[12])
   ||iccCount&&iccCount!==data[13])failC2('C2_JPEG_ICC_INVALID',400);
   iccCount=data[13];iccSeq.add(data[12]);iccTotal+=data.length;
   if(iccTotal>262144)failC2('C2_JPEG_ICC_INVALID',400);
  }else if(marker===192){
   if(sof||data.length<6||data[0]!==8||![1,3].includes(data[5])||data.length!==6+3*data[5])failC2('C2_JPEG_INVALID',400);
   height=(data[1]<<8)|data[2];width=(data[3]<<8)|data[4];sof=true;
   if(width<1||height<1||width>1280||height>1280)failC2('C2_IMAGE_DIMENSIONS',400);
  }else if(marker===219){if(!data.length)failC2('C2_JPEG_INVALID',400);dqt=true;
  }else if(marker===196){if(!data.length)failC2('C2_JPEG_INVALID',400);dht=true;
  }else if(marker===221){if(data.length!==2)failC2('C2_JPEG_INVALID',400);
  }else if(marker===218){
   if(!sof||!dqt||!dht||data.length<4||data.length!==4+2*data[0]
   ||data[data.length-3]!==0||data[data.length-2]!==63||data[data.length-1]!==0
   ||iccSeq.size!==iccCount)failC2('C2_JPEG_INVALID',400);
   let pos=end,done=false;
   while(pos<input.length){
    if(input[pos++]!==255)continue;
    if(pos>=input.length)failC2('C2_JPEG_INVALID',400);
    const next=input[pos++];
    if(next===0||next>=208&&next<=215)continue;
    if(next===217&&pos===input.length){done=true;break;}
    failC2('C2_JPEG_UNSUPPORTED_SCAN',400);
   }
   if(!done)failC2('C2_JPEG_INVALID',400);
   chunks.push(input.slice(start));let size=0;for(const x of chunks)size+=x.length;
   const bytes=new Uint8Array(size);let offset=0;for(const x of chunks){bytes.set(x,offset);offset+=x.length;}
   return Object.freeze({bytes,width,height,removed});
  }else failC2('C2_JPEG_UNSUPPORTED',400);
  chunks.push(input.slice(start,end));i=end;
 }
 return failC2('C2_JPEG_INVALID',400);
}
