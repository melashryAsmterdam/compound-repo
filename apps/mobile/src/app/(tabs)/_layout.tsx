import { Ionicons } from '@expo/vector-icons';
import { Redirect, Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { UnitHeader } from '@/components/Header';
import { useSession } from '@/lib/session';
import { colors, fonts, type } from '@/lib/theme';

/** Bottom tabs; RN mirrors the order in RTL so Home is right-most in Arabic (§2.1). */
export default function TabsLayout() {
  const { t } = useTranslation();
  const { status } = useSession();
  if (status === 'signedOut') return <Redirect href="/sign-in" />;
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: type.caption,
        header: () => <UnitHeader />,
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('tabs.home'), tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" color={color as string} size={size} /> }} />
      <Tabs.Screen name="requests" options={{ title: t('tabs.requests'), header: () => <UnitHeader title={t('tabs.requests')} />, tabBarIcon: ({ color, size }) => <Ionicons name="construct-outline" color={color as string} size={size} /> }} />
      <Tabs.Screen name="announcements" options={{ title: t('tabs.announcements'), header: () => <UnitHeader title={t('tabs.announcements')} />, tabBarIcon: ({ color, size }) => <Ionicons name="megaphone-outline" color={color as string} size={size} /> }} />
      <Tabs.Screen name="settings" options={{ title: t('tabs.settings'), headerShown: true, header: undefined, headerTitleStyle: { fontFamily: fonts.bold }, tabBarIcon: ({ color, size }) => <Ionicons name="settings-outline" color={color as string} size={size} /> }} />
    </Tabs>
  );
}
