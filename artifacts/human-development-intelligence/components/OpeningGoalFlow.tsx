import { getUnifiedOwnerFacts } from '@/domain/m2/factual-snapshot';
import Svg, { Defs, ClipPath, Polygon, Circle, G, RadialGradient, Stop } from 'react-native-svg';
import {CoachPresencePanel} from './CoachPresencePanel';
import { LocalVerificationControls } from './LocalVerificationControls';
import type { LocalVerificationControl } from '@/lib/identity/local-verification';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  AccessibilityInfo,
  Animated,
  AppState,
  Easing,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView, useKeyboardState } from 'react-native-keyboard-controller';
import { WelcomeLogoAnimation } from '@/components/WelcomeLogoAnimation';
import { WelcomeExperience } from '@/components/WelcomeExperience';
import { Animated100Signature } from '@/components/Animated100Signature';
import { useLocale } from '@/context/LocalizationContext';
import { createGoalDraftStore, type GoalDraftOwnerBinding } from './goal-draft/store';
import { useColors } from '@/hooks/useColors';
import { useM2Gateway } from '@/components/useM2Gateway';
import type { M3HostMode } from '@/components/m3-host-lifetime';
import { isM2NoteCurrent, type M2Gateway, type M2Note } from '@/domain/m2';
import { getLocaleOption, translate, RELEASE_LOCALE_OPTIONS, COMPACT_LOCALE_LABELS, isReleaseLocale, type Locale } from '@/i18n';
import { TrainerJourneyCard } from '@/components/TrainerJourneyCard';
import { W01ProductCard } from '@/components/W01ProductCard';
import { M7RecordCard } from '@/components/M7RecordCard';
import type { M7RecordActivation } from '@/components/m7-record-activation';
import {
  useOptionalTrainerJourney,
  type TrainerJourneyPresentation,
} from '@/context/TrainerRuntimeContext';
const welcomeImage = require('../assets/images/scene_m2_sunless_golden.jpg');
const sunriseImage = welcomeImage;
const displayFont = Platform.select({ ios: 'Georgia', android: 'serif', web: '"Times New Roman", "Noto Serif", Georgia, serif' });
const SCENE_WIDTH = 540;
const SCENE_HEIGHT = 960;

type Props = {
  initialPhase: FlowPhase;
  reviewing: boolean;
  onGoalOpened: () => void;
  onClose: () => void;
  onOpenSettings?: () => void;
  m2Gateway?: M2Gateway;
  ownerSession?: GoalDraftOwnerBinding;
  m3HostMode?: M3HostMode;
  neutralGoalPrompt?: boolean;
  localVerification?: LocalVerificationControl;
  localVerificationReady?: boolean;
  localVerificationLogout?: () => Promise<unknown>;
  trainerJourney?: TrainerJourneyPresentation;
  m7RecordActivation?: M7RecordActivation;
};

type FlowPhase = 'opening' | 'goal';

type CameraSurface = NonNullable<ReturnType<typeof useM2Gateway>['cameraC0']>;
type CameraColors = ReturnType<typeof useColors>;

// CAMERA_RENDER_HARNESS_START
function CameraAcquisitionControls({ camera, colors, takePhoto, choosePhoto }: {
  camera: CameraSurface;
  colors: CameraColors;
  takePhoto: () => Promise<boolean>;
  choosePhoto: () => Promise<boolean>;
}) {
  if (!camera.acquisitionAllowed) return null;
  return (
    <View testID="camera-c0-acquisition-actions" style={styles.cameraC0Actions}>
      <Pressable testID="camera-c0-take" accessibilityRole="button" disabled={camera.busy}
        onPress={takePhoto} style={({ pressed }) => [styles.cameraC0SecondaryAction, {
          borderColor: colors.welcomeGoalChipBorder,
          backgroundColor: pressed ? colors.welcomeGoalChipPressed : colors.welcomeGoalChip,
        }]}>
        <Text numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.82}
          style={[styles.cameraC0ActionText, { color: colors.welcomeText }]}>
          {camera.take_photo}
        </Text>
      </Pressable>
      <Pressable testID="camera-c0-choose" accessibilityRole="button" disabled={camera.busy}
        onPress={choosePhoto} style={({ pressed }) => [styles.cameraC0SecondaryAction, {
          borderColor: colors.welcomeGoalChipBorder,
          backgroundColor: pressed ? colors.welcomeGoalChipPressed : colors.welcomeGoalChip,
        }]}>
        <Text numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.82}
          style={[styles.cameraC0ActionText, { color: colors.welcomeText }]}>
          {camera.choose_photo}
        </Text>
      </Pressable>
    </View>
  );
}

function CameraReplacementControl({ camera, colors, takePhoto, choosePhoto }: {
  camera: CameraSurface;
  colors: CameraColors;
  takePhoto: () => Promise<boolean>;
  choosePhoto: () => Promise<boolean>;
}) {
  if (!camera.replacementAllowed || !camera.candidate) return null;
  return (
    <Pressable testID="camera-c0-replace" accessibilityRole="button" disabled={camera.busy}
      onPress={camera.candidate.source === 'CAMERA' ? takePhoto : choosePhoto}
      style={({ pressed }) => [styles.cameraC0SecondaryAction, {
        borderColor: colors.welcomeGoalChipBorder,
        backgroundColor: pressed ? colors.welcomeGoalChipPressed : colors.welcomeGoalChip,
      }]}>
      <Text numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.82}
        style={[styles.cameraC0ActionText, { color: colors.welcomeText }]}>
        {camera.candidate.source === 'CAMERA' ? camera.retake : camera.choose_again}
      </Text>
    </Pressable>
  );
}

function CameraRetainedControls({ camera, colors, takePhoto, choosePhoto, cancelPhoto,
  usePhoto }: {
  camera: CameraSurface;
  colors: CameraColors;
  takePhoto: () => Promise<boolean>;
  choosePhoto: () => Promise<boolean>;
  cancelPhoto: () => boolean;
  usePhoto: () => boolean;
}) {
  if (!camera.candidate) return null;
  return (
    <>
      <View style={styles.cameraC0Actions}>
        <CameraReplacementControl camera={camera} colors={colors}
          takePhoto={takePhoto} choosePhoto={choosePhoto} />
        <Pressable testID="camera-c0-cancel" accessibilityRole="button" onPress={cancelPhoto}
          style={({ pressed }) => [styles.cameraC0SecondaryAction, {
            borderColor: colors.welcomeGoalChipBorder,
            backgroundColor: pressed ? colors.welcomeGoalChipPressed : colors.welcomeGoalChip,
          }]}>
          <Text numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.82}
            style={[styles.cameraC0ActionText, { color: colors.welcomeText }]}>
            {camera.cancel}
          </Text>
        </Pressable>
      </View>
      <Pressable testID="camera-c0-use" accessibilityRole="button"
        accessibilityState={{ selected: camera.accepted, disabled: camera.accepted }}
        disabled={camera.accepted} onPress={usePhoto}
        style={({ pressed }) => [styles.cameraC0PrimaryAction, {
          borderColor: colors.welcomeGoalInputFocus,
          backgroundColor: pressed ? colors.welcomeGoalChipPressed : colors.welcomeGoalChipSelected,
        }]}>
        <Text numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.82}
          style={[styles.cameraC0PrimaryText, { color: colors.welcomeText }]}>
          {camera.accepted ? camera.selected : camera.use_photo}
        </Text>
      </Pressable>
    </>
  );
}

function CameraC0Panel({ active, camera, colors, takePhoto, choosePhoto, cancelPhoto, usePhoto,
  children }: {
  active: boolean;
  camera?: CameraSurface;
  colors: CameraColors;
  takePhoto: () => Promise<boolean>;
  choosePhoto: () => Promise<boolean>;
  cancelPhoto: () => boolean;
  usePhoto: () => boolean;
  children?: React.ReactNode;
}) {
  if (!active || !camera) return null;
  return (
    <View testID="camera-c0-panel" style={styles.cameraC0Panel}>
      {camera.acquisitionAllowed ? (
        <Text testID="camera-c0-entry" style={[styles.cameraC0Text, { color: colors.welcomeText }]}>
          {camera.entry}
        </Text>
      ) : null}
      {camera.candidate ? (
        <>
          {React.createElement(camera.candidate.previewHandle, {
            accessibilityLabel: camera.preview,
            style: styles.cameraC0Preview,
          })}
          <CameraRetainedControls camera={camera} colors={colors}
            takePhoto={takePhoto} choosePhoto={choosePhoto}
            cancelPhoto={cancelPhoto} usePhoto={usePhoto} />
        </>
      ) : (
        <CameraAcquisitionControls camera={camera} colors={colors}
          takePhoto={takePhoto} choosePhoto={choosePhoto} />
      )}
      {children}
    </View>
  );
}

function CameraCleanupWarning({ cleanup, colors }: {
  cleanup?: Readonly<{ status: 'PENDING' | 'FAILED' | 'UNCONFIRMED'; copy: string }>;
  colors: CameraColors;
}) {
  if (!cleanup) return null;
  return (
    <View testID="camera-cleanup-warning" style={styles.cameraC0Panel}>
      <Text accessibilityLiveRegion="polite"
        style={[styles.cameraC0Text, { color: colors.welcomeText }]}>
        {cleanup.copy}
      </Text>
    </View>
  );
}
// CAMERA_RENDER_HARNESS_END

export function OpeningGoalFlow({ initialPhase, reviewing, onGoalOpened, onClose, onOpenSettings, m2Gateway, ownerSession,
  m3HostMode = 'BLOCKED', neutralGoalPrompt = false, localVerification, localVerificationReady, localVerificationLogout,
  trainerJourney: injectedTrainerJourney, m7RecordActivation }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { locale, setLocale, t } = useLocale();
  const hostedTrainerJourney = useOptionalTrainerJourney();
  const trainerJourney = injectedTrainerJourney ?? hostedTrainerJourney;
  const m2 = useM2Gateway(m2Gateway, locale, t, ownerSession, trainerJourney, m3HostMode,
    m7RecordActivation);
  const verifiedResume = (() => {
    if (reviewing || m3HostMode !== 'OWNED' || !ownerSession || !m2Gateway) return false;
    try {
      const scope = ownerSession.access.requireLease(ownerSession.lease);
      const snapshot = m2Gateway.snapshot, task = snapshot.activeTask;
      if (snapshot.subject.id !== scope.owner.subjectId || snapshot.subject.loading !== 'ready'
        || snapshot.permission.status !== 'allowed') return false;
      const facts = getUnifiedOwnerFacts(ownerSession.access, ownerSession.lease);
      return ['IN_PROGRESS', 'RETURNING', 'CHANGED', 'JUST_COMPLETED'].includes(facts.state)
        || Boolean(m2.activeM3Task || m2.m5GoalChoice || m2.m7Record);
    } catch { return false; }
  })();
  const startAtGoal = initialPhase === 'goal' || verifiedResume;
  const [welcomeVisible, setWelcomeVisible] = useState(!startAtGoal);
  const welcomeRunActiveRef = useRef(true);
  useEffect(() => () => {
    welcomeRunActiveRef.current = false;
  }, []);
  const initialWebReduceMotion = Platform.OS === 'web'
    && typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [reduceMotion, setReduceMotion] = useState(Boolean(initialWebReduceMotion));
  const [motionPreferenceKnown, setMotionPreferenceKnown] = useState(Platform.OS === 'web');
  const [logoReady, setLogoReady] = useState(false);
  const [phase, setPhase] = useState<FlowPhase>(startAtGoal ? 'goal' : 'opening');
  const [openingMounted, setOpeningMounted] = useState(!startAtGoal);
  const subjectHint = m2Gateway?.snapshot.subject.id;
  const persistenceAllowed = !localVerification && (m2Gateway === undefined || (
    m2Gateway.snapshot.subject.loading !== 'deleted' && m2Gateway.snapshot.permission.status === 'allowed'
  ));
  const draftStore = useMemo(() => createGoalDraftStore({
    owner: ownerSession, backend: AsyncStorage, subjectHint, persistenceAllowed,
  }), [ownerSession?.access, ownerSession?.lease, subjectHint, persistenceAllowed]);
  const liveDraftStore = useRef(draftStore);
  liveDraftStore.current = draftStore;
  const draft = useSyncExternalStore(draftStore.subscribe, draftStore.getSnapshot, draftStore.getSnapshot);
  useEffect(() => { draftStore.start(); return draftStore.stop; }, [draftStore]);
  const goalDraft = draft.text;
  // Never render the M2 hook's previous owner/generation text in the controlled field.
  // Keep its existing adaptive presentation hold synchronized before React commits.
  if (m2.managed && m2.text !== goalDraft) m2.changeText(goalDraft);
  const draftIsCurrent = () => liveDraftStore.current === draftStore && draft.isCurrent();
  const setGoalDraft = (value: string) => {
    if (!draftIsCurrent() || !draft.changeText(value)) return false;
    if (m2.managed) m2.changeText(value);
    return true;
  };
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  const [languageQuery, setLanguageQuery] = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  const [compassOpen, setCompassOpen] = useState(false);
  const [attachedPillar, setAttachedPillar] = useState<string | null>(null);
  const expressionSource = useRef<string | null>(null);
  useEffect(()=>{setAttachedPillar(null);expressionSource.current=null;setCompassOpen(false);},[draftStore]);

  const keyboardVisible = useKeyboardState((state) => state.isVisible);
  const composerActive = inputFocused && (Platform.OS === 'web' || keyboardVisible);
  const enterCue = useRef(new Animated.Value(0)).current;
  useEffect(()=>{if(Platform.OS!=='web'||typeof document==='undefined'||typeof document.createElement!=='function'||!document.head)return;const rule=document.createElement('style');rule.textContent='[data-testid="opening-goal-input"]{outline-style:none!important}';document.head.appendChild(rule);return()=>rule.remove();},[]);
  useEffect(()=>{
    enterCue.setValue(0);
    if (!goalDraft.trim() || reduceMotion || !motionPreferenceKnown) return;
    let pulse: ReturnType<typeof Animated.loop> | undefined;
    const stop=()=>{pulse?.stop();enterCue.stopAnimation();enterCue.setValue(0);};
    const start=()=>{stop();pulse=Animated.loop(Animated.sequence([
      Animated.timing(enterCue,{toValue:1,duration:525,easing:Easing.inOut(Easing.sin),useNativeDriver:true,isInteraction:false}),
      Animated.timing(enterCue,{toValue:0,duration:525,easing:Easing.inOut(Easing.sin),useNativeDriver:true,isInteraction:false})
    ]));pulse.start();};
    const visibility=()=>{if(document.hidden)stop();else start();};
    const sub=AppState.addEventListener('change',state=>{if(state==='active')start();else stop();});
    if(Platform.OS==='web'&&typeof document!=='undefined'){document.addEventListener('visibilitychange',visibility);if(!document.hidden)start();}else if(AppState.currentState==='active')start();
    return()=>{stop();sub.remove();if(Platform.OS==='web'&&typeof document!=='undefined')document.removeEventListener('visibilitychange',visibility);};
  },[goalDraft.length>0,reduceMotion,motionPreferenceKnown,enterCue]);
  const [inputContentHeight, setInputContentHeight] = useState(0);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [closeHeight, setCloseHeight] = useState(0);
  const [pressedSuggestion, setPressedSuggestion] = useState<string | null>(null);
  const overlayRef = useRef<any>(null);
  const focusRef = useRef<any>(null);
  const goalInputRef = useRef<TextInput>(null);
  const endTextEntry = () => {
    goalInputRef.current?.blur();
    Keyboard.dismiss();
    setInputFocused(false);
  };
  const transitionStartedRef = useRef(startAtGoal);
  const openingExit = useRef(new Animated.Value(startAtGoal ? 1 : 0)).current;
  const openingCopyExit = useRef(new Animated.Value(startAtGoal ? 1 : 0)).current;
  const openingLogoExit = useRef(new Animated.Value(startAtGoal ? 1 : 0)).current;
  const goalReveal = useRef(new Animated.Value(startAtGoal ? 1 : 0)).current;
  const goalPanelReveal = useRef(new Animated.Value(startAtGoal ? 1 : 0)).current;
  const logoPressScale = useRef(new Animated.Value(1)).current;
  const suggestionPressScale = useRef(new Animated.Value(1)).current;
  const systemPresentationFade = useRef(new Animated.Value(1)).current;
  const previousPresentationLocale = useRef(locale);
  useEffect(() => {
    const localeChanged = previousPresentationLocale.current !== locale;
    previousPresentationLocale.current = locale;
    systemPresentationFade.stopAnimation();
    if (!localeChanged || !motionPreferenceKnown || reduceMotion) {
      systemPresentationFade.setValue(1);
      return;
    }
    systemPresentationFade.setValue(0.72);
    Animated.timing(systemPresentationFade, {
      toValue: 1,
      duration: 140,
      useNativeDriver: true,
    }).start();
  }, [locale, motionPreferenceKnown, reduceMotion, systemPresentationFade]);
  const logoShimmer = useRef(new Animated.Value(0)).current;

  const compactLayout = height < 620;
  const topInset = Platform.OS === 'web' ? (compactLayout ? 10 : 67) : insets.top;
  const bottomInset = Platform.OS === 'web' ? (compactLayout ? 10 : 34) : insets.bottom;
  // A fixed viewport boundary, not padding that can scroll behind the header.
  // Keep the existing resting gap, allowing for larger controls and review mode.
  const goalViewportTop = topInset + Math.max(
    76,
    4 + headerHeight + 12,
    reviewing ? 54 + Math.max(38, closeHeight) + 12 : 0,
  );
  // KeyboardAvoidingView owns displacement. The composer is a fixed flex
  // sibling of scrollable context; only TextInput scrolls its multiline text.
  const logoSize = compactLayout
    ? Math.min(134, Math.max(112, width * 0.4))
    : Math.min(210, Math.max(154, width * 0.52));
  const logoStageSize = logoSize + (compactLayout ? 22 : 34);
  const sceneAspect = SCENE_WIDTH / SCENE_HEIGHT;
  const sceneWidth = Math.max(width, height * sceneAspect);
  const sceneHeight = sceneWidth / sceneAspect;
  const sceneLeft = (width - sceneWidth) / 2;
  const sceneTop = (height - sceneHeight) / 2;
  const sunSize = Math.min(58, Math.max(40, width * 0.115));
  const sunCenterX = sceneLeft + sceneWidth * 0.58;
  const sunFinalY = sceneTop + sceneHeight * 0.29;
  const sunRidgeY = sceneTop + sceneHeight * 0.32;
  const sunWindowTop = sunFinalY - sunSize / 2;
  const sunWindowHeight = Math.max(sunSize * 0.58, sunRidgeY - sunWindowTop);
  const currentLocale = getLocaleOption(locale);
  const isRtl = currentLocale.direction === 'rtl';
  const sliceDisplayFont = displayFont;
  const filteredLocales = useMemo(() => {
    const query = languageQuery.trim().toLocaleLowerCase();
    if (!query) return RELEASE_LOCALE_OPTIONS;
    return RELEASE_LOCALE_OPTIONS.filter((option) => (
      option.nativeName.toLocaleLowerCase().includes(query)
      || option.englishName.toLocaleLowerCase().includes(query)
      || option.code.toLocaleLowerCase().includes(query)
    ));
  }, [languageQuery]);

  useEffect(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.matchMedia) {
      const media = window.matchMedia('(prefers-reduced-motion: reduce)');
      const handleChange = (event: MediaQueryListEvent) => setReduceMotion(event.matches);
      setReduceMotion(media.matches);
      setMotionPreferenceKnown(true);
      media.addEventListener?.('change', handleChange);
      return () => media.removeEventListener?.('change', handleChange);
    }
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      setReduceMotion(enabled);
      setMotionPreferenceKnown(true);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!motionPreferenceKnown || !logoReady || phase !== 'opening' || reduceMotion) {
      logoShimmer.stopAnimation();
      logoShimmer.setValue(0);
      return;
    }
    const animation = Animated.loop(Animated.sequence([
      Animated.parallel([
        Animated.timing(logoPressScale, {
          toValue: 0.992,
          duration: 1600,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(logoShimmer, {
          toValue: 0.62,
          duration: 230,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.timing(logoPressScale, {
          toValue: 1,
          duration: 1800,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(logoShimmer, {
          toValue: 0,
          duration: 1800,
          easing: Easing.out(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
      Animated.delay(240),
    ]));
    animation.start();
    return () => {
      animation.stop();
      logoPressScale.setValue(1);
    };
  }, [logoReady, logoPressScale, logoShimmer, motionPreferenceKnown, phase, reduceMotion]);

  useEffect(() => {
    const target = focusRef.current;
    const focusTarget = () => {
      if (Platform.OS === 'web') {
        try {
          target?.focus?.({ preventScroll: true });
        } catch {
          target?.focus?.();
        }
        return;
      }
      const node = target ? require('react-native').findNodeHandle(target) : null;
      if (node) void AccessibilityInfo.setAccessibilityFocus(node);
    };
    const focusTimer = setTimeout(focusTarget, 40);
    if (Platform.OS !== 'web') return () => clearTimeout(focusTimer);

    const root = overlayRef.current as HTMLElement | null;
    if (!root) return () => clearTimeout(focusTimer);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && reviewing) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(root.querySelectorAll<HTMLElement>(
        'button, a, input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )).filter((element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true');
      if (focusable.length === 0) return;
      const active = document.activeElement;
      const currentIndex = focusable.indexOf(active as HTMLElement);
      if ((!event.shiftKey && (active === focusable.at(-1) || currentIndex === -1))
        || (event.shiftKey && (active === focusable[0] || currentIndex === -1))) {
        event.preventDefault();
        (event.shiftKey ? focusable.at(-1) : focusable[0])?.focus();
      }
    };
    root.addEventListener('keydown', handleKeyDown);
    return () => {
      clearTimeout(focusTimer);
      root.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, reviewing, welcomeVisible]);

  const completeTransition = useCallback(() => {
    if (!transitionStartedRef.current) return;
    openingExit.stopAnimation();
    openingCopyExit.stopAnimation();
    openingLogoExit.stopAnimation();
    goalReveal.stopAnimation();
    goalPanelReveal.stopAnimation();
    openingExit.setValue(1);
    openingCopyExit.setValue(1);
    openingLogoExit.setValue(1);
    goalReveal.setValue(1);
    goalPanelReveal.setValue(1);
    setOpeningMounted(false);
  }, [goalPanelReveal, goalReveal, openingCopyExit, openingExit, openingLogoExit]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        m2.retireCameraC2();
        completeTransition();
      }
    });
    const handleVisibilityChange = () => {
      if (Platform.OS === 'web' && typeof document !== 'undefined' && document.hidden) {
        m2.retireCameraC2();
        completeTransition();
      }
    };
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }
    return () => {
      subscription.remove();
      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    };
  }, [completeTransition, m2.retireCameraC2]);

  const openGoal = useCallback(() => {
    if (phase !== 'opening' || transitionStartedRef.current) return;
    transitionStartedRef.current = true;
    setPhase('goal');
    onGoalOpened();
    logoPressScale.stopAnimation();
    logoPressScale.setValue(0.94);
    Animated.timing(logoPressScale, {
      toValue: 1,
      duration: reduceMotion ? 60 : 130,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
    Animated.sequence([
      Animated.delay(reduceMotion ? 60 : 130),
      Animated.parallel([
        Animated.timing(openingCopyExit, {
          toValue: 1,
          duration: reduceMotion ? 80 : 220,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(openingExit, {
          toValue: 0.35,
          duration: reduceMotion ? 80 : 220,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(openingLogoExit, {
        toValue: 1,
        duration: reduceMotion ? 90 : 260,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      setOpeningMounted(false);
      if (!finished) return;
      Animated.parallel([
        Animated.timing(goalReveal, {
          toValue: 1,
          duration: reduceMotion ? 260 : 2400,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.delay(reduceMotion ? 0 : 200),
          Animated.timing(goalPanelReveal, {
            toValue: 1,
            duration: reduceMotion ? 160 : 550,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
        ])
      ]).start();
    });
  }, [goalPanelReveal, goalReveal, logoPressScale, onGoalOpened, openingCopyExit, openingExit, openingLogoExit, phase, reduceMotion]);

  const closeWelcome = useCallback(() => {
    if (!welcomeRunActiveRef.current) return;
    welcomeRunActiveRef.current = false;
    onClose();
  }, [onClose]);

  const beginWelcome = useCallback(() => {
    if (!welcomeRunActiveRef.current) return;
    if (reviewing) {
      closeWelcome();
      return;
    }
    welcomeRunActiveRef.current = false;
    transitionStartedRef.current = true;
    openingExit.stopAnimation();
    openingCopyExit.stopAnimation();
    openingLogoExit.stopAnimation();
    goalReveal.stopAnimation();
    goalPanelReveal.stopAnimation();
    openingExit.setValue(1);
    openingCopyExit.setValue(1);
    openingLogoExit.setValue(1);
    goalReveal.setValue(1);
    goalPanelReveal.setValue(reduceMotion ? 1 : 0);
    if (!reduceMotion) Animated.timing(goalPanelReveal,{toValue:1,duration:550,easing:Easing.out(Easing.cubic),useNativeDriver:true}).start();
    logoPressScale.setValue(1);
    setOpeningMounted(false);
    setPhase('goal');
    setWelcomeVisible(false);
    onGoalOpened();
  }, [closeWelcome, goalPanelReveal, goalReveal, logoPressScale, onGoalOpened,
    openingCopyExit, openingExit, openingLogoExit, reduceMotion, reviewing]);

  const pressLogo = useCallback((pressed: boolean) => {
    if (transitionStartedRef.current) return;
    Animated.spring(logoPressScale, {
      toValue: pressed ? 0.94 : 1,
      speed: 24,
      bounciness: 4,
      useNativeDriver: true,
    }).start();
  }, [logoPressScale]);

  const chooseSuggestion = (value: string) => {
    if (setGoalDraft(value)) requestAnimationFrame(() => goalInputRef.current?.focus());
  };

  const pressSuggestion = useCallback((id: string | null, pressed: boolean) => {
    setPressedSuggestion(pressed ? id : null);
    suggestionPressScale.stopAnimation();
    Animated.timing(suggestionPressScale, {
      toValue: pressed ? (reduceMotion ? 0.985 : 0.96) : 1,
      duration: reduceMotion ? 0 : (pressed ? 70 : 130),
      easing: pressed ? Easing.out(Easing.quad) : Easing.out(Easing.back(1.5)),
      useNativeDriver: true,
    }).start();
  }, [reduceMotion, suggestionPressScale]);

  const selectLocale = useCallback((nextLocale: Locale) => {
    if (!isReleaseLocale(nextLocale)) return;
    setLocale(nextLocale);
    setLanguageMenuOpen(false);
    setLanguageQuery('');
  }, [setLocale]);

  const openingOpacity = openingLogoExit.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const openingLift = openingLogoExit.interpolate({ inputRange: [0, 1], outputRange: [0, -12] });
  const openingScale = openingLogoExit.interpolate({ inputRange: [0, 1], outputRange: [1, 0.975] });
  const copyOpacity = openingCopyExit.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const copyLift = openingCopyExit.interpolate({ inputRange: [0, 1], outputRange: [0, -10] });
  const darkOverlayOpacity = goalReveal.interpolate({ inputRange: [0, 1], outputRange: [0.68, 0.08] });
  const lightOverlayOpacity = goalReveal.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const sceneOpacity = goalReveal.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1],
  });
  const sunRise = goalReveal.interpolate({ inputRange: [0, 1], outputRange: [sunSize * 0.82, 0] });
  const sunOpacity = goalReveal.interpolate({ inputRange: [0, 0.18, 1], outputRange: [0, 0, 0] });
  const panelLift = goalPanelReveal.interpolate({
    inputRange: [0, 1],
    outputRange: [compactLayout ? 38 : 64, 0],
  });
  const logoPressLift = logoPressScale.interpolate({
    inputRange: [0.94, 1],
    outputRange: [3, 0],
    extrapolate: 'clamp',
  });
  const shimmerOpacity = logoShimmer.interpolate({ inputRange: [0, 1], outputRange: [0, 0.56] });
  const shimmerScale = logoShimmer.interpolate({ inputRange: [0, 1], outputRange: [1, 1.012] });
  const legacySuggestions = [
    { id: 'health', label: t('s32Movement'), icon: 'walk' as const },
    { id: 'fat-loss', label: t('s32Nutrition'), icon: 'food-apple' as const },
    { id: 'muscle', label: t('s32Body'), icon: 'human-male-height' as const },
    { id: 'shape', label: t('s32Recovery'), icon: 'weather-night' as const },
  ];
  // Expression assistance only: this never supplies facts, M2 NEW or authority.
  // A component instance is one welcome run. Retirement is monotonic in that run.
  const neutralLifetime = useRef({ activated: false, retired: false, token: {},
    store: draftStore, subject: subjectHint, mode: m3HostMode, enabled: neutralGoalPrompt,
    access: ownerSession?.access, lease: ownerSession?.lease,
    permission: m2Gateway?.snapshot.permission.revision, locale });
  let neutralRun = neutralLifetime.current;
  const neutralContextChanged = neutralRun.store !== draftStore || neutralRun.subject !== subjectHint
    || neutralRun.mode !== m3HostMode || neutralRun.enabled !== neutralGoalPrompt
    || neutralRun.access !== ownerSession?.access || neutralRun.lease !== ownerSession?.lease
    || neutralRun.permission !== m2Gateway?.snapshot.permission.revision;
  if (neutralContextChanged || neutralRun.locale !== locale) {
    neutralRun = { ...neutralRun, token: {},
      retired: neutralRun.retired || (neutralRun.activated && neutralContextChanged),
      store: draftStore, subject: subjectHint, mode: m3HostMode, enabled: neutralGoalPrompt,
      access: ownerSession?.access, lease: ownerSession?.lease,
      permission: m2Gateway?.snapshot.permission.revision, locale };
    neutralLifetime.current = neutralRun;
  }
  const neutralBase = m2Gateway?.snapshot;
  const neutralScopeEligible = neutralGoalPrompt && m3HostMode === 'ANONYMOUS' && !ownerSession
    && m2.managed && m2.view === null && Boolean(neutralBase
      && neutralBase.subject.loading === 'ready' && neutralBase.subject.profile === 'unknown'
      && neutralBase.permission.status === 'allowed' && neutralBase.safety === 'clear'
      && !neutralBase.explicitIntent && neutralBase.goal === 'unknown'
      && neutralBase.activeTask.kind === 'unknown' && neutralBase.returning.kind === 'unknown');
  const neutralHasActivity = Boolean(m2.hasM3Activity || m2.m5GoalChoice || m2.w01
    || m2.m7Record || m2.adaptiveHandoff || m2.cameraC0 || m2.cameraC1 || m2.cameraC2
    || m2.cameraCleanup);
  if (goalDraft.length > 0 || neutralHasActivity
    || (neutralRun.activated && (!neutralScopeEligible || m2.disabled))) neutralRun.retired = true;
  const neutralEligible = !neutralRun.retired && neutralScopeEligible && !neutralHasActivity
    && phase === 'goal' && !welcomeVisible && draftIsCurrent() && draft.persistence === 'memory'
    && goalDraft.length === 0 && !m2.disabled && !inputFocused && !composerActive;
  if (neutralEligible) neutralRun.activated = true;
  const neutralLive = useRef({ token: neutralRun.token, allowed: neutralEligible,
    store: draftStore, current: draftIsCurrent, change: setGoalDraft });
  neutralLive.current = { token: neutralRun.token, allowed: neutralEligible,
    store: draftStore, current: draftIsCurrent, change: setGoalDraft };
  const chooseNeutralExpression = (label: string, token: object): boolean => {
    const live = neutralLive.current;
    if (live.token !== token || !live.allowed || !live.current()
      || liveDraftStore.current !== live.store) return false;
    neutralLifetime.current.retired = true;
    live.allowed = false; // A held or double-tap callback cannot write twice.
    if (!live.change(label)) return false;
    // Synchronous focus only, and recheck after the external-store notification.
    if (neutralLive.current.token === token && liveDraftStore.current === live.store
      && live.current()) goalInputRef.current?.focus();
    return true;
  };
  const hasGoalPresentation = !m2.managed || Boolean(m2.view && m2.view.kind !== 'reported_action');
  const suggestions = m2.view?.notes ?? (m2.managed ? [] : legacySuggestions);
  const inputValue = goalDraft;
  const question = m2.view && m2.view.kind !== 'goal' ? (m2.view.question || t('s32Question')) : t('s32Question');
  const placeholder = t('s32Placeholder');
  const inputAccessibilityLabel = placeholder;
  const pillarLive = useRef({store:draftStore,locale});
  pillarLive.current={store:draftStore,locale};
  const changeInput = (value: string) => { expressionSource.current = null; return setGoalDraft(value); };
  // Scope tags are presentation only: no facts, authority, submission or task switch.
  const choosePillar = (label: string, id?: string) => {
    if (pillarLive.current.store!==draftStore || pillarLive.current.locale!==locale || !draftIsCurrent() || m2.disabled) return false;
    const currentText=draftStore.getSnapshot().text;
    if (!currentText.trim() || currentText === expressionSource.current) {
      if (!setGoalDraft(label)) return false;
      expressionSource.current = label; setAttachedPillar(null);
    } else setAttachedPillar(id ?? legacySuggestions.find(p=>p.label===label)?.id ?? null);
    goalInputRef.current?.focus(); return true;
  };
  const chooseNote = (note: (typeof suggestions)[number], expressionLabel = note.label) => {
    if (!hasGoalPresentation || !draftIsCurrent() || !m2.acceptPress(note.id)) return;
    if (m2.view) {
      if (!isM2NoteCurrent(m2.view, m2.view, note as M2Note)) return;
      if ((note as M2Note).action) void m2.choose(note as M2Note);
      else if(m2.view.kind === 'goal') choosePillar(expressionLabel);
      else chooseSuggestion(note.label);
    } else if (m2.managed) {
      return;
    } else {
      chooseSuggestion(note.label);
    }
  };
  const editActiveTask = () => {
    if (draftIsCurrent() && m2.editM3Task(inputValue)) goalInputRef.current?.focus();
  };
  const cancelActiveTask = () => {
    if (setGoalDraft('') && m2.cancelM3Task()) endTextEntry();
  };
  const primaryResponse = m2.cameraC0?.message
    || (m2.m5GoalChoice
      ? m2.m5GoalChoice.acknowledgement
      : (m2.notice || m2.context || m2.m3Notice));


  if (welcomeVisible) {
    return (
      <WelcomeExperience
        reviewing={reviewing}
        onBegin={beginWelcome}
        onClose={closeWelcome}
      />
    );
  }

  return (
    <Animated.View
      ref={overlayRef}
      importantForAccessibility="yes"
      style={[styles.root, { backgroundColor: colors.welcomeNavy }]}
    >
      <StatusBar style="light" />
      <View style={styles.image}>
        <Animated.View
          testID="goal-sunrise-scene"
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { opacity: sceneOpacity },
          ]}
        >
          <Animated.Image
            source={welcomeImage}
            resizeMode="cover"
            testID="goal-sunrise-image"
            style={[
              styles.goalSceneImage,
              {
                width: sceneWidth,
                height: sceneHeight,
                left: sceneLeft,
                top: sceneTop,
              },
            ]}
          />
          <Animated.Image
            testID="goal-sunrise-awakening"
            source={sunriseImage}
            resizeMode="cover"
            style={[styles.goalSceneImage,{width:sceneWidth,height:sceneHeight,left:sceneLeft,top:sceneTop,opacity:goalReveal}]}
          />
        </Animated.View>

        <Animated.View testID="s32-ridge-sun" pointerEvents="none" style={{position:'absolute',left:sceneLeft,top:sceneTop,width:sceneWidth,height:sceneHeight,opacity:goalReveal}}>
          <Svg width="100%" height="100%" viewBox="0 0 540 960">
            <Defs><ClipPath id="s32-sky-ridge"><Polygon points="0.00,333.98 5.99,333.41 12.04,332.16 18.04,331.10 24.03,331.87 30.08,334.46 36.07,335.62 42.07,336.86 48.11,338.30 54.11,338.02 60.10,338.88 66.10,339.84 72.14,340.70 78.14,341.76 84.13,343.01 90.18,345.12 96.17,343.39 102.17,341.47 108.22,339.26 114.21,338.59 120.20,336.86 126.25,336.38 132.25,335.71 138.24,333.98 144.29,331.39 150.28,328.13 156.28,326.02 162.32,324.29 168.32,321.31 174.31,320.54 180.36,319.97 186.35,317.47 192.35,314.30 198.34,311.62 204.39,309.70 210.38,307.97 216.38,307.58 222.43,307.30 228.42,307.01 234.41,307.97 240.46,310.27 246.46,312.10 252.45,313.15 258.50,314.59 264.49,316.32 270.49,318.53 276.53,319.87 282.53,320.16 288.52,320.54 294.57,319.68 300.56,319.39 306.56,320.16 312.55,321.98 318.60,321.98 324.59,319.39 330.59,318.43 336.64,318.72 342.63,319.30 348.62,321.12 354.67,324.29 360.67,326.30 366.66,328.42 372.71,331.01 378.70,331.39 384.70,334.18 390.74,331.01 396.74,338.59 402.73,340.99 408.78,343.97 414.77,345.89 420.77,347.33 426.82,347.62 432.81,348.58 438.80,341.28 444.80,351.84 450.85,352.90 456.84,353.86 462.83,352.32 468.88,344.26 474.88,338.30 480.87,344.83 486.92,351.17 492.91,354.14 498.91,353.28 504.95,355.01 510.95,351.74 516.94,352.90 522.99,330.24 528.98,280.13 534.98,279.26 540.00,278.30 540.00,0.00 0.00,0.00"/></ClipPath>
              <RadialGradient id="s32-sun-glow"><Stop offset="0" stopColor="#FFF9D5" stopOpacity="1"/><Stop offset="0.28" stopColor="#FFF3BE" stopOpacity="0.9"/><Stop offset="1" stopColor="#FFD46B" stopOpacity="0"/></RadialGradient>
            </Defs>
            <G clipPath="url(#s32-sky-ridge)"><Circle cx={262} cy={312} r={84} fill="url(#s32-sun-glow)"/><Circle cx={262} cy={304} r={26} fill="#FFF9DC"/></G>
          </Svg>
        </Animated.View>
        <Animated.View
          testID="goal-sun-disc"
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          aria-hidden
          style={[
            styles.sunWindow,
            {
              left: sunCenterX - sunSize / 2,
              top: sunWindowTop,
              width: sunSize,
              height: sunWindowHeight,
              opacity: sunOpacity,
            },
          ]}
        >
          <Animated.View
            style={[
              styles.sunGlow,
              {
                width: sunSize,
                height: sunSize,
                borderRadius: sunSize / 2,
                backgroundColor: colors.welcomeLogoGlow,
                shadowColor: colors.welcomeLogoBeamCore,
                transform: [{ translateY: sunRise }],
              },
            ]}
          >
            <View
              style={[
                styles.sunCore,
                {
                  borderRadius: sunSize / 2,
                  backgroundColor: colors.welcomeText,
                },
              ]}
            />
          </Animated.View>
        </Animated.View>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: darkOverlayOpacity }]}>
          <LinearGradient
            colors={[
              colors.welcomeOpeningSky,
              colors.welcomeOpeningMid,
              colors.welcomeOpeningLower,
            ]}
            locations={[0, 0.52, 1]}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: lightOverlayOpacity }]}>
          <LinearGradient
            colors={[colors.welcomeGoalLightSoft, colors.welcomeGoalLight, colors.welcomeGoalClear]}
            locations={[0, 0.42, 1]}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: goalReveal }]}>
          <LinearGradient
            colors={[
              colors.welcomeGoalAtmosphereClear,
              colors.welcomeGoalAtmosphereMid,
              colors.welcomeGoalAtmosphereBase,
            ]}
            locations={[0.34, 0.7, 1]}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>

        <View
          testID="opening-goal-header"
          onLayout={({ nativeEvent }) => setHeaderHeight(nativeEvent.layout.height)}
          pointerEvents="box-none"
          style={[styles.headerBar, { top: topInset + 4 }]}
        >
          <Animated.View style={{ opacity: phase === 'goal' ? goalPanelReveal : 0 }}>
            <Pressable testID="opening-home-100" accessibilityRole="button" accessibilityLabel={t('s32Home')}
              onPress={()=>{endTextEntry();setCompassOpen(true);}} style={{borderRadius:22,minWidth:66,minHeight:44}}>
              <Animated100Signature color={colors.welcomeText} testID="goal-brand-logo" />
            </Pressable>
          </Animated.View>
        {phase === 'goal' && !reviewing && onOpenSettings ? (
          <Pressable testID="opening-settings-trigger" accessibilityRole="button" accessibilityLabel={t('settings')}
            onPress={() => { endTextEntry(); onOpenSettings(); }}
            style={{minWidth:44,minHeight:44,flexShrink:0,alignItems:'center',justifyContent:'center'}}>
            <Feather name="settings" size={22} color={colors.welcomeText} />
          </Pressable>
        ) : null}
          <Animated.View style={{ opacity: phase === 'goal' ? goalPanelReveal : 0 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('languageMenuOpen')}
              accessibilityState={{ expanded: languageMenuOpen }}
              testID="opening-language-menu"
              disabled={phase !== 'goal'}
              onPress={() => setLanguageMenuOpen(true)}
              hitSlop={8}
              style={({ pressed }) => [
                styles.languageMenuButton,
                {
                  backgroundColor: colors.welcomeGoalHeaderSurface,
                  borderColor: colors.welcomeGoalPanelBorder,
                  maxWidth: Math.min(184, width * 0.56),
                  opacity: pressed ? 0.78 : 1,
                  transform: [{ scale: pressed && !reduceMotion ? 0.97 : 1 }],
                },
              ]}
            >
              <Feather name="globe" size={15} color={colors.welcomeText} />
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.82}
                style={[
                  styles.languageMenuButtonText,
                  {
                    color: colors.welcomeText,
                    writingDirection: isRtl ? 'rtl' : 'ltr',
                  },
                ]}
              >
                {COMPACT_LOCALE_LABELS[locale]}
              </Text>
              <Feather name="chevron-down" size={14} color={colors.welcomeMuted} />
            </Pressable>
          </Animated.View>
        </View>

        {reviewing ? (
          <Pressable
            ref={focusRef}
            accessibilityRole="button"
            accessibilityLabel={t('welcomeClose')}
            testID="welcome-close"
            onLayout={({ nativeEvent }) => setCloseHeight(nativeEvent.layout.height)}
            onPress={onClose}
            hitSlop={12}
            style={({ pressed }) => [
              styles.close,
              {
                top: topInset + 54,
                backgroundColor: colors.welcomeGoalHeaderSurface,
                borderColor: colors.welcomeGoalPanelBorder,
                opacity: pressed ? 0.65 : 1,
              },
            ]}
          >
            <Feather name="x" size={22} color={colors.welcomeText} />
          </Pressable>
        ) : null}

        {phase === 'goal' ? (
          <View
            testID="opening-goal-viewport"
            collapsable={false}
            pointerEvents="box-none"
            style={[styles.goalViewport, { top: goalViewportTop }]}
          >
          <Animated.View
            testID="opening-goal-panel-layer"
            style={[styles.goalLayer, {
              opacity: goalPanelReveal,
              transform: [{ translateY: panelLift }],
            }]}
          >
            <KeyboardAvoidingView
              testID="opening-goal-keyboard-viewport"
              style={styles.goalLayer}
              behavior="padding"
              automaticOffset
              enabled={Platform.OS !== 'web'}
            >
            <View
              pointerEvents="box-none"
              style={[styles.goalContent, { paddingBottom: bottomInset + 12 }]}
            >
              <Pressable
                testID="opening-goal-dismiss-area"
                accessible={false}
                focusable={false}
                disabled={!inputFocused}
                onPress={endTextEntry}
                style={StyleSheet.absoluteFill}
              />
              <View
                testID="opening-goal-panel"
                style={[
                  styles.goalPanel,
                  compactLayout && styles.goalPanelCompact,
                  {
                    backgroundColor: 'rgba(9,23,22,0.82)',
                    borderColor: colors.welcomeGoalPanelBorder,
                  },
                ]}
              >
                {localVerification ? <LocalVerificationControls control={localVerification}
                  ready={Boolean(localVerificationReady)} allowed={m2Gateway?.m3Access?.status === 'allowed'}
                  setAllowed={m2.setM3Access} logout={localVerificationLogout} locale={locale} /> : null}
                <View testID="opening-goal-focus-block" style={styles.goalFocusBlock}>
                <Text
                  accessibilityRole="header"
                  accessible
                  accessibilityElementsHidden={false}
                  importantForAccessibility="auto"
                  style={[
                    styles.goalQuestion,
                    
                    compactLayout && styles.goalQuestionCompact,
                    {
                      color: colors.welcomeText,
                      fontFamily: sliceDisplayFont,
                      textAlign: 'center',
                      writingDirection: isRtl ? 'rtl' : 'ltr',
                    },
                  ]}
                >
                  {question.normalize('NFC')}
                </Text>
                <LinearGradient
                  testID="opening-goal-composer"
                  colors={inputFocused
                    ? [colors.welcomeGoalInputFocus, colors.welcomeGoalInputShine, colors.welcomeGoalInputFocus]
                    : [colors.welcomeGoalInputShine, colors.welcomeGoalInputBorder, colors.welcomeGoalInputShade]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={[styles.goalInputFrame, compactLayout && styles.goalInputFrameCompact]}
                >
                  <View style={[styles.goalInputSurface, { backgroundColor: colors.welcomeGoalHeaderSurface }]}>
                    <Feather name="edit-3" size={17} color={colors.welcomeMuted} />
                    <View style={[styles.goalInputField, compactLayout && styles.goalInputFieldCompact]}>
                      {!inputValue && <View
                        pointerEvents="none"
                        accessible={false}
                        accessibilityElementsHidden
                        importantForAccessibility="no-hide-descendants"
                      >
                        <Text
                          testID="opening-goal-placeholder"
                          style={[
                            styles.goalPlaceholder,
                            compactLayout && styles.goalPlaceholderCompact,
                            { color: colors.welcomeMuted, textAlign: isRtl ? 'right' : 'left', writingDirection: isRtl ? 'rtl' : 'ltr' },
                          ]}
                        >
                          {placeholder}
                        </Text>
                      </View>}
                      <TextInput
                        ref={goalInputRef}
                        value={inputValue}
                        onChangeText={changeInput}
                        onFocus={() => setInputFocused(true)}
                        onBlur={() => setInputFocused(false)}
                        multiline
                        underlineColorAndroid="transparent"
                        submitBehavior="newline"
                        scrollEnabled
                        onContentSizeChange={({ nativeEvent }) => setInputContentHeight(nativeEvent.contentSize.height)}
                        maxLength={1000}
                        placeholder={placeholder}
                        placeholderTextColor="transparent"
                        accessibilityLabel={inputAccessibilityLabel}
                        testID="opening-goal-input"
                        style={[
                          styles.goalInput,
                          Platform.OS === 'web' && {outlineWidth: 0},
                          compactLayout && styles.goalInputCompact,
                          !inputValue && styles.goalInputEmpty,
                          {
                            height: inputValue ? Math.min(compactLayout ? 72 : 112, Math.max(compactLayout ? 42 : 60, inputContentHeight)) : undefined,
                            color: colors.welcomeText,
                            textAlign: isRtl ? 'right' : 'left',
                            writingDirection: isRtl ? 'rtl' : 'ltr',
                          },
                        ]}
                      />
                    </View>
                    <View testID="opening-enter-hit-frame" style={{width:44,height:44,position:'relative'}}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t('m2Submit')}
                      testID="opening-goal-submit"
                      onPress={() => {
                        if (draftIsCurrent() && !m2.disabled && inputValue.trim()) {
                          setCompassOpen(false);
                          m2.submit(inputValue);
                          endTextEntry();
                        }
                      }}
                      disabled={m2.disabled || !inputValue.trim()}
                      style={[styles.inputArrow, { borderColor: '#FFEDB6', backgroundColor: '#FFF4CD', opacity: m2.disabled || !inputValue.trim() ? 0.45 : 1 }]}
                    >
                      <Animated.View pointerEvents="none" testID="opening-enter-glow" style={[StyleSheet.absoluteFill,{borderRadius:22,borderWidth:2,borderColor:'#FFD36B',opacity:enterCue.interpolate({inputRange:[0,1],outputRange:[0.12,0.8]})}]} /><Feather name="corner-down-left" size={20} color="#2E210B" />
                    </Pressable>
                    </View>
                  </View>
                </LinearGradient>

                </View>
                <ScrollView
                  testID="opening-goal-scroll"
                  style={styles.goalScroll}
                  contentInsetAdjustmentBehavior="never"
                  automaticallyAdjustContentInsets={false}
                  automaticallyAdjustKeyboardInsets={false}
                  showsVerticalScrollIndicator={false}
                  keyboardDismissMode="on-drag"
                  keyboardShouldPersistTaps="handled"
                >
                {attachedPillar ? <Pressable testID="opening-attached-pillar" accessibilityRole="button"
                  accessibilityLabel={legacySuggestions.find(p=>p.id===attachedPillar)?.label} onPress={()=>setAttachedPillar(null)} style={{alignSelf:'flex-start',borderRadius:18,padding:8,backgroundColor:'rgba(255,234,171,.16)'}}><Text style={{color:'#FFF5E2'}}>{legacySuggestions.find(p=>p.id===attachedPillar)?.label} ×</Text></Pressable> : null}
                <Animated.View style={{ opacity: systemPresentationFade, display: compassOpen ? 'none' : 'flex' }}>
                {primaryResponse ? (
                  <Text
                    testID="m4-primary-response"
                    accessibilityLiveRegion="polite"
                    style={[
                      styles.primaryResponse,
                      {
                        color: colors.welcomeText,
                        backgroundColor: colors.welcomeGoalHeaderSurface,
                        borderColor: colors.welcomeGoalPanelBorder,
                      },
                    ]}
                  >
                    {primaryResponse.normalize('NFC')}
                  </Text>
                ) : null}
                {trainerJourney?.view.state === 'CURRENT' ? (
                  <TrainerJourneyCard journey={trainerJourney} locale={locale} />
                ) : null}
                {m2.coachPresence ? <CoachPresencePanel flow={m2.coachPresence.flow} model={m2.coachPresence.model} locale={locale} /> : null}
                {m2.m3Mode !== 'off' ? (
                  <View
                    testID="m3-stub-panel"
                    style={[styles.m3StubPanel, { borderColor: colors.welcomeGoalPanelBorder }, !m2.activeM3Task && !m2.w01 && !m2.m7Record && {borderWidth:0,padding:0,paddingHorizontal:0,paddingVertical:0,gap:0,minHeight:0}]}
                  >
                    <CameraC0Panel
                      active={Boolean(m2.activeM3Task) && !m2.coachPresence}
                      camera={m2.cameraC0}
                      colors={colors}
                      takePhoto={m2.takeCameraPhoto}
                      choosePhoto={m2.chooseCameraPhoto}
                      cancelPhoto={m2.cancelCameraPhoto}
                      usePhoto={m2.useCameraPhoto}
                    >
                        {m2.cameraC1 ? (
                          <View testID="camera-c1-panel" style={styles.cameraC0Panel}>
                            <Text style={[styles.cameraC0Text, { color: colors.welcomeText }]}>
                              {m2.cameraC1.state === 'NEEDS_LOCAL_PERMISSION'
                                ? m2.cameraC1.prompt
                                : m2.cameraC1.state === 'LOCAL_ALLOWED'
                                  ? m2.cameraC1.allowed : m2.cameraC1.stopped}
                            </Text>
                            {m2.cameraC1.state === 'NEEDS_LOCAL_PERMISSION' ? (
                              <View style={styles.cameraC0Actions}>
                                <Pressable
                                  testID="camera-c1-allow"
                                  accessibilityRole="button"
                                  onPress={m2.allowCameraPhotoForTask}
                                  style={[styles.cameraC0PrimaryAction, {
                                    borderColor: colors.welcomeGoalInputFocus,
                                    backgroundColor: colors.welcomeGoalChipSelected,
                                  }]}
                                >
                                  <Text style={[styles.cameraC0PrimaryText, { color: colors.welcomeText }]}>
                                    {m2.cameraC1.allow}
                                  </Text>
                                </Pressable>
                                <Pressable
                                  testID="camera-c1-decline"
                                  accessibilityRole="button"
                                  onPress={m2.declineCameraPhotoForTask}
                                  style={[styles.cameraC0SecondaryAction, {
                                    borderColor: colors.welcomeGoalChipBorder,
                                    backgroundColor: colors.welcomeGoalChip,
                                  }]}
                                >
                                  <Text style={[styles.cameraC0ActionText, { color: colors.welcomeText }]}>
                                    {m2.cameraC1.decline}
                                  </Text>
                                </Pressable>
                              </View>
                            ) : m2.cameraC1.state === 'LOCAL_ALLOWED' ? (
                              <Pressable
                                testID="camera-c1-revoke"
                                accessibilityRole="button"
                                onPress={m2.revokeCameraPhotoForTask}
                                style={[styles.cameraC0SecondaryAction, {
                                  borderColor: colors.welcomeGoalChipBorder,
                                  backgroundColor: colors.welcomeGoalChip,
                                }]}
                              >
                                <Text style={[styles.cameraC0ActionText, { color: colors.welcomeText }]}>
                                  {m2.cameraC1.revoke}
                                </Text>
                              </Pressable>
                            ) : null}
                            <Text style={[styles.cameraC0Text, { color: colors.welcomeText }]}>
                              {m2.cameraC1.external_boundary}
                            </Text>
                          </View>
                        ) : null}
                        {m2.cameraC2 ? (
                          <View testID="camera-c2-panel" style={styles.cameraC0Panel}>
                            <Text style={[styles.cameraC0Text, { color: colors.welcomeText }]}>
                              {m2.cameraC2.state === 'CONSENT_REQUIRED'
                                || m2.cameraC2.state === 'LOCAL_ONLY_DECLINED'
                                ? m2.cameraC2.copy.ask
                                : m2.cameraC2.state === 'PREPARING_LOCAL'
                                  ? m2.cameraC2.copy.preparing
                                  : m2.cameraC2.state === 'PREPARED_NOT_SENT'
                                    ? m2.cameraC2.copy.prepared
                                    : m2.cameraC2.reason_code === 'CLEANUP_PENDING_OR_FAILED'
                                      ? m2.cameraC2.copy.cleanup : m2.cameraC2.copy.blocked}
                            </Text>
                            {(m2.cameraC2.state === 'CONSENT_REQUIRED'
                              || m2.cameraC2.state === 'LOCAL_ONLY_DECLINED') ? (
                              <View style={styles.cameraC0Actions}>
                                <Pressable testID="camera-c2-allow-prepare" accessibilityRole="button"
                                  onPress={() => { void m2.allowExternalProcessingAndPrepare(m2.cameraC2!.view_token); }}
                                  style={[styles.cameraC0PrimaryAction, {
                                    borderColor: colors.welcomeGoalInputFocus,
                                    backgroundColor: colors.welcomeGoalChipSelected,
                                  }]}>
                                  <Text style={[styles.cameraC0PrimaryText, { color: colors.welcomeText }]}>
                                    {m2.cameraC2.copy.allow}
                                  </Text>
                                </Pressable>
                                <Pressable testID="camera-c2-decline" accessibilityRole="button"
                                  onPress={() => m2.declineExternalProcessing(m2.cameraC2!.view_token)}
                                  style={[styles.cameraC0SecondaryAction, {
                                    borderColor: colors.welcomeGoalChipBorder,
                                    backgroundColor: colors.welcomeGoalChip,
                                  }]}>
                                  <Text style={[styles.cameraC0ActionText, { color: colors.welcomeText }]}>
                                    {m2.cameraC2.copy.decline}
                                  </Text>
                                </Pressable>
                              </View>
                            ) : null}
                            {m2.cameraC2.external_consent === 'ON' ? (
                              <View style={styles.cameraC0Actions}>
                                <Pressable testID="camera-c2-revoke" accessibilityRole="button"
                                  onPress={() => m2.revokeExternalProcessing(m2.cameraC2!.view_token)}
                                  style={[styles.cameraC0SecondaryAction, {
                                    borderColor: colors.welcomeGoalChipBorder,
                                    backgroundColor: colors.welcomeGoalChip,
                                  }]}>
                                  <Text style={[styles.cameraC0ActionText, { color: colors.welcomeText }]}>
                                    {m2.cameraC2.copy.revoke}
                                  </Text>
                                </Pressable>
                                {m2.cameraC2.state === 'BLOCKED' ? (
                                  <Pressable testID="camera-c2-retry" accessibilityRole="button"
                                    onPress={() => { void m2.retryLocalPreparation(m2.cameraC2!.view_token); }}
                                    style={[styles.cameraC0SecondaryAction, {
                                      borderColor: colors.welcomeGoalChipBorder,
                                      backgroundColor: colors.welcomeGoalChip,
                                    }]}>
                                    <Text style={[styles.cameraC0ActionText, { color: colors.welcomeText }]}>
                                      {m2.cameraC2.copy.retry}
                                    </Text>
                                  </Pressable>
                                ) : null}
                              </View>
                            ) : null}
                            <Text style={[styles.cameraC0Text, { color: colors.welcomeText }]}>
                              {m2.cameraC2.copy.revoked}
                            </Text>
                          </View>
                        ) : null}
                    </CameraC0Panel>
                    {m2.activeM3Task ? (
                      <CameraCleanupWarning cleanup={m2.cameraCleanup} colors={colors} />
                    ) : null}
                    {m2.activeM3Task && m2.m5GoalChoice ? (
                      <View testID="m5-goal-choice" style={styles.m5GoalChoice}>
                        <Pressable
                          testID="m5-goal-use"
                          accessibilityRole="button"
                          accessibilityState={{
                            selected: m2.m5GoalChoice.accepted,
                            disabled: m2.m5GoalChoice.accepted,
                          }}
                          disabled={m2.m5GoalChoice.accepted}
                          onPress={m2.acceptM5GoalChoice}
                          style={({ pressed }) => [
                            styles.m5PrimaryAction,
                            {
                              borderColor: colors.welcomeGoalInputFocus,
                              backgroundColor: pressed
                                ? colors.welcomeGoalChipPressed
                                : colors.welcomeGoalChipSelected,
                              opacity: m2.m5GoalChoice?.accepted ? 0.88 : 1,
                            },
                          ]}
                        >
                          <Text
                            numberOfLines={2}
                            adjustsFontSizeToFit
                            minimumFontScale={0.82}
                            style={[styles.m5PrimaryActionText, { color: colors.welcomeText }]}
                          >
                            {m2.m5GoalChoice.accepted
                              ? m2.m5GoalChoice.selected
                              : m2.m5GoalChoice.use_goal}
                          </Text>
                        </Pressable>
                        <View style={styles.m5SecondaryActions}>
                          <Pressable
                            testID="m5-goal-change"
                            accessibilityRole="button"
                            onPress={editActiveTask}
                            style={({ pressed }) => [
                              styles.m5SecondaryAction,
                              {
                                borderColor: colors.welcomeGoalChipBorder,
                                backgroundColor: pressed
                                  ? colors.welcomeGoalChipPressed
                                  : colors.welcomeGoalChip,
                              },
                            ]}
                          >
                            <Text
                              numberOfLines={2}
                              adjustsFontSizeToFit
                              minimumFontScale={0.82}
                              style={[styles.m5SecondaryActionText, { color: colors.welcomeText }]}
                            >
                              {m2.m5GoalChoice.change_goal}
                            </Text>
                          </Pressable>
                          <Pressable
                            testID="m3-stub-cancel-task"
                            accessibilityRole="button"
                            onPress={cancelActiveTask}
                            style={({ pressed }) => [
                              styles.m5SecondaryAction,
                              {
                                borderColor: colors.welcomeGoalChipBorder,
                                backgroundColor: pressed
                                  ? colors.welcomeGoalChipPressed
                                  : colors.welcomeGoalChip,
                              },
                            ]}
                          >
                            <Text
                              numberOfLines={2}
                              adjustsFontSizeToFit
                              minimumFontScale={0.82}
                              style={[styles.m5SecondaryActionText, { color: colors.welcomeText }]}
                            >
                              {translate(m2.effectiveLocale, 'm2CancelRequest')}
                            </Text>
                          </Pressable>
                        </View>
                      </View>
                    ) : m2.activeM3Task ? (
                        <View style={styles.m3TaskActions}>
                          <Pressable
                            testID="m3-stub-edit-task"
                            accessibilityRole="button"
                            onPress={editActiveTask}
                          >
                            <Text style={{ color: colors.welcomeText }}>
                              {translate(m2.effectiveLocale, 'm2EditRequest')}
                            </Text>
                          </Pressable>
                          <Pressable
                            testID="m3-stub-cancel-task"
                            accessibilityRole="button"
                            onPress={cancelActiveTask}
                          >
                            <Text style={{ color: colors.welcomeText }}>
                              {translate(m2.effectiveLocale, 'm2CancelRequest')}
                            </Text>
                          </Pressable>
                        </View>
                    ) : null}
                    {m2.w01 ? <W01ProductCard controller={m2.w01} locale={m2.effectiveLocale}
                      color={colors.welcomeText} border={colors.welcomeGoalChipBorder} /> : null}
                    {m2.m7Record ? <M7RecordCard presentation={m2.m7Record.presentation}
                      locale={m2.effectiveLocale} color={colors.welcomeText}
                      border={colors.welcomeGoalChipBorder} /> : null}
                  </View>
                ) : null}
                </Animated.View>
                {neutralEligible ? <View testID="opening-neutral-goal-suggestions">
                  <View style={[styles.suggestionGrid, compactLayout && styles.suggestionGridCompact]}>
                    {legacySuggestions.map((suggestion) => (
                      <Pressable key={suggestion.id}
                        testID={`opening-neutral-goal-chip-${suggestion.id}`}
                        accessibilityRole="button" accessibilityLabel={suggestion.label.normalize('NFC')}
                        onPress={() => chooseNeutralExpression(suggestion.label, neutralRun.token)}
                        style={({ pressed }) => [styles.suggestionCell, styles.suggestion, styles.suggestionSurface,
                          { borderColor: colors.welcomeGoalChipBorder, opacity: pressed ? 0.78 : 1 }]}>
                        <Text numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.82}
                          style={[styles.suggestionText, { color: colors.welcomeText }]}>
                          {suggestion.label.normalize('NFC')}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View> : null}
                {!neutralEligible && m2.view?.kind !== 'goal' && (!neutralHasActivity || compassOpen) && !m2.disabled && draftIsCurrent() ? <View testID="opening-pillar-grid" style={styles.suggestionGrid}>
                  {legacySuggestions.map(p=><Pressable key={p.id} testID={'opening-pillar-'+p.id} accessibilityRole="button" accessibilityLabel={p.label.normalize('NFC')}
                    onPress={()=>choosePillar(p.label,p.id)} style={[styles.suggestionCell,styles.suggestion,styles.suggestionSurface,{borderColor:colors.welcomeGoalChipBorder}]}>
                    <MaterialCommunityIcons name={p.icon} size={20} color="#FFF5E2"/><Text style={[styles.suggestionText,{color:'#FFF5E2'}]}>{p.label.normalize('NFC')}</Text>
                  </Pressable>)}
                </View> : null}
                {compassOpen && neutralHasActivity ? <Pressable testID="opening-resume-preserved-task" accessibilityRole="button" onPress={()=>setCompassOpen(false)} style={styles.suggestion}><Text style={{color:'#FFF5E2'}}>{t('s32Resume')}</Text></Pressable> : null}
                {hasGoalPresentation && !compassOpen && !m2.adaptiveHandoff && !m2.m5GoalChoice ? <View
                  testID="opening-goal-suggestions"
                  style={[styles.suggestionGrid, compactLayout && styles.suggestionGridCompact, composerActive && styles.suggestionsHidden]}
                  pointerEvents={composerActive ? 'none' : 'auto'}
                  accessibilityElementsHidden={composerActive}
                  importantForAccessibility={composerActive ? 'no-hide-descendants' : 'auto'}
                  aria-hidden={composerActive}
                >
                  {suggestions.map((sourceSuggestion, index) => {
                    const suggestion = m2.view?.kind === 'goal' ? {...sourceSuggestion,label:legacySuggestions[index]?.label ?? sourceSuggestion.label} : sourceSuggestion;
                    const isSelected = inputValue === suggestion.label;
                    const isOtherFocused = (inputFocused || inputValue.length > 0) && !isSelected;
                    return (
                    <Animated.View
                      key={suggestion.id}
                      style={[
                        styles.suggestionCell,
                        {
                          opacity: isOtherFocused ? 0.64 : 1,
                          transform: [
                            { scale: pressedSuggestion === suggestion.id ? suggestionPressScale : 1 },
                            { translateY: pressedSuggestion === suggestion.id && !reduceMotion ? 2 : 0 },
                          ],
                        },
                      ]}
                    >
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={suggestion.label.normalize('NFC')}
                        accessibilityState={{ selected: isSelected, disabled: m2.disabled || composerActive }}
                        testID={`opening-goal-chip-${suggestion.id}`}
                        onPressIn={() => { m2.beginPress(suggestion.id); pressSuggestion(suggestion.id, true); }}
                        onPressOut={() => { m2.endPress(); pressSuggestion(suggestion.id, false); }}
                        onPress={() => chooseNote(sourceSuggestion,suggestion.label)}
                        disabled={m2.disabled || composerActive}
                        style={[
                          styles.suggestion,
                          compactLayout && styles.suggestionCompact,
                          {
                            borderColor: isSelected
                              ? colors.welcomeGoalInputFocus
                              : colors.welcomeGoalChipBorder,
                          },
                        ]}
                      >
                        <LinearGradient
                          colors={isSelected
                            ? [colors.welcomeGoalChipSelected, colors.welcomeGoalChipSelectedBottom]
                            : pressedSuggestion === suggestion.id
                              ? [colors.welcomeGoalChipPressed, colors.welcomeGoalChipBottom]
                              : [colors.welcomeGoalChipTop, colors.welcomeGoalChipBottom]}
                            style={[styles.suggestionSurface, compactLayout && styles.suggestionSurfaceCompact]}
                        >
                          <View style={styles.suggestionIcon}>
                            <MaterialCommunityIcons
                              name={suggestion.icon}
                              size={compactLayout ? 17 : 18}
                              color={colors.welcomeText}
                            />
                          </View>
                          <Text
                            numberOfLines={2}
                            adjustsFontSizeToFit
                            minimumFontScale={0.82}
                            style={[
                              styles.suggestionText,
                              {
                                color: colors.welcomeText,
                                writingDirection: isRtl ? 'rtl' : 'ltr',
                              },
                            ]}
                          >
                            {suggestion.label.normalize('NFC')}
                          </Text>
                        </LinearGradient>
                      </Pressable>
                    </Animated.View>
                  )})}
                </View> : null}
                </ScrollView>
              </View>
            </View>
            </KeyboardAvoidingView>
          </Animated.View>
          </View>
        ) : null}
        {openingMounted ? (
          <Animated.View
            pointerEvents={phase === 'opening' ? 'auto' : 'none'}
            style={[
              styles.contentLayer,
              {
                opacity: openingOpacity,
                transform: [{ translateY: openingLift }, { scale: openingScale }],
              },
            ]}
          >
            <ScrollView
              contentContainerStyle={[
                styles.openingContent,
                { paddingTop: topInset + (compactLayout ? 26 : 78), paddingBottom: bottomInset + 12 },
              ]}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <View style={[styles.logoArea, { minHeight: logoStageSize }]}>
                <Animated.View style={{ transform: [{ translateY: logoPressLift }, { scale: logoPressScale }] }}>
                  <Pressable
                    ref={!reviewing ? focusRef : undefined}
                    accessibilityRole="button"
                    accessibilityLabel={logoReady ? t('openingTapHint') : 'Logo 100'}
                    accessibilityState={{ disabled: transitionStartedRef.current }}
                    testID="opening-logo-open"
                    disabled={transitionStartedRef.current}
                    onPressIn={() => pressLogo(true)}
                    onPressOut={() => pressLogo(false)}
                    onPress={openGoal}
                    style={styles.logoTouchTarget}
                  >
                    <View style={[styles.logoPanel, { width: logoSize, height: logoSize, backgroundColor: 'rgba(5,7,12,0.18)' }]}>
                      <WelcomeLogoAnimation
                        size={logoSize}
                        motionPreferenceKnown={motionPreferenceKnown}
                        reduceMotion={reduceMotion}
                        surfaceColor="rgba(5,7,12,0.18)"
                        traceColor={colors.welcomeText}
                        traceGlowColor={colors.welcomeLogoBeamCore}
                        borderGlowColor={colors.welcomeLogoGlow}
                        onDrawComplete={() => setLogoReady(true)}
                      />
                      <Animated.View
                        testID="welcome-logo-shimmer"
                        pointerEvents="none"
                        style={[
                          styles.logoShimmer,
                          {
                            borderColor: colors.welcomeLogoBeamCore,
                            opacity: shimmerOpacity,
                            transform: [{ scale: shimmerScale }],
                          },
                        ]}
                      />
                    </View>
                  </Pressable>
                </Animated.View>
              </View>

              <Animated.View
                style={[
                  styles.heroCopy,
                  compactLayout && styles.heroCopyCompact,
                  { opacity: copyOpacity, transform: [{ translateY: copyLift }] },
                ]}
              >
                <Text
                  style={[
                    styles.titleLead,
                    {
                      color: colors.welcomeText,
                      fontFamily: sliceDisplayFont,
                      letterSpacing: locale === 'en' ? -0.4 : 0,
                      writingDirection: isRtl ? 'rtl' : 'ltr',
                    },
                  ]}
                >
                  {t('openingTitleLead')}
                </Text>
                <Text
                  style={[
                    styles.subtitle,
                    {
                      color: colors.welcomeMuted,
                      writingDirection: isRtl ? 'rtl' : 'ltr',
                    },
                  ]}
                >
                  {t('welcomeTagline')}
                </Text>
              </Animated.View>

              <View style={styles.openingFooter} />
            </ScrollView>
          </Animated.View>
        ) : null}

        <Modal
          visible={languageMenuOpen}
          transparent
          statusBarTranslucent
          animationType={reduceMotion ? 'none' : 'fade'}
          onRequestClose={() => setLanguageMenuOpen(false)}
        >
          <View style={styles.languageModalRoot}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('languageMenuClose')}
              onPress={() => setLanguageMenuOpen(false)}
              style={[StyleSheet.absoluteFill, { backgroundColor: colors.welcomeGoalMenuBackdrop }]}
            />
            <View
              accessibilityViewIsModal
              style={[
                styles.languageModalCard,
                {
                  maxHeight: Math.min(620, height - topInset - bottomInset - 20),
                  backgroundColor: colors.welcomeGoalMenuSurface,
                  borderColor: colors.welcomeGoalPanelBorder,
                  marginTop: topInset + 10,
                  marginBottom: bottomInset + 10,
                },
              ]}
            >
              <View style={styles.languageModalHeader}>
                <Text
                  accessibilityRole="header"
                  style={[
                    styles.languageModalTitle,
                    {
                      color: colors.welcomeText,
                      textAlign: isRtl ? 'right' : 'left',
                      writingDirection: isRtl ? 'rtl' : 'ltr',
                    },
                  ]}
                >
                  {t('languageMenuTitle')}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('languageMenuClose')}
                  testID="language-menu-close"
                  hitSlop={10}
                  onPress={() => setLanguageMenuOpen(false)}
                  style={({ pressed }) => [styles.languageModalClose, { opacity: pressed ? 0.6 : 1 }]}
                >
                  <Feather name="x" size={21} color={colors.welcomeText} />
                </Pressable>
              </View>
              <View style={[styles.languageSearchFrame, { borderColor: colors.welcomeGoalInputBorder }]}>
                <Feather name="search" size={17} color={colors.welcomeMuted} />
                <TextInput
                  value={languageQuery}
                  onChangeText={setLanguageQuery}
                  accessibilityLabel={t('languageMenuSearchPlaceholder')}
                  placeholder={t('languageMenuSearchPlaceholder')}
                  placeholderTextColor={colors.welcomeMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  testID="language-menu-search"
                  style={[
                    styles.languageSearchInput,
                    {
                      color: colors.welcomeText,
                      textAlign: isRtl ? 'right' : 'left',
                      writingDirection: isRtl ? 'rtl' : 'ltr',
                    },
                  ]}
                />
              </View>
              <ScrollView
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.languageList}
              >
                {filteredLocales.map((option) => {
                  const selected = option.id === locale;
                  return (
                    <Pressable
                      key={option.id}
                      accessibilityRole="radio"
                      accessibilityLabel={`${option.nativeName}${selected ? `, ${t('languageMenuSelected')}` : ''}`}
                      accessibilityState={{ checked: selected }}
                      testID={`language-option-${option.id}`}
                      onPress={() => selectLocale(option.id)}
                      style={({ pressed }) => [
                        styles.languageOption,
                        {
                          backgroundColor: selected ? colors.welcomeGoalChipSelected : colors.welcomeGoalChip,
                          borderColor: selected ? colors.welcomeGoalInputFocus : colors.welcomeGoalChipBorder,
                          opacity: pressed ? 0.72 : 1,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.languageOptionNative,
                          {
                            color: colors.welcomeText,
                            textAlign: option.direction === 'rtl' ? 'right' : 'left',
                            writingDirection: option.direction,
                          },
                        ]}
                      >
                        {option.nativeName}
                      </Text>
                      <View style={styles.languageOptionMeta}>
                        <Text style={[styles.languageOptionCode, { color: colors.welcomeMuted }]}>
                          {option.code}
                        </Text>
                        {selected ? <Feather name="check" size={17} color={colors.welcomeText} /> : null}
                      </View>
                    </Pressable>
                  );
                })}
                {filteredLocales.length === 0 ? (
                  <Text
                    style={[
                      styles.languageEmpty,
                      {
                        color: colors.welcomeMuted,
                        writingDirection: isRtl ? 'rtl' : 'ltr',
                      },
                    ]}
                  >
                    {t('languageMenuNoResults')}
                  </Text>
                ) : null}
              </ScrollView>
            </View>
          </View>
        </Modal>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  primaryResponse: {
    width: '100%',
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '600',
  },
  m3StubPanel: {
    width: '100%',
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 12,
  },
  m3StubHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  m3StubCaption: { fontSize: 11, lineHeight: 15 },
  simulationBadge: {
    minHeight: 30,
    borderRadius: 15,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  simulationBadgeText: { fontSize: 11, fontWeight: '600' },
  m3StubToggle: {
    minHeight: 36,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  m3TaskList: { gap: 8 },
  m3TaskChip: {
    width: 150,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  m3TaskStatus: { fontSize: 10, marginTop: 3 },
  m3StubResponse: { fontSize: 12, lineHeight: 17 },
  m3TaskActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
    paddingHorizontal: 4,
  },
  cameraC0Panel: { width: '100%', gap: 12, paddingVertical: 8 },
  cameraC0Text: { fontSize: 13, lineHeight: 18, textAlign: 'center' },
  cameraC0Preview: {
    width: '100%',
    height: 180,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.08)',
  },
  cameraC0Actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  cameraC0SecondaryAction: {
    minHeight: 44,
    minWidth: 120,
    flexBasis: 120,
    flexGrow: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraC0ActionText: {
    flexShrink: 1,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '600',
    textAlign: 'center',
  },
  cameraC0PrimaryAction: {
    width: '100%',
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraC0PrimaryText: {
    flexShrink: 1,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '700',
    textAlign: 'center',
  },
  m5GoalChoice: { width: '100%', gap: 12, paddingVertical: 8 },
  m5PrimaryAction: {
    width: '100%',
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  m5PrimaryActionText: {
    flexShrink: 1,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  m5SecondaryActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  m5SecondaryAction: {
    minHeight: 44,
    minWidth: 120,
    flexBasis: 120,
    flexGrow: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  m5SecondaryActionText: {
    flexShrink: 1,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '600',
    textAlign: 'center',
  },
  root: { flex: 1 },
  image: { flex: 1 },
  goalSceneImage: { position: 'absolute' },
  sunWindow: { position: 'absolute', overflow: 'hidden', zIndex: 1 },
  sunGlow: {
    padding: 5,
    shadowOpacity: 0.8,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  sunCore: { flex: 1 },
  contentLayer: { ...StyleSheet.absoluteFill },
  openingContent: { flexGrow: 1, paddingHorizontal: 24 },
  logoArea: { width: '100%', alignItems: 'center', justifyContent: 'center', position: 'relative' },
  logoTouchTarget: { padding: 10, borderRadius: 32 },
  logoPanel: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    overflow: 'hidden',
  },
  logoShimmer: { ...StyleSheet.absoluteFill, borderRadius: 22, borderWidth: 2 },
  headerBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 9,
  },
  targetLogo: { width: 66, height: 40 },
  languageMenuButton: {
    minHeight: 42,
    minWidth: 0,
    flexShrink: 1,
    borderRadius: 15,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 11,
  },
  languageMenuButtonText: { minWidth: 0, flexShrink: 1, fontSize: 13, lineHeight: 18, fontWeight: '700' },
  close: {
    position: 'absolute',
    right: 16,
    width: 38,
    height: 38,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 8,
  },
  heroCopy: { marginTop: 16, width: '100%', alignItems: 'center' },
  heroCopyCompact: { marginTop: 8 },
  titleLead: { fontSize: 34, lineHeight: 42, fontWeight: '500', textAlign: 'center' },
  subtitle: { fontSize: 17, lineHeight: 25, fontWeight: '500', marginTop: 10, textAlign: 'center' },
  openingFooter: { minHeight: 48, marginTop: 'auto', paddingTop: 42 },
  goalLayer: { flex: 1 },
  // Keep the native clipping plane stationary while its child animates/scrolls.
  goalViewport: { position: 'absolute', left: 0, right: 0, bottom: 0, overflow: 'hidden', zIndex: 2 },
  goalFocusBlock: { flexShrink: 0 },
  goalScroll: { flexGrow: 0, flexShrink: 1, minHeight: 0, overflow: 'hidden' },
  goalContent: { flex: 1, minHeight: 0, justifyContent: 'flex-end', paddingHorizontal: 16 },
  goalPanel: { maxHeight: '88%', flexShrink: 1, minHeight: 0, width: '100%', maxWidth: 540, alignSelf: 'center', borderWidth: 1, borderRadius: 32, padding: 16 },
  goalPanelCompact: { borderRadius: 22, padding: 10 },
  goalQuestion: { fontSize: 22, lineHeight: 29, fontWeight: '500', textAlign: 'center' },
  goalQuestionCompact: { fontSize: 18, lineHeight: 22 },
  goalInputFrame: { flexShrink: 0, borderRadius: 25, padding: 1, marginTop: 14 },
  goalInputFrameCompact: { marginTop: 8 },
  goalInputSurface: {
    minHeight: 64,
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 13,
    paddingRight: 7,
    gap: 9,
  },
  goalInputField: { flex: 1, minWidth: 0, minHeight: 60, position: 'relative' },
  goalInputFieldCompact: { minHeight: 42 },
  goalPlaceholder: { paddingVertical: 14, fontSize: 14.5, lineHeight: 22 },
  goalPlaceholderCompact: { paddingVertical: 9 },
  goalInputEmpty: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 },
  goalInput: {
    flex: 1,
    minHeight: 60,
    maxHeight: 112,
    paddingVertical: 14,
    paddingHorizontal: 0,
    fontSize: 14.5,
    lineHeight: 22,
    textAlignVertical: 'top',
    borderWidth: 0,
    backgroundColor: 'transparent',
  },
  goalInputCompact: { minHeight: 42, maxHeight: 72, paddingVertical: 9 },
  inputArrow: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestionGrid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 8, rowGap: 8, marginTop: 12 },
  suggestionsHidden: { display: 'none' },
  suggestionGridCompact: { rowGap: 6, marginTop: 6 },
  suggestionCell: { width: '48%', flexBasis: '48%', maxWidth: '49%', flexGrow: 0, flexShrink: 0 },
  suggestion: {
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 16,
    overflow: 'hidden',
  },
  suggestionCompact: { minHeight: 44, borderRadius: 14 },
  suggestionSurface: {
    flexGrow: 0,
    flexShrink: 0,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  suggestionSurfaceCompact: { minHeight: 42, paddingHorizontal: 8, paddingVertical: 5 },
  suggestionIcon: {
    width: 25,
    height: 25,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  suggestionText: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 17, fontWeight: '600', textAlign: 'center' },
  languageModalRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  languageModalCard: {
    width: '100%',
    maxWidth: 440,
    borderWidth: 1,
    borderRadius: 24,
    padding: 14,
    overflow: 'hidden',
  },
  languageModalHeader: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  languageModalTitle: { flex: 1, fontSize: 21, lineHeight: 28, fontWeight: '700' },
  languageModalClose: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  languageSearchFrame: {
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 15,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    marginTop: 10,
  },
  languageSearchInput: { flex: 1, minHeight: 44, fontSize: 15, lineHeight: 20 },
  languageList: { gap: 7, paddingTop: 12, paddingBottom: 4 },
  languageOption: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  languageOptionNative: { flex: 1, fontSize: 16, lineHeight: 22, fontWeight: '600' },
  languageOptionMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  languageOptionCode: { fontSize: 12, lineHeight: 17, fontWeight: '600' },
  languageEmpty: { paddingVertical: 24, textAlign: 'center', fontSize: 15, lineHeight: 21 },
});
