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
    try {
      const { text } = await TextRecognition.processImage({ path: photo.path, script: Script.Latin });
      return { text, preview: photo.webPath || '' };
    } catch (error) {
      console.warn('Falha ao ler a foto do cupom:', error);
      return {
        text: '',
        preview: photo.webPath || '',
        warning: 'Foto capturada, mas a leitura do texto falhou. Preencha os dados manualmente e confira antes de continuar.'
      };
    }
  }
};
