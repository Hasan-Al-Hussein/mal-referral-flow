import { Feather } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';

import { radii, useAppTheme } from '../theme/theme';

interface ButtonProps {
  label: string;
  onPress(): void;
  icon?: keyof typeof Feather.glyphMap;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  accessibilityHint?: string;
  style?: ViewStyle;
}

export function Button({
  label,
  onPress,
  icon,
  variant = 'primary',
  loading = false,
  disabled = false,
  fullWidth = false,
  accessibilityHint,
  style,
}: ButtonProps): React.JSX.Element {
  const { colors, isDark } = useAppTheme();
  const isPrimary = variant === 'primary';
  const isDanger = variant === 'danger';
  const backgroundColor = isPrimary
    ? isDark
      ? '#6847DC'
      : colors.ink
    : isDanger
      ? colors.dangerSoft
      : variant === 'secondary'
        ? colors.surface
        : 'transparent';
  const foregroundColor = isPrimary
    ? colors.white
    : isDanger
      ? colors.danger
      : colors.ink;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor, borderColor: variant === 'secondary' ? colors.border : backgroundColor },
        fullWidth && styles.fullWidth,
        pressed && styles.interactive,
        (disabled || loading) && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={foregroundColor} size="small" />
      ) : (
        <>
          {icon ? <Feather name={icon} color={foregroundColor} size={18} /> : null}
          <Text style={[styles.label, { color: foregroundColor }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 50,
    paddingHorizontal: 20,
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  fullWidth: { width: '100%' },
  label: { fontSize: 15, lineHeight: 20, fontWeight: '700', letterSpacing: 0.1 },
  interactive: { opacity: 0.84, transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.5 },
});
