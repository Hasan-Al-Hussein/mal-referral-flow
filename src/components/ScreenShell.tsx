import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useReferralRuntime } from '../application/ReferralRuntime';
import { useAppTheme } from '../theme/theme';

import { BrandHeader } from './BrandHeader';

import type { PropsWithChildren } from 'react';

export function ScreenShell({ children }: PropsWithChildren): React.JSX.Element {
  const { colors } = useAppTheme();
  const { coordinator } = useReferralRuntime();
  const { width } = useWindowDimensions();
  const horizontalPadding = width < 520 ? 18 : 28;
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingHorizontal: horizontalPadding },
        ]}
        keyboardShouldPersistTaps="handled"
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
  safe: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingBottom: 56 },
  maxWidth: { width: '100%', maxWidth: 1160, alignSelf: 'center' },
});
