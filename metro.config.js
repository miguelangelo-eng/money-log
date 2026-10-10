const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

/** O drizzle/migrations.js importa os .sql gerados pelo drizzle-kit, e o Metro
 *  não resolve .sql por padrão — o bundle falha com "Unable to resolve module
 *  ./0000_xxx.sql". Registrar como sourceExt faz o Metro inlinar o conteúdo,
 *  que é o que o useMigrations espera no dispositivo. */
config.resolver.sourceExts.push('sql');

/** Web está fora de escopo (`platforms: ["ios","android"]` no app.json), e não
 *  foi só para calar o erro de bundle.
 *
 *  No navegador o expo-sqlite não usa SQLite nativo: usa wa-sqlite, um port em
 *  WebAssembly com outro backend de persistência. Um build web verde não
 *  provaria que a migração aplica nem que a transação funciona no aparelho —
 *  seria confiança falsa justamente na camada que o M0 precisa validar.
 *
 *  Se um dia o web entrar (uma visão de leitura no desktop, por exemplo), são
 *  três coisas, não uma:
 *    1. devolver "web" a `platforms` no app.json;
 *    2. `config.resolver.assetExts.push('wasm')` aqui;
 *    3. servir os cabeçalhos COOP/COEP, que o wa-sqlite exige para usar
 *       SharedArrayBuffer — sem eles ele bundla e falha em tempo de execução.
 */

module.exports = config;
