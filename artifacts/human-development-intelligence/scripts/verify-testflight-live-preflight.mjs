import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
export function verifyTestflightPreflight({app,eas,env={},latestBuildNumber,latestVersion,sourceTexts=[]}) {
 const fail=code=>{throw Error(code);};
 if(eas.build?.production?.env?.EXPO_PUBLIC_M3_RUNTIME_MODE!=='off')fail('PRODUCTION_ORACLE_DRIFT');
 const p=eas.build?.['testflight-live'];
 if(p?.distribution!=='store'||p.environment!=='preview'||p.env?.EXPO_PUBLIC_M3_RUNTIME_MODE!=='live'||p.env?.EXPO_PUBLIC_IDENTITY_REQUEST_TIMEOUT_MS!=='60000'||'EXPO_PUBLIC_DOMAIN' in p.env)fail('EAS_LIVE_PROFILE_INVALID');
 if(eas.submit?.['testflight-live']?.ios?.ascAppId!=='6816377557')fail('EAS_SUBMIT_PROFILE_INVALID');
 if(app.expo?.ios?.bundleIdentifier!=='com.togiang.hdi100'||app.expo.ios.usesAppleSignIn!==true)fail('NATIVE_IDENTITY_DRIFT');
 if(/--auto-submit/.test(JSON.stringify(eas)))fail('AUTO_SUBMIT_FORBIDDEN');
 for(const text of sourceTexts)if(/(?:process\.env(?:\.|\[['"]))(?:GEMINI_API_KEY|OPENAI_API_KEY|DATABASE_URL|SESSION_SECRET)/.test(text))fail('CLIENT_SECRET_REFERENCE');
 const domain=env.EXPO_PUBLIC_DOMAIN;if(!domain)fail('PARK_PUBLIC_ORIGIN_MISSING');
 let url;try{url=new URL(domain.includes('://')?domain:'https://'+domain);}catch{fail('PUBLIC_ORIGIN_INVALID');}
 if(url.protocol!=='https:'||!url.hostname||url.username||url.password||url.pathname!=='/'||url.search||url.hash||/^(localhost|127\.|0\.|\[::)/i.test(url.hostname)||/\.(invalid|test|localhost)$/.test(url.hostname)||/^example\.(com|org|net)$/.test(url.hostname))fail('PUBLIC_ORIGIN_INVALID');
 const timeout=env.EXPO_PUBLIC_IDENTITY_REQUEST_TIMEOUT_MS??p.env.EXPO_PUBLIC_IDENTITY_REQUEST_TIMEOUT_MS;
 if(!/^[1-9][0-9]*$/.test(timeout)||!Number.isSafeInteger(Number(timeout))||Number(timeout)>60000)fail('IDENTITY_TIMEOUT_INVALID');
 const tuple=s=>{if(typeof s!=='string'||!/^\d+(?:\.\d+){0,2}$/.test(s))fail('BUILD_NUMBER_INVALID');const a=s.split('.').map(Number);if(a.some(n=>!Number.isSafeInteger(n)))fail('BUILD_NUMBER_INVALID');return [...a,...Array(3-a.length).fill(0)];};
 if(latestBuildNumber===undefined||latestVersion===undefined)fail('PARK_ASC_MONOTONIC_INPUT_MISSING');
 if(latestVersion!==app.expo.version)fail('PARK_ASC_VERSION_SCOPE_MISMATCH');
 const a=tuple(app.expo.ios.buildNumber),b=tuple(latestBuildNumber);let cmp=0;for(let i=0;i<3&&!cmp;i++)cmp=Math.sign(a[i]-b[i]);if(cmp<=0)fail('BUILD_NUMBER_NOT_MONOTONIC');
 return Object.freeze({status:'PASS_OFFLINE_CONFIG_ONLY',origin:url.origin,timeoutMs:Number(timeout),buildNumber:app.expo.ios.buildNumber,ascInput:'CALLER_SUPPLIED_NOT_LIVE_VERIFIED'});
}
const main=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(main){try{const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');const result=verifyTestflightPreflight({app:JSON.parse(readFileSync(resolve(root,'app.json'),'utf8')),eas:JSON.parse(readFileSync(resolve(root,'eas.json'),'utf8')),env:process.env,latestBuildNumber:process.env.P100_ASC_LATEST_BUILD_NUMBER,latestVersion:process.env.P100_ASC_LATEST_VERSION});console.log(JSON.stringify(result));}catch(e){console.error(e.message);process.exitCode=1;}}
