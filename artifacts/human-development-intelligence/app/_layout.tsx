import {coachPresenceCopy} from '@/i18n-coach-presence';
import { readLocalVerificationBinding } from '@/lib/identity/local-verification';
import { createHostFactsReader, type OwnerScopedFactsPort } from '@/domain/m2/host-facts-reader';
import { projectAuthoritativeM2Baseline } from '@/domain/m2/factual-snapshot';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useRouter } from 'expo-router';
import { DevelopmentProvider } from '@/context/DevelopmentContext';
import { LocalizationProvider, useLocale } from '@/context/LocalizationContext';
import { OpeningProvider } from '@/context/OpeningContext';
import { WelcomeProvider, useWelcome } from '@/context/WelcomeContext';
import { CoachingProvider } from '@/context/CoachingContext';
import { InteractionProvider } from '@/context/InteractionContext';
import { OwnerSessionProvider, useOwnerSessionBinding, useOwnerSessionControl } from '@/context/OwnerSessionContext';
import { TrainerRuntimeProvider } from '@/context/TrainerRuntimeContext';
import { OpeningGoalFlow } from '@/components/OpeningGoalFlow';
import { WelcomeExperience } from '@/components/WelcomeExperience';
import { createM7RecordActivation } from '@/components/m7-record-activation';
import { resolveWelcomeInitialPhase } from '@/domain/welcome';
import { FORCE_SLICE_PREVIEW_OPENING } from '@/context/WelcomeContext';
import type { M2Gateway, M3Access } from '@/domain/m2';
import { createM3StubAdapter } from '@/domain/m3/stub-adapter';
import { resolveM3RuntimeMode, selectM3RuntimeAdapter } from '@/domain/m3/runtime-mode';
import type { M3HostMode } from '@/components/m3-host-lifetime';

const STARTUP_FONT_DEADLINE_MS = 900;
const M3_RUNTIME_MODE = resolveM3RuntimeMode(process.env.EXPO_PUBLIC_M3_RUNTIME_MODE);

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

const queryClient = new QueryClient();

function RootLayoutNav() {
  const {locale}=useLocale();
  return (
    <Stack screenOptions={{ headerBackTitle: coachPresenceCopy(locale).back }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="lab" options={{ headerShown: false }} />
    </Stack>
  );
}

function PrivateOwnerProviders({ ownerSession, children }: {
  ownerSession: ReturnType<typeof useOwnerSessionBinding>; children: React.ReactNode;
}) { return (<OpeningProvider ownerSession={ownerSession}>
  <CoachingProvider ownerSession={ownerSession}>
    <InteractionProvider ownerSession={ownerSession}>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <DevelopmentProvider ownerSession={ownerSession}>
{children}
</DevelopmentProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </InteractionProvider>
  </CoachingProvider>
</OpeningProvider>); }

// Explicit composition injection only. Production calls AppSurface without a port.
export function useHostM2Facts(ownerSession: ReturnType<typeof useOwnerSessionBinding>, factsPort?: OwnerScopedFactsPort) {
  const access = ownerSession?.access, lease = ownerSession?.lease;
  const local = readLocalVerificationBinding(ownerSession);
  const source = local && factsPort?.access === access && factsPort?.lease === lease ? factsPort : undefined;
  const host = useMemo(() => createHostFactsReader(access, lease, source), [access, lease, source]);
  const snapshot = useSyncExternalStore(host.subscribe, host.getSnapshot, host.getSnapshot);
  useLayoutEffect(() => { host.start(); return () => host.dispose(); }, [host]);
  return { host, snapshot };
}

function AppSurface({ factsPort }: { factsPort?: OwnerScopedFactsPort } = {}) {
  const welcome = useWelcome();
  const settingsPresented = Boolean(welcome.goalSettingsSuspended && welcome.goalSettingsActive);
  const modalActive = welcome.visible && (!settingsPresented || welcome.reviewing);
  const router = useRouter();
  const ownerSession = useOwnerSessionBinding();
  const ownerControl = useOwnerSessionControl();
  const facts = useHostM2Facts(ownerSession, factsPort);
  const [guestSelected, setGuestSelected] = useState(false);
  useLayoutEffect(() => {
    if (ownerControl.phase === 'READY') {
      setGuestSelected(false);
    }
  }, [ownerControl.phase]);
  const welcomePhase = resolveWelcomeInitialPhase(
    FORCE_SLICE_PREVIEW_OPENING, welcome.reviewing, welcome.resumeGoal,
  );
  const m3HostMode: M3HostMode = ownerControl.phase === 'READY' && ownerSession
    ? 'OWNED' : ownerControl.phase === 'LOCKED' && guestSelected
      ? 'ANONYMOUS' : 'BLOCKED';
  const ownerScope = useMemo(() => {
    if (!ownerSession) return undefined;
    try {
      return ownerSession.access.requireLease(ownerSession.lease);
    } catch {
      return undefined;
    }
  }, [ownerSession, facts.snapshot]);
  const ownerAccess = ownerSession?.access;
  const ownerLease = ownerSession?.lease;
  const recordingCutoff = ownerScope?.validUntil;
  const m7RecordActivation = useMemo(() => {
    if (m3HostMode !== 'OWNED' || ownerControl.phase !== 'READY'
      || !ownerAccess || !ownerLease || recordingCutoff === undefined) return undefined;
    try {
      const scope = ownerAccess.requireLease(ownerLease);
      const current = ownerAccess.getSnapshot();
      const now = Date.now();
      if (current.phase !== 'READY' || current.generation !== scope.generation
        || current.owner.subjectId !== scope.owner.subjectId
        || current.owner.profileId !== scope.owner.profileId
        || scope.validUntil !== recordingCutoff || !Number.isFinite(recordingCutoff)
        || !Number.isFinite(now) || now >= recordingCutoff) return undefined;
      return createM7RecordActivation({ access: ownerAccess, lease: ownerLease }, recordingCutoff);
    } catch {
      return undefined;
    }
  }, [ownerAccess, ownerLease, recordingCutoff, m3HostMode, ownerControl.phase]);
  const appRootRef = useRef<any>(null);
  const localBinding = readLocalVerificationBinding(ownerSession);
  const localGrant = useRef<object | undefined>(undefined);
  const ownedM3Grant = useRef<typeof ownerSession>(undefined);
  const liveM3Scope = useRef({ binding: ownerSession, mode: m3HostMode });
  liveM3Scope.current = { binding: ownerSession, mode: m3HostMode };
  const [m3Access, setM3AccessState] = useState<M3Access>({ status: 'denied', revision: 1 });
  const m3StubAdapter = useMemo(
    () => selectM3RuntimeAdapter(M3_RUNTIME_MODE, 'fixture', createM3StubAdapter),
    [],
  );
  const m2Gateway = useMemo<M2Gateway>(() => ({
    snapshot: projectAuthoritativeM2Baseline({
      revision: ownerScope ? `owner-${ownerScope.generation}` : 'anonymous-session-1',
      subject: { id: ownerScope?.owner.subjectId ?? 'anonymous', loading: 'ready', profile: 'unknown' },
      permission: {
        status: 'allowed',
        revision: ownerScope ? `owner-${ownerScope.generation}-m2` : 'anonymous-m2-1',
      },
      safety: 'clear',
      goal: 'unknown',
      explicitIntent: false,
      activeTask: { kind: 'unknown' },
      returning: { kind: 'unknown' },
    }, facts.snapshot.reader), // Production unconfigured stays UNKNOWN; fixture port is explicit.
    m3Access: m3HostMode === 'BLOCKED'
      || (m3HostMode === 'OWNED' && ownedM3Grant.current !== ownerSession)
      || (ownerControl.localVerification && localGrant.current !== localBinding?.identity)
      ? { ...m3Access, status: 'denied' } : m3Access,
    m3StubAdapter,
    m4StubFixture: 'absent',
    setM3Access: (allowed) => {
      // A callback captured for another owner/lease or mode cannot grant current authority.
      if (liveM3Scope.current.binding !== ownerSession || liveM3Scope.current.mode !== m3HostMode) return;
      if (allowed) {
        if (m3HostMode === 'BLOCKED') return;
        if (m3HostMode === 'OWNED') {
          if (!ownerSession) return;
          try {
            ownerSession.access.requireLease(ownerSession.lease);
            if (ownerSession.access.getSnapshot().phase !== 'READY') return;
          } catch { return; }
          ownedM3Grant.current = ownerSession;
        }
      } else {
        ownedM3Grant.current = undefined;
        facts.host.invalidate();
      }
      if (ownerControl.localVerification) {
        if (!localBinding || readLocalVerificationBinding(ownerSession) !== localBinding) return;
        localGrant.current = allowed ? localBinding.identity : undefined;
      }
      setM3AccessState((current) => ({
      status: allowed ? 'allowed' : 'denied',
      revision: current.revision + 1,
    })); },
  }), [m3Access, m3StubAdapter, ownerScope, ownerSession, m3HostMode, localBinding, ownerControl.localVerification, facts.host, facts.snapshot]);

  const settingsWasSuspended = useRef(false);
  useLayoutEffect(() => {
    if (settingsWasSuspended.current && !welcome.goalSettingsSuspended && ownerSession) {
      try { ownerSession.access.requireLease(ownerSession.lease); } catch { facts.host.invalidate(); }
    }
    settingsWasSuspended.current = Boolean(welcome.goalSettingsSuspended);
  }, [welcome.goalSettingsSuspended, ownerSession, facts.host]);

  useLayoutEffect(() => facts.host.trackBaseline(m2Gateway.snapshot, facts.snapshot.epoch),
    [facts.host, facts.snapshot.epoch, m2Gateway.snapshot]);

  useEffect(() => {
    if (!welcome.hydrated) return;
    void SplashScreen.hideAsync().catch(() => undefined);
  }, [welcome.hydrated]);

  useLayoutEffect(() => {
    if (Platform.OS !== 'web') return;
    const appRoot = appRootRef.current as HTMLElement | null;
    if (!appRoot) return;
    appRoot.toggleAttribute('inert', modalActive);
    return () => appRoot.removeAttribute('inert');
  }, [modalActive]);

  if (!welcome.hydrated) return null;
  return (
    <View style={styles.surface}>
      <PrivateOwnerProviders ownerSession={ownerControl.localVerification ? undefined : ownerSession}>
                  <View
                    ref={appRootRef}
                    style={styles.surface}
                    accessibilityElementsHidden={modalActive}
                    importantForAccessibility={modalActive ? 'no-hide-descendants' : 'auto'}
                    aria-hidden={modalActive}
                  >
                    <GestureHandlerRootView style={styles.surface}>
                      <StatusBar style="dark" />
                      <RootLayoutNav />
                    </GestureHandlerRootView>
                  </View>
                      </PrivateOwnerProviders>
      {welcome.visible ? (
        <View
          style={[styles.welcomeOverlay, !modalActive && {display:'none'}]}
          pointerEvents={modalActive ? 'auto' : 'none'}
          accessibilityElementsHidden={!modalActive}
          aria-hidden={!modalActive}
          accessibilityViewIsModal
          aria-modal
          role="dialog"
          accessibilityLabel="100"
        >
          {facts.snapshot.scope === 'TEST_FIXTURE_SCOPED' ? (
            <Text testID="m2-history-provenance-test-fixture">TEST_FIXTURE_SCOPED</Text>
          ) : null}
          <View style={{flex:1,display:settingsPresented ? 'none' : 'flex'}}>
          <OpeningGoalFlow
            key={welcome.runId}
            initialPhase={welcomePhase}
            reviewing={welcome.reviewing && !welcome.goalSettingsSuspended}
            onGoalOpened={() => {
              if (ownerControl.phase === 'LOCKED') setGuestSelected(true);
              welcome.markWelcomeSeen();
            }}
            onOpenSettings={() => {
              if (ownerSession) { try { ownerSession.access.requireLease(ownerSession.lease); } catch { facts.host.invalidate(); return; } }
              if (welcome.openGoalSettings()) router.push('/privacy');
            }}
            onClose={welcome.closeWelcome}
            m2Gateway={m2Gateway}
            ownerSession={ownerSession}
            m3HostMode={m3HostMode}
            neutralGoalPrompt={ownerControl.phase === 'LOCKED' && guestSelected
              && m3HostMode === 'ANONYMOUS' && !ownerSession}
            localVerification={ownerControl.localVerification}
            localVerificationReady={ownerControl.phase === 'READY'}
            localVerificationLogout={ownerControl.logout}
            m7RecordActivation={m7RecordActivation}
          />
          </View>
          {welcome.goalSettingsSuspended && welcome.reviewing ? (
            <WelcomeExperience key={`settings-review-${welcome.settingsReviewRunId}`} reviewing
              onBegin={welcome.closeWelcome} onClose={welcome.closeWelcome} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  const [fontDeadlineReached, setFontDeadlineReached] = React.useState(false);
  const canRenderApp = fontsLoaded || Boolean(fontError) || fontDeadlineReached;

  useEffect(() => {
    const deadline = setTimeout(() => setFontDeadlineReached(true), STARTUP_FONT_DEADLINE_MS);
    return () => clearTimeout(deadline);
  }, []);

  if (!canRenderApp) return null;

  return (
    <SafeAreaProvider>
      <OwnerSessionProvider>
        <TrainerRuntimeProvider>
          <WelcomeProvider>
            <LocalizationProvider>
              <KeyboardProvider>
                <AppSurface />
              </KeyboardProvider>
            </LocalizationProvider>
          </WelcomeProvider>
        </TrainerRuntimeProvider>
      </OwnerSessionProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  surface: { flex: 1 },
  welcomeOverlay: {
    ...StyleSheet.absoluteFill,
    elevation: 10,
    zIndex: 10,
  },
});
