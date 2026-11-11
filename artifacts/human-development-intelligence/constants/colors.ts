/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const colors = {
  light: {
    // Legacy aliases (kept for backward compatibility)
    text: '#14243A',
    tint: '#B98542',

    // Core surfaces
    background: '#F7F3EA',
    foreground: '#14243A',

    // Cards / elevated surfaces
    card: '#FFFDF8',
    cardForeground: '#14243A',

    // Primary action color (buttons, links, active states)
    primary: '#18314F',
    primaryForeground: '#FFFDF8',

    // Secondary / less-emphasis interactive surfaces
    secondary: '#F1EADD',
    secondaryForeground: '#243A54',

    // Muted / subdued elements (dividers, timestamps, placeholders)
    muted: '#EEE7DB',
    mutedForeground: '#69717D',

    // Accent highlights (badges, selected items, focus rings)
    accent: '#DDE8E4',
    accentForeground: '#205248',

    // Destructive actions (delete, error states)
    destructive: '#A94B43',
    destructiveForeground: '#FBF9F4',

    // Borders and input outlines
    border: '#DDD5C8',
    input: '#DDD5C8',

    // Locked visual direction: deep navy, warm ivory, restrained antique gold.
    brandGold: '#B98542',
    brandGoldSoft: '#F1E4D0',
    destructiveSoft: '#F4DFDB',
    welcomeNavy: '#07162B',
    welcomeOverlay: 'rgba(7, 22, 43, 0.16)',
    welcomeLowerOverlay: 'rgba(7, 22, 43, 0.34)',
    welcomeText: '#FFFDF8',
    welcomeMuted: '#E8E4DC',
    welcomeButton: '#FFF9EE',
    welcomeButtonBorder: '#F3E6D0',
    welcomeButtonText: '#132A45',
    welcomeBorder: 'rgba(232, 228, 220, 0.24)',
    welcomeLogoFrame: 'rgba(232, 228, 220, 0.12)',
    welcomeLogoGlow: 'rgba(238, 244, 246, 0.34)',
    welcomeLogoBeam: 'rgba(255, 213, 132, 0.38)',
    welcomeLogoBeamCore: 'rgba(255, 244, 213, 0.72)',
    welcomeLogoSurface: '#020407',
    welcomeOpeningSky: 'rgba(7, 22, 43, 0.42)',
    welcomeOpeningMid: 'rgba(7, 22, 43, 0.12)',
    welcomeOpeningLower: 'rgba(7, 22, 43, 0.16)',
    welcomeGoalLight: 'rgba(255, 224, 164, 0.38)',
    welcomeGoalLightSoft: 'rgba(255, 245, 215, 0.3)',
    welcomeGoalClear: 'rgba(7, 22, 43, 0.02)',
    welcomeGoalSceneClear: 'rgba(7, 22, 43, 0)',
    welcomeGoalSceneFade: '#07121F',
    welcomeGoalAtmosphereClear: 'rgba(7, 22, 43, 0)',
    welcomeGoalAtmosphereMid: 'rgba(38, 37, 39, 0.12)',
    welcomeGoalAtmosphereBase: 'rgba(5, 13, 24, 0.5)',
    welcomeGoalPanel: 'rgba(4, 12, 24, 0.46)',
    welcomeGoalPanelBorder: 'rgba(255, 253, 248, 0.28)',
    welcomeGoalChip: 'rgba(255, 253, 248, 0.1)',
    welcomeGoalChipTop: 'rgba(255, 253, 248, 0.2)',
    welcomeGoalChipBottom: 'rgba(255, 253, 248, 0.07)',
    welcomeGoalChipBorder: 'rgba(255, 253, 248, 0.34)',
    welcomeGoalChipPressed: 'rgba(255, 236, 197, 0.22)',
    welcomeGoalChipSelected: 'rgba(255, 224, 164, 0.34)',
    welcomeGoalChipSelectedBottom: 'rgba(255, 203, 118, 0.18)',
    welcomeGoalInputShine: 'rgba(255, 248, 226, 0.64)',
    welcomeGoalInputBorder: 'rgba(255, 239, 201, 0.3)',
    welcomeGoalInputFocus: 'rgba(255, 216, 145, 0.72)',
    welcomeGoalInputShade: 'rgba(255, 255, 255, 0.12)',
    welcomeGoalHeaderSurface: 'rgba(4, 12, 24, 0.62)',
    welcomeGoalMenuSurface: 'rgba(8, 20, 36, 0.97)',
    welcomeGoalMenuBackdrop: 'rgba(2, 7, 15, 0.62)',
  },

  // Border radius (in px). Sync from the sibling web artifact's --radius
  // CSS variable. This value applies to cards, buttons, inputs, and modals.
  radius: 8,
};

export default colors;
