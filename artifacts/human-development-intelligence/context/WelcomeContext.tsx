import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import {
  resolveWelcomeLaunch,
  shouldShowFirstWelcome,
  WELCOME_SEEN_VALUE,
  WELCOME_STORAGE_KEY,
} from '@/domain/welcome';

type WelcomeContextValue = {
  hydrated: boolean;
  visible: boolean;
  reviewing: boolean;
  resumeGoal: false;
  goalSettingsSuspended: boolean;
  goalSettingsActive: boolean;
  settingsReviewRunId: number;
  openGoalSettings: () => boolean;
  presentGoalSettings: (active: boolean) => void;
  returnToGoal: () => void;
  runId: number;
  completeWelcome: () => void;
  markWelcomeSeen: () => void;
  showWelcome: () => void;
  closeWelcome: () => void;
};

const WelcomeContext = createContext<WelcomeContextValue | null>(null);
const WELCOME_HYDRATION_DEADLINE_MS = 900;
export const FORCE_SLICE_PREVIEW_OPENING = __DEV__;

export function WelcomeProvider({ children }: { children: React.ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  const [firstWelcome, setFirstWelcome] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [runId, setRunId] = useState(0);
  const [returnFocus, setReturnFocus] = useState<(() => void) | null>(null);
  const [goalEntered, setGoalEntered] = useState(false);
  const [goalSettingsSuspended, setGoalSettingsSuspended] = useState(false);
  const [goalSettingsActive, setGoalSettingsActive] = useState(false);
  const [settingsReviewRunId, setSettingsReviewRunId] = useState(0);
  const [goalReturnFocus, setGoalReturnFocus] = useState<(() => void) | null>(null);

  useEffect(() => {
    let settled = false;
    const finishHydration = (shouldShow: boolean) => {
      if (settled) return;
      settled = true;
      setFirstWelcome(shouldShow);
      setHydrated(true);
    };
    const deadline = setTimeout(() => finishHydration(true), WELCOME_HYDRATION_DEADLINE_MS);

    // Device presentation only. Never read, import or delete personal legacy keys.
    AsyncStorage.getItem(WELCOME_STORAGE_KEY)
      .then((saved) => {
        if (settled) return;
        const launch = resolveWelcomeLaunch(
          FORCE_SLICE_PREVIEW_OPENING,
          shouldShowFirstWelcome(saved),
        );
        finishHydration(launch.showWelcome);
      })
      .catch(() => finishHydration(true))
      .finally(() => clearTimeout(deadline));

    return () => {
      settled = true;
      clearTimeout(deadline);
    };
  }, []);

  const value = useMemo<WelcomeContextValue>(() => ({
    hydrated,
    goalSettingsSuspended, goalSettingsActive, settingsReviewRunId,
    openGoalSettings: () => {
      if (!goalEntered || reviewing) return false;
      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        const active = document.activeElement;
        if (active instanceof HTMLElement) setGoalReturnFocus(() => () => { if (active.isConnected) active.focus(); });
      }
      setGoalSettingsSuspended(true);
      return true;
    },
    presentGoalSettings: (active) => setGoalSettingsActive(active),
    returnToGoal: () => {
      if (!goalSettingsSuspended || reviewing) return;
      setGoalSettingsActive(false); setGoalSettingsSuspended(false);
      if (goalReturnFocus) { setTimeout(goalReturnFocus, 0); setGoalReturnFocus(null); }
    },
    visible: firstWelcome || reviewing,
    reviewing,
    // No verified owner goal is supplied to Welcome; never infer a resume.
    resumeGoal: false,
    runId,
    completeWelcome: () => {
      setFirstWelcome(false);
      setReviewing(false);
      void AsyncStorage.setItem(WELCOME_STORAGE_KEY, WELCOME_SEEN_VALUE).catch(() => undefined);
    },
    markWelcomeSeen: () => {
      if (reviewing) return;
      setGoalEntered(true);
      void AsyncStorage.setItem(WELCOME_STORAGE_KEY, WELCOME_SEEN_VALUE).catch(() => undefined);
    },
    showWelcome: () => {
      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        const activeElement = document.activeElement;
        if (activeElement instanceof HTMLElement) {
          setReturnFocus(() => () => activeElement.focus());
        }
      }
      if (goalSettingsSuspended) setSettingsReviewRunId((current) => current + 1);
      else setRunId((current) => current + 1);
      setReviewing(true);
    },
    closeWelcome: () => {
      setReviewing(false);
      if (returnFocus) {
        setTimeout(returnFocus, 0);
        setReturnFocus(null);
      }
    },
  }), [firstWelcome, hydrated, reviewing, returnFocus, runId, goalEntered, goalSettingsSuspended, goalSettingsActive, settingsReviewRunId, goalReturnFocus]);

  return <WelcomeContext.Provider value={value}>{children}</WelcomeContext.Provider>;
}

export function useWelcome() {
  const value = useContext(WelcomeContext);
  if (!value) throw new Error('useWelcome must be used inside WelcomeProvider');
  return value;
}
