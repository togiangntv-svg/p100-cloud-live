import type { CameraAcceptedReceipt, CameraTaskScope } from '../../domain/camera/candidate';
import type {
  LocalImagePreparationPort,
  LocalImagePreparationRequest,
  LocalImageSourceRef,
  ReencodedLocalImage,
} from '../../domain/camera/image-preparation';

type PrivateSource = Readonly<{
  ref: LocalImageSourceRef;
  localUri: string;
}>;

type PrivateArtifact = Readonly<{
  descriptor: ReencodedLocalImage;
  cacheUri: string;
}>;

type RenderedImage = Readonly<{
  width: number;
  height: number;
  saveAsync(options: Readonly<{
    format: 'jpeg';
    compress: number;
    base64: boolean;
  }>): Promise<Readonly<{ uri: string; width: number; height: number; base64?: string }>>;
}>;

type ManipulatorContext = Readonly<{
  resize(size: Readonly<{ width?: number; height?: number }>): ManipulatorContext;
  renderAsync(): Promise<RenderedImage>;
}>;

type ImageManipulatorRuntime = Readonly<{
  ImageManipulator: Readonly<{
    manipulate(source: string | RenderedImage): ManipulatorContext;
  }>;
  SaveFormat: Readonly<{ JPEG: 'jpeg' }>;
}>;

/** A caller must confirm deletion of the exact cache file created by saveAsync. */
export type OwnedCacheCleanupPort = Readonly<{
  deleteOwnedCache(uri: string): Promise<boolean>;
  /** Optional native preflight; injected test ports may omit it. */
  canDeleteOwnedCache?(uri?: string): boolean;
}>;

const sameScope = (a: CameraTaskScope, b: CameraTaskScope): boolean =>
  a.session_id === b.session_id && a.task_id === b.task_id && a.revision === b.revision;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every(key => keys.includes(key));
};
const validScope = (value: unknown): value is CameraTaskScope => isRecord(value)
  && exactKeys(value, ['session_id', 'task_id', 'revision'])
  && typeof value.session_id === 'string' && value.session_id.length > 0
  && typeof value.task_id === 'string' && value.task_id.length > 0
  && Number.isSafeInteger(value.revision) && Number(value.revision) > 0;
const validLocalUri = (uri: string): boolean => uri.length > 0 && uri.length <= 4096
  && /^(?:file|content|ph|assets-library|blob):/u.test(uri);
const validReceipt = (value: unknown): value is CameraAcceptedReceipt => isRecord(value)
  && exactKeys(value, [
    'session_id', 'task_id', 'revision', 'candidate_id', 'source', 'local_uri', 'choice',
  ])
  && validScope({ session_id: value.session_id, task_id: value.task_id, revision: value.revision })
  && typeof value.candidate_id === 'string' && value.candidate_id.length > 0
  && ['CAMERA', 'LIBRARY'].includes(String(value.source))
  && value.choice === 'USE_PHOTO'
  && typeof value.local_uri === 'string' && validLocalUri(value.local_uri);
const validSourceRef = (value: unknown): value is LocalImageSourceRef => isRecord(value)
  && exactKeys(value, ['scope', 'candidate_id', 'source_ref_id', 'choice'])
  && validScope(value.scope)
  && typeof value.candidate_id === 'string' && value.candidate_id.length > 0
  && typeof value.source_ref_id === 'string' && value.source_ref_id.length > 0
  && value.choice === 'USE_PHOTO';

export function createExpoImagePreparer(
  injectedRuntime?: ImageManipulatorRuntime,
  cleanupPort?: OwnedCacheCleanupPort,
) {
  let activeScope: CameraTaskScope | undefined;
  let source: PrivateSource | undefined;
  let generation = 0;
  let prepareEpoch = 0;
  let sourceSequence = 0;
  let artifactSequence = 0;
  const artifacts = new Map<string, PrivateArtifact>();
  const pendingCleanup = new Set<Promise<void>>();
  let cleanupFailed = false;

  const cleanupOwned = (uri: string, originalUri: string) => {
    if (uri === originalUri || !cleanupPort) {
      cleanupFailed = true;
      return;
    }
    const operation = Promise.resolve().then(() => cleanupPort.deleteOwnedCache(uri))
      .then((deleted) => { if (!deleted) cleanupFailed = true; })
      .catch(() => { cleanupFailed = true; });
    pendingCleanup.add(operation);
    void operation.finally(() => pendingCleanup.delete(operation));
  };

  const dropArtifacts = () => {
    for (const artifact of artifacts.values()) {
      cleanupOwned(artifact.cacheUri, source?.localUri ?? '');
    }
    artifacts.clear();
  };

  const clearSourceAndArtifacts = () => {
    generation += 1;
    dropArtifacts();
    source = undefined;
  };

  const clearArtifacts = () => {
    generation += 1;
    dropArtifacts();
  };

  const retire = () => {
    activeScope = undefined;
    clearSourceAndArtifacts();
  };

  const sameDescriptor = (a: ReencodedLocalImage, b: ReencodedLocalImage): boolean =>
    sameScope(a.scope, b.scope)
    && a.context_id === b.context_id
    && a.candidate_id === b.candidate_id
    && a.source_ref_id === b.source_ref_id
    && a.c1_permission_revision === b.c1_permission_revision
    && a.consent_revision === b.consent_revision
    && a.prepared_image_id === b.prepared_image_id
    && a.state === b.state && a.width === b.width && a.height === b.height && a.mime === b.mime;

  const port: LocalImagePreparationPort = Object.freeze({
    isCurrentSource: ref => Boolean(source && validSourceRef(ref)
      && source.ref.source_ref_id === ref.source_ref_id
      && source.ref.candidate_id === ref.candidate_id
      && sameScope(source.ref.scope, ref.scope)),
    prepare: async (request: LocalImagePreparationRequest) => {
      // Do not create a real cached image without a usable cleanup boundary.
      if (!injectedRuntime && !cleanupPort) throw new Error('BLOCKED_NATIVE_CLEANUP');
      if (cleanupPort?.canDeleteOwnedCache?.() === false) throw new Error('BLOCKED_NATIVE_CLEANUP');
      const currentSource = source;
      if (!currentSource || !port.isCurrentSource(request.source)) {
        throw new Error('LOCAL_IMAGE_SOURCE_NOT_CURRENT');
      }
      const generationAtStart = generation;
      const operationEpoch = ++prepareEpoch;
      const assertCurrent = () => {
        if (operationEpoch !== prepareEpoch || generation !== generationAtStart
          || source !== currentSource
          || !port.isCurrentSource(request.source)) {
          throw new Error('LOCAL_IMAGE_PREPARATION_SUPERSEDED');
        }
      };

      const runtime = injectedRuntime
        ?? await import('expo-image-manipulator') as unknown as ImageManipulatorRuntime;
      assertCurrent();
      const initial = await runtime.ImageManipulator.manipulate(currentSource.localUri).renderAsync();
      assertCurrent();
      const longestEdge = Math.max(initial.width, initial.height);
      let rendered = initial;
      if (longestEdge > 1280) {
        const context = runtime.ImageManipulator.manipulate(initial);
        if (initial.width >= initial.height) context.resize({ width: 1280 });
        else context.resize({ height: 1280 });
        rendered = await context.renderAsync();
        assertCurrent();
      }
      const saved = await rendered.saveAsync({
        format: runtime.SaveFormat.JPEG,
        compress: 0.80,
        base64: false,
      });
      // saveAsync can finish after revocation. Retire that exact output even
      // though it was never entered in the active descriptor registry.
      if (operationEpoch !== prepareEpoch || generation !== generationAtStart
        || source !== currentSource || !port.isCurrentSource(request.source)) {
        cleanupOwned(saved.uri, currentSource.localUri);
        throw new Error('LOCAL_IMAGE_PREPARATION_SUPERSEDED');
      }
      assertCurrent();
      if (saved.uri === currentSource.localUri) {
        cleanupFailed = true;
        throw new Error('ORIGINAL_IMAGE_NOT_REENCODED');
      }
      if (!validLocalUri(saved.uri)
        || !Number.isFinite(saved.width) || saved.width <= 0 || saved.width > 1280
        || !Number.isFinite(saved.height) || saved.height <= 0 || saved.height > 1280) {
        cleanupOwned(saved.uri, currentSource.localUri);
        throw new Error('INVALID_REENCODED_LOCAL_RESULT');
      }
      if (cleanupPort?.canDeleteOwnedCache?.(saved.uri) === false) {
        cleanupFailed = true;
        throw new Error('UNOWNED_LOCAL_CACHE_RESULT');
      }

      const preparedImageId = `camera-reencoded-local-${++artifactSequence}`;
      const descriptor: ReencodedLocalImage = Object.freeze({
        scope: Object.freeze({ ...request.source.scope }),
        context_id: request.c1_context.context_id,
        candidate_id: request.source.candidate_id,
        source_ref_id: request.source.source_ref_id,
        c1_permission_revision: request.c1_context.permission_revision,
        consent_revision: request.consent.consent_revision,
        prepared_image_id: preparedImageId,
        state: 'REENCODED_LOCAL',
        width: saved.width,
        height: saved.height,
        mime: 'image/jpeg',
      });
      assertCurrent();
      artifacts.set(preparedImageId, Object.freeze({ descriptor, cacheUri: saved.uri }));
      return descriptor;
    },
    resolvePrivate: descriptor => {
      const artifact = artifacts.get(descriptor.prepared_image_id);
      if (!artifact || !sameDescriptor(artifact.descriptor, descriptor)) return undefined;
      return artifact.cacheUri;
    },
    retireArtifacts: clearArtifacts,
    retire,
  });

  return Object.freeze({
    bind: (scope: CameraTaskScope): boolean => {
      if (!validScope(scope)) return false;
      if (activeScope && sameScope(activeScope, scope)) return true;
      clearSourceAndArtifacts();
      activeScope = Object.freeze({ ...scope });
      return true;
    },
    bindAcceptedPhoto: (receipt: CameraAcceptedReceipt): LocalImageSourceRef | undefined => {
      if (!activeScope || !validReceipt(receipt) || !sameScope(activeScope, receipt)) return undefined;
      clearSourceAndArtifacts();
      const ref: LocalImageSourceRef = Object.freeze({
        scope: Object.freeze({
          session_id: receipt.session_id,
          task_id: receipt.task_id,
          revision: receipt.revision,
        }),
        candidate_id: receipt.candidate_id,
        source_ref_id: `camera-local-source-${++sourceSequence}`,
        choice: 'USE_PHOTO',
      });
      source = Object.freeze({ ref, localUri: receipt.local_uri });
      return ref;
    },
    port,
    retire,
    get nativeCleanupAvailable() {
      return Boolean(cleanupPort) && cleanupPort?.canDeleteOwnedCache?.() !== false;
    },
    cleanupStatus: () => Object.freeze({
      pending: pendingCleanup.size > 0,
      failed: cleanupFailed,
    }),
    settleCleanup: async () => {
      await Promise.all([...pendingCleanup]);
      return !cleanupFailed;
    },
  });
}


// S21A-REV2: separate sanitized headless path. Legacy PREPARED_NOT_SENT stays local-only.
export interface VisionImageIO extends OwnedCacheCleanupPort {
 readOwnedCache(uri:string):Promise<Uint8Array>;
 writeOwnedCache(uri:string,bytes:Uint8Array):Promise<void>;
 decodeJpeg(bytes:Uint8Array):Promise<Readonly<{width:number;height:number}>>;
}
export function createSanitizedVisionImagePreparer(io?:VisionImageIO,runtime?:ImageManipulatorRuntime){
 let epoch=0,busy=false,cleanupFailed=false;
 const artifacts=new Map<object,{uri:string;bytes:Uint8Array}>();
 const cleaning=new Set<Promise<void>>();
 const cleanup=(uri:string)=>{
  const job=Promise.resolve().then(()=>io?.deleteOwnedCache(uri)).then(ok=>{if(ok!==true)cleanupFailed=true;}).catch(()=>{cleanupFailed=true;});
  cleaning.add(job);void job.finally(()=>cleaning.delete(job));return job;
 };
 const clear=()=>{for(const a of artifacts.values())void cleanup(a.uri);artifacts.clear();};
 const settle=async()=>{await Promise.all([...cleaning]);return !cleanupFailed;};
 return Object.freeze({
  prepare:async(originalUri:string,isCurrent:()=>boolean)=>{
   if(busy||!io||io.canDeleteOwnedCache?.()!==true||!validLocalUri(originalUri)||!isCurrent())throw Error('C2_PREPARATION_UNAVAILABLE');
   busy=true;const operation=++epoch;let owned:string|undefined,registered=false;
   const current=()=>{if(operation!==epoch||!isCurrent())throw Error('C2_PREPARATION_RETIRED');};
   try{
    clear();if(!await settle())throw Error('C2_CLEANUP_FAILED');current();
    const imageRuntime=runtime??await import('expo-image-manipulator') as unknown as ImageManipulatorRuntime;
    current();let rendered=await imageRuntime.ImageManipulator.manipulate(originalUri).renderAsync();current();
    if(!Number.isFinite(rendered.width)||!Number.isFinite(rendered.height)||rendered.width<=0||rendered.height<=0)throw Error('C2_IMAGE_DIMENSIONS');
    if(Math.max(rendered.width,rendered.height)>1280){
     const context=imageRuntime.ImageManipulator.manipulate(rendered);
     context.resize(rendered.width>=rendered.height?{width:1280}:{height:1280});
     rendered=await context.renderAsync();current();
    }
    const saved=await rendered.saveAsync({format:imageRuntime.SaveFormat.JPEG,compress:0.8,base64:false});
    if(saved.uri===originalUri)throw Error('C2_ORIGINAL_URI_FORBIDDEN');
    if(io.canDeleteOwnedCache?.(saved.uri)!==true){cleanupFailed=true;throw Error('C2_UNOWNED_CACHE');}
    owned=saved.uri;current();
    const raw=await io.readOwnedCache(owned);current();
    const {sanitizeC2Jpeg}=await import('../../../../lib/api-zod/src/c2-jpeg.ts');current();
    const jpeg=sanitizeC2Jpeg(raw),decoded=await io.decodeJpeg(jpeg.bytes);current();
    if(decoded.width!==jpeg.width||decoded.height!==jpeg.height||saved.width!==jpeg.width||saved.height!==jpeg.height)
     throw Error('C2_DECODE_MISMATCH');
    await io.writeOwnedCache(owned,jpeg.bytes);current();
    const readback=await io.readOwnedCache(owned);current();
    if(readback.length!==jpeg.bytes.length||readback.some((b,i)=>b!==jpeg.bytes[i]))throw Error('C2_SANITIZE_READBACK');
    const token=Object.freeze({kind:'VERIFIED_BASELINE_JPEG',width:jpeg.width,height:jpeg.height});
    artifacts.set(token,{uri:owned,bytes:jpeg.bytes.slice()});registered=true;
    return token;
   }finally{if(owned&&!registered)await cleanup(owned);busy=false;}
  },
  bytes:(token:object)=>artifacts.get(token)?.bytes.slice(),
  retire:()=>{epoch++;clear();},
  settleCleanup:settle,
  cleanupStatus:()=>Object.freeze({pending:cleaning.size>0,failed:cleanupFailed}),
 });
}
