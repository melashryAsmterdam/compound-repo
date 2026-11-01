import { useFocusEffect } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { useCallback, useState, type ReactNode } from 'react';
import { Pressable, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { colors, MIN_TOUCH, pattern, radius, space } from '@/lib/theme';
import { Text } from './ui';

/**
 * The Saha mark: four units around a central square, gold dot for management (tokens brand.mark;
 * geometry from the approved mockup, 64-unit grid). Drawn with Views so it needs no SVG module.
 * `inverse` = white field with green figure, for use on the green hero.
 */
export function SahaMark({ size = 64, inverse = false, label }: { size?: number; inverse?: boolean; label?: string }) {
  const u = size / 64;
  const field = inverse ? colors.surface : colors.accent;
  const figure = inverse ? colors.header : colors.surface;
  const unit = (x: number, y: number) => (
    <View key={`${x}-${y}`} style={{ position: 'absolute', left: x * u, top: y * u, width: 15 * u, height: 15 * u, borderRadius: 3 * u, backgroundColor: figure }} />
  );
  return (
    <View accessible={Boolean(label)} accessibilityRole="image" accessibilityLabel={label} testID="saha-mark"
      style={{ width: size, height: size, borderRadius: 14 * u, backgroundColor: field, direction: 'ltr' }}>
      {unit(14, 14)}{unit(35, 14)}{unit(14, 35)}{unit(35, 35)}
      <View style={{ position: 'absolute', left: 27.5 * u, top: 27.5 * u, width: 9 * u, height: 9 * u, borderRadius: radius.pill, backgroundColor: colors.markDot }} />
    </View>
  );
}

/**
 * Eight-point star lattice (tokens.pattern) — headers, sign-in and splash only, never behind long text.
 * Each tile: a square and the same square turned 45°, plus short ticks joining neighbours.
 */
export function StarPattern({ onGreen = true }: { onGreen?: boolean }) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  const tile = pattern.tile;
  const stroke = onGreen ? colors.headerInk : colors.accent;
  const opacity = onGreen ? pattern.opacityOnGreen : pattern.opacityOnWhite;
  const cols = Math.ceil(box.w / tile) + 1;
  const rows = Math.ceil(box.h / tile) + 1;
  const s = (22 / 56) * tile;
  const o = (17 / 56) * tile;
  const tick = (9 / 56) * tile;
  const line = { position: 'absolute' as const, backgroundColor: stroke };
  return (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      onLayout={(e: LayoutChangeEvent) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, overflow: 'hidden', opacity, direction: 'ltr' }}>
      {Array.from({ length: rows * cols }, (_, i) => {
        const x = (i % cols) * tile;
        const y = Math.floor(i / cols) * tile;
        const sq = { position: 'absolute' as const, left: x + o, top: y + o, width: s, height: s, borderWidth: 1.2, borderColor: stroke };
        return (
          <View key={i}>
            <View style={sq} />
            <View style={[sq, { transform: [{ rotate: '45deg' }] }]} />
            <View style={[line, { left: x, top: y + tile / 2, width: tick, height: 1.2 }]} />
            <View style={[line, { left: x + tile - tick, top: y + tile / 2, width: tick, height: 1.2 }]} />
            <View style={[line, { left: x + tile / 2, top: y, width: 1.2, height: tick }]} />
            <View style={[line, { left: x + tile / 2, top: y + tile - tick, width: 1.2, height: tick }]} />
          </View>
        );
      })}
    </View>
  );
}

/** Green hero block with the pattern: sign-in (M-03) and the tab headers. */
export function GreenHero({ children, style, bottomRadius = radius.xl, testID }: { children: ReactNode; style?: StyleProp<ViewStyle>; bottomRadius?: number; testID?: string }) {
  return (
    <View testID={testID} style={[{ backgroundColor: colors.header, borderBottomStartRadius: bottomRadius, borderBottomEndRadius: bottomRadius, overflow: 'hidden' }, style]}>
      <StarPattern />
      {children}
    </View>
  );
}

/** Light status bar while a green-hero screen is focused; back to dark when it loses focus. */
export function useLightStatusBar() {
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle('light');
      return () => setStatusBarStyle('dark');
    }, []),
  );
}

/** Outlined pill for actions on the green hero (language switch on M-03). */
export function HeroPill({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={6}
      style={({ pressed }) => ({ minHeight: MIN_TOUCH - space.sm, justifyContent: 'center', paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.headerMuted, opacity: pressed ? 0.8 : 1 })}>
      <Text variant="label" color={colors.headerInk}>{title}</Text>
    </Pressable>
  );
}
