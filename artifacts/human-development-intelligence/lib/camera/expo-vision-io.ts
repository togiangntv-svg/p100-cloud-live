import * as FileSystem from 'expo-file-system/legacy';
import {createExpoCacheCleanup} from './expo-cache-cleanup';
import type {VisionImageIO} from './expo-image-preparer';
/** Native adapter is opt-in on an explicit C2 action; device/color behavior remains a device gate. */
export function createExpoVisionImageIO():VisionImageIO{
 const cleanup=createExpoCacheCleanup();
 const release=(value:object)=>{if(!('release' in value)||typeof value.release!=='function')throw Error('C2_DECODER_CLEANUP_UNAVAILABLE');value.release();};
 const check=(uri:string)=>{if(cleanup.canDeleteOwnedCache?.(uri)!==true)throw Error('C2_UNOWNED_CACHE');};
 const encode=(b:Uint8Array)=>{let s='';for(let i=0;i<b.length;i+=8192)s+=String.fromCharCode(...b.subarray(i,i+8192));return btoa(s);};
 return Object.freeze({...cleanup,
  readOwnedCache:async(uri:string)=>{check(uri);const text=await FileSystem.readAsStringAsync(uri,{encoding:FileSystem.EncodingType.Base64});
   if(text.length>1398104)throw Error('C2_IMAGE_LIMIT');return Uint8Array.from(atob(text),c=>c.charCodeAt(0));},
  writeOwnedCache:async(uri:string,bytes:Uint8Array)=>{check(uri);if(bytes.length>1048576)throw Error('C2_IMAGE_LIMIT');
   await FileSystem.writeAsStringAsync(uri,encode(bytes),{encoding:FileSystem.EncodingType.Base64});},
  decodeJpeg:async(bytes:Uint8Array)=>{if(bytes.length>1048576)throw Error('C2_IMAGE_LIMIT');
   const {ImageManipulator}=await import('expo-image-manipulator');
   const context=ImageManipulator.manipulate('data:image/jpeg;base64,'+encode(bytes));
   try{const image=await context.renderAsync();try{return {width:image.width,height:image.height};}finally{release(image);}}
   finally{release(context);}},
 });
}
