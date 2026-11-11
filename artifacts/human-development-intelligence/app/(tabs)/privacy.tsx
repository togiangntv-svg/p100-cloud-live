import { M7CompletedReportCard } from '@/components/M7RecordCard';
import { localVerificationCopy } from '@/i18n-identity';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import * as RouterModule from 'expo-router';
const { router } = RouterModule;
import { ActionButton, Card, Header, Screen, SectionLabel, Row, styles as ui } from '@/components/UI';
import { useColors } from '@/hooks/useColors';
import { useLocale } from '@/context/LocalizationContext';
import { useDevelopment } from '@/context/DevelopmentContext';
import { useOpening } from '@/context/OpeningContext';
import { useWelcome } from '@/context/WelcomeContext';
import { useCoaching } from '@/context/CoachingContext';
import { useInteraction } from '@/context/InteractionContext';
import { useOwnerSessionControl, useM7CompletedHistory } from '@/context/OwnerSessionContext';
import { summarizeLocalDeleteResults } from '@/domain/privacy-local-delete';
import { RELEASE_LOCALE_OPTIONS } from '@/i18n';
import type { ReleaseLocale } from '@/i18n-opening';

export default function PrivacyScreen() {
  const colors = useColors();
  const { t, locale, localeCode, setLocale } = useLocale();
  const setDisplayLocale = setLocale;
  const { state, revokeCalendar, resetLocalState, persistenceStatus } = useDevelopment();
  const opening = useOpening();
  const coaching = useCoaching();
  const interaction = useInteraction();
  const ownerSession = useOwnerSessionControl();
  const m7History=useM7CompletedHistory();
  const [identityNotice, setIdentityNotice] = useState<'identityCancelled' | 'identityUnavailable' | 'identityLogoutUnavailable' | null>(null);
  const [deleteResult, setDeleteResult] = useState<'idle' | 'deleting' | 'confirmed' | 'failed' | 'partial'>('idle');
  const deleteRunRef = useRef(0);
  const [accountConfirmation,setAccountConfirmation]=useState<object | 'RETRY' | undefined>(undefined);
  const [accountBusy,setAccountBusy]=useState(false);
  const [accountError,setAccountError]=useState(false);
  const accountBusyRef=useRef(false);
  const accountLatest=useRef(ownerSession);accountLatest.current=ownerSession;
  const accountMounted=useRef(true);
  useEffect(()=>{accountMounted.current=true;return()=>{accountMounted.current=false;};},[]);
  useEffect(()=>{setAccountConfirmation(undefined);setAccountError(false);},[ownerSession.erasureScope]);
  const canRequestAccount=ownerSession.state==='ready'&&!!ownerSession.erasureScope&&!ownerSession.localVerification;
  const retryAccount=ownerSession.erasurePhase==='QUARANTINED';
  const requestAccountDelete=()=>{
    if(accountBusyRef.current||typeof ownerSession.eraseAccount!=='function')return;
    if(canRequestAccount){setAccountError(false);setAccountConfirmation(ownerSession.erasureScope);}
    else if(retryAccount){setAccountError(false);setAccountConfirmation('RETRY');}
  };
  const confirmAccountDelete=async()=>{
    const scope=accountConfirmation,current=accountLatest.current;
    if(!scope||accountBusyRef.current||typeof current.eraseAccount!=='function')return;
    if(scope==='RETRY'?current.erasurePhase!=='QUARANTINED':current.state!=='ready'||current.erasureScope!==scope)return;
    accountBusyRef.current=true;setAccountBusy(true);setAccountConfirmation(undefined);setAccountError(false);
    try{const done=await current.eraseAccount();const next=accountLatest.current;
      if(accountMounted.current&&(!next.erasureScope||next.erasureScope===current.erasureScope))setAccountError(!done);
    }catch{const next=accountLatest.current;if(accountMounted.current&&(!next.erasureScope||next.erasureScope===current.erasureScope))setAccountError(true);}
    finally{accountBusyRef.current=false;if(accountMounted.current)setAccountBusy(false);}
  };
  const accountPhase=ownerSession.erasurePhase??'IDLE';
  const accountStatus=accountBusy||accountPhase==='REQUESTING'?'privacyAccountDeletePending'
    :accountPhase==='COMPLETE'?'privacyAccountDeleteComplete'
      :accountError||accountPhase==='QUARANTINED'?'privacyAccountDeleteFailed'
        :!canRequestAccount?'privacyAccountDeleteGuest':null;

  const welcome = useWelcome();
  const { showWelcome } = welcome;
  const settingsPath = typeof RouterModule.usePathname === 'function' ? RouterModule.usePathname() : undefined;
  const settingsRouteActive = settingsPath === '/privacy';
  useEffect(() => {
    if (!welcome.goalSettingsSuspended || !settingsRouteActive) return;
    welcome.presentGoalSettings(true);
    return () => welcome.presentGoalSettings(false);
  }, [welcome.goalSettingsSuspended, settingsRouteActive]);
  useEffect(() => {
    deleteRunRef.current++;
    setDeleteResult('idle');
  }, [opening.projectionRevision, coaching.projectionRevision, ownerSession.state]);
  const phaseLabel = coaching.state.status === 'idle'
    ? t('privacyCoachingIdle')
    : coaching.state.status === 'paused'
      ? t('privacyCoachingPaused')
      : coaching.state.status === 'completed'
        ? t('privacyCoachingCompleted')
        : t('privacyCoachingActive');
  const pathLabels = {
    work: t('privacyPathWork'),
    movement: t('privacyPathMovement'),
    relationships: t('privacyPathRelationships'),
    creativity: t('privacyPathCreativity'),
    learning: t('privacyPathLearning'),
    joy: t('privacyPathJoy'),
    other: t('privacyPathOther'),
  };
  const pathLabel = coaching.state.path ? pathLabels[coaching.state.path] : t('privacyPathNotChosen');
  const sourceLabel = coaching.state.pathSource === 'inferred'
    ? t('privacySourceInferred')
    : coaching.state.pathSource === 'chosen'
      ? t('privacySourceChosen')
      : t('privacySourceNone');

  const confirmForgetOpening = () => {
    const token = deleteRunRef.current;
    const forgetMemory = opening.forgetMemory;
    Alert.alert(
    t('openingForgetQuestion'),
    t('openingForgetBody'),
    [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('delete'),
        style: 'destructive',
        onPress: () => { void (async () => {
          if (token !== deleteRunRef.current) return;
          setDeleteResult('deleting');
          const ok = await forgetMemory();
          if (token === deleteRunRef.current) setDeleteResult(ok ? 'confirmed' : 'failed');
        })(); },
      },
    ],
    );
  };

  const confirmResetCoaching = () => {
    const token = deleteRunRef.current;
    const deleteData = coaching.deleteData;
    Alert.alert(
    t('privacyDeleteCoachingQuestion'),
    t('privacyDeleteCoachingBody'),
    [
      { text: t('cancel'), style: 'cancel' },
      { text: t('delete'), style: 'destructive', onPress: () => { void (async () => {
        if (token !== deleteRunRef.current) return;
        setDeleteResult('deleting');
        const ok = await deleteData();
        if (token === deleteRunRef.current) setDeleteResult(ok ? 'confirmed' : 'failed');
      })(); } },
    ]
    );
  };

  const confirmReset = () => {
    const token = deleteRunRef.current;
    const operations = [resetLocalState, opening.forgetMemory, coaching.deleteData, interaction.deleteData];
    Alert.alert(
    t('deleteQuestion'),
    t('privacyDeleteLocalDescription'),
    [
      { text: t('cancel'), style: 'cancel' },
      { text: t('delete'), style: 'destructive', onPress: () => { void (async () => {
        if (token !== deleteRunRef.current) return;
        setDeleteResult('deleting');
        const results = await Promise.all(operations.map(operation => operation()));
        if (token !== deleteRunRef.current) return;
        setDeleteResult(summarizeLocalDeleteResults(results));
      })(); } },
    ],
    );
  };

  const ownerReady = ownerSession.state === 'ready' && !ownerSession.localVerification;
  const privateUnreadable = opening.unreadableDataPreserved || coaching.unreadableDataPreserved
    || interaction.unreadableDataPreserved;
  const deleteStatusText = deleteResult === 'confirmed' ? t('privacyDeleteConfirmed')
    : deleteResult === 'partial' ? t('privacyDeletePartial')
      : deleteResult === 'failed' ? t('privacyDeleteFailed')
        : deleteResult === 'deleting' ? t('statusSaving') : null;

  const persistenceLabel = persistenceStatus === 'loading'
    ? t('statusSaving')
    : persistenceStatus === 'error'
      ? t('statusError')
      : t('statusReady');

  const identityBody = ownerSession.state === 'ready'
    ? t('identityReadyBody')
    : ownerSession.state === 'verifying'
      ? t('identityVerifyingBody')
      : t('identityLockedBody');

  const signInWithApple = async () => {
    setIdentityNotice(null);
    const result = await ownerSession.signIn();
    if (result === 'cancelled') setIdentityNotice('identityCancelled');
    if (result === 'unavailable') setIdentityNotice('identityUnavailable');
  };

  const logout = async () => {
    if (ownerSession.localVerification && !ownerSession.localVerification.isCurrent()) return;
    setIdentityNotice(null);
    if (await ownerSession.logout() === 'remote-unavailable') setIdentityNotice('identityLogoutUnavailable');
  };

  return (
    <Screen>
      {welcome.goalSettingsSuspended && settingsRouteActive ? <ActionButton testID="privacy-return-to-goal"
        label={t('privacyReturnToGoal')} onPress={() => { router.replace('/'); welcome.returnToGoal(); }} secondary /> : null}
      <M7CompletedReportCard snapshot={m7History.snapshot} locale={locale} color={colors.foreground} border={colors.border} />
      <Header eyebrow="100" title={t('settings')} subtitle={t('settingsSubtitle')} icon="settings" />

      <SectionLabel>{t('language')}</SectionLabel>
      <Card>
        <Row icon="globe" title={t('language')} body={t('languageBody')} />
        <Text style={[styles.currentLanguage, { color: colors.mutedForeground }]}>{t('currentLanguage', { locale: localeCode })}</Text>
        <View style={styles.languageRow}>
          <ActionButton testID="language-vi" label="Tiếng Việt" onPress={() => setLocale('vi')}
            secondary={locale !== 'vi'} disabled={locale === 'vi'} />
          <ActionButton testID="language-en" label="English" onPress={() => setLocale('en')}
            secondary={locale !== 'en'} disabled={locale === 'en'} />
          {RELEASE_LOCALE_OPTIONS.filter(option => option.id !== 'vi' && option.id !== 'en').map(option => (
            <ActionButton key={option.id} testID={`language-${option.id}`} label={option.nativeName}
              onPress={() => setDisplayLocale(option.id as ReleaseLocale)} secondary={locale !== option.id} disabled={locale === option.id} />
          ))}
        </View>
      </Card>

      <SectionLabel>{t('identityControl')}</SectionLabel>
      <Card>
        <Row icon="feather" title={ownerSession.localVerification ? localVerificationCopy(locale).title : t('identityContinuityTitle')}
          body={ownerSession.localVerification ? localVerificationCopy(locale).body : identityBody} />
        {ownerSession.state === 'ready' ? (
          <ActionButton testID="identity-logout" label={t('identityLogout')} onPress={() => { void logout(); }} secondary />
        ) : ownerSession.canSignInWithApple ? (
          <ActionButton testID="identity-sign-in-apple" label={t('identitySignInApple')} onPress={() => { void signInWithApple(); }} disabled={ownerSession.state === 'verifying'} />
        ) : null}
        {identityNotice ? <Text style={[styles.status, { color: colors.mutedForeground }]}>{t(identityNotice)}</Text> : null}
      </Card>

      <Card>
        <Row icon="hard-drive" title={t('privacySummaryTitle')} body={t('privacySummaryBody')} />
        <Text style={[styles.status, { color: colors.mutedForeground }]}>{t('privacyOwnerBoundary')}</Text>
        <Text style={[styles.status, { color: colors.mutedForeground }]}>{t('privacyLegacyBoundary')}</Text>
        {!ownerReady ? <Text style={[styles.status, { color: colors.destructive }]}>{t('privacyLockedState')}</Text> : null}
        {privateUnreadable ? <Text style={[styles.status, { color: colors.destructive }]}>{t('privacyUnreadableState')}</Text> : null}
        <Text style={[styles.status, { color: interaction.unreadableDataPreserved ? colors.destructive : colors.mutedForeground }]}>
          {interaction.unreadableDataPreserved
            ? t('interactionUnreadableBody')
            : t('privacyExternalAiBoundary')}
        </Text>
      </Card>

      <Card>
        <Row icon="image" title={t('welcomeReview')} body={t('welcomeReviewBody')} />
        <ActionButton testID="review-welcome" label={t('welcomeReview')} onPress={showWelcome} secondary icon="sunrise" />
      </Card>


      <View testID="privacy-account-delete-section">
        <SectionLabel>{t('privacyAccountDeleteTitle')}</SectionLabel>
        <Card>
          <Row icon="trash-2" title={t('privacyAccountDeleteTitle')} body={t('privacyAccountDeleteBody')} />
          <ActionButton testID="privacy-account-delete-trigger" label={t(retryAccount?'privacyAccountDeleteRetry':'privacyAccountDeleteTrigger')}
            onPress={requestAccountDelete} disabled={accountBusy||accountPhase==='REQUESTING'||(!canRequestAccount&&!retryAccount)||typeof ownerSession.eraseAccount!=='function'} secondary icon="trash-2" />
          {accountConfirmation&&(accountConfirmation==='RETRY'?retryAccount:accountConfirmation===ownerSession.erasureScope&&canRequestAccount)?(
            <View accessibilityRole="alert" testID="privacy-account-delete-confirmation">
              <Text style={[styles.status,{color:colors.foreground}]}>{t('privacyAccountDeleteConfirmTitle')}</Text>
              <Text style={[styles.status,{color:colors.mutedForeground}]}>{t('privacyAccountDeleteConfirmBody')}</Text>
              <ActionButton testID="privacy-account-delete-confirm" label={t('privacyAccountDeleteConfirm')} disabled={accountBusy} onPress={()=>{void confirmAccountDelete();}} />
              <ActionButton testID="privacy-account-delete-cancel" label={t('privacyAccountDeleteCancel')} disabled={accountBusy} onPress={()=>setAccountConfirmation(undefined)} secondary />
            </View>
          ):null}
          <Text testID="privacy-account-delete-status" accessibilityRole="alert" accessibilityLiveRegion="polite"
            style={[styles.status,{color:accountError||accountPhase==='QUARANTINED'?colors.destructive:colors.mutedForeground}]}>{accountStatus?t(accountStatus):''}</Text>
        </Card>
      </View>
      <View testID="privacy-wellness-disclosure">
        <Card><Row icon="heart" title={t('privacyWellnessTitle')} body={t('privacyWellnessBody')} /></Card>
      </View>
      <View testID="privacy-ai-ephemeral-disclosure">
        <Card><Row icon="feather" title={t('privacyAiEphemeralTitle')} body={t('privacyAiEphemeralBody')} /></Card>
      </View>

      <View testID="privacy-wearable-gateway-section" style={styles.wearableGateway}>
        <SectionLabel>{t('wearableGatewayTitle')}</SectionLabel>
        <Card>
          <Row icon="activity" title={t('wearableGatewayTitle')} body={t('wearableGatewayBody')} />
          <Text style={[styles.wearableProtection,{color:colors.foreground}]}>{t('wearableGatewayScope')}</Text>
          <Text style={[styles.wearableProtection,{color:colors.foreground}]}>{t('wearableGatewayUncertainty')}</Text>
          <Text style={[styles.wearableProtection,{color:colors.foreground}]}>{t('wearableGatewayRevoke')}</Text>
          <Text testID="privacy-wearable-gateway-status" style={[styles.wearableStatus,{color:colors.foreground,borderColor:colors.border,backgroundColor:colors.secondary}]}>{t('wearableGatewayOff')}</Text>
          <ActionButton testID="privacy-wearable-clear-session" label={t('wearableGatewayClear')} disabled={!ownerSession.wearable} onPress={()=>ownerSession.wearable?.clearSession()} secondary />
        </Card>
      </View>

      <SectionLabel>{t('privacyDataControlTitle')}</SectionLabel>
      <Card>
        <Row icon="book" title={t('privacyLocalDataTitle')} body={t('privacyLocalDataBody')} />
        {coaching.state.status !== 'idle' ? (
          <View style={{ marginTop: 10, padding: 12, backgroundColor: colors.secondary, borderRadius: 8, marginBottom: 12 }}>
            <Text style={{ fontSize: 13, color: colors.foreground, fontWeight: 'bold' }}>{phaseLabel}</Text>
            <Text style={{ fontSize: 13, color: colors.mutedForeground, marginTop: 6 }}>{t('privacyYourWords')}{coaching.state.freeformStory || t('privacyNothingSaved')}</Text>
            <Text style={{ fontSize: 13, color: colors.mutedForeground, marginTop: 6 }}>{t('privacyCurrentDirection')}{pathLabel}</Text>
            <Text style={{ fontSize: 13, color: colors.mutedForeground, marginTop: 6 }}>{t('privacyInterpretationSource')}{sourceLabel}</Text>
          </View>
        ) : (
          <Text style={{ fontSize: 13, color: colors.mutedForeground, marginTop: 10, marginBottom: 12 }}>{phaseLabel}</Text>
        )}
        <ActionButton testID="settings-change-coaching-direction" label={t('privacyChangeCoachingDirection')} onPress={() => { coaching.changeDirection(); router.push('/'); }} secondary disabled={!ownerReady || coaching.ownerStorageState === 'ERROR'} />
        <ActionButton testID="forget-coaching" label={t('privacyDeleteCoachingData')} onPress={confirmResetCoaching} secondary icon="rotate-ccw" disabled={!ownerReady || deleteResult === 'deleting'} />
        <Text style={[styles.status, { color: coaching.persistenceStatus === 'error' ? colors.destructive : colors.mutedForeground }]}>
          {coaching.unreadableDataPreserved
            ? t('interactionUnreadableBody')
            : coaching.persistenceStatus === 'error'
            ? t('privacyCoachingSaveFailed')
            : t('privacyStoredLocally')}
        </Text>

        <Row icon="rotate-ccw" title={t('openingForget')} body={t('openingForgetBody')} />
        <ActionButton testID="forget-opening" label={t('openingForget')} onPress={confirmForgetOpening} secondary icon="rotate-ccw" disabled={!ownerReady || deleteResult === 'deleting'} />
        <Row icon="trash-2" title={t('deleteData')} body={t('privacyDeleteLocalDescription')} />
        <ActionButton label={t('deleteData')} onPress={confirmReset} secondary icon="trash-2" disabled={!ownerReady || deleteResult === 'deleting'} />
        {deleteStatusText ? <Text style={[styles.status, { color: deleteResult === 'confirmed' ? colors.mutedForeground : colors.destructive }]}>{deleteStatusText}</Text> : null}
        <Text style={[styles.status, { color: colors.mutedForeground }]}>{t('privacyLocalDeleteBoundary')}</Text>
        <Text style={[styles.status, { color: persistenceStatus === 'error' ? colors.destructive : colors.mutedForeground }]}>{persistenceLabel}</Text>
      </Card>

      {__DEV__ ? (
        <>
          <SectionLabel>{t('validation')}</SectionLabel>
          <Card>
            <ActionButton label={t('openValidation')} onPress={() => router.push('/lab')} icon="tool" />
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  wearableGateway: {gap:10,borderRadius:24},
  wearableProtection: {fontSize:14,lineHeight:22,marginTop:10,paddingLeft:12,borderLeftWidth:2,borderLeftColor:'#8FAE9B'},
  wearableStatus: {alignSelf:'flex-start',borderWidth:1,borderRadius:18,paddingHorizontal:14,paddingVertical:10,marginVertical:14,fontSize:13,lineHeight:20,fontWeight:'700'},
  currentLanguage: { fontSize: 12, marginTop: 2 },
  languageRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  status: { fontSize: 11, lineHeight: 16, marginTop: 10 },
});
