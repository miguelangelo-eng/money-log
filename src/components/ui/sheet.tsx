/** EscolhaSheet — folha inferior com opções (o ConfirmSheet de
 *  replica/design/components.md).
 *
 *  Existe porque o `Alert` do Android comporta no máximo três botões, e
 *  "só esta / esta e as próximas / todas / cancelar" são quatro: o quarto
 *  simplesmente some. Folha inferior também é o que a especificação pede —
 *  alcance do polegar, scrim atrás, cada opção dizendo quantas linhas atinge.
 */

import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { radius, space, useTheme } from '@/design/theme';

import { Button, Txt } from './primitives';

export interface OpcaoDaFolha {
  label: string;
  onPress: () => void;
  /** `danger` para a ação destrutiva. Nunca a primeira da lista: ela não pode
   *  ser o alvo "natural" do dedo nem do foco inicial. */
  variant?: 'secondary' | 'danger';
}

export function EscolhaSheet({
  visivel,
  titulo,
  texto,
  opcoes,
  onCancelar,
}: {
  visivel: boolean;
  titulo: string;
  texto?: string;
  opcoes: OpcaoDaFolha[];
  onCancelar: () => void;
}) {
  const t = useTheme();
  const inset = useSafeAreaInsets();

  return (
    <Modal visible={visivel} transparent animationType="slide" onRequestClose={onCancelar}>
      <View style={styles.fundo}>
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: t.scrim }]}
          onPress={onCancelar}
          accessibilityLabel="Fechar"
          accessibilityRole="button"
        />
        <View
          accessibilityViewIsModal
          style={[
            styles.folha,
            { backgroundColor: t.surface, paddingBottom: space[4] + inset.bottom },
          ]}>
          <Txt variant="lg">{titulo}</Txt>
          {texto ? (
            <Txt variant="sm" color="textMuted" style={{ marginTop: space[1] }}>
              {texto}
            </Txt>
          ) : null}
          <View style={styles.opcoes}>
            {opcoes.map((o) => (
              <Button key={o.label} label={o.label} variant={o.variant ?? 'secondary'} onPress={o.onPress} />
            ))}
            <Button label="Cancelar" variant="ghost" onPress={onCancelar} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fundo: { flex: 1, justifyContent: 'flex-end' },
  folha: {
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: space[4],
  },
  opcoes: { gap: space[2], marginTop: space[4] },
});
