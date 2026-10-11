import * as SQLite from 'expo-sqlite';
import { drizzle } from 'drizzle-orm/expo-sqlite';

import * as schema from './schema';

/** Nome de antes do app virar "Money Log". NÃO renomear: o arquivo já existe
 *  nos aparelhos, e um nome novo abriria um banco vazio — os lançamentos
 *  ficariam órfãos no arquivo antigo. */
export const DB_NAME = 'financas.db';

const sqlite = SQLite.openDatabaseSync(DB_NAME, { enableChangeListener: true });

/** Chave estrangeira NÃO vem ligada no SQLite: sem isto ele aceita órfão em
 *  silêncio, e aí um lançamento aponta para uma conta que não existe mais.
 *  É por conexão, não por banco — tem que rodar aqui, no módulo. */
sqlite.execSync('pragma foreign_keys = on;');

/** WAL: leitura não bloqueia escrita. Importa porque a lista do mês (S04) e a
 *  tela de relatório (S15) consultam enquanto o usuário salva um lançamento. */
sqlite.execSync('pragma journal_mode = WAL;');

export const db = drizzle(sqlite, { schema });
export { sqlite };
export type Database = typeof db;
