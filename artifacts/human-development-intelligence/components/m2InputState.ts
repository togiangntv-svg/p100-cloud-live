import type { M2View } from '../domain/m2';

// Ephemeral input only. A subject/permission lifecycle boundary retires its draft.
export type M2InputState = {
  subjectId: string;
  invalidated: boolean;
  text: string;
  heldView: M2View | null;
  heldLocale: string;
  pressing: boolean;
  pressedView: M2View | null;
};

export function createM2Input(subjectId: string, invalidated: boolean): M2InputState {
  return { subjectId, invalidated, text: '', heldView: null, heldLocale: '', pressing: false, pressedView: null };
}

export function syncM2Input(state: M2InputState, subjectId: string, invalidated: boolean): M2InputState {
  return state.subjectId === subjectId && state.invalidated === invalidated
    ? state : createM2Input(subjectId, invalidated);
}

export function editM2Input(state: M2InputState, text: string, view: M2View | null, locale: string): M2InputState {
  return { ...state, text, heldView: text ? view : null, heldLocale: locale };
}

export function pressM2Input(state: M2InputState, view: M2View | null): M2InputState {
  return { ...state, pressing: true, pressedView: view };
}

export function releaseM2Input(state: M2InputState): M2InputState {
  return state.pressing ? { ...state, pressing: false, pressedView: null } : state;
}

export function presentM2Input(state: M2InputState, proposed: M2View | null, locale: string): M2View | null {
  // Hold button identities until release/cancel; the hook disables stale actions.
  // Account deletion/switch or permission changes clear this hold in syncM2Input.
  if (state.pressing) return state.pressedView;
  if (!proposed) return null;
  return state.text && state.heldView?.subjectId === state.subjectId && state.heldLocale === locale
    ? state.heldView : proposed;
}

export type M2Press = { id: string; token: string | null; cancelled: boolean };
export function isM2PressCurrent(press: M2Press | null, rendered: M2View | null, latest: M2View | null, id: string): boolean {
  const token = rendered?.token ?? null;
  return (!press || (!press.cancelled && press.id === id && press.token === token))
    && token === (latest?.token ?? null);
}
