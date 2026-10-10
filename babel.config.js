module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      /** Transforma `import m from './x.sql'` no CONTEÚDO do arquivo como
       *  string, antes de o Metro tentar parseá-lo como JavaScript. Sem isto o
       *  bundle morre com "Missing semicolon" apontando para a primeira linha
       *  do .sql — o Metro resolve o arquivo e então o trata como código.
       *  Combina com `config.resolver.sourceExts.push('sql')` no metro.config.js:
       *  um faz o Metro achar, o outro faz virar string. */
      ['inline-import', { extensions: ['.sql'] }],
    ],
  };
};
