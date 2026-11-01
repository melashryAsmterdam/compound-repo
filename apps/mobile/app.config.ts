import type { ConfigContext, ExpoConfig } from 'expo/config';
// The config loader can't run the TS tokens module, so read the tokens JSON from the same package.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const tokens = require('@compound/ui-tokens/tokens.json') as { color: { green: Record<string, string>; neutral: { white: string } } };
// semantic.primary = green.600 (tokens v0.1.1).
const color = { semantic: { primary: tokens.color.green['600']! }, neutral: { white: tokens.color.neutral.white } };

/**
 * App config. Product name and store identity are configuration, not code: the name ساحة / Saha is
 * pending trademark and store-name clearance, so it can change here (or via env) without touching
 * screens. Each EAS profile gets its own bundle id so builds install side by side (build review R3).
 */
type Variant = 'development' | 'preview' | 'production';
const variant = (process.env.APP_VARIANT ?? 'production') as Variant;

const brand = {
  ar: process.env.APP_NAME_AR ?? 'ساحة',
  en: process.env.APP_NAME_EN ?? 'Saha',
};
const suffix = { development: ' (Dev)', preview: ' (Preview)', production: '' }[variant];
const bundleId = { development: 'sa.compound.app.dev', preview: 'sa.compound.app.preview', production: 'sa.compound.app' }[variant];
const linkHost = process.env.APP_LINK_HOST ?? 'go.compound.example.sa';

const permissions = {
  en: {
    camera: 'Take photos of a problem to attach to your maintenance request.',
    photos: 'Choose photos of a problem to attach to your maintenance request.',
    faceId: 'Unlock the app with Face ID.',
  },
  ar: {
    camera: 'التقط صورًا للمشكلة لإرفاقها بطلب الصيانة.',
    photos: 'اختر صورًا للمشكلة لإرفاقها بطلب الصيانة.',
    faceId: 'افتح التطبيق باستخدام Face ID.',
  },
};

// Arabic iOS permission strings and display name (build review R4).
const iosLocale = (l: 'ar' | 'en') => ({
  CFBundleDisplayName: brand[l] + suffix,
  NSCameraUsageDescription: permissions[l].camera,
  NSPhotoLibraryUsageDescription: permissions[l].photos,
  NSFaceIDUsageDescription: permissions[l].faceId,
});

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: brand.en + suffix,
  slug: 'compound-app',
  scheme: ['compoundapp', 'compound'],
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  locales: { ar: iosLocale('ar'), en: iosLocale('en') } as unknown as ExpoConfig['locales'],
  ios: {
    bundleIdentifier: bundleId,
    supportsTablet: false,
    associatedDomains: [`applinks:${linkHost}`],
    infoPlist: {
      NSCameraUsageDescription: permissions.en.camera,
      NSPhotoLibraryUsageDescription: permissions.en.photos,
      NSFaceIDUsageDescription: permissions.en.faceId,
      CFBundleAllowMixedLocalizations: true,
      CFBundleDevelopmentRegion: 'ar',
    },
  },
  android: {
    package: bundleId,
    adaptiveIcon: {
      backgroundColor: color.semantic.primary,
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        data: [{ scheme: 'https', host: linkHost, pathPrefix: '/a/' }],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
  },
  plugins: [
    'expo-router',
    // Splash: the Designer's Saha mark (green field) on white, the base colour (tokens rules).
    ['expo-splash-screen', { image: './assets/splash-icon.png', imageWidth: 160, backgroundColor: color.neutral.white, resizeMode: 'contain' }],
    'expo-secure-store',
    ['expo-localization', { supportsRTL: true }],
    'expo-font',
    ['expo-notifications', { color: color.semantic.primary }],
    ['expo-image-picker', { cameraPermission: permissions.en.camera, photosPermission: permissions.en.photos }],
    ['expo-local-authentication', { faceIDPermission: permissions.en.faceId }],
  ],
  experiments: { typedRoutes: false },
  extra: {
    // Fallback only; the API's GET /app/v1/meta is the source of truth (contract v1.1).
    minSupportedVersion: '1.0.0',
    brand,
    variant,
    storeId: { android: bundleId, ios: process.env.APP_STORE_ID ?? null },
  },
});
