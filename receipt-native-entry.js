import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { TextRecognition, Script } from '@capacitor-mlkit/text-recognition';

window.NDReceiptNative = {
  async scan(source) {
    const photo = await Camera.getPhoto({
      quality: 95,
      allowEditing: false,
      resultType: CameraResultType.Uri,
      source: source === 'photos' ? CameraSource.Photos : CameraSource.Camera,
      correctOrientation: true
    });
    if (!photo.path) throw new Error('Não foi possível acessar o arquivo da imagem.');
    const { text } = await TextRecognition.processImage({ path: photo.path, script: Script.Latin });
    return { text, preview: photo.webPath || '' };
  }
};
