const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

/** O drizzle/migrations.js importa os .sql gerados pelo drizzle-kit, e o Metro
 *  não resolve .sql por padrão — o bundle falha com "Unable to resolve module
 *  ./0000_xxx.sql". Registrar como sourceExt faz o Metro inlinar o conteúdo,
 *  que é o que o useMigrations espera no dispositivo. */
config.resolver.sourceExts.push('sql');

module.exports = config;
