import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type AccessibilityState,
  type ViewStyle,
} from 'react-native';

import { useReducedMotion } from '../motion/MotionProvider';
import { motion, radii, typography, useAppTheme } from '../theme/theme';

interface ButtonProps {
  label: string;
  onPress(): void;
  icon?: keyof typeof Feather.glyphMap;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  accessibilityHint?: string;
  accessibilityState?: AccessibilityState;
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
  accessibilityState,
  style,
}: ButtonProps): React.JSX.Element {
  const { colors } = useAppTheme();
  const reducedMotion = useReducedMotion();
  const [scale] = useState(() => new Animated.Value(1));
  const [focused, setFocused] = useState(false);
  const isPrimary = variant === 'primary';
  const isDanger = variant === 'danger';
  const inactive = disabled || loading;
  const backgroundColor = isDanger
    ? colors.dangerSoft
    : variant === 'secondary'
      ? colors.surfaceGlass
      : variant === 'ghost'
        ? 'transparent'
        : colors.ctaStart;
  const foregroundColor = isPrimary
    ? colors.white
    : isDanger
      ? colors.danger
      : variant === 'secondary'
        ? colors.ink
        : colors.inkMuted;

  useEffect(() => {
    if (reducedMotion) {
      scale.stopAnimation();
      scale.setValue(1);
    }

    return () => scale.stopAnimation();
  }, [reducedMotion, scale]);

  const pressIn = () => {
    if (reducedMotion) return;
    scale.stopAnimation();
    Animated.timing(scale, {
      toValue: 0.975,
      duration: motion.press,
      easing: motion.easeOut,
      useNativeDriver: motion.nativeDriver,
    }).start();
  };

  const pressOut = () => {
    scale.stopAnimation();
    if (reducedMotion) {
      scale.setValue(1);
      return;
    }
    Animated.spring(scale, {
      toValue: 1,
      damping: 18,
      stiffness: 260,
      mass: 0.7,
      useNativeDriver: motion.nativeDriver,
    }).start();
  };

  return (
    <Animated.View
      style={[
        styles.motionFrame,
        fullWidth && styles.fullWidth,
        focused && { borderColor: colors.accent },
        { transform: [{ scale }] },
        style,
      ]}
    >
      <Pressable
        aria-expanded={accessibilityState?.expanded}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ ...accessibilityState, disabled: inactive, busy: loading }}
        android_ripple={isPrimary ? { color: 'rgba(255,255,255,0.18)' } : undefined}
        disabled={inactive}
        onBlur={() => setFocused(false)}
        onFocus={() => setFocused(true)}
        onPress={onPress}
        onPressIn={pressIn}
        onPressOut={pressOut}
        style={({ pressed }) => [
          styles.base,
          {
            backgroundColor,
            borderColor:
              variant === 'secondary'
                ? colors.borderStrong
                : isDanger
                  ? colors.danger
                  : backgroundColor,
            opacity: pressed && reducedMotion ? 0.8 : 1,
          },
          fullWidth && styles.fullWidth,
          inactive && styles.disabled,
        ]}
      >
        {isPrimary ? (
          <LinearGradient
            colors={[colors.ctaStart, colors.ctaEnd]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            pointerEvents="none"
            style={StyleSheet.absoluteFill}
          />
        ) : null}
        <View style={[styles.content, loading && styles.loadingContent]}>
          {icon ? <Feather name={icon} color={foregroundColor} size={18} /> : null}
          <Text style={[styles.label, { color: foregroundColor }]}>{label}</Text>
        </View>
        {loading ? <ActivityIndicator color={foregroundColor} size="small" style={styles.loader} /> : null}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  motionFrame: {
    borderWidth: 2,
    borderColor: 'transparent',
    borderRadius: radii.pill,
    alignSelf: 'flex-start',
  },
  base: {
    minHeight: 50,
    paddingHorizontal: 21,
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    cursor: Platform.OS === 'web' ? 'pointer' : undefined,
  },
  fullWidth: { width: '100%' },
  content: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  loadingContent: { opacity: 0 },
  loader: { position: 'absolute' },
  label: {
    fontFamily: typography.family,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    letterSpacing: 0.05,
  },
  disabled: { opacity: 0.46, cursor: Platform.OS === 'web' ? 'auto' : undefined },
});
