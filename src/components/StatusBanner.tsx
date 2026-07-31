import { Feather } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { radii, useAppTheme } from '../theme/theme';

interface StatusBannerProps {
  tone: 'info' | 'success' | 'error';
  title: string;
  message: string;
}

export function StatusBanner({ tone, title, message }: StatusBannerProps): React.JSX.Element {
  const { colors } = useAppTheme();
  const toneColor = tone === 'success' ? colors.success : tone === 'error' ? colors.danger : colors.accentStrong;
  const backgroundColor = tone === 'success' ? colors.successSoft : tone === 'error' ? colors.dangerSoft : colors.accentSoft;
  return (
    <View
      accessibilityRole={tone === 'error' ? 'alert' : 'summary'}
      style={[styles.container, { backgroundColor }]}
    >
      <Feather
        name={tone === 'success' ? 'check-circle' : tone === 'error' ? 'alert-circle' : 'info'}
        color={toneColor}
        size={19}
      />
      <View style={styles.copy}>
        <Text style={[styles.title, { color: toneColor }]}>{title}</Text>
        <Text style={[styles.message, { color: colors.inkMuted }]}>{message}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderRadius: radii.md, padding: 15, flexDirection: 'row', gap: 11 },
  copy: { flex: 1, gap: 2 },
  title: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
  message: { fontSize: 12, lineHeight: 18 },
});
