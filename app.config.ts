import type { ConfigContext, ExpoConfig } from 'expo/config';

const branchKey = process.env.EXPO_PUBLIC_BRANCH_KEY;
const branchDomain = process.env.EXPO_PUBLIC_BRANCH_DOMAIN;
const branchAlternateDomain = process.env.EXPO_PUBLIC_BRANCH_ALTERNATE_DOMAIN;
const nativeSdkBuild = process.env.NATIVE_SDK_BUILD === '1';
const nativeBuildPlatform =
  process.env.EAS_BUILD_PLATFORM ?? process.env.NATIVE_BUILD_PLATFORM ?? 'all';
const easBuildWorker = process.env.EAS_BUILD === 'true';
const googleServicesJson =
  process.env.GOOGLE_SERVICES_JSON ??
  (nativeSdkBuild && !easBuildWorker ? './google-services.json' : undefined);
const googleServicesPlist =
  process.env.GOOGLE_SERVICES_PLIST ??
  (nativeSdkBuild && !easBuildWorker ? './GoogleService-Info.plist' : undefined);
const webBaseUrl = process.env.EXPO_PUBLIC_BASE_URL;

const branchDomains = [branchDomain, branchAlternateDomain].filter(
  (domain): domain is string => Boolean(domain),
);

export default ({ config }: ConfigContext) => {
  const plugins: NonNullable<ExpoConfig['plugins']> = ['expo-font'];
  const buildsAndroid = nativeBuildPlatform === 'android' || nativeBuildPlatform === 'all';
  const buildsIos = nativeBuildPlatform === 'ios' || nativeBuildPlatform === 'all';

  if (nativeSdkBuild && !['android', 'ios', 'all'].includes(nativeBuildPlatform)) {
    throw new Error(
      'NATIVE_BUILD_PLATFORM/EAS_BUILD_PLATFORM must be android, ios, or all.',
    );
  }

  if (nativeSdkBuild && (!branchKey || !branchDomain)) {
    throw new Error(
      'NATIVE_SDK_BUILD=1 requires EXPO_PUBLIC_BRANCH_KEY and EXPO_PUBLIC_BRANCH_DOMAIN.',
    );
  }
  if (nativeSdkBuild && easBuildWorker && buildsAndroid && !googleServicesJson) {
    throw new Error(
      'Android native SDK builds require GOOGLE_SERVICES_JSON.',
    );
  }
  if (nativeSdkBuild && easBuildWorker && buildsIos && !googleServicesPlist) {
    throw new Error(
      'iOS native SDK builds require GOOGLE_SERVICES_PLIST.',
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

  if (nativeSdkBuild) {
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
      googleServicesFile: nativeSdkBuild && buildsIos ? googleServicesPlist : undefined,
      associatedDomains: branchDomains.map((domain) => `applinks:${domain}`),
    },
    android: {
      package: 'com.hasanalhussein.malreferral',
      googleServicesFile:
        nativeSdkBuild && buildsAndroid ? googleServicesJson : undefined,
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
      nativeBuildPlatform,
      easBuildWorker,
      branchConfigured: Boolean(branchKey && branchDomain),
      firebaseConfigured: Boolean(
        (!buildsAndroid || googleServicesJson) && (!buildsIos || googleServicesPlist),
      ),
      firebaseCredentialSource:
        process.env.GOOGLE_SERVICES_JSON || process.env.GOOGLE_SERVICES_PLIST
          ? 'environment-file-path'
          : nativeSdkBuild
            ? 'local-ignored-file-fallback'
            : 'not-configured',
      eas: {
        projectId: process.env.EAS_PROJECT_ID,
      },
    },
  };
};
