/** CSV de verdade (RFC 4180), não `split(',')`.
 *
 *  A fatura do Nubank traz o valor entre aspas porque a vírgula é o separador
 *  decimal ("9,99"), e a descrição pode ter aspas dobradas
 *  (`"IOF de ""Loja X"""`). Separar por vírgula partiria o valor ao meio.
 *
 *  Aceita \n e \r\n, BOM no começo e quebra de linha dentro de campo entre
 *  aspas. Linhas vazias são descartadas.
 */
/** Marca de ordem de bytes que o Excel e alguns bancos põem no início. */
const BOM = String.fromCharCode(0xfeff);

export function lerCsv(texto: string): string[][] {
  const t = texto.startsWith(BOM) ? texto.slice(1) : texto;
  const linhas: string[][] = [];
  let linha: string[] = [];
  let campo = '';
  let entreAspas = false;

  const fecharLinha = () => {
    linha.push(campo);
    campo = '';
    if (linha.some((c) => c.trim() !== '')) linhas.push(linha);
    linha = [];
  };

  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (entreAspas) {
      if (c !== '"') campo += c;
      else if (t[i + 1] === '"') {
        campo += '"';
        i++;
      } else entreAspas = false;
      continue;
    }
    if (c === '"') entreAspas = true;
    else if (c === ',') {
      linha.push(campo);
      campo = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      fecharLinha();
    } else campo += c;
  }
  if (entreAspas) throw new Error('Arquivo CSV com aspas sem fechar.');
  fecharLinha();
  return linhas;
}
