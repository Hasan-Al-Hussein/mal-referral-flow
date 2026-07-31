import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { useReferralRuntime } from '../application/ReferralRuntime';
import { Button } from '../components/Button';
import { EventLedger } from '../components/EventLedger';
import { PageIntro } from '../components/PageIntro';
import { ScreenShell } from '../components/ScreenShell';
import { StatusBanner } from '../components/StatusBanner';
import { radii, useAppTheme } from '../theme/theme';

import type { RootStackParamList } from '../navigation/types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

type Props = NativeStackScreenProps<RootStackParamList, 'Onboarding'>;

export function OnboardingScreen({ route, navigation }: Props): React.JSX.Element {
  const { attribution } = route.params;
  const { colors } = useAppTheme();
  const { width } = useWindowDimensions();
  const isWide = width >= 880;
  const { coordinator } = useReferralRuntime();
  const [hasStarted, setHasStarted] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const begin = async () => {
    setError(null);
    await coordinator.beginSignup(attribution.referralCode, attribution);
    setHasStarted(true);
  };

  const complete = async () => {
    setError(null);
    const normalizedEmail = email.trim().toLowerCase();
    if (!firstName.trim()) {
      setError('Enter your first name to continue.');
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      setError('Enter a valid email address to continue.');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await coordinator.completeSignup(
        attribution.referralCode,
        normalizedEmail,
        attribution,
      );
      navigation.replace('Success', result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Signup could not be completed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ScreenShell>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.page}>
          <Button label="Back to referral lab" icon="arrow-left" variant="ghost" onPress={() => navigation.navigate('Invite')} style={styles.backButton} />
          <PageIntro
            eyebrow={attribution.kind.includes('deferred') ? 'FIRST LAUNCH ATTRIBUTION' : 'REFERRED ONBOARDING'}
            title="Your invitation arrived safely."
            description="The referral was validated, persisted, and applied before this screen opened—even when authentication and navigation were not ready yet."
          />

          <View style={[styles.columns, !isWide && styles.stacked]}>
            <View style={styles.mainColumn}>
              <View style={[styles.appliedCard, { backgroundColor: colors.successSoft }]}>
                <View style={[styles.appliedIcon, { backgroundColor: colors.surface }]}>
                  <Feather name="check" color={colors.success} size={20} />
                </View>
                <View style={styles.appliedCopy}>
                  <Text style={[styles.appliedEyebrow, { color: colors.success }]}>REFERRAL PRE-APPLIED</Text>
                  <Text selectable style={[styles.appliedCode, { color: colors.ink }]}>{attribution.referralCode}</Text>
                  <Text style={[styles.appliedMeta, { color: colors.inkMuted }]}>
                    {attribution.kind.replace('-', ' ')} · destination allow-listed
                  </Text>
                </View>
                <Feather name="lock" color={colors.success} size={18} />
              </View>

              {!hasStarted ? (
                <View style={[styles.formCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <View style={[styles.stepBadge, { backgroundColor: colors.accentSoft }]}>
                    <Text style={[styles.stepBadgeText, { color: colors.accentStrong }]}>STEP 1 OF 2</Text>
                  </View>
                  <Text style={[styles.formTitle, { color: colors.ink }]}>Open your Mal account</Text>
                  <Text style={[styles.formDescription, { color: colors.inkMuted }]}>
                    Your referral stays attached through the signup flow. It is frozen when you begin so a later link cannot silently replace it.
                  </Text>
                  <View style={styles.trustList}>
                    <TrustRow icon="shield" label="Code validated before navigation" />
                    <TrustRow icon="save" label="Attribution persisted across restarts" />
                    <TrustRow icon="eye-off" label="No personal data in analytics events" />
                  </View>
                  <Button label="Start secure signup" icon="arrow-right" fullWidth onPress={() => void begin()} />
                </View>
              ) : (
                <View style={[styles.formCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <View style={[styles.stepBadge, { backgroundColor: colors.accentSoft }]}>
                    <Text style={[styles.stepBadgeText, { color: colors.accentStrong }]}>STEP 2 OF 2</Text>
                  </View>
                  <Text style={[styles.formTitle, { color: colors.ink }]}>A few details to continue</Text>
                  <Text style={[styles.formDescription, { color: colors.inkMuted }]}>
                    This prototype uses a local endpoint. No information leaves the device.
                  </Text>

                  <View style={styles.fields}>
                    <View style={styles.fieldGroup}>
                      <Text style={[styles.label, { color: colors.ink }]}>First name</Text>
                      <TextInput
                        accessibilityLabel="First name"
                        autoComplete="name-given"
                        autoCapitalize="words"
                        placeholder="Your first name"
                        placeholderTextColor={colors.inkSubtle}
                        value={firstName}
                        onChangeText={setFirstName}
                        style={[styles.input, { color: colors.ink, backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}
                      />
                    </View>
                    <View style={styles.fieldGroup}>
                      <Text style={[styles.label, { color: colors.ink }]}>Email address</Text>
                      <TextInput
                        accessibilityLabel="Email address"
                        autoComplete="email"
                        autoCapitalize="none"
                        keyboardType="email-address"
                        placeholder="you@example.com"
                        placeholderTextColor={colors.inkSubtle}
                        value={email}
                        onChangeText={setEmail}
                        style={[styles.input, { color: colors.ink, backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}
                      />
                    </View>
                    <View style={styles.fieldGroup}>
                      <Text style={[styles.label, { color: colors.ink }]}>Referral code</Text>
                      <View style={[styles.lockedInput, { backgroundColor: colors.successSoft, borderColor: colors.success }]}>
                        <Text selectable style={[styles.lockedCode, { color: colors.ink }]}>{attribution.referralCode}</Text>
                        <Feather name="lock" color={colors.success} size={16} />
                      </View>
                    </View>
                  </View>
                  {error ? <StatusBanner tone="error" title="Check this step" message={error} /> : null}
                  <Button label="Create demo account" icon="check-circle" loading={isSubmitting} fullWidth onPress={() => void complete()} />
                  <Text style={[styles.terms, { color: colors.inkSubtle }]}>By continuing, you are exercising a local assessment fixture—not creating a real financial account.</Text>
                </View>
              )}
            </View>
            <View style={styles.sideColumn}>
              <EventLedger />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </ScreenShell>
  );
}

function TrustRow({ icon, label }: { icon: keyof typeof Feather.glyphMap; label: string }): React.JSX.Element {
  const { colors } = useAppTheme();
  return (
    <View style={styles.trustRow}>
      <View style={[styles.trustIcon, { backgroundColor: colors.surfaceMuted }]}>
        <Feather name={icon} color={colors.accentStrong} size={15} />
      </View>
      <Text style={[styles.trustText, { color: colors.inkMuted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { paddingTop: 22, gap: 28 },
  backButton: { alignSelf: 'flex-start', paddingHorizontal: 4 },
  columns: { flexDirection: 'row', alignItems: 'flex-start', gap: 28 },
  stacked: { flexDirection: 'column' },
  mainColumn: { flex: 1.65, minWidth: 0, gap: 16 },
  sideColumn: { flex: 1, minWidth: 280, width: '100%' },
  appliedCard: { borderRadius: radii.lg, padding: 20, flexDirection: 'row', alignItems: 'center', gap: 14 },
  appliedIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  appliedCopy: { flex: 1 },
  appliedEyebrow: { fontSize: 9, lineHeight: 13, fontWeight: '800', letterSpacing: 1.1 },
  appliedCode: { marginTop: 4, fontSize: 22, lineHeight: 28, fontWeight: '800', letterSpacing: 1.1 },
  appliedMeta: { marginTop: 2, fontSize: 11, lineHeight: 16, textTransform: 'capitalize' },
  formCard: { borderWidth: 1, borderRadius: radii.lg, padding: 24, gap: 18 },
  stepBadge: { alignSelf: 'flex-start', borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 5 },
  stepBadgeText: { fontSize: 9, lineHeight: 13, fontWeight: '800', letterSpacing: 1 },
  formTitle: { fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.5 },
  formDescription: { fontSize: 14, lineHeight: 22 },
  trustList: { gap: 12, paddingVertical: 2 },
  trustRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  trustIcon: { width: 32, height: 32, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  trustText: { flex: 1, fontSize: 13, lineHeight: 18 },
  fields: { gap: 15 },
  fieldGroup: { gap: 7 },
  label: { fontSize: 12, lineHeight: 17, fontWeight: '700' },
  input: { minHeight: 52, borderRadius: radii.md, borderWidth: 1, paddingHorizontal: 15, fontSize: 15 },
  lockedInput: { minHeight: 52, borderRadius: radii.md, borderWidth: 1, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  lockedCode: { fontSize: 14, fontWeight: '700', letterSpacing: 0.7 },
  terms: { textAlign: 'center', fontSize: 10, lineHeight: 15 },
});
