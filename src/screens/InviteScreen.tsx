import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { useReferralRuntime } from '../application/ReferralRuntime';
import { Button } from '../components/Button';
import { EventLedger } from '../components/EventLedger';
import { PageIntro } from '../components/PageIntro';
import { ScreenShell } from '../components/ScreenShell';
import { StatusBanner } from '../components/StatusBanner';
import { radii, useAppTheme } from '../theme/theme';

import type { GeneratedReferral } from '../application/ReferralCoordinator';
import type { RootStackParamList } from '../navigation/types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

type Props = NativeStackScreenProps<RootStackParamList, 'Invite'>;
type Notice = { tone: 'info' | 'success' | 'error'; title: string; message: string };

const MOCK_USER = { id: 'member_0194', name: 'Hasan', initials: 'HA' };
const REVIEW_CODE = 'MAL-H7K9P2Q4';

export function InviteScreen({ navigation }: Props): React.JSX.Element {
  const { colors } = useAppTheme();
  const { width } = useWindowDimensions();
  const isWide = width >= 880;
  const { coordinator, clearLedger } = useReferralRuntime();
  const [referral, setReferral] = useState<GeneratedReferral | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const displayCode = referral?.referralCode ?? 'YOUR CODE';
  const architectureLabel = useMemo(
    () => (coordinator.integrationMode === 'native' ? 'Branch + Firebase' : 'Deterministic web adapters'),
    [coordinator.integrationMode],
  );

  const generate = async () => {
    setNotice(null);
    setIsGenerating(true);
    try {
      const generated = await coordinator.generateReferral(MOCK_USER.id);
      setReferral(generated);
      setNotice({
        tone: 'success',
        title: 'Referral link ready',
        message: 'The code is stable for this member and the generated event was recorded once.',
      });
    } catch (error) {
      setNotice({
        tone: 'error',
        title: 'Could not generate the link',
        message: error instanceof Error ? error.message : 'Please try again.',
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const share = async () => {
    if (!referral) return;
    setNotice(null);
    setIsSharing(true);
    const result = await coordinator.shareReferral(referral);
    setIsSharing(false);
    if (result.status === 'shared') {
      setNotice({
        tone: 'success',
        title: result.channel === 'clipboard' ? 'Invite copied' : 'Invite handed to share sheet',
        message:
          result.channel === 'clipboard'
            ? 'Web Share is unavailable here, so the complete invite was copied to your clipboard.'
            : 'The shared event was recorded only after the share action completed.',
      });
    } else if (result.status === 'cancelled') {
      setNotice({ tone: 'info', title: 'Share cancelled', message: 'No success event was recorded.' });
    } else {
      setNotice({ tone: 'error', title: 'Share failed', message: result.reason });
    }
  };

  const simulate = (kind: 'direct' | 'deferred' | 'invalid') => {
    setNotice(null);
    coordinator.simulateLink(kind, referral?.referralCode ?? REVIEW_CODE);
    if (kind === 'invalid') {
      setNotice({
        tone: 'error',
        title: 'Malformed link safely rejected',
        message: 'The app stayed on this screen and emitted explicit resolution failure events.',
      });
    }
  };

  const reset = async () => {
    await coordinator.resetDemoState();
    clearLedger();
    setReferral(null);
    setNotice({
      tone: 'info',
      title: 'Test state cleared',
      message: 'Attribution, milestone dedupe and the visible event ledger were reset.',
    });
    navigation.popToTop();
  };

  return (
    <ScreenShell>
      <View style={styles.page}>
        {coordinator.integrationMode === 'web-demo' ? (
          <StatusBanner
            tone="info"
            title="Interactive reviewer build"
            message="This browser build exercises the same state machine and analytics contract. Native Branch install attribution and Firebase delivery require the documented custom build."
          />
        ) : null}

        <PageIntro
          eyebrow="MEMBER REFERRALS"
          title="Invite someone into better banking."
          description="Generate a private referral link, share it natively, and watch the attributed signup journey end to end."
        />

        <View style={[styles.columns, !isWide && styles.stacked]}>
          <View style={styles.mainColumn}>
            <View style={[styles.identity, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={[styles.avatar, { backgroundColor: colors.accentSoft }]}>
                <Text style={[styles.avatarText, { color: colors.accentStrong }]}>{MOCK_USER.initials}</Text>
              </View>
              <View style={styles.identityCopy}>
                <Text style={[styles.signedIn, { color: colors.success }]}>AUTHENTICATED MEMBER</Text>
                <Text style={[styles.userName, { color: colors.ink }]}>Signed in as {MOCK_USER.name}</Text>
              </View>
              <Feather name="shield" color={colors.success} size={20} />
            </View>

            <LinearGradient
              colors={colors.ink === '#15131B' ? ['#201638', '#4B2E96'] : ['#251B43', '#5237A3']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.pass}
            >
              <View style={styles.passGlow} />
              <View style={styles.passTop}>
                <View>
                  <Text style={styles.passEyebrow}>MAL MEMBER PASS</Text>
                  <Text style={styles.passTitle}>A warmer welcome.</Text>
                </View>
                <View style={styles.passIcon}>
                  <Feather name="gift" color="#FFFFFF" size={21} />
                </View>
              </View>
              <View>
                <Text style={styles.codeLabel}>REFERRAL CODE</Text>
                <Text selectable style={styles.code}>{displayCode}</Text>
              </View>
              <Text style={styles.passFinePrint}>Unique to member · destination locked · attribution protected</Text>
            </LinearGradient>

            <View style={styles.buttonRow}>
              {!referral ? (
                <Button
                  label="Generate my link"
                  icon="zap"
                  loading={isGenerating}
                  onPress={() => void generate()}
                  fullWidth={!isWide}
                />
              ) : (
                <>
                  <Button
                    label="Share invite"
                    icon="share-2"
                    loading={isSharing}
                    onPress={() => void share()}
                    fullWidth={!isWide}
                  />
                  <Button
                    label="Link generated"
                    icon="check"
                    variant="secondary"
                    disabled
                    onPress={() => undefined}
                    fullWidth={!isWide}
                  />
                </>
              )}
            </View>

            {referral ? (
              <View style={[styles.linkBox, { backgroundColor: colors.surfaceMuted }]}>
                <Feather name="link" color={colors.accentStrong} size={17} />
                <Text selectable numberOfLines={2} style={[styles.link, { color: colors.inkMuted }]}>
                  {referral.url}
                </Text>
              </View>
            ) : null}
            {notice ? <StatusBanner {...notice} /> : null}

            <View style={[styles.lab, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.labHeader}>
                <View>
                  <Text style={[styles.labEyebrow, { color: colors.accentStrong }]}>REVIEWER LAB</Text>
                  <Text style={[styles.labTitle, { color: colors.ink }]}>Exercise attribution edge cases</Text>
                </View>
                <Feather name="sliders" color={colors.inkSubtle} size={20} />
              </View>
              <Text style={[styles.labDescription, { color: colors.inkMuted }]}>
                Direct and deferred controls feed Branch-shaped payloads through the production parser. The deferred control represents the callback received on first launch after installation.
              </Text>
              <View style={styles.labButtons}>
                <Button label="Direct open" icon="corner-down-right" variant="secondary" onPress={() => simulate('direct')} />
                <Button label="Deferred first launch" icon="download-cloud" variant="secondary" onPress={() => simulate('deferred')} />
                <Button label="Invalid payload" icon="shield-off" variant="danger" onPress={() => simulate('invalid')} />
              </View>
              <View style={[styles.techRow, { borderTopColor: colors.border }]}>
                <Text style={[styles.techText, { color: colors.inkSubtle }]}>{architectureLabel}</Text>
                <Text style={[styles.techText, { color: colors.inkSubtle }]}>{Platform.OS} · idempotent milestones</Text>
              </View>
              <Button label="Reset test state" icon="refresh-cw" variant="ghost" onPress={() => void reset()} />
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

const styles = StyleSheet.create({
  page: { paddingTop: 28, gap: 32 },
  columns: { flexDirection: 'row', alignItems: 'flex-start', gap: 28 },
  stacked: { flexDirection: 'column' },
  mainColumn: { flex: 1.65, minWidth: 0, gap: 16 },
  sideColumn: { flex: 1, minWidth: 280, width: '100%' },
  identity: { borderWidth: 1, borderRadius: radii.md, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 13, fontWeight: '800' },
  identityCopy: { flex: 1 },
  signedIn: { fontSize: 9, lineHeight: 13, fontWeight: '800', letterSpacing: 1 },
  userName: { marginTop: 2, fontSize: 14, lineHeight: 19, fontWeight: '700' },
  pass: { minHeight: 264, borderRadius: radii.lg, padding: 24, justifyContent: 'space-between', overflow: 'hidden' },
  passGlow: { position: 'absolute', width: 220, height: 220, borderRadius: 110, right: -65, top: -82, backgroundColor: 'rgba(184,161,255,0.16)' },
  passTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  passEyebrow: { color: '#CDBFFF', fontSize: 10, lineHeight: 14, fontWeight: '800', letterSpacing: 1.3 },
  passTitle: { color: '#FFFFFF', marginTop: 6, fontSize: 22, lineHeight: 28, fontWeight: '700' },
  passIcon: { width: 44, height: 44, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  codeLabel: { color: '#CDBFFF', fontSize: 10, lineHeight: 14, fontWeight: '800', letterSpacing: 1.2 },
  code: { color: '#FFFFFF', marginTop: 5, fontSize: 30, lineHeight: 38, fontWeight: '800', letterSpacing: 2 },
  passFinePrint: { color: 'rgba(255,255,255,0.67)', fontSize: 10, lineHeight: 15 },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  linkBox: { borderRadius: radii.md, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  link: { flex: 1, fontSize: 12, lineHeight: 18 },
  lab: { borderWidth: 1, borderRadius: radii.lg, padding: 22, gap: 16 },
  labHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  labEyebrow: { fontSize: 10, lineHeight: 14, fontWeight: '800', letterSpacing: 1.1 },
  labTitle: { marginTop: 3, fontSize: 18, lineHeight: 24, fontWeight: '700' },
  labDescription: { fontSize: 13, lineHeight: 20 },
  labButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  techRow: { borderTopWidth: 1, paddingTop: 14, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 },
  techText: { fontSize: 10, lineHeight: 15, fontWeight: '600' },
});
