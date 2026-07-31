import { Feather } from '@expo/vector-icons';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { useReferralRuntime } from '../application/ReferralRuntime';
import { Button } from '../components/Button';
import { EventLedger } from '../components/EventLedger';
import { ScreenShell } from '../components/ScreenShell';
import { radii, useAppTheme } from '../theme/theme';

import type { RootStackParamList } from '../navigation/types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

type Props = NativeStackScreenProps<RootStackParamList, 'Success'>;

export function SuccessScreen({ route, navigation }: Props): React.JSX.Element {
  const { accountId, referralCode } = route.params;
  const { colors } = useAppTheme();
  const { width } = useWindowDimensions();
  const isWide = width >= 880;
  const { coordinator, clearLedger } = useReferralRuntime();

  const restart = async () => {
    await coordinator.resetDemoState();
    clearLedger();
    navigation.popToTop();
  };

  return (
    <ScreenShell>
      <View style={styles.page}>
        <View style={[styles.columns, !isWide && styles.stacked]}>
          <View style={styles.mainColumn}>
            <View style={[styles.successCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={[styles.successIcon, { backgroundColor: colors.successSoft }]}>
                <Feather name="check" color={colors.success} size={34} />
              </View>
              <Text style={[styles.eyebrow, { color: colors.success }]}>ATTRIBUTED SIGNUP COMPLETE</Text>
              <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>The full referral loop is closed.</Text>
              <Text style={[styles.description, { color: colors.inkMuted }]}>
                The mock account was created only after the frozen referral code was accepted. The completion event now carries the same flow identity as the original click.
              </Text>

              <View style={[styles.receipt, { backgroundColor: colors.surfaceMuted }]}>
                <ReceiptRow label="Referral code" value={referralCode} />
                <View style={[styles.divider, { backgroundColor: colors.border }]} />
                <ReceiptRow label="Demo account" value={accountId} />
                <View style={[styles.divider, { backgroundColor: colors.border }]} />
                <ReceiptRow label="Reward status" value="Server validation queued" />
              </View>

              <View style={[styles.note, { backgroundColor: colors.accentSoft }]}>
                <Feather name="server" color={colors.accentStrong} size={18} />
                <Text style={[styles.noteText, { color: colors.inkMuted }]}>
                  In production, reward issuance belongs to an idempotent backend ledger—not the mobile client.
                </Text>
              </View>
              <Button label="Run the flow again" icon="refresh-cw" fullWidth onPress={() => void restart()} />
            </View>
          </View>
          <View style={styles.sideColumn}>
            <EventLedger />
          </View>
        </View>
      </View>
    </ScreenShell>
  );
}

function ReceiptRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  const { colors } = useAppTheme();
  return (
    <View style={styles.receiptRow}>
      <Text style={[styles.receiptLabel, { color: colors.inkSubtle }]}>{label}</Text>
      <Text selectable style={[styles.receiptValue, { color: colors.ink }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { paddingTop: 52 },
  columns: { flexDirection: 'row', alignItems: 'flex-start', gap: 28 },
  stacked: { flexDirection: 'column' },
  mainColumn: { flex: 1.65, minWidth: 0 },
  sideColumn: { flex: 1, minWidth: 280, width: '100%' },
  successCard: { borderWidth: 1, borderRadius: radii.lg, padding: 30, alignItems: 'center', gap: 16 },
  successIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', marginBottom: 3 },
  eyebrow: { fontSize: 10, lineHeight: 14, fontWeight: '800', letterSpacing: 1.2, textAlign: 'center' },
  title: { maxWidth: 520, textAlign: 'center', fontSize: 34, lineHeight: 40, fontWeight: '800', letterSpacing: -1.1 },
  description: { maxWidth: 540, textAlign: 'center', fontSize: 14, lineHeight: 22 },
  receipt: { width: '100%', borderRadius: radii.md, padding: 17, gap: 12, marginTop: 6 },
  receiptRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 16 },
  receiptLabel: { fontSize: 11, lineHeight: 17 },
  receiptValue: { flexShrink: 1, textAlign: 'right', fontSize: 12, lineHeight: 17, fontWeight: '700' },
  divider: { height: StyleSheet.hairlineWidth },
  note: { width: '100%', borderRadius: radii.md, padding: 15, flexDirection: 'row', gap: 11, alignItems: 'flex-start' },
  noteText: { flex: 1, fontSize: 12, lineHeight: 18 },
});
