import { useColorScheme } from 'react-native';

export interface AppTheme {
  isDark: boolean;
  colors: {
    background: string;
    surface: string;
    surfaceElevated: string;
    surfaceMuted: string;
    ink: string;
    inkMuted: string;
    inkSubtle: string;
    border: string;
    accent: string;
    accentStrong: string;
    accentSoft: string;
    success: string;
    successSoft: string;
    warning: string;
    danger: string;
    dangerSoft: string;
    white: string;
    overlay: string;
  };
}

const lightColors: AppTheme['colors'] = {
  background: '#F7F6FA',
  surface: '#FFFFFF',
  surfaceElevated: '#FFFFFF',
  surfaceMuted: '#F0EEF5',
  ink: '#15131B',
  inkMuted: '#5E5968',
  inkSubtle: '#827C8E',
  border: '#E3DFEA',
  accent: '#7654FF',
  accentStrong: '#5835E8',
  accentSoft: '#EEE9FF',
  success: '#168A64',
  successSoft: '#E4F7F0',
  warning: '#A86700',
  danger: '#BC3545',
  dangerSoft: '#FCE8EB',
  white: '#FFFFFF',
  overlay: 'rgba(21, 19, 27, 0.07)',
};

const darkColors: AppTheme['colors'] = {
  background: '#0E0D13',
  surface: '#17151E',
  surfaceElevated: '#201D29',
  surfaceMuted: '#292532',
  ink: '#F8F6FC',
  inkMuted: '#C0BACB',
  inkSubtle: '#948DA0',
  border: '#373240',
  accent: '#9B84FF',
  accentStrong: '#B1A0FF',
  accentSoft: '#2D254D',
  success: '#5ED0A8',
  successSoft: '#163A30',
  warning: '#F2B755',
  danger: '#FF8290',
  dangerSoft: '#49252C',
  white: '#FFFFFF',
  overlay: 'rgba(0, 0, 0, 0.28)',
};

export function useAppTheme(): AppTheme {
  const isDark = useColorScheme() === 'dark';
  return { isDark, colors: isDark ? darkColors : lightColors };
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  hero: 48,
} as const;

export const radii = {
  sm: 10,
  md: 16,
  lg: 24,
  pill: 999,
} as const;
