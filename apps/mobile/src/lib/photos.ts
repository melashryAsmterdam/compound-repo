import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import type { ResidentApi } from './api';
import { MAX_PHOTO_BYTES } from './drafts';
import { uploadBlob, type UploadPurpose } from './upload';

export type PickSource = 'camera' | 'gallery';
export type PickResult =
  | { kind: 'ok'; uri: string; width: number; height: number }
  | { kind: 'cancelled' }
  | { kind: 'denied'; source: PickSource }
  | { kind: 'too_large' };

const MAX_SIDE = 2048;

/** Pick or take a photo, then resize and re-encode to JPEG — re-encoding drops EXIF/GPS (R2-AC7, ADR-013). */
export async function pickPhoto(source: PickSource): Promise<PickResult> {
  const perm =
    source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return { kind: 'denied', source };
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, exif: false, allowsMultipleSelection: false };
  const res = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  if (res.canceled || !res.assets[0]) return { kind: 'cancelled' };
  const asset = res.assets[0];
  if (asset.fileSize && asset.fileSize > MAX_PHOTO_BYTES) return { kind: 'too_large' };
  return { kind: 'ok', ...(await compress(asset.uri, asset.width, asset.height)) };
}

export async function compress(uri: string, width: number, height: number) {
  const ctx = ImageManipulator.manipulate(uri);
  if (Math.max(width, height) > MAX_SIDE) {
    ctx.resize(width >= height ? { width: MAX_SIDE, height: null } : { width: null, height: MAX_SIDE });
  }
  const image = await ctx.renderAsync();
  const out = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
  return { uri: out.uri, width: out.width, height: out.height };
}

/** Upload a compressed local photo (file:// URI). */
export async function uploadPhoto(api: ResidentApi, uri: string, purpose: UploadPurpose): Promise<string> {
  const blob = await (await fetch(uri)).blob();
  return uploadBlob(api, blob, purpose);
}
