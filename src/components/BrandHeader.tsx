import { Feather } from '@expo/vector-icons';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { radii, useAppTheme } from '../theme/theme';

interface BrandHeaderProps {
  integrationMode: 'native' | 'web-demo';
}

export function BrandHeader({ integrationMode }: BrandHeaderProps): React.JSX.Element {
  const { colors } = useAppTheme();
  const isDemo = integrationMode === 'web-demo';
  return (
    <View style={[styles.header, { borderBottomColor: colors.border }]}>
      <View style={styles.brandRow}>
        <View style={[styles.logo, { backgroundColor: colors.accent }]}>
          <Feather name="link-2" size={19} color={colors.white} />
        </View>
        <View>
          <Text style={[styles.brand, { color: colors.ink }]}>Mal</Text>
          <Text style={[styles.subbrand, { color: colors.inkSubtle }]}>Referral prototype</Text>
        </View>
      </View>
      <View
        accessibilityLabel={isDemo ? 'Web reviewer simulation' : 'Native SDK mode'}
        style={[
          styles.mode,
          { backgroundColor: isDemo ? colors.accentSoft : colors.successSoft },
        ]}
      >
        <View style={[styles.dot, { backgroundColor: isDemo ? colors.accent : colors.success }]} />
        <Text style={[styles.modeText, { color: isDemo ? colors.accentStrong : colors.success }]}>
          {isDemo ? `${Platform.OS.toUpperCase()} REVIEW MODE` : 'NATIVE SDK MODE'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: 76,
    width: '100%',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    paddingVertical: 12,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  logo: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brand: { fontSize: 19, lineHeight: 21, fontWeight: '800', letterSpacing: -0.4 },
  subbrand: { fontSize: 11, lineHeight: 15, fontWeight: '500' },
  mode: {
    minHeight: 30,
    borderRadius: radii.pill,
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  modeText: { fontSize: 10, lineHeight: 13, fontWeight: '800', letterSpacing: 0.7 },
});
