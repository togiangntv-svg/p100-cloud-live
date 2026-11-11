// Pixel equations ported verbatim from Founder-approved studio 976f2e33…; maps remain byte-exact.
export const DRAW_DURATION_MS = 3000;
export const MECH_BOB_PERIOD_MS = 1050;
export const SHRINK_FLIGHT_MS = 1450;
export const PRESS_DURATION_MS = 140;
export const CORNER_LOOP_DRAW_MS = 2300;
export const CORNER_LOOP_HOLD_MS = 550;
export const CORNER_LOOP_FADE_MS = 650;
export function mechanicalPose(elapsed: number) {
 const phase = (elapsed % MECH_BOB_PERIOD_MS) / MECH_BOB_PERIOD_MS;
 const wave = Math.pow(0.5 - 0.5 * Math.cos(phase * Math.PI * 2), 0.85);
 return {wave, y: 3.5 - 17 * wave, scale: 0.985 + 0.048 * wave, rimGain: 0.55 + wave, glow: 0.20 + 0.80 * wave};
}
export function signatureFrame(elapsed: number) {
 const cycle = elapsed % (CORNER_LOOP_DRAW_MS + CORNER_LOOP_HOLD_MS + CORNER_LOOP_FADE_MS);
 return {progress: Math.min(1, cycle / CORNER_LOOP_DRAW_MS), alpha: cycle < CORNER_LOOP_DRAW_MS + CORNER_LOOP_HOLD_MS ? 1 : Math.max(0, 1 - (cycle - CORNER_LOOP_DRAW_MS - CORNER_LOOP_HOLD_MS) / CORNER_LOOP_FADE_MS)};
}
export function createGoldRenderer(visData: Uint8ClampedArray, timData: Uint8ClampedArray, put: (buf: Uint8ClampedArray) => void) {
 const N=480, outBuf=new Uint8ClampedArray(N*N*4);
 let sqIdx: Int32Array, sqAlpha: Uint8Array, p100Idx: Int32Array, p100T: Float32Array, p100R: Uint8Array, p100G: Uint8Array, p100B: Uint8Array, rimIdx: Int32Array, rimT: Float32Array, rimR: Uint8Array, rimG: Uint8Array, rimB: Uint8Array;
  function buildSparseTables() {
    const total = N * N;
    let nSq = 0, n100 = 0, nRim = 0;
    for (let i = 0; i < total; i++) {
      const k = i * 4;
      if (timData[k + 2] > 0) nSq++;
      if (timData[k] > 0) n100++;
      if (timData[k + 1] > 0) nRim++;
    }

    sqIdx = new Int32Array(nSq);
    sqAlpha = new Uint8Array(nSq);

    p100Idx = new Int32Array(n100);
    p100T = new Float32Array(n100);
    p100R = new Uint8Array(n100);
    p100G = new Uint8Array(n100);
    p100B = new Uint8Array(n100);

    rimIdx = new Int32Array(nRim);
    rimT = new Float32Array(nRim);
    rimR = new Uint8Array(nRim);
    rimG = new Uint8Array(nRim);
    rimB = new Uint8Array(nRim);

    let iSq = 0, i100 = 0, iRim = 0;
    for (let i = 0; i < total; i++) {
      const k = i * 4;
      const bSq = timData[k + 2];
      if (bSq > 0) {
        sqIdx[iSq] = k;
        sqAlpha[iSq] = bSq;
        iSq++;
      }
      const t1 = timData[k];
      if (t1 > 0) {
        p100Idx[i100] = k;
        p100T[i100] = (t1 - 1) / 254.0;
        p100R[i100] = visData[k];
        p100G[i100] = visData[k + 1];
        p100B[i100] = visData[k + 2];
        i100++;
      }
      const tr = timData[k + 1];
      if (tr > 0) {
        rimIdx[iRim] = k;
        rimT[iRim] = (tr - 1) / 254.0;
        rimR[iRim] = visData[k];
        rimG[iRim] = visData[k + 1];
        rimB[iRim] = visData[k + 2];
        iRim++;
      }
    }
  }

  // Render exact frame onto the 480x480 Canvas:
  // - p100: progress of 100 pen stroke [0..1]
  // - alpha100: overall opacity of 100 [0..1] (used during corner loop fade-out "đủ tan")
  // - pRim: progress of edge-radiating rim [0..1]
  // - rimMult: brightness multiplier of edge-radiating rim (pulses strongly during mechanical bob, fades to 0 when shrinking to corner)
  // - boxAlpha: opacity of dark #030408 squircle button body (1.0 on M1, fades to 0 when shrinking to top-left corner!)
  function renderFrame(p100: number, alpha100: number, pRim: number, rimMult: number, boxAlpha: number) {


    // Clear buffer
    outBuf.fill(0);

    // 1. Draw dark #030408 squircle base if boxAlpha > 0.01
    if (boxAlpha > 0.01) {
      const nSq = sqIdx.length;
      for (let i = 0; i < nSq; i++) {
        const k = sqIdx[i];
        outBuf[k]     = 3;
        outBuf[k + 1] = 4;
        outBuf[k + 2] = 8;
        outBuf[k + 3] = Math.round(sqAlpha[i] * boxAlpha);
      }
    }

    // 2. Draw Molded Edge-Radiating White-Gold Squircle Rim if rimMult > 0.01
    if (rimMult > 0.01 && pRim > 0.001) {
      const nRim = rimIdx.length;
      const showTip = pRim < 0.99;
      for (let i = 0; i < nRim; i++) {
        const t = rimT[i];
        if (t > pRim + 0.02) continue;
        const k = rimIdx[i];
        let rev = (pRim - t + 0.02) / 0.02;
        if (rev > 1.0) rev = 1.0;

        let boost = rimMult * rev;
        if (showTip) {
          const dt = (pRim - t) / 0.022;
          if (dt >= -0.4 && dt <= 1.2) {
            boost += 0.65 * Math.exp(-dt * dt);
          }
        }
        const r = Math.min(255, Math.round(rimR[i] * boost));
        const g = Math.min(255, Math.round(rimG[i] * boost));
        const b = Math.min(255, Math.round(rimB[i] * boost));
        outBuf[k]     = Math.min(255, outBuf[k] + r);
        outBuf[k + 1] = Math.min(255, outBuf[k + 1] + g);
        outBuf[k + 2] = Math.min(255, outBuf[k + 2] + b);
        if (outBuf[k + 3] < 255) {
          const lumA = Math.max(r, g, b);
          outBuf[k + 3] = Math.min(255, outBuf[k + 3] + lumA);
        }
      }
    }

    // 3. Draw Pen-Written 1-Stroke 100 Calligraphy
    if (alpha100 > 0.01 && p100 > 0.001) {
      const n100 = p100Idx.length;
      const showPenNib = p100 < 0.99;
      for (let i = 0; i < n100; i++) {
        const t = p100T[i];
        if (t > p100 + 0.016) continue;
        const k = p100Idx[i];
        let rev = (p100 - t + 0.016) / 0.016;
        if (rev > 1.0) rev = 1.0;

        let mult = rev * alpha100;
        let nibBoost = 0.0;
        if (showPenNib) {
          const dt = (p100 - t) / 0.018;
          if (dt >= -0.35 && dt <= 1.3) {
            nibBoost = 0.72 * Math.exp(-dt * dt) * alpha100;
          }
        }
        const baseR = p100R[i];
        const baseG = p100G[i];
        const baseB = p100B[i];
        const lumNorm = baseR / 255.0;

        const r = Math.min(255, Math.round(baseR * mult + 255.0 * nibBoost * lumNorm));
        const g = Math.min(255, Math.round(baseG * mult + 252.0 * nibBoost * lumNorm));
        const b = Math.min(255, Math.round(baseB * mult + 235.0 * nibBoost * lumNorm));

        outBuf[k]     = Math.min(255, outBuf[k] + r);
        outBuf[k + 1] = Math.min(255, outBuf[k + 1] + g);
        outBuf[k + 2] = Math.min(255, outBuf[k + 2] + b);
        if (outBuf[k + 3] < 255) {
          const aStroke = Math.min(255, Math.round(Math.max(r, g, b) * 1.18));
          outBuf[k + 3] = Math.max(outBuf[k + 3], aStroke);
        }
      }
    }

    put(outBuf);
  }


 buildSparseTables();
 return renderFrame;
}
