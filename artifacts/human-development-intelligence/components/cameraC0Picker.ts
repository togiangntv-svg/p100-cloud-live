import * as ImagePicker from 'expo-image-picker';
import type { CameraPickerPort, CameraPickerResult } from '@/domain/camera/candidate';

const options: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  allowsEditing: false,
  allowsMultipleSelection: false,
  base64: false,
  exif: false,
  quality: 1,
};

const present = (result: ImagePicker.ImagePickerResult): CameraPickerResult => {
  if (result.canceled || !result.assets?.[0]?.uri) return Object.freeze({ canceled: true });
  const asset = result.assets[0];
  return Object.freeze({
    canceled: false,
    asset: Object.freeze({
      uri: asset.uri,
      ...(asset.width > 0 ? { width: asset.width } : {}),
      ...(asset.height > 0 ? { height: asset.height } : {}),
    }),
  });
};

export const expoCameraC0Picker: CameraPickerPort = Object.freeze({
  requestCameraPermission: async () => {
    const response = await ImagePicker.requestCameraPermissionsAsync();
    return response.granted ? 'granted' : 'denied';
  },
  takePhoto: async () => present(await ImagePicker.launchCameraAsync(options)),
  // Expo 57 uses the platform photo picker here. No broad library permission is
  // requested before the user deliberately opens that picker.
  choosePhoto: async () => present(await ImagePicker.launchImageLibraryAsync(options)),
});