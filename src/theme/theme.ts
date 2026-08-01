import {
  createContext,
  createElement,
  type PropsWithChildren,
  useContext,
  useMemo,
  useState,
} from 'react';
import { Easing, Platform } from 'react-native';

export type ThemeMode = 'light' | 'dark';

export interface AppTheme {
  isDark: boolean;
  mode: ThemeMode;
  toggleTheme(): void;
  colors: {
    background: string;
    surface: string;
    surfaceElevated: string;
    surfaceMuted: string;
    surfaceGlass: string;
    ink: string;
    inkMuted: string;
    inkSubtle: string;
    border: string;
    borderStrong: string;
    accent: string;
    accentStrong: string;
    accentSoft: string;
    ctaStart: string;
    ctaEnd: string;
    brandMist: string;
    brandBlue: string;
    brandLilac: string;
    brandPink: string;
    success: string;
    successSoft: string;
    warning: string;
    warningSoft: string;
    danger: string;
    dangerSoft: string;
    white: string;
    black: string;
    overlay: string;
  };
}

const lightColors: AppTheme['colors'] = {
  background: '#F6F8FC',
  surface: '#FFFFFF',
  surfaceElevated: '#FFFFFF',
  surfaceMuted: '#EEF2F8',
  surfaceGlass: 'rgba(255, 255, 255, 0.84)',
  ink: '#373638',
  inkMuted: '#5E5B67',
  inkSubtle: '#6D6878',
  border: '#D9DEE8',
  borderStrong: '#8B93A3',
  accent: '#7032FF',
  accentStrong: '#4D1FC6',
  accentSoft: '#EEE8FF',
  ctaStart: '#5222C8',
  ctaEnd: '#2858B9',
  brandMist: '#D0DDEE',
  brandBlue: '#2A94D4',
  brandLilac: '#A67DFE',
  brandPink: '#A950DF',
  success: '#066B50',
  successSoft: '#E2F5EF',
  warning: '#7A4F00',
  warningSoft: '#FFF3D6',
  danger: '#A91F38',
  dangerSoft: '#FFE9EE',
  white: '#FFFFFF',
  black: '#121212',
  overlay: 'rgba(31, 24, 47, 0.08)',
};

const darkColors: AppTheme['colors'] = {
  background: '#0F0C17',
  surface: '#171320',
  surfaceElevated: '#201A2B',
  surfaceMuted: '#292234',
  surfaceGlass: 'rgba(23, 19, 32, 0.9)',
  ink: '#FAF8FF',
  inkMuted: '#C4BDCF',
  inkSubtle: '#AAA1B5',
  border: '#443850',
  borderStrong: '#7B6B88',
  accent: '#8D68FF',
  accentStrong: '#C5B7FF',
  accentSoft: '#2D2148',
  ctaStart: '#633ED6',
  ctaEnd: '#2854AE',
  brandMist: '#D0DDEE',
  brandBlue: '#67C6F5',
  brandLilac: '#B79CFF',
  brandPink: '#D58AF0',
  success: '#6DDEB8',
  successSoft: '#15382E',
  warning: '#F4C56A',
  warningSoft: '#41341D',
  danger: '#FF8DA1',
  dangerSoft: '#48212D',
  white: '#FFFFFF',
  black: '#121212',
  overlay: 'rgba(0, 0, 0, 0.34)',
};

const ThemeContext = createContext<AppTheme | null>(null);

export function AppThemeProvider({ children }: PropsWithChildren): React.JSX.Element {
  // Mal's public product language is light-first. Reviewers can still inspect the
  // independently designed dark theme from the header control.
  const [mode, setMode] = useState<ThemeMode>('light');
  const value = useMemo<AppTheme>(
    () => ({
      isDark: mode === 'dark',
      mode,
      toggleTheme: () => setMode((current) => (current === 'light' ? 'dark' : 'light')),
      colors: mode === 'dark' ? darkColors : lightColors,
    }),
    [mode],
  );

  return createElement(ThemeContext.Provider, { value }, children);
}

export function useAppTheme(): AppTheme {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useAppTheme must be used within AppThemeProvider');
  return value;
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  hero: 48,
  section: 64,
} as const;

export const radii = {
  sm: 10,
  md: 16,
  lg: 24,
  xl: 32,
  pill: 999,
} as const;

export const typography = {
  family: Platform.select({
    ios: 'System',
    android: 'sans-serif',
    default: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  }),
  mono: Platform.select({
    ios: 'Menlo',
    android: 'monospace',
    default: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
  }),
} as const;

export const motion = {
  press: 140,
  hoverIn: 180,
  hoverOut: 120,
  state: 200,
  feedback: 220,
  route: 320,
  reveal: 360,
  journey: 400,
  backdrop: 760,
  celebration: 720,
  stagger: 44,
  easeOut: Easing.bezier(0.16, 1, 0.3, 1),
  nativeDriver: Platform.OS !== 'web',
} as const;
