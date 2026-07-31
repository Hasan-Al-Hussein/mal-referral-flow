import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { radii, typography, useAppTheme } from '../theme/theme';

interface BrandHeaderProps {
  integrationMode: 'native' | 'web-demo';
}

export function BrandHeader({ integrationMode }: BrandHeaderProps): React.JSX.Element {
  const { colors, isDark, toggleTheme } = useAppTheme();
  const { width } = useWindowDimensions();
  const [themeFocused, setThemeFocused] = useState(false);
  const isCompact = width < 620;
  const isDemo = integrationMode === 'web-demo';

  return (
    <View style={[styles.header, { borderBottomColor: colors.border }]}>
      <View style={styles.brandRow}>
        <View style={[styles.logoTile, { backgroundColor: colors.brandMist }]}>
          <Image
            accessibilityLabel="Mal"
            resizeMode="contain"
            source={require('../../assets/mal-brand-lockup.png')}
            style={styles.logo}
          />
        </View>
        {!isCompact ? (
          <>
            <View style={[styles.divider, { backgroundColor: colors.borderStrong }]} />
            <View>
              <Text style={[styles.productName, { color: colors.ink }]}>Referral flow</Text>
              <Text style={[styles.productMeta, { color: colors.inkSubtle }]}>Growth engineering prototype</Text>
            </View>
          </>
        ) : null}
      </View>

      <View style={styles.actions}>
        <View
          accessibilityLabel={isDemo ? 'Web reviewer simulation' : 'Native SDK mode'}
          style={[
            styles.mode,
            {
              backgroundColor: isDemo ? colors.surfaceGlass : colors.successSoft,
              borderColor: isDemo ? colors.border : colors.success,
            },
          ]}
        >
          <View style={[styles.dot, { backgroundColor: isDemo ? colors.accent : colors.success }]} />
          <Text style={[styles.modeText, { color: isDemo ? colors.inkMuted : colors.success }]}>
            {isDemo ? (isCompact ? 'REVIEW' : `${Platform.OS.toUpperCase()} REVIEW`) : 'NATIVE SDK'}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Switch to ${isDark ? 'light' : 'dark'} theme`}
          hitSlop={4}
          onBlur={() => setThemeFocused(false)}
          onFocus={() => setThemeFocused(true)}
          onPress={toggleTheme}
          style={({ pressed }) => [
            styles.themeButton,
            {
              backgroundColor: colors.surfaceGlass,
              borderColor: themeFocused ? colors.accent : colors.border,
              opacity: pressed ? 0.72 : 1,
            },
          ]}
        >
          <Feather name={isDark ? 'sun' : 'moon'} size={17} color={colors.ink} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: 82,
    width: '100%',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 14,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', flexShrink: 1, gap: 13 },
  logoTile: {
    width: 116,
    height: 49,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  logo: { width: 110, height: 47 },
  divider: { width: StyleSheet.hairlineWidth, height: 32 },
  productName: {
    fontFamily: typography.family,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '700',
    letterSpacing: -0.1,
  },
  productMeta: {
    marginTop: 2,
    fontFamily: typography.family,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '500',
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  mode: {
    minHeight: 34,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  modeText: {
    fontFamily: typography.family,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '800',
    letterSpacing: 0.7,
  },
  themeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    cursor: Platform.OS === 'web' ? 'pointer' : undefined,
  },
});
