import { getAnalytics, logEvent } from '@react-native-firebase/analytics';

import type { AnalyticsClient, ReferralEventRecord } from '../../domain/analytics';

export class FirebaseAnalyticsClient implements AnalyticsClient {
  async logEvent(event: ReferralEventRecord): Promise<void> {
    await Promise.resolve(logEvent(getAnalytics(), event.name, event.properties));
  }
}

export function createAnalyticsClient(): AnalyticsClient {
  return new FirebaseAnalyticsClient();
}
