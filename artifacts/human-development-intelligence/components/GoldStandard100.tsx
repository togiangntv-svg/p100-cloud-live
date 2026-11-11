import React, { useEffect, useRef } from 'react';
import { Image, Platform, View } from 'react-native';
import Svg, { Defs, Image as SvgImage, Mask, Path, Rect } from 'react-native-svg';
import { createGoldRenderer } from './m1-gold-standard';
import { goldRimBands, goldStrokeBands } from './m1-native-masks';

const visual = require('../assets/images/m1_molded_white_gold_visual_v2_zero_halo_480.png');
const timing = require('../assets/images/m1_pen_stroke_timing_map_v2_zero_halo_480.png');
type Frame = { progress: number; alpha?: number; rimProgress?: number; rimGain?: number; boxAlpha?: number };
type Props = Frame & { width: number; height: number; signature?: boolean; testID?: string; onReady?: () => void };
let instance = 0;

// The Web path executes the reference's exact sparse pixel compositor. The native
// SVG path uses lossless timing-map bands, with no prematurely complete base glyph.
export function GoldStandard100(props: Props) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const render = useRef<ReturnType<typeof createGoldRenderer> | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const id = useRef(`m1-gold-${++instance}`).current;
  const paint = () => {
    const p = latest.current;
    render.current?.(p.progress, p.alpha ?? 1, p.rimProgress ?? 0, p.rimGain ?? 0, p.boxAlpha ?? 0);
  };
  useEffect(() => {
    if (Platform.OS !== 'web') { latest.current.onReady?.(); return; }
    let live = true;
    const images = [new window.Image(), new window.Image()];
    const load = (image: HTMLImageElement, uri: string) => new Promise<void>((resolve, reject) => {
      image.onload = () => resolve(); image.onerror = () => reject(new Error('M1_REFERENCE_IMAGE_LOAD'));
      image.src = uri;
    });
    const uri = (source: any) => {
      if (typeof source === 'string') return source;
      if (source?.uri) return source.uri;
      const asset = require('react-native-web/dist/modules/AssetRegistry').getAssetByID(source);
      if (!asset) throw new Error('M1_PACKAGED_ASSET_MISSING');
      const scale = asset.scales[0];
      return asset.httpServerLocation + '/' + asset.name + (scale === 1 ? '' : '@' + scale + 'x') + '.' + asset.type;
    };
    void Promise.all(images.map((img, i) => load(img, uri(i ? timing : visual)))).then(() => {
      if (!live || !canvas.current) return;
      const off = document.createElement('canvas'); off.width = off.height = 480;
      const context = off.getContext('2d', { willReadFrequently: true });
      const target = canvas.current.getContext('2d');
      if (!context || !target) throw new Error('M1_CANVAS_UNAVAILABLE');
      context.drawImage(images[0], 0, 0, 480, 480);
      const vis = context.getImageData(0, 0, 480, 480).data;
      context.clearRect(0, 0, 480, 480); context.drawImage(images[1], 0, 0, 480, 480);
      const tim = context.getImageData(0, 0, 480, 480).data;
      const output = context.createImageData(480, 480);
      render.current = createGoldRenderer(vis, tim, (buf) => {
        output.data.set(buf); context.putImageData(output, 0, 0);
        target.clearRect(0, 0, 480, latest.current.signature ? 253 : 480);
        if (latest.current.signature) target.drawImage(off, 50, 135, 380, 200, 0, 0, 480, 253);
        else target.drawImage(off, 0, 0);
      });
      paint(); latest.current.onReady?.();
    }).catch((error) => { if (live) console.error(error.message); });
    return () => { live = false; render.current = null; images.forEach(img => { img.onload = img.onerror = null; }); };
  }, []);
  useEffect(paint, [props.progress, props.alpha, props.rimProgress, props.rimGain, props.boxAlpha]);
  if (Platform.OS === 'web') return React.createElement('canvas', {
    ref: canvas, width: 480, height: props.signature ? 253 : 480,
    'data-testid': props.testID, 'aria-hidden': true,
    style: { width: props.width, height: props.height, display: 'block', pointerEvents: 'none' },
  });
  const progress = Math.max(0, Math.min(1, props.progress));
  const mask = (bands: readonly (readonly [number, string])[], p: number) => bands.map(([t, d]) => (
    t > p + 0.016 ? null : <Path key={t} d={d} fill="white" opacity={Math.min(1, (p - t + 0.016) / 0.016)} />
  ));
  return <View style={{ width: props.width, height: props.height }} testID={props.testID} pointerEvents="none">
    <Svg width="100%" height="100%" viewBox={props.signature ? '50 135 380 200' : '0 0 480 480'}>
      <Defs>
        <Mask id={`${id}-stroke`} maskUnits="userSpaceOnUse" x={0} y={0} width={480} height={480}>{mask(goldStrokeBands, progress)}</Mask>
        <Mask id={`${id}-rim`} maskUnits="userSpaceOnUse" x={0} y={0} width={480} height={480}>{mask(goldRimBands, props.rimProgress ?? 0)}</Mask>
      </Defs>
      <Rect x={1} y={1} width={478} height={478} rx={112} fill="#030408" opacity={props.boxAlpha ?? 0} />
      <SvgImage href={visual} width={480} height={480} mask={`url(#${id}-rim)`} opacity={Math.min(1, props.rimGain ?? 0)} />
      <SvgImage href={visual} width={480} height={480} mask={`url(#${id}-stroke)`} opacity={props.alpha ?? 1} />
    </Svg>
  </View>;
}
