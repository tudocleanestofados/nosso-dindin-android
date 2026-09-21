# Nosso Dindin - Android

Projeto preparado para gerar um APK de teste na nuvem usando GitHub Actions, sem Android Studio.

## Conteúdo
- `www/index.html`: versão v53 aprovada do Nosso Dindin
- `capacitor.config.json`: configuração Android
- `.github/workflows/gerar-apk.yml`: geração automática do APK

## Identificação
- Nome: Nosso Dindin
- App ID: com.nossodindin.app

O APK gerado pelo workflow é uma versão DEBUG destinada aos testes no celular.
Para publicação na Google Play, deve ser criada posteriormente uma versão RELEASE assinada/AAB.
