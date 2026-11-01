import { useEffect, useState, type ReactNode } from 'react';
import { RefreshControl, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { colors, space } from '@/lib/theme';
import { OfflineBanner } from './ui';

export function Screen({
  children, scroll = true, refreshing, onRefresh, edges = ['bottom'], contentStyle, footer,
}: {
  children: ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  edges?: Edge[];
  contentStyle?: StyleProp<ViewStyle>;
  footer?: ReactNode;
}) {
  const content: StyleProp<ViewStyle> = [{ padding: space.lg, gap: space.lg }, contentStyle];
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: colors.bg }}>
      <OfflineBanner />
      {scroll ? (
        <ScrollView
          contentContainerStyle={content}
          keyboardShouldPersistTaps="handled"
          refreshControl={onRefresh ? <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} /> : undefined}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, content]}>{children}</View>
      )}
      {footer ? <View style={{ padding: space.lg, gap: space.sm, borderTopWidth: 1, borderColor: colors.line, backgroundColor: colors.surface }}>{footer}</View> : null}
    </SafeAreaView>
  );
}

/** Show skeletons only after 300 ms to avoid flashing (§1.4). */
export function useDelayed(active: boolean, ms = 300): boolean {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!active) {
      setShow(false);
      return undefined;
    }
    const id = setTimeout(() => setShow(true), ms);
    return () => clearTimeout(id);
  }, [active, ms]);
  return show;
}
