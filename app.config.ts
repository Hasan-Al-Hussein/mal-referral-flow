import type { ConfigContext, ExpoConfig } from 'expo/config';

const branchKey = process.env.EXPO_PUBLIC_BRANCH_KEY;
const branchDomain = process.env.EXPO_PUBLIC_BRANCH_DOMAIN;
const branchAlternateDomain = process.env.EXPO_PUBLIC_BRANCH_ALTERNATE_DOMAIN;
const googleServicesJson = process.env.GOOGLE_SERVICES_JSON;
const googleServicesPlist = process.env.GOOGLE_SERVICES_PLIST;
const nativeSdkBuild = process.env.NATIVE_SDK_BUILD === '1';
const webBaseUrl = process.env.EXPO_PUBLIC_BASE_URL;

const branchDomains = [branchDomain, branchAlternateDomain].filter(
  (domain): domain is string => Boolean(domain),
);

export default ({ config }: ConfigContext) => {
  const plugins: NonNullable<ExpoConfig['plugins']> = ['expo-font'];

  if (nativeSdkBuild && (!branchKey || !branchDomain)) {
    throw new Error(
      'NATIVE_SDK_BUILD=1 requires EXPO_PUBLIC_BRANCH_KEY and EXPO_PUBLIC_BRANCH_DOMAIN.',
    );
  }
  if (nativeSdkBuild && (!googleServicesJson || !googleServicesPlist)) {
    throw new Error(
      'NATIVE_SDK_BUILD=1 requires GOOGLE_SERVICES_JSON and GOOGLE_SERVICES_PLIST.',
    );
  }

  if (nativeSdkBuild && branchKey && branchDomain) {
    plugins.push([
      '@config-plugins/react-native-branch',
      {
        apiKey: branchKey,
        iosAppDomain: branchDomain,
        iosUniversalLinkDomains: branchDomains,
      },
    ]);
  }

  if (nativeSdkBuild && googleServicesJson && googleServicesPlist) {
    plugins.push('@react-native-firebase/app');
    plugins.push('@react-native-firebase/analytics');
    plugins.push([
      'expo-build-properties',
      {
        ios: {
          useFrameworks: 'static',
          forceStaticLinking: ['RNFBApp', 'RNFBAnalytics'],
        },
      },
    ]);
  }

  return {
    ...config,
    name: 'Mal Referral',
    slug: 'mal-referral-flow',
    version: '1.0.0',
    orientation: 'default',
    icon: './assets/icon.png',
    userInterfaceStyle: 'automatic',
    newArchEnabled: true,
    scheme: 'malreferral',
    splash: {
      image: './assets/splash-icon.png',
      resizeMode: 'contain',
      backgroundColor: '#D0DDEE',
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.hasanalhussein.malreferral',
      googleServicesFile: nativeSdkBuild ? googleServicesPlist : undefined,
      associatedDomains: branchDomains.map((domain) => `applinks:${domain}`),
    },
    android: {
      package: 'com.hasanalhussein.malreferral',
      googleServicesFile: nativeSdkBuild ? googleServicesJson : undefined,
      permissions: [
        'com.android.vending.INSTALL_REFERRER',
      ],
      blockedPermissions: ['com.google.android.gms.permission.AD_ID'],
      intentFilters: branchDomains.map((domain) => ({
        action: 'VIEW',
        autoVerify: true,
        category: ['BROWSABLE', 'DEFAULT'],
        data: [{ scheme: 'https', host: domain, pathPrefix: '/' }],
      })),
    },
    web: {
      bundler: 'metro',
      output: 'single',
      favicon: './assets/favicon.png',
    },
    plugins,
    experiments: {
      typedRoutes: false,
      ...(webBaseUrl ? { baseUrl: webBaseUrl } : {}),
    },
    extra: {
      nativeSdkBuild,
      branchConfigured: Boolean(branchKey && branchDomain),
      firebaseConfigured: Boolean(googleServicesJson && googleServicesPlist),
      eas: {
        projectId: process.env.EAS_PROJECT_ID,
      },
    },
  };
};
