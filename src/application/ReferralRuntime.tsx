import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Platform } from 'react-native';

import { createAnalyticsClient } from '../services/analytics/analyticsClient';
import {
  AnalyticsTracker,
  type AnalyticsDelivery,
} from '../services/analytics/AnalyticsTracker';
import { createDeepLinkService } from '../services/deepLinks/deepLinkService';
import { createMockReferralApi } from '../services/referrals/mockReferralApi';
import { createShareService } from '../services/share/shareService';
import { referralStorage } from '../services/storage/referralStorage';

import { ReferralCoordinator } from './ReferralCoordinator';

import type { PlatformName, ReferralEventRecord } from '../domain/analytics';

export interface LedgerEntry {
  event: ReferralEventRecord;
  delivery: AnalyticsDelivery;
  sequence: number;
}

interface ReferralRuntimeValue {
  coordinator: ReferralCoordinator;
  events: LedgerEntry[];
  clearLedger(): void;
}

const ReferralRuntimeContext = createContext<ReferralRuntimeValue | null>(null);

function currentPlatform(): PlatformName {
  const value = Platform.OS as PlatformName;
  return ['android', 'ios', 'web', 'windows', 'macos'].includes(value) ? value : 'unknown';
}

export function ReferralRuntimeProvider({ children }: PropsWithChildren): React.JSX.Element {
  const runtime = useMemo(() => {
    const platform = currentPlatform();
    const tracker = new AnalyticsTracker(
      createAnalyticsClient(),
      referralStorage,
      platform,
    );
    const coordinator = new ReferralCoordinator(
      createDeepLinkService(),
      tracker,
      referralStorage,
      createMockReferralApi(referralStorage),
      createShareService(),
      platform,
    );
    return { tracker, coordinator };
  }, []);
  const [events, setEvents] = useState<LedgerEntry[]>([]);

  useEffect(() => {
    let sequence = 0;
    const unsubscribe = runtime.tracker.subscribe((event, delivery) => {
      sequence += 1;
      setEvents((current) => [{ event, delivery, sequence }, ...current].slice(0, 30));
    });
    runtime.coordinator.start();
    return () => {
      unsubscribe();
      runtime.coordinator.stop();
    };
  }, [runtime]);

  const value = useMemo<ReferralRuntimeValue>(
    () => ({ coordinator: runtime.coordinator, events, clearLedger: () => setEvents([]) }),
    [events, runtime.coordinator],
  );

  return (
    <ReferralRuntimeContext.Provider value={value}>
      {children}
    </ReferralRuntimeContext.Provider>
  );
}

export function useReferralRuntime(): ReferralRuntimeValue {
  const value = useContext(ReferralRuntimeContext);
  if (!value) throw new Error('useReferralRuntime must be used within ReferralRuntimeProvider');
  return value;
}
