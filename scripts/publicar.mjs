/** Publica uma atualização pelo ar (EAS Update) no canal preview.
 *
 *      npm run publicar -- o que mudou, em uma linha
 *
 *  Existe como script, e não como uma linha no package.json, porque no
 *  Windows o npm.cmd repassa `-- "WhatsApp em backlog"` como três argumentos
 *  soltos: o EAS recebia `--message WhatsApp em backlog` e recusava "em" e
 *  "backlog". Aqui as palavras viram UMA mensagem, sempre.
 *
 *  Ordem: verify (typecheck, testes, migração) e só então o update, com as
 *  variáveis do ambiente preview do EAS — sem elas o app atualizado acharia
 *  que não tem Supabase e pararia de sincronizar (ver SETUP.md).
 *
 *  PUBLICAR_SECO=1 mostra o comando do EAS sem rodar nada.
 */

import { spawnSync } from 'node:child_process';

const mensagem = process.argv
  .slice(2)
  .join(' ')
  .trim()
  // A linha passa pelo cmd.exe no Windows: aspas e % teriam significado lá.
  .replace(/["%]/g, '');

if (!mensagem) {
  console.error('uso: npm run publicar -- o que mudou, em uma linha');
  process.exit(2);
}

const eas =
  'npx eas-cli@24.8.0 update --channel preview --environment preview ' +
  `--message "${mensagem}" --non-interactive`;

if (process.env.PUBLICAR_SECO) {
  console.log(eas);
  process.exit(0);
}

// shell: true é obrigatório para npm/npx (.cmd) no Windows desde o Node 20;
// por isso a mensagem vai entre aspas na própria linha.
const rodar = (linha) => {
  const r = spawnSync(linha, { stdio: 'inherit', shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

rodar('npm run verify');
rodar(eas);
