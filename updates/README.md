# Atualizações do Nosso Dindin

O APK inicial precisa conter o plugin nativo de atualização. Depois, alterações em HTML, CSS e JavaScript podem ser publicadas pelo workflow **Publicar atualização do conteúdo do app**. Ele gera um ZIP, publica o arquivo em uma versão do GitHub e atualiza `manifest.json` com o SHA-256. O aplicativo verifica o manifesto ao abrir e em **Configurações → Atualizações**.

Mudanças em plugins, permissões, Firebase ou código nativo exigem outro APK. Assine esse APK com o certificado mantido fora do repositório, aumente o `versionCode`, publique o arquivo e atualize `native_version` e `apk_url` no manifesto. O Android confirma a instalação pelo usuário. Nunca inclua a chave privada ou a senha no repositório.
