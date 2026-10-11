/** Campo de data do lançamento.
 *
 *  Os dois casos que respondem pela maior parte do uso — hoje e ontem — ficam a
 *  um toque. Qualquer outra data abre o seletor nativo do sistema (dialog no
 *  Android, calendário no iOS). Data futura é permitida e avisada: o
 *  lançamento entra como previsto e não mexe no saldo até a data chegar.
 *
 *  A conversão Date <-> data civil passa por toLocalDate/today, que usam
 *  meia-noite LOCAL — ver o bug de fuso descrito em src/lib/civil-date.ts.
 */

import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';

import { space } from '@/design/theme';
import { addDays, isAfter, parse, toLocalDate, today, type CivilDate } from '@/lib/civil-date';

import { Button, Txt } from './primitives';

const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** 'sex, 09/10' — sem Intl, para não depender do suporte a locale do motor JS. */
export function dataCurta(d: CivilDate): string {
  const { day, month } = parse(d);
  const dia = SEMANA[toLocalDate(d).getDay()];
  return `${dia}, ${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}`;
}

export function DateField({
  value,
  onChange,
  label = 'Data',
}: {
  value: CivilDate;
  onChange: (d: CivilDate) => void;
  label?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const hoje = today();
  const ontem = addDays(hoje, -1);
  const outra = value !== hoje && value !== ontem;

  function aoEscolher(e: DateTimePickerEvent, d?: Date) {
    // No Android o dialog fecha sozinho; no iOS fechamos ao escolher.
    setAberto(false);
    if (e.type === 'set' && d) onChange(today(d));
  }

  return (
    <View style={{ marginTop: space[3] }}>
      <Txt variant="sm" style={{ fontWeight: '600', marginBottom: space[1] }}>
        {label}
      </Txt>
      <View style={styles.linha}>
        <Button
          label="Hoje"
          size="sm"
          variant={value === hoje ? 'primary' : 'secondary'}
          onPress={() => onChange(hoje)}
          style={styles.flex}
        />
        <Button
          label="Ontem"
          size="sm"
          variant={value === ontem ? 'primary' : 'secondary'}
          onPress={() => onChange(ontem)}
          style={styles.flex}
        />
        <Button
          label={outra ? dataCurta(value) : 'Outra data'}
          size="sm"
          variant={outra ? 'primary' : 'secondary'}
          onPress={() => setAberto(true)}
          style={styles.flex}
        />
      </View>

      {isAfter(value, hoje) ? (
        <Txt variant="xs" color="warningInk" style={{ marginTop: space[1] }}>
          {`⚠ ${dataCurta(value)} é no futuro: entra como previsto e não mexe no saldo até lá.`}
        </Txt>
      ) : null}

      {aberto ? (
        <DateTimePicker
          value={toLocalDate(value)}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          maximumDate={toLocalDate(addDays(hoje, 365))}
          onChange={aoEscolher}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  linha: { flexDirection: 'row', gap: space[2] },
  flex: { flex: 1 },
});
