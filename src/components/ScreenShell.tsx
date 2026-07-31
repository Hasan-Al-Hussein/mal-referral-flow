import { LinearGradient } from 'expo-linear-gradient';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useReferralRuntime } from '../application/ReferralRuntime';
import { useAppTheme } from '../theme/theme';

import { BrandHeader } from './BrandHeader';

import type { PropsWithChildren } from 'react';

export function ScreenShell({ children }: PropsWithChildren): React.JSX.Element {
  const { colors, isDark } = useAppTheme();
  const { coordinator } = useReferralRuntime();
  const { width } = useWindowDimensions();
  const horizontalPadding = width < 520 ? 18 : width < 900 ? 28 : 36;
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <LinearGradient
          colors={
            isDark
              ? ['#171020', colors.background, '#101826']
              : ['#E7EFF9', colors.background, '#F7F3FF']
          }
          locations={[0, 0.52, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <View
          style={[
            styles.atmosphere,
            styles.atmosphereTop,
            { backgroundColor: colors.brandBlue },
          ]}
        />
        <View
          style={[
            styles.atmosphere,
            styles.atmosphereBottom,
            { backgroundColor: colors.brandPink },
          ]}
        />
        <View style={[styles.orbitLine, { borderColor: colors.border }]} />
      </View>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingHorizontal: horizontalPadding }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.maxWidth}>
          <BrandHeader integrationMode={coordinator.integrationMode} />
          {children}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, overflow: 'hidden' },
  scrollContent: { flexGrow: 1, paddingBottom: 64 },
  maxWidth: { width: '100%', maxWidth: 1180, alignSelf: 'center' },
  atmosphere: { position: 'absolute', width: 360, height: 360, borderRadius: 180, opacity: 0.07 },
  atmosphereTop: { right: -130, top: -170 },
  atmosphereBottom: { left: -210, bottom: -220 },
  orbitLine: {
    position: 'absolute',
    width: 520,
    height: 520,
    borderRadius: 260,
    borderWidth: 1,
    right: -310,
    top: 160,
    opacity: 0.52,
  },
});
