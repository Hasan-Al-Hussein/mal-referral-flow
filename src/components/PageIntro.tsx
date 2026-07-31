import { StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '../theme/theme';

interface PageIntroProps {
  eyebrow: string;
  title: string;
  description: string;
}

export function PageIntro({ eyebrow, title, description }: PageIntroProps): React.JSX.Element {
  const { colors } = useAppTheme();
  return (
    <View style={styles.container}>
      <Text style={[styles.eyebrow, { color: colors.accentStrong }]}>{eyebrow}</Text>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>
        {title}
      </Text>
      <Text style={[styles.description, { color: colors.inkMuted }]}>{description}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { maxWidth: 700, gap: 10 },
  eyebrow: { fontSize: 11, lineHeight: 15, fontWeight: '800', letterSpacing: 1.3 },
  title: { fontSize: 40, lineHeight: 46, fontWeight: '800', letterSpacing: -1.5 },
  description: { maxWidth: 650, fontSize: 16, lineHeight: 25 },
});
