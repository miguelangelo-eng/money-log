/** O template do Expo importa CSS (global e module) mas nao traz declaracao
 *  de tipo para isso, o que faz o tsc reclamar em arquivos que nao sao meus.
 *  Estas tres linhas resolvem, e valem para o web do React Native Web. */
declare module '*.css';
declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}
