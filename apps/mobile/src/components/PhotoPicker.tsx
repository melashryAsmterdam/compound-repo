import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActionSheetIOS, ActivityIndicator, Alert, Image, Linking, Platform, Pressable, View } from 'react-native';
import type { DraftPhoto } from '@/lib/drafts';
import type { PickResult, PickSource } from '@/lib/photos';
import { colors, radius, space } from '@/lib/theme';
import { Button, Row, Text } from './ui';

/** Thumbnails + add tile (camera / gallery) with per-photo upload progress and retry (M-13, M-17). */
export function PhotoPicker({ photos, max, onAdd, onRetry, onRemove }: {
  photos: DraftPhoto[];
  max: number;
  onAdd: (source: PickSource) => Promise<PickResult['kind']>;
  onRetry: (localId: string) => void;
  onRemove: (localId: string) => void;
}) {
  const { t } = useTranslation();
  const [denied, setDenied] = useState<PickSource | null>(null);
  const [tooLarge, setTooLarge] = useState(false);

  const add = async (source: PickSource) => {
    setDenied(null);
    setTooLarge(false);
    const r = await onAdd(source);
    if (r === 'denied') setDenied(source);
    if (r === 'too_large') setTooLarge(true);
  };

  const choose = () => {
    const options = [t('newRequest.takePhoto'), t('newRequest.chooseGallery'), t('common.cancel')];
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions({ options, cancelButtonIndex: 2 }, (i) => {
        if (i === 0) void add('camera');
        if (i === 1) void add('gallery');
      });
    } else {
      Alert.alert(t('newRequest.addPhoto'), undefined, [
        { text: options[0]!, onPress: () => void add('camera') },
        { text: options[1]!, onPress: () => void add('gallery') },
        { text: options[2]!, style: 'cancel' },
      ]);
    }
  };

  return (
    <View style={{ gap: space.sm }}>
      <Row style={{ flexWrap: 'wrap' }}>
        {photos.map((p, i) => (
          <Pressable
            key={p.localId}
            accessibilityRole="button"
            accessibilityLabel={p.state === 'failed' ? t('newRequest.retryUpload') : t('newRequest.removePhoto')}
            accessibilityHint={t('photos.photo', { index: i + 1, total: photos.length })}
            onPress={() => (p.state === 'failed' ? onRetry(p.localId) : undefined)}
            onLongPress={() => onRemove(p.localId)}
            style={{ width: 80, height: 80 }}
          >
            <Image source={{ uri: p.uri }} style={{ width: 80, height: 80, borderRadius: radius.md, opacity: p.state === 'ready' ? 1 : 0.5 }} />
            {p.state === 'uploading' || p.state === 'compressing' ? (
              <View style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel={t('newRequest.uploading')}>
                <ActivityIndicator color={colors.accent} />
              </View>
            ) : null}
            {p.state === 'failed' ? (
              <View style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="refresh-circle" size={32} color={colors.danger} />
              </View>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('newRequest.removePhoto')}
              onPress={() => onRemove(p.localId)}
              hitSlop={10}
              style={{ position: 'absolute', top: -6, end: -6, backgroundColor: colors.surface, borderRadius: 12 }}
            >
              <Ionicons name="close-circle" size={24} color={colors.ink} />
            </Pressable>
          </Pressable>
        ))}
        {photos.length < max ? (
          <Pressable
            testID="add-photo"
            accessibilityRole="button"
            accessibilityLabel={t('newRequest.addPhoto')}
            onPress={choose}
            style={{ width: 80, height: 80, borderRadius: radius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="camera" size={28} color={colors.accent} />
          </Pressable>
        ) : null}
      </Row>
      <Text variant="small" color={colors.muted}>{t('newRequest.photosHint', { max })}</Text>
      {denied ? (
        <View style={{ gap: space.xs }}>
          <Text variant="small" color={colors.danger}>{denied === 'camera' ? t('newRequest.cameraDenied') : t('newRequest.galleryDenied')}</Text>
          <Button kind="ghost" title={t('push.openSettings')} onPress={() => void Linking.openSettings()} />
        </View>
      ) : null}
      {tooLarge ? <Text variant="small" color={colors.danger}>{t('newRequest.tooLarge')}</Text> : null}
    </View>
  );
}
