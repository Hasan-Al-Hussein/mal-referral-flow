import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { AnimatedReveal } from '../motion/AnimatedReveal';
import { motion, typography, useAppTheme } from '../theme/theme';

interface PageIntroProps {
  eyebrow: string;
  title: string;
  description: string;
}

export function PageIntro({ eyebrow, title, description }: PageIntroProps): React.JSX.Element {
  const { colors } = useAppTheme();
  const { width } = useWindowDimensions();
  const compact = width < 520;
  return (
    <View style={styles.container}>
      <AnimatedReveal duration={motion.feedback}>
        <View style={styles.eyebrowRow}>
          <View style={[styles.eyebrowDash, { backgroundColor: colors.accent }]} />
          <Text style={[styles.eyebrow, { color: colors.accentStrong }]}>{eyebrow}</Text>
        </View>
      </AnimatedReveal>
      <AnimatedReveal delay={motion.stagger}>
        <Text
          accessibilityRole="header"
          style={[
            styles.title,
            compact && styles.titleCompact,
            { color: colors.ink },
          ]}
        >
          {title}
        </Text>
      </AnimatedReveal>
      <AnimatedReveal delay={motion.stagger * 2}>
        <Text style={[styles.description, { color: colors.inkMuted }]}>{description}</Text>
      </AnimatedReveal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { maxWidth: 760, gap: 11 },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  eyebrowDash: { width: 28, height: 3, borderRadius: 2 },
  eyebrow: {
    fontFamily: typography.family,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '800',
    letterSpacing: 1.15,
  },
  title: {
    fontFamily: typography.family,
    fontSize: 46,
    lineHeight: 51,
    fontWeight: '800',
    letterSpacing: -1.65,
  },
  titleCompact: { fontSize: 36, lineHeight: 41, letterSpacing: -1.15 },
  description: {
    maxWidth: 680,
    fontFamily: typography.family,
    fontSize: 16,
    lineHeight: 25,
  },
});
