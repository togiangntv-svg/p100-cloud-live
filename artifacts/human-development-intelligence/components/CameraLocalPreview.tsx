import React from 'react';
import { Image, type ImageStyle, type StyleProp } from 'react-native';
import type { createCameraCandidateStore } from '../domain/camera/candidate.ts';

type Store = ReturnType<typeof createCameraCandidateStore>;
type RenderProps = Readonly<{ accessibilityLabel: string; style: StyleProp<ImageStyle> }>;

/** The function is an opaque, render-only handle; no URI crosses into the host DTO. */
export function createCameraLocalPreviewHandle(store: Store, candidateId: string) {
  const Preview = ({ accessibilityLabel, style }: RenderProps) => {
    const snapshot = store.getSnapshot();
    const candidate = snapshot.candidate;
    if (!candidate || candidate.candidate_id !== candidateId) return null;
    return <Image
      testID="camera-c0-preview"
      source={{ uri: candidate.local_uri }}
      accessibilityLabel={accessibilityLabel}
      resizeMode="cover"
      style={style}
    />;
  };
  return Preview;
}
