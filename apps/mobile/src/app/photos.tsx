import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Image, ScrollView, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, IconButton, Ltr, Text } from '@/components/ui';
import { colors } from '@/lib/theme';
import { getViewerPhotos } from '@/lib/viewer';

/** M-19 full-screen photo viewer: pinch to zoom (iOS ScrollView zoom), swipe in reading direction. No share/download. */
export default function PhotoViewer() {
  const { t } = useTranslation();
  const { index } = useLocalSearchParams<{ index?: string }>();
  const photos = getViewerPhotos();
  const { width, height } = useWindowDimensions();
  const [current, setCurrent] = useState(Number(index ?? 0));
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState<Record<string, boolean>>({});
  const [nonce, setNonce] = useState(0);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.scrim }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 8 }}>
        <IconButton icon="close" label={t('common.close')} color={colors.onDark} onPress={() => router.back()} />
        <Ltr color={colors.onDark}>{t('photos.counter', { index: current + 1, total: photos.length })}</Ltr>
        <View style={{ width: 44 }} />
      </View>
      <FlatList
        data={photos}
        horizontal
        pagingEnabled
        initialScrollIndex={Math.min(current, Math.max(0, photos.length - 1))}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        keyExtractor={(p) => p.id}
        onMomentumScrollEnd={(e) => setCurrent(Math.round(Math.abs(e.nativeEvent.contentOffset.x) / width))}
        renderItem={({ item, index: i }) => (
          <ScrollView maximumZoomScale={4} minimumZoomScale={1} centerContent style={{ width }} contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center' }}>
            {failed[item.id] ? (
              <View style={{ alignItems: 'center', gap: 12 }}>
                <Text color={colors.onDark}>{t('photos.failed')}</Text>
                <Button kind="secondary" title={t('common.tryAgain')} onPress={() => {
                  setFailed((f) => ({ ...f, [item.id]: false }));
                  setNonce((n) => n + 1);
                }} />
              </View>
            ) : (
              <>
                {!loaded[item.id] ? <ActivityIndicator color={colors.onDark} style={{ position: 'absolute' }} /> : null}
                <Image
                  key={`${item.id}-${nonce}`}
                  source={{ uri: item.url }}
                  accessibilityLabel={t('photos.photo', { index: i + 1, total: photos.length })}
                  resizeMode="contain"
                  onLoad={() => setLoaded((l) => ({ ...l, [item.id]: true }))}
                  onError={() => setFailed((f) => ({ ...f, [item.id]: true }))}
                  style={{ width, height: height * 0.8 }}
                />
              </>
            )}
          </ScrollView>
        )}
      />
    </SafeAreaView>
  );
}
