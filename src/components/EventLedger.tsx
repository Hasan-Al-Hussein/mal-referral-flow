import { Feather } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { useReferralRuntime } from '../application/ReferralRuntime';
import { REQUIRED_REFERRAL_EVENTS, type ReferralEventName } from '../domain/analytics';
import { radii, useAppTheme } from '../theme/theme';

import { Button } from './Button';

const shortLabels: Record<ReferralEventName, string> = {
  referral_link_generated: 'Link generated',
  referral_link_shared: 'Link shared',
  referral_link_clicked: 'Link clicked',
  referral_signup_started: 'Signup started',
  referral_signup_completed: 'Signup completed',
  referral_link_generation_failed: 'Generation failed',
  referral_link_share_cancelled: 'Share cancelled',
  referral_link_share_failed: 'Share failed',
  referral_deeplink_resolution_failed: 'Link rejected',
  referral_code_rejected: 'Code rejected',
  referral_signup_failed: 'Signup failed',
  referral_duplicate_suppressed: 'Duplicate suppressed',
};

export function EventLedger(): React.JSX.Element {
  const { colors } = useAppTheme();
  const { events, clearLedger } = useReferralRuntime();
  const completedNames = new Set(
    events.filter(({ delivery }) => delivery === 'accepted').map(({ event }) => event.name),
  );

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.headingRow}>
        <View>
          <Text style={[styles.eyebrow, { color: colors.accentStrong }]}>LIVE CONTRACT</Text>
          <Text style={[styles.title, { color: colors.ink }]}>Referral event ledger</Text>
        </View>
        <View style={[styles.counter, { backgroundColor: colors.surfaceMuted }]}>
          <Text style={[styles.counterText, { color: colors.inkMuted }]}>{events.length}</Text>
        </View>
      </View>
      <Text style={[styles.description, { color: colors.inkMuted }]}>
        Every event includes referral_code, platform, flow_id and a stable event_id.
      </Text>

      <View style={styles.funnel}>
        {REQUIRED_REFERRAL_EVENTS.map((name, index) => {
          const complete = completedNames.has(name);
          return (
            <View key={name} style={styles.funnelItem}>
              <View
                style={[
                  styles.check,
                  { backgroundColor: complete ? colors.successSoft : colors.surfaceMuted },
                ]}
              >
                <Feather
                  name={complete ? 'check' : 'circle'}
                  color={complete ? colors.success : colors.inkSubtle}
                  size={14}
                />
              </View>
              <View style={styles.funnelCopy}>
                <Text style={[styles.funnelLabel, { color: colors.ink }]}>{shortLabels[name]}</Text>
                <Text style={[styles.funnelIndex, { color: colors.inkSubtle }]}>0{index + 1}</Text>
              </View>
            </View>
          );
        })}
      </View>

      {events.length ? (
        <View style={[styles.log, { borderTopColor: colors.border }]}>
          {events.slice(0, 5).map(({ event, delivery, sequence }) => {
            const isFailure = event.name.includes('failed') || event.name.includes('rejected');
            return (
              <View key={`${sequence}-${event.properties.event_id}`} style={styles.logRow}>
                <View
                  style={[
                    styles.eventDot,
                    {
                      backgroundColor:
                        delivery === 'duplicate'
                          ? colors.warning
                          : isFailure
                            ? colors.danger
                            : colors.success,
                    },
                  ]}
                />
                <View style={styles.logCopy}>
                  <Text numberOfLines={1} style={[styles.logName, { color: colors.ink }]}>
                    {event.name}
                  </Text>
                  <Text numberOfLines={1} style={[styles.logMeta, { color: colors.inkSubtle }]}>
                    {event.properties.referral_code} · {event.properties.platform} · {delivery}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      ) : (
        <View style={[styles.empty, { backgroundColor: colors.surfaceMuted }]}>
          <Feather name="activity" color={colors.inkSubtle} size={18} />
          <Text style={[styles.emptyText, { color: colors.inkMuted }]}>Events will appear here as you test.</Text>
        </View>
      )}
      {events.length ? (
        <Button label="Clear visible log" variant="ghost" onPress={clearLedger} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radii.lg, padding: 22, gap: 18 },
  headingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  eyebrow: { fontSize: 10, lineHeight: 14, fontWeight: '800', letterSpacing: 1.2 },
  title: { marginTop: 3, fontSize: 19, lineHeight: 24, fontWeight: '700' },
  counter: { minWidth: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  counterText: { fontSize: 12, fontWeight: '800' },
  description: { fontSize: 13, lineHeight: 19 },
  funnel: { gap: 10 },
  funnelItem: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 11 },
  check: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  funnelCopy: { flex: 1, flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  funnelLabel: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  funnelIndex: { fontSize: 11, lineHeight: 18, fontVariant: ['tabular-nums'] },
  log: { borderTopWidth: 1, paddingTop: 15, gap: 12 },
  logRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  eventDot: { width: 7, height: 7, borderRadius: 4, marginTop: 6 },
  logCopy: { flex: 1 },
  logName: { fontSize: 12, lineHeight: 17, fontWeight: '600' },
  logMeta: { marginTop: 1, fontSize: 10, lineHeight: 14 },
  empty: { padding: 16, borderRadius: radii.md, flexDirection: 'row', alignItems: 'center', gap: 10 },
  emptyText: { flex: 1, fontSize: 12, lineHeight: 17 },
  indicator: { width: 0 },
});
