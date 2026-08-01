import { afterEach, describe, expect, it } from '@jest/globals';

import getExpoConfig from '../app.config';
import easConfig from '../eas.json';

import type { ConfigContext } from 'expo/config';

const managedEnvironmentNames = [
  'NATIVE_SDK_BUILD',
  'NATIVE_BUILD_PLATFORM',
  'EAS_BUILD_PLATFORM',
  'EAS_BUILD',
  'BRANCH_ENVIRONMENT',
  'EXPO_PUBLIC_BRANCH_KEY',
  'EXPO_PUBLIC_BRANCH_TEST_KEY',
  'EXPO_PUBLIC_BRANCH_LIVE_KEY',
  'EXPO_PUBLIC_BRANCH_DOMAIN',
  'EXPO_PUBLIC_BRANCH_ALTERNATE_DOMAIN',
  'GOOGLE_SERVICES_JSON',
  'GOOGLE_SERVICES_PLIST',
] as const;

const originalEnvironment = Object.fromEntries(
  managedEnvironmentNames.map((name) => [name, process.env[name]]),
) as Record<(typeof managedEnvironmentNames)[number], string | undefined>;

function setEnvironment(values: Record<string, string>) {
  for (const name of managedEnvironmentNames) delete process.env[name];
  Object.assign(process.env, values);
}

function restoreEnvironment() {
  for (const name of managedEnvironmentNames) {
    const value = originalEnvironment[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

function readConfig() {
  return getExpoConfig({
    config: { name: 'test', slug: 'test' },
  } as ConfigContext);
}

function readBranchPlugin(config: ReturnType<typeof getExpoConfig>) {
  const entry = config.plugins?.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === '@config-plugins/react-native-branch',
  );
  expect(entry).toBeDefined();
  return (entry as [string, Record<string, unknown>])[1];
}

const baseNativeEnvironment = {
  NATIVE_SDK_BUILD: '1',
  NATIVE_BUILD_PLATFORM: 'android',
  EXPO_PUBLIC_BRANCH_DOMAIN: 'probe.test-app.link',
};

afterEach(restoreEnvironment);

describe('Branch native environment config', () => {
  it('configures preview/test mode with required live slot, test key, and test flag', () => {
    setEnvironment({
      ...baseNativeEnvironment,
      BRANCH_ENVIRONMENT: 'test',
      EXPO_PUBLIC_BRANCH_TEST_KEY: 'key_test_preview',
      EXPO_PUBLIC_BRANCH_LIVE_KEY: 'key_live_preview_fallback',
    });

    expect(readBranchPlugin(readConfig())).toEqual(
      expect.objectContaining({
        apiKey: 'key_live_preview_fallback',
        testApiKey: 'key_test_preview',
        enableTestEnvironment: true,
      }),
    );
    expect(readConfig().extra?.branchEnvironment).toBe('test');
  });

  it('keeps a legacy test key viable by using it for both plugin key slots', () => {
    setEnvironment({
      ...baseNativeEnvironment,
      EXPO_PUBLIC_BRANCH_KEY: 'key_test_legacy',
    });

    expect(readBranchPlugin(readConfig())).toEqual(
      expect.objectContaining({
        apiKey: 'key_test_legacy',
        testApiKey: 'key_test_legacy',
        enableTestEnvironment: true,
      }),
    );
  });

  it('configures production/live mode without exposing a test-key plugin property', () => {
    setEnvironment({
      ...baseNativeEnvironment,
      BRANCH_ENVIRONMENT: 'live',
      EXPO_PUBLIC_BRANCH_LIVE_KEY: 'key_live_production',
      EXPO_PUBLIC_BRANCH_TEST_KEY: 'key_test_unused',
    });

    const plugin = readBranchPlugin(readConfig());
    expect(plugin).toEqual(
      expect.objectContaining({
        apiKey: 'key_live_production',
        enableTestEnvironment: false,
      }),
    );
    expect(plugin).not.toHaveProperty('testApiKey');
    expect(readConfig().extra?.branchEnvironment).toBe('live');
  });

  it.each([
    {
      name: 'unknown environment',
      values: { BRANCH_ENVIRONMENT: 'staging', EXPO_PUBLIC_BRANCH_TEST_KEY: 'key_test_x' },
      error: 'BRANCH_ENVIRONMENT must be test or live.',
    },
    {
      name: 'test mode without a test key',
      values: { BRANCH_ENVIRONMENT: 'test', EXPO_PUBLIC_BRANCH_LIVE_KEY: 'key_live_x' },
      error: 'EXPO_PUBLIC_BRANCH_TEST_KEY (or legacy EXPO_PUBLIC_BRANCH_KEY)',
    },
    {
      name: 'live mode without a live key',
      values: { BRANCH_ENVIRONMENT: 'live', EXPO_PUBLIC_BRANCH_TEST_KEY: 'key_test_x' },
      error: 'EXPO_PUBLIC_BRANCH_LIVE_KEY (or legacy EXPO_PUBLIC_BRANCH_KEY)',
    },
    {
      name: 'wrong test-key prefix',
      values: { BRANCH_ENVIRONMENT: 'test', EXPO_PUBLIC_BRANCH_TEST_KEY: 'key_live_x' },
      error: 'EXPO_PUBLIC_BRANCH_TEST_KEY must start with key_test_.',
    },
  ])('rejects $name', ({ values, error }) => {
    setEnvironment({ ...baseNativeEnvironment, ...values });
    expect(readConfig).toThrow(error);
  });

  it('pins development and preview to test while production is live', () => {
    expect(easConfig.build.development.env.BRANCH_ENVIRONMENT).toBe('test');
    expect(easConfig.build.preview.env.BRANCH_ENVIRONMENT).toBe('test');
    expect(easConfig.build.production.env.BRANCH_ENVIRONMENT).toBe('live');
  });
});
