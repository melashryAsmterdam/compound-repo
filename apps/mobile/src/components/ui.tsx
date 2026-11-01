import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator, I18nManager, Pressable, Text as RNText, TextInput, View,
  type PressableProps, type StyleProp, type TextInputProps, type TextProps, type TextStyle, type ViewStyle,
} from 'react-native';
import { useOnline } from '@/lib/network';
import type { Chip as ChipModel } from '@/lib/requests';
import { colors, MIN_TOUCH, radius, space, type } from '@/lib/theme';

type Variant = keyof typeof type;

/** Text that follows the UI direction. Never sets letterSpacing or uppercase (§1.1). */
export function Text({ variant = 'body', style, color, ...rest }: TextProps & { variant?: Variant; color?: string }) {
  return (
    <RNText
      {...rest}
      maxFontSizeMultiplier={2}
      style={[type[variant], { color: color ?? colors.ink, textAlign: 'auto', writingDirection: I18nManager.isRTL ? 'rtl' : 'ltr' }, style]}
    />
  );
}

/** LTR isolate for IDs, unit numbers, phones, OTP, time ranges inside Arabic text (§1.1 bidi). */
export function Ltr({ children, style, variant = 'body', color }: { children: ReactNode; style?: StyleProp<TextStyle>; variant?: Variant; color?: string }) {
  return (
    <Text variant={variant} color={color} style={[{ writingDirection: 'ltr' }, style]}>
      {'⁦'}
      {children}
      {'⁩'}
    </Text>
  );
}

/** User content (descriptions, comments, bodies): direction from the first strong character (dir="auto"). */
export function AutoText({ children, ...rest }: TextProps & { variant?: Variant; color?: string; children: string }) {
  const rtl = /^[^A-Za-z؀-ۿ]*[؀-ۿ]/.test(children);
  return (
    <Text {...rest} style={[{ writingDirection: rtl ? 'rtl' : 'ltr', textAlign: 'auto' }, rest.style]}>
      {children}
    </Text>
  );
}

type ButtonKind = 'primary' | 'secondary' | 'ghost' | 'danger';
export function Button({
  title, onPress, kind = 'primary', loading, disabled, icon, style, accessibilityHint, testID, needsNetwork,
}: {
  title: string;
  onPress?: () => void;
  kind?: ButtonKind;
  loading?: boolean;
  disabled?: boolean;
  icon?: ComponentProps<typeof Ionicons>['name'];
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
  testID?: string;
  needsNetwork?: boolean;
}) {
  const online = useOnline();
  const { t } = useTranslation();
  const off = disabled || loading || (needsNetwork && !online);
  const bg = { primary: colors.accent, secondary: colors.surface, ghost: 'transparent', danger: colors.danger }[kind];
  const fg = { primary: colors.accentInk, secondary: colors.accent, ghost: colors.accent, danger: colors.accentInk }[kind];
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(off), busy: Boolean(loading) }}
      accessibilityHint={needsNetwork && !online ? t('common.offlineHint') : accessibilityHint}
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [
        {
          minHeight: MIN_TOUCH + 4,
          paddingHorizontal: space.lg,
          paddingVertical: space.sm,
          borderRadius: radius.md,
          backgroundColor: bg,
          borderWidth: kind === 'secondary' ? 1 : 0,
          borderColor: colors.accent,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: space.sm,
          opacity: off ? 0.5 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : icon ? <Ionicons name={icon} size={20} color={fg} /> : null}
      <Text variant="label" color={fg} style={{ textAlign: 'center' }}>
        {title}
      </Text>
    </Pressable>
  );
}

export function IconButton({ icon, label, onPress, color = colors.ink, badge }: {
  icon: ComponentProps<typeof Ionicons>['name']; label: string; onPress: () => void; color?: string; badge?: number;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={8}
      style={{ minWidth: MIN_TOUCH, minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name={icon} size={24} color={color} />
      {badge ? (
        <View style={{ position: 'absolute', top: 4, end: 2, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
          <Text variant="micro" color={colors.onDark}>{badge > 99 ? '99+' : String(badge)}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/** Chevron pointing in reading direction (mirrors in Arabic). */
export function Chevron({ color = colors.muted }: { color?: string }) {
  return <Ionicons name={I18nManager.isRTL ? 'chevron-back' : 'chevron-forward'} size={18} color={color} />;
}

const TONES: Record<ChipModel['tone'], { bg: string; fg: string; border?: string }> = {
  info: { bg: colors.infoSoft, fg: colors.info },
  warning: { bg: colors.warningSoft, fg: colors.warning },
  success: { bg: colors.surface, fg: colors.success, border: colors.success },
  neutral: { bg: colors.neutralSoft, fg: colors.ink },
  muted: { bg: colors.neutralSoft, fg: colors.muted },
};

export function StatusChip({ chip, icon }: { chip: ChipModel; icon?: ComponentProps<typeof Ionicons>['name'] }) {
  const { t } = useTranslation();
  const tone = TONES[chip.tone];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: tone.bg, borderWidth: tone.border ? 1 : 0, borderColor: tone.border }}>
      {icon ? <Ionicons name={icon} size={14} color={tone.fg} /> : null}
      <Text variant="small" color={tone.fg}>{t(chip.key, chip.params)}</Text>
    </View>
  );
}

export function Card({ children, onPress, style, accessibilityLabel, testID }: {
  children: ReactNode; onPress?: PressableProps['onPress']; style?: StyleProp<ViewStyle>; accessibilityLabel?: string; testID?: string;
}) {
  const base: ViewStyle = { backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg, borderWidth: 1, borderColor: colors.line, gap: space.sm };
  if (!onPress) return <View style={[base, style]} testID={testID}>{children}</View>;
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress}
      style={({ pressed }) => [base, { opacity: pressed ? 0.9 : 1 }, style]}>
      {children}
    </Pressable>
  );
}

export function Row({ children, style, gap = space.sm }: { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, style]}>{children}</View>;
}

export function Field({ label, error, helper, counter, ...input }: TextInputProps & { label: string; error?: string | null; helper?: string; counter?: string }) {
  return (
    <View style={{ gap: space.xs }}>
      <Text variant="label">{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        maxFontSizeMultiplier={2}
        {...input}
        style={[
          type.body,
          {
            minHeight: input.multiline ? 120 : MIN_TOUCH + 4,
            borderWidth: 1,
            borderColor: error ? colors.danger : colors.line,
            borderRadius: radius.md,
            paddingHorizontal: space.md,
            paddingVertical: space.sm,
            backgroundColor: colors.surface,
            color: colors.ink,
            textAlignVertical: input.multiline ? 'top' : 'center',
          },
          input.style,
        ]}
      />
      <Row style={{ justifyContent: 'space-between' }}>
        <Text variant="small" color={error ? colors.danger : colors.muted} style={{ flex: 1 }} accessibilityLiveRegion="polite">
          {error ?? helper ?? ''}
        </Text>
        {counter ? <Text variant="small" color={colors.muted}>{counter}</Text> : null}
      </Row>
    </View>
  );
}

export function SelectChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ selected }} onPress={onPress}
      style={{ minHeight: MIN_TOUCH, paddingHorizontal: space.md, justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: selected ? colors.accent : colors.line, backgroundColor: selected ? colors.accentSoft : colors.surface }}>
      <Text variant="label" color={selected ? colors.accent : colors.ink}>{label}</Text>
    </Pressable>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', backgroundColor: colors.neutralSoft, borderRadius: radius.md, padding: 3 }}>
      {options.map((o) => (
        <Pressable key={o.value} accessibilityRole="tab" accessibilityState={{ selected: o.value === value }} onPress={() => onChange(o.value)}
          style={{ flex: 1, minHeight: MIN_TOUCH - 4, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: o.value === value ? colors.surface : 'transparent' }}>
          <Text variant="label">{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** §1.4 offline banner. */
export function OfflineBanner() {
  const online = useOnline();
  const { t } = useTranslation();
  if (online) return null;
  return (
    <View accessibilityRole="alert" style={{ backgroundColor: colors.ink, paddingVertical: space.sm, paddingHorizontal: space.lg }}>
      <Text variant="small" color={colors.onDark} style={{ textAlign: 'center' }}>{t('common.offline')}</Text>
    </View>
  );
}

/** §1.4 inline load error with retry; keeps cached content when there is some. */
export function ErrorPanel({ onRetry, cached, message }: { onRetry: () => void; cached?: boolean; message?: string }) {
  const { t } = useTranslation();
  return (
    <Card style={{ alignItems: 'center' }}>
      <Text variant="label">{message ?? t('common.loadFailed')}</Text>
      {cached ? <Text variant="small" color={colors.muted}>{t('common.showingSaved')}</Text> : null}
      <Button kind="secondary" title={t('common.tryAgain')} onPress={onRetry} />
    </Card>
  );
}

export function EmptyState({ icon, text, action }: { icon: ComponentProps<typeof Ionicons>['name']; text: string; action?: ReactNode }) {
  return (
    <View style={{ alignItems: 'center', padding: space.xxl, gap: space.md }}>
      <Ionicons name={icon} size={48} color={colors.line} />
      <Text color={colors.muted} style={{ textAlign: 'center' }}>{text}</Text>
      {action}
    </View>
  );
}

/** Skeleton block (shown after 300 ms only — see useDelayed). */
export function Skeleton({ height = 72, style }: { height?: number; style?: StyleProp<ViewStyle> }) {
  return <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[{ height, borderRadius: radius.lg, backgroundColor: colors.neutralSoft }, style]} />;
}
