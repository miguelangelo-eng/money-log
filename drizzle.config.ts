import type { Config } from 'drizzle-kit';

/** `driver: 'expo'` faz o drizzle-kit emitir, além do .sql, um
 *  drizzle/migrations.js que o `useMigrations` do expo-sqlite importa em
 *  tempo de bundle. Sem ele não há como aplicar migração no dispositivo:
 *  o app não tem sistema de arquivos para ler .sql solto. */
export default {
  dialect: 'sqlite',
  driver: 'expo',
  schema: './src/db/schema.ts',
  out: './drizzle',
} satisfies Config;
